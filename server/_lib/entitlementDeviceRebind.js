import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { authenticateAdmin, ensureFirebaseAdmin } from './firebaseAdmin.js';

const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

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

/** Admin-only, audited replacement of the installation bound to an account. */
export default async function rebindEntitlementDevice(req, res, dependencies = {}) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return response(res, 405, { success: false, error: 'method_not_allowed' });
  }

  const input = objectBody(req.body);
  if (!input) return response(res, 400, { success: false, error: 'invalid_json' });
  const uid = typeof input.uid === 'string' ? input.uid.trim() : '';
  const installationCandidate = typeof input.installationId === 'string' ? input.installationId.trim() : '';
  const deviceIdCandidate = typeof input.deviceId === 'string' ? input.deviceId.trim() : '';
  const installationId = installationCandidate || deviceIdCandidate;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (installationCandidate && deviceIdCandidate
      && installationCandidate !== deviceIdCandidate) {
    return response(res, 400, { success: false, error: 'device_id_mismatch' });
  }
  if (!UID_PATTERN.test(uid)
      || !INSTALLATION_ID_PATTERN.test(installationId)
      || !reason || reason.length > 500) {
    return response(res, 400, { success: false, error: 'rebind_input_invalid' });
  }

  const configured = dependencies.ensureFirebaseAdmin
    ? dependencies.ensureFirebaseAdmin()
    : ensureFirebaseAdmin();
  if (!configured?.ok) {
    return response(res, 503, {
      success: false,
      error: configured?.error || 'server_not_configured',
    });
  }
  const getAuthFn = dependencies.getAuth || getAuth;
  const getFirestoreFn = dependencies.getFirestore || getFirestore;
  const authorize = dependencies.authenticateAdmin || authenticateAdmin;
  const caller = await authorize(req, {
    getAuth: getAuthFn,
    getFirestore: getFirestoreFn,
  });
  if (!caller.ok) {
    return response(res, caller.status, { success: false, error: caller.error });
  }

  const db = dependencies.db || getFirestoreFn();
  const serverTimestamp = dependencies.serverTimestamp || (() => FieldValue.serverTimestamp());
  const now = dependencies.now ?? Date.now();
  const userRef = db.collection('users').doc(uid);
  const auditRef = db.collection('admin_audit_logs').doc();
  const bindingRef = db.collection('device_bindings').doc(installationId);

  try {
    const result = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(userRef);
      if (!snapshot.exists) return { error: 'account_not_found', status: 404 };
      const bindingSnapshot = await transaction.get(bindingRef);
      const binding = bindingSnapshot.exists ? (bindingSnapshot.data() || {}) : {};
      const bindingUid = typeof binding.uid === 'string' ? binding.uid.trim() : '';
      if (bindingUid && bindingUid !== uid) {
        return { error: 'installation_bound_to_another_account', status: 409 };
      }
      const user = snapshot.data() || {};
      const previousInstallationId = typeof user.entitlementInstallationId === 'string'
        && user.entitlementInstallationId.trim()
        ? user.entitlementInstallationId.trim()
        : null;
      const rawVersion = Number(user.entitlementVersion);
      const previousVersion = Number.isSafeInteger(rawVersion) && rawVersion >= 1
        ? rawVersion
        : 1;
      // Rebind is the admin approval step: incrementing the lease version makes
      // every lease previously issued to the old installation stale, and the
      // new device stays locked until this transaction commits.
      const version = previousVersion + 1;
      transaction.set(userRef, {
        entitlementInstallationId: installationId,
        entitlementInstallationBoundAt: serverTimestamp(),
        entitlementPreviousInstallationId: previousInstallationId,
        entitlementVersion: version,
        entitlementReboundAt: serverTimestamp(),
        entitlementReboundAtMs: now,
        entitlementReboundBy: caller.callerUid,
        entitlementLeaseRevokedAtMs: now,
      }, { merge: true });
      transaction.set(bindingRef, {
        uid,
        installationId,
        boundAt: serverTimestamp(),
        updatedAtMs: now,
        reboundBy: caller.callerUid,
      }, { merge: true });
      transaction.set(auditRef, {
        action: 'ENTITLEMENT_DEVICE_REBIND',
        actorUid: caller.callerUid,
        targetType: 'user',
        targetId: uid,
        details: {
          previousInstallationId,
          installationId,
          reason,
          previousVersion,
          version,
          approvalSource: 'admin_api',
        },
        createdAt: serverTimestamp(),
        createdAtMs: now,
      }, { merge: false });
      return { previousInstallationId, installationId, previousVersion, version };
    });

    if (result?.error) {
      return response(res, result.status, { success: false, error: result.error });
    }
    return response(res, 200, { success: true, ...result });
  } catch (error) {
    console.error('entitlement device rebind failed', {
      uid,
      actorUid: caller.callerUid,
      code: error?.code,
      message: error?.message,
    });
    return response(res, 500, { success: false, error: 'entitlement_device_rebind_failed' });
  }
}
