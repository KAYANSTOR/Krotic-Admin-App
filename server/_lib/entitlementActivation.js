import { createPrivateKey, sign } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { ensureFirebaseAdmin } from './firebaseAdmin.js';

export const ENTITLEMENT_KEY_ID = 'ed25519-krotak-2026-10-v1';
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const ACTIVE_STATUSES = new Set(['TRIAL', 'ACTIVE_PAID']);
const OPERATIONS = Object.freeze(['sell', 'settle', 'sync', 'support', 'readOnly']);

function objectBody(body) {
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

function timestampMillis(value) {
  if (value == null) return NaN;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);
  if (typeof value._seconds === 'number') return value._seconds * 1000;
  return NaN;
}

function response(res, status, body) {
  return res.status(status).json(body);
}

function configuredPrivateKey(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const key = createPrivateKey(value.replace(/\\n/g, '\n'));
    return key.asymmetricKeyType === 'ed25519' ? key : null;
  } catch {
    return null;
  }
}

/**
 * Issues a signed lease only to the authenticated account's current authorized
 * installation. First activation binds that installation atomically in Firestore.
 *
 * `dependencies` is injectable for deterministic tests; production reads the
 * signing material exclusively from process.env.ENTITLEMENT_PRIVATE_KEY.
 */
export default async function activateEntitlement(req, res, dependencies = {}) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return response(res, 405, { error: 'method_not_allowed' });
  }

  const input = objectBody(req.body);
  if (!input) return response(res, 400, { error: 'invalid_json' });
  const claimedUid = typeof input.userId === 'string' ? input.userId.trim() : '';
  const installationId = typeof input.deviceId === 'string'
    ? input.deviceId.trim()
    : typeof input.installationId === 'string'
      ? input.installationId.trim()
      : '';
  if (!claimedUid || !UID_PATTERN.test(claimedUid)
      || !installationId || !INSTALLATION_ID_PATTERN.test(installationId)) {
    return response(res, 400, { error: 'userId_and_deviceId_required' });
  }
  if (input.deviceId && input.installationId
      && input.deviceId !== input.installationId) {
    return response(res, 400, { error: 'device_id_mismatch' });
  }

  const authorization = String(req.headers?.authorization || '');
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice(7).trim()
    : '';
  if (!idToken) return response(res, 401, { error: 'missing_token' });

  const configured = dependencies.ensureFirebaseAdmin
    ? dependencies.ensureFirebaseAdmin()
    : ensureFirebaseAdmin();
  if (!configured?.ok) {
    return response(res, 503, { error: configured?.error || 'server_not_configured' });
  }

  const auth = dependencies.auth || getAuth();
  let uid;
  try {
    const claims = await auth.verifyIdToken(idToken);
    uid = typeof claims.uid === 'string' ? claims.uid : '';
  } catch {
    return response(res, 401, { error: 'invalid_token' });
  }
  if (!uid || !UID_PATTERN.test(uid)) {
    return response(res, 401, { error: 'invalid_token' });
  }
  if (claimedUid !== uid) return response(res, 403, { error: 'user_identity_mismatch' });

  const privateKey = configuredPrivateKey(
    dependencies.privateKey ?? process.env.ENTITLEMENT_PRIVATE_KEY,
  );
  if (!privateKey) {
    return response(res, 503, { error: 'entitlement_signing_not_configured' });
  }

  const db = dependencies.db || getFirestore();
  const serverTimestamp = dependencies.serverTimestamp || (() => FieldValue.serverTimestamp());
  const now = dependencies.now ?? Date.now();
  const userRef = db.collection('users').doc(uid);

  try {
    const issued = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(userRef);
      if (!snapshot.exists) return { error: 'account_not_found', status: 404 };
      const user = snapshot.data() || {};
      const accessStatus = typeof user.accessStatus === 'string'
        ? user.accessStatus.trim().toUpperCase()
        : '';
      if (!ACTIVE_STATUSES.has(accessStatus)) {
        return { error: 'account_not_eligible', status: 403 };
      }

      const endMillis = timestampMillis(user.subscriptionEndsAt ?? user.subscription_end_date);
      if (!Number.isFinite(endMillis) || endMillis <= now) {
        return { error: 'account_not_eligible', status: 403 };
      }

      const boundInstallationId = typeof user.entitlementInstallationId === 'string'
        ? user.entitlementInstallationId.trim()
        : '';
      if (boundInstallationId && boundInstallationId !== installationId) {
        return { error: 'installation_mismatch', status: 409 };
      }
      if (!boundInstallationId) {
        transaction.set(userRef, {
          entitlementInstallationId: installationId,
          entitlementInstallationBoundAt: serverTimestamp(),
        }, { merge: true });
      }

      const issuedAt = new Date(now).toISOString();
      const expiry = new Date(endMillis).toISOString();
      const payload = {
        uid,
        installationId,
        issuedAt,
        notBefore: issuedAt,
        version: 1,
        keyId: ENTITLEMENT_KEY_ID,
        operations: [...OPERATIONS],
        ...(accessStatus === 'TRIAL'
          ? { trialEndsAt: expiry }
          : { commercialUntil: expiry }),
        serverTime: issuedAt,
        expiry,
        userId: uid,
        deviceId: installationId,
      };
      const signature = sign(
        null,
        Buffer.from(JSON.stringify(payload), 'utf8'),
        privateKey,
      ).toString('base64');
      return { payload, signature };
    });

    if (issued?.error) return response(res, issued.status, { error: issued.error });
    return response(res, 200, issued);
  } catch (error) {
    console.error('entitlement signing failed', {
      uid,
      code: error?.code,
      message: error?.message,
    });
    return response(res, 500, { error: 'entitlement_signing_failed' });
  }
}
