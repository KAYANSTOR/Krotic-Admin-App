import { getAuth } from 'firebase-admin/auth';
import { ensureFirebaseAdmin, getAppFirestore, isAdminUid } from './firebaseAdmin.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

function requestedLimit(req) {
  const raw = new URL(req.url || '/api/device-heartbeats', 'https://krotak.invalid')
    .searchParams.get('limit');
  if (raw == null || raw.trim() === '') return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, parsed));
}

function publicHeartbeat(snapshot) {
  const data = snapshot.data() || {};
  const networkId = snapshot.ref?.parent?.parent?.id;
  if (typeof networkId !== 'string' || !networkId) return null;
  return {
    installationId: String(data.installationId || snapshot.id || ''),
    accountId: typeof data.accountId === 'string' ? data.accountId : '',
    networkId,
    schemaVersion: Number.isSafeInteger(data.schemaVersion) ? data.schemaVersion : null,
    appVersion: typeof data.appVersion === 'string' ? data.appVersion : '',
    releaseId: typeof data.releaseId === 'string' ? data.releaseId : '',
    serverReceivedAt: typeof data.serverReceivedAt === 'string' ? data.serverReceivedAt : null,
    serverReceivedAtMs: Number.isSafeInteger(data.serverReceivedAtMs) ? data.serverReceivedAtMs : null,
    lastSyncAt: typeof data.lastSyncAt === 'string' ? data.lastSyncAt : null,
    pendingCount: Number.isSafeInteger(data.pendingCount) && data.pendingCount >= 0 ? data.pendingCount : null,
    oldestPendingAt: typeof data.oldestPendingAt === 'string' ? data.oldestPendingAt : null,
    unknownDeliveryCount: Number.isSafeInteger(data.unknownDeliveryCount) && data.unknownDeliveryCount >= 0
      ? data.unknownDeliveryCount : null,
    lastError: typeof data.lastError === 'string' ? data.lastError.slice(0, 500) : null,
    riskSignals: Array.isArray(data.riskSignals)
      ? data.riskSignals.filter((value) => typeof value === 'string').slice(0, 32)
      : [],
  };
}

/** Admin-only, read-only view of device heartbeat telemetry. */
export default async function handler(req, res, dependencies = {}) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const init = (dependencies.ensureFirebaseAdmin || ensureFirebaseAdmin)();
  if (!init?.ok) {
    return res.status(503).json({ success: false, error: init?.error || 'server_not_configured' });
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

  const db = dependencies.db || getAppFirestore();
  try {
    const adminCheck = dependencies.isAdminUid || isAdminUid;
    if (!(await adminCheck(uid, () => db))) {
      return res.status(403).json({ success: false, error: 'not_admin' });
    }
    const limit = requestedLimit(req);
    const snapshot = await db.collectionGroup('device_heartbeats')
      .orderBy('serverReceivedAtMs', 'desc')
      .limit(limit)
      .get();
    const devices = snapshot.docs.map(publicHeartbeat).filter(Boolean);
    return res.status(200).json({ success: true, limit, devices });
  } catch (error) {
    const quotaExceeded = error?.code === 8
      || error?.code === 'RESOURCE_EXHAUSTED'
      || String(error?.message || '').includes('RESOURCE_EXHAUSTED');
    console.error('device-heartbeats: read failed', { uid, code: error?.code });
    return res.status(quotaExceeded ? 503 : 500).json({
      success: false,
      error: quotaExceeded ? 'firestore_quota_exceeded' : 'heartbeat_query_failed',
    });
  }
}
