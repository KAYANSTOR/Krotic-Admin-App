import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { ensureFirebaseAdmin } from '../server/_lib/firebaseAdmin.js';

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_SIGNALS = 32;
const MAX_SIGNAL_LENGTH = 96;
const MAX_LAST_ERROR_LENGTH = 500;

function objectBody(body) {
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return null; }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

export function validateHeartbeat(body) {
  const input = objectBody(body);
  if (!input) return { ok: false, error: 'invalid_json' };
  if (input.schemaVersion !== 1) return { ok: false, error: 'schema_version_unsupported' };

  const installationId = typeof input.installationId === 'string' ? input.installationId.trim() : '';
  const accountId = typeof input.accountId === 'string' ? input.accountId.trim() : '';
  const networkId = typeof input.networkId === 'string' ? input.networkId.trim() : '';
  const appVersion = typeof input.appVersion === 'string' ? input.appVersion.trim() : '';
  const releaseId = typeof input.releaseId === 'string' ? input.releaseId.trim() : '';
  if (!ID_PATTERN.test(installationId) || !ID_PATTERN.test(accountId) || !ID_PATTERN.test(networkId)) {
    return { ok: false, error: 'identity_fields_invalid' };
  }
  if (!appVersion || appVersion.length > 64 || !releaseId || releaseId.length > 128) {
    return { ok: false, error: 'version_fields_invalid' };
  }

  const pendingCount = input.pendingCount;
  const unknownDeliveryCount = input.unknownDeliveryCount;
  if (!Number.isSafeInteger(pendingCount) || pendingCount < 0 || pendingCount > 1_000_000
      || !Number.isSafeInteger(unknownDeliveryCount) || unknownDeliveryCount < 0 || unknownDeliveryCount > 1_000_000) {
    return { ok: false, error: 'counter_invalid' };
  }

  const riskSignals = input.riskSignals;
  if (!Array.isArray(riskSignals) || riskSignals.length > MAX_SIGNALS
      || riskSignals.some((v) => typeof v !== 'string' || !v.trim() || v.length > MAX_SIGNAL_LENGTH)) {
    return { ok: false, error: 'risk_signals_invalid' };
  }

  const optionalDate = (value, field) => {
    if (value == null) return { ok: true, value: null };
    if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value))) {
      return { ok: false, error: `${field}_invalid` };
    }
    return { ok: true, value: new Date(value).toISOString() };
  };
  const lastSyncAt = optionalDate(input.lastSyncAt, 'last_sync_at');
  if (!lastSyncAt.ok) return lastSyncAt;
  const oldestPendingAt = optionalDate(input.oldestPendingAt, 'oldest_pending_at');
  if (!oldestPendingAt.ok) return oldestPendingAt;

  const lastError = input.lastError == null ? null
    : typeof input.lastError === 'string' ? input.lastError.slice(0, MAX_LAST_ERROR_LENGTH) : null;
  if (input.lastError != null && typeof input.lastError !== 'string') {
    return { ok: false, error: 'last_error_invalid' };
  }

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      installationId,
      accountId,
      networkId,
      appVersion,
      releaseId,
      pendingCount,
      unknownDeliveryCount,
      riskSignals: [...new Set(riskSignals.map((v) => v.trim()))],
      lastSyncAt: lastSyncAt.value,
      oldestPendingAt: oldestPendingAt.value,
      lastError,
    },
  };
}

export default async function handler(req, res, dependencies = {}) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const validated = validateHeartbeat(req.body);
  if (!validated.ok) return res.status(400).json({ success: false, error: validated.error });

  const configured = (dependencies.ensureFirebaseAdmin || ensureFirebaseAdmin)();
  if (!configured?.ok) {
    return res.status(503).json({ success: false, error: configured?.error || 'server_not_configured' });
  }

  const authorization = String(req.headers?.authorization || '');
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!idToken) return res.status(401).json({ success: false, error: 'missing_token' });

  const auth = dependencies.auth || getAuth();
  let uid;
  try {
    const claims = await auth.verifyIdToken(idToken);
    uid = typeof claims.uid === 'string' ? claims.uid : '';
  } catch {
    return res.status(401).json({ success: false, error: 'invalid_token' });
  }
  if (!uid) return res.status(401).json({ success: false, error: 'invalid_token' });
  if (validated.value.accountId !== uid) {
    return res.status(403).json({ success: false, error: 'account_identity_mismatch' });
  }

  const db = dependencies.db || getFirestore();
  try {
    const adminSnap = await db.collection('Admins').doc(uid).get();
    const legacyAdminSnap = adminSnap.exists ? null : await db.collection('admins').doc(uid).get();
    if (adminSnap.exists || legacyAdminSnap?.exists) {
      return res.status(403).json({ success: false, error: 'not_client_account' });
    }

    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) return res.status(404).json({ success: false, error: 'account_not_found' });
    const user = userSnap.data() || {};
    const networkId = typeof user.networkId === 'string' && user.networkId.trim()
      ? user.networkId.trim() : uid;
    if (validated.value.networkId !== networkId) {
      return res.status(403).json({ success: false, error: 'network_identity_mismatch' });
    }

    const networkSnap = await db.collection('networks').doc(networkId).get();
    if (!networkSnap.exists) return res.status(404).json({ success: false, error: 'network_not_found' });
    const network = networkSnap.data() || {};
    if ((network.owner_uid && network.owner_uid !== uid) || (!network.owner_uid && networkId !== uid)) {
      return res.status(403).json({ success: false, error: 'network_owner_mismatch' });
    }

    const now = dependencies.now ?? Date.now();
    const heartbeat = {
      ...validated.value,
      accountId: uid,
      networkId,
      serverReceivedAt: new Date(now).toISOString(),
      serverReceivedAtMs: now,
      // Client telemetry is observational only; never use it to grant entitlement or validate money.
      clientLastSeenAt: typeof req.body?.lastSeenAt === 'string' && Number.isFinite(Date.parse(req.body.lastSeenAt))
        ? new Date(req.body.lastSeenAt).toISOString() : null,
    };
    const ref = db.collection('networks').doc(networkId)
      .collection('device_heartbeats').doc(validated.value.installationId);
    await ref.set(heartbeat, { merge: true });
    return res.status(200).json({
      success: true,
      schemaVersion: 1,
      receivedAt: heartbeat.serverReceivedAt,
    });
  } catch (error) {
    console.error('device-heartbeat: request failed', { uid, code: error?.code });
    return res.status(500).json({ success: false, error: 'heartbeat_failed' });
  }
}
