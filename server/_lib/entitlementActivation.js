import { createPrivateKey, sign } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { ensureFirebaseAdmin } from './firebaseAdmin.js';
import { accessStateMatches } from './accessReconciliation.js';
import { loadAccountAccess } from './accountAccess.js';
import { appendHistory, planDeviceTransfer } from './deviceTransferPolicy.js';

export const ENTITLEMENT_KEY_ID = 'ed25519-krotak-2026-10-v1';
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const OPERATIONS = Object.freeze(['sell', 'settle', 'sync', 'support', 'readOnly']);
const DAY_MS = 24 * 60 * 60 * 1000;

// سياسة العمل دون اتصال منفصلة عن نهاية الاستحقاق التجاري:
// - commercialUntil: آخر لحظة يُسمح فيها بالعمليات التجارية (sell/settle).
// - maxOfflineUntil: آخر لحظة يبقى فيها العقد صالحاً للعمل دون اتصال،
//   وتمنح مهلة قصيرة بعد الانتهاء التجاري كي يستطيع الجهاز مزامنة ما تبقّى
//   وطلب الدعم والقراءة، مع سقف أقصى يجبر الجهاز على العودة للخادم.
export const ENTITLEMENT_OFFLINE_GRACE_MS = 7 * DAY_MS;
export const ENTITLEMENT_MAX_OFFLINE_MS = 30 * DAY_MS;

function policyMs(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 && raw <= 365 * DAY_MS ? raw : fallback;
}

/** Returns ISO boundaries so the lease can carry both policies explicitly. */
export function entitlementLeaseWindow({
  issuedAtMs,
  commercialUntilMs,
  offlineGraceMs = policyMs('ENTITLEMENT_OFFLINE_GRACE_MS', ENTITLEMENT_OFFLINE_GRACE_MS),
  maxOfflineMs = policyMs('ENTITLEMENT_MAX_OFFLINE_MS', ENTITLEMENT_MAX_OFFLINE_MS),
}) {
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(commercialUntilMs)) return null;
  const commercial = Math.max(issuedAtMs, commercialUntilMs);
  const offline = Math.min(commercial + offlineGraceMs, issuedAtMs + maxOfflineMs);
  return {
    commercialUntilMs: commercial,
    maxOfflineUntilMs: offline,
    commercialUntil: new Date(commercial).toISOString(),
    maxOfflineUntil: new Date(offline).toISOString(),
  };
}

function leaseVersionFor(user) {
  const raw = Number(user?.entitlementVersion);
  return Number.isSafeInteger(raw) && raw >= 1 ? raw : 1;
}

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
  if (input.userId != null && typeof input.userId !== 'string') {
    return response(res, 400, { error: 'user_id_invalid' });
  }
  if (claimedUid && !UID_PATTERN.test(claimedUid)) {
    return response(res, 400, { error: 'user_id_invalid' });
  }
  const deviceIdCandidate = typeof input.deviceId === 'string' ? input.deviceId.trim() : '';
  const installationCandidate = typeof input.installationId === 'string' ? input.installationId.trim() : '';
  const installationId = deviceIdCandidate || installationCandidate;
  if (!installationId || !INSTALLATION_ID_PATTERN.test(installationId)) {
    return response(res, 400, { error: 'installation_id_required' });
  }
  if (deviceIdCandidate && installationCandidate && deviceIdCandidate !== installationCandidate) {
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
  if (claimedUid && claimedUid !== uid) return response(res, 403, { error: 'user_identity_mismatch' });

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
  const bindingRef = db.collection('device_bindings').doc(installationId);

  try {
    const issued = await db.runTransaction(async (transaction) => {
      const read = (ref) => transaction.get(ref);
      const account = await loadAccountAccess(db, uid, { read, nowMs: now });
      if (!account.exists) return { error: 'account_not_found', status: 404 };
      const { user, network, networkRef, access } = account;

      const bindingSnapshot = await transaction.get(bindingRef);
      const binding = bindingSnapshot.exists ? (bindingSnapshot.data() || {}) : {};
      const bindingUid = typeof binding.uid === 'string' ? binding.uid.trim() : '';
      if (bindingUid && bindingUid !== uid) {
        // A binding left behind by a deleted account must not lock the phone
        // out forever: release it when its owner no longer exists.
        const ownerSnapshot = await transaction.get(db.collection('users').doc(bindingUid));
        if (ownerSnapshot.exists) {
          return { error: 'installation_bound_to_another_account', status: 409 };
        }
      }

      if (!access.eligible) {
        // `error` keeps its historical value for installed apps; `reason`
        // tells the app exactly which screen to show.
        return { error: 'account_not_eligible', reason: access.reason, status: 403 };
      }
      const accessState = access.state;
      const accessStatus = accessState.accessStatus;
      const endMillis = access.endMs;

      const boundInstallationId = typeof user.entitlementInstallationId === 'string'
        ? user.entitlementInstallationId.trim()
        : '';
      let leaseVersion = leaseVersionFor(user);
      const userPatch = {};
      if (boundInstallationId && boundInstallationId !== installationId) {
        const decision = planDeviceTransfer({ user, installationId, nowMs: now });
        if (!decision.allowed) {
          // Record the refused installation so the admin can approve it from
          // the dashboard (device-rebind) without asking the customer for ids.
          transaction.set(userRef, {
            entitlementPendingTransfer: {
              installationId,
              reason: decision.reason,
              requestedAtMs: now,
            },
            // Bumped so the admin dashboard's delta sync picks the request up.
            updatedAtMs: now,
          }, { merge: true });
          return { error: decision.error, reason: decision.reason, status: 409 };
        }
        leaseVersion = decision.nextVersion;
        Object.assign(userPatch, {
          entitlementInstallationId: installationId,
          entitlementInstallationBoundAt: serverTimestamp(),
          entitlementVersion: leaseVersion,
          entitlementPreviousInstallationId: boundInstallationId,
          entitlementInstallationHistory: decision.history,
          entitlementAutoTransfersMs: decision.transfers,
          entitlementLastTransferAtMs: now,
          entitlementLastTransferBy: 'self_service',
        });
        transaction.set(db.collection('admin_audit_logs').doc(), {
          action: 'ENTITLEMENT_DEVICE_SELF_TRANSFER',
          actorUid: uid,
          uid,
          details: {
            previousInstallationId: boundInstallationId,
            installationId,
            version: leaseVersion,
            transfersInWindow: decision.transfers.length,
          },
          createdAt: serverTimestamp(),
          createdAtMs: now,
        });
      } else if (!boundInstallationId) {
        Object.assign(userPatch, {
          entitlementInstallationId: installationId,
          entitlementInstallationBoundAt: serverTimestamp(),
          entitlementVersion: leaseVersion,
          entitlementInstallationHistory: appendHistory(user.entitlementInstallationHistory, installationId),
        });
      }

      // A previous deployment could update users and networks at different times.
      // Reconcile the older record before issuing a lease so the client cannot
      // receive "suspended" or an old expiry after an admin renewal.
      const { updatedAtMs: _ignoredUpdatedAtMs, ...accessFields } = accessState;
      if (!accessStateMatches(user, accessState)) {
        Object.assign(userPatch, accessFields, { updatedAt: serverTimestamp(), updatedAtMs: now });
      }
      // The device that is now issued a lease no longer has a pending request.
      if (user.entitlementPendingTransfer) userPatch.entitlementPendingTransfer = null;
      if (Object.keys(userPatch).length) {
        // Any binding change must reach the admin dashboard (delta sync by updatedAtMs).
        userPatch.updatedAtMs = now;
        transaction.set(account.userRef, userPatch, { merge: true });
      }
      if (network && !accessStateMatches(network, accessState)) {
        transaction.set(networkRef, {
          ...accessFields,
          updatedAt: serverTimestamp(),
          updatedAtMs: now,
        }, { merge: true });
      }
      if (!bindingSnapshot.exists || bindingUid !== uid) {
        transaction.set(bindingRef, {
          uid,
          installationId,
          boundAt: serverTimestamp(),
          updatedAtMs: now,
        }, { merge: false });
      }

      const window = entitlementLeaseWindow({
        issuedAtMs: now,
        commercialUntilMs: endMillis,
      });
      if (!window) return { error: 'account_not_eligible', status: 403 };

      const issuedAt = new Date(now).toISOString();
      // Keep this declaration order stable: the client verifies the Ed25519
      // signature over this exact serialized payload, so reordering changes
      // the signed bytes. Required contract fields stay first.
      const payload = {
        uid,
        installationId,
        issuedAt,
        notBefore: issuedAt,
        version: leaseVersion,
        keyId: ENTITLEMENT_KEY_ID,
        operations: [...OPERATIONS],
        commercialUntil: window.commercialUntil,
        maxOfflineUntil: window.maxOfflineUntil,
        serverTime: issuedAt,
        ...(accessStatus === 'TRIAL' ? { trialEndsAt: window.commercialUntil } : {}),
        // Legacy alias keeps its previous meaning (commercial end) for older
        // clients; the dedicated offline deadline is maxOfflineUntil.
        expiry: window.commercialUntil,
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

    if (issued?.error) {
      return response(res, issued.status, {
        error: issued.error,
        ...(issued.reason ? { reason: issued.reason } : {}),
      });
    }
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
