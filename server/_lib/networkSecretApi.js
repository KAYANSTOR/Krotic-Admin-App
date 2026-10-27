import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { authenticateAdmin, ensureFirebaseAdmin } from './firebaseAdmin.js';
import { ensureNetworkSecret, rotateNetworkSecret } from './networkSecretStore.js';

const DOC_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ACTIONS = new Set(['get', 'rotate']);
const MAX_REASON_LENGTH = 500;

function objectBody(body) {
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return {}; }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

function bearerToken(req) {
  const header = String(req.headers?.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function deriveNetworkId(user, uid) {
  const candidate = typeof user?.networkId === 'string' && user.networkId.trim()
    ? user.networkId.trim()
    : typeof user?.network_id === 'string' && user.network_id.trim()
      ? user.network_id.trim()
      : '';
  return candidate || uid;
}

function ownsNetwork(network, uid, networkId) {
  return (network.owner_uid && network.owner_uid === uid)
    || (!network.owner_uid && networkId === uid);
}

function rotationAudit({ callerUid, targetUid, networkId, reason, now }) {
  return (result) => ({
    action: 'NETWORK_SECRET_ROTATE',
    actorUid: callerUid,
    targetType: 'network',
    targetId: networkId,
    details: {
      targetUid: targetUid || null,
      networkId,
      reason,
      previousVersion: result.previousVersion,
      version: result.version,
      previousValidUntilMs: result.previousValidUntilMs,
    },
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: now,
    updatedAtMs: now,
  });
}

export async function handleNetworkSecret(req, res, dependencies = {}) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const init = (dependencies.ensureFirebaseAdmin || ensureFirebaseAdmin)();
  if (!init?.ok) return res.status(503).json({ success: false, error: init?.error || 'server_not_configured' });

  res.setHeader('Cache-Control', 'no-store');

  const input = objectBody(req.body);
  const action = input.action == null ? 'get' : String(input.action).trim().toLowerCase();
  if (!ACTIONS.has(action)) {
    return res.status(400).json({ success: false, error: 'action_invalid' });
  }

  const getAuthFn = dependencies.getAuth || getAuth;
  const getFirestoreFn = dependencies.getFirestore || getFirestore;
  const db = dependencies.db || getFirestoreFn();

  if (action === 'rotate') {
    return rotateSecret({ req, res, input, db, dependencies, getAuthFn, getFirestoreFn });
  }

  const idToken = bearerToken(req);
  if (!idToken) return res.status(401).json({ success: false, error: 'missing_token' });

  let uid;
  try {
    uid = (await getAuthFn().verifyIdToken(idToken)).uid;
  } catch {
    return res.status(401).json({ success: false, error: 'invalid_token' });
  }
  if (typeof uid !== 'string' || !UID_PATTERN.test(uid)) {
    return res.status(401).json({ success: false, error: 'invalid_token' });
  }

  try {
    const [adminSnapshot, legacyAdminSnapshot] = await Promise.all([
      db.collection('Admins').doc(uid).get(),
      db.collection('admins').doc(uid).get().catch(() => ({ exists: false })),
    ]);
    if (adminSnapshot.exists || legacyAdminSnapshot?.exists) {
      return res.status(403).json({ success: false, error: 'not_client_account' });
    }

    const userSnapshot = await db.collection('users').doc(uid).get();
    if (!userSnapshot.exists) return res.status(404).json({ success: false, error: 'network_not_provisioned' });
    const user = userSnapshot.data() || {};
    const networkId = deriveNetworkId(user, uid);
    if (!DOC_ID_PATTERN.test(networkId)) {
      return res.status(409).json({ success: false, error: 'network_mapping_invalid' });
    }

    const networkRef = db.collection('networks').doc(networkId);
    const networkSnapshot = await networkRef.get();
    if (!networkSnapshot.exists) {
      return res.status(404).json({ success: false, error: 'network_not_provisioned' });
    }
    const network = networkSnapshot.data() || {};
    if (!ownsNetwork(network, uid, networkId)) {
      return res.status(403).json({ success: false, error: 'network_owner_mismatch' });
    }

    const result = await ensureNetworkSecret(db, networkRef, {
      // Fail closed: a decryption failure is never answered with a silently
      // generated replacement key. An administrator must rotate explicitly.
      recoverUndecryptable: false,
      now: dependencies.now ?? Date.now(),
    });
    if (typeof result.networkSecret !== 'string' || !result.networkSecret) {
      // Never return an empty fallback or derive a local key: the client must
      // keep its last verified key and retry the server later.
      return res.status(503).json({ success: false, error: 'network_secret_unavailable' });
    }
    return res.status(200).json({
      success: true,
      networkId,
      networkSecret: result.networkSecret,
      networkSecretVersion: result.version,
      signatureAlgorithm: 'HMAC-SHA256',
      signatureHeader: 'x-verification-receipt',
      policyVersion: 1,
      ...(result.previousValidUntilMs
        ? { previousNetworkSecretValidUntilMs: result.previousValidUntilMs }
        : {}),
    });
  } catch (error) {
    if (error?.message === 'network_secret_master_not_configured') {
      return res.status(503).json({ success: false, error: 'hmac_not_configured' });
    }
    if (error?.message === 'network_secret_decryption_failed'
        || error?.message === 'network_secret_envelope_invalid') {
      console.error('network-secret: stored key could not be decrypted', { uid });
      return res.status(503).json({ success: false, error: 'network_secret_unavailable' });
    }
    console.error('network-secret: request failed', { uid, code: error?.message });
    return res.status(500).json({ success: false, error: 'network_secret_failed' });
  }
}


/**
 * Admin-only key rotation. The new key is intentionally not included in the
 * response; devices fetch it through the authorized `get` path. The previous
 * key remains verifiable only for the configured grace window.
 */
async function rotateSecret({ req, res, input, db, dependencies, getAuthFn, getFirestoreFn }) {
  const authorize = dependencies.authenticateAdmin || authenticateAdmin;
  let caller;
  try {
    caller = await authorize(req, { getAuth: getAuthFn, getFirestore: getFirestoreFn });
  } catch (error) {
    console.error('network-secret: admin authorization failed', { code: error?.message });
    return res.status(500).json({ success: false, error: 'admin_check_failed' });
  }
  if (!caller?.ok) {
    return res.status(caller.status).json({ success: false, error: caller.error });
  }

  const now = dependencies.now ?? Date.now();
  const reason = typeof input.reason === 'string'
    ? input.reason.trim().slice(0, MAX_REASON_LENGTH)
    : '';
  const targetUid = typeof input.uid === 'string' ? input.uid.trim() : '';
  let networkId = typeof input.networkId === 'string' ? input.networkId.trim() : '';

  if (targetUid && !UID_PATTERN.test(targetUid)) {
    return res.status(400).json({ success: false, error: 'uid_invalid' });
  }
  if (!targetUid && !networkId) {
    return res.status(400).json({ success: false, error: 'uid_or_network_id_required' });
  }

  try {
    if (targetUid) {
      const userSnapshot = await db.collection('users').doc(targetUid).get();
      if (!userSnapshot.exists) {
        return res.status(404).json({ success: false, error: 'account_not_found' });
      }
      networkId = deriveNetworkId(userSnapshot.data() || {}, targetUid);
    }
    if (!DOC_ID_PATTERN.test(networkId)) {
      return res.status(409).json({ success: false, error: 'network_mapping_invalid' });
    }

    const networkRef = db.collection('networks').doc(networkId);
    const networkSnapshot = await networkRef.get();
    if (!networkSnapshot.exists) {
      return res.status(404).json({ success: false, error: 'network_not_provisioned' });
    }
    const network = networkSnapshot.data() || {};
    if (targetUid && !ownsNetwork(network, targetUid, networkId)) {
      return res.status(403).json({ success: false, error: 'network_owner_mismatch' });
    }

    const result = await rotateNetworkSecret(db, networkRef, {
      now,
      graceMs: dependencies.rotationGraceMs,
      actorUid: caller.callerUid,
      reason,
      auditRef: db.collection('admin_audit_logs').doc(),
      auditData: rotationAudit({
        callerUid: caller.callerUid,
        targetUid: targetUid || null,
        networkId,
        reason,
        now,
      }),
    });

    return res.status(200).json({
      success: true,
      networkId,
      rotated: result.rotated,
      networkSecretVersion: result.version,
      previousNetworkSecretVersion: result.previousVersion,
      previousNetworkSecretValidUntilMs: result.previousValidUntilMs,
      previousNetworkSecretValidUntil: result.previousValidUntilMs
        ? new Date(result.previousValidUntilMs).toISOString()
        : null,
    });
  } catch (error) {
    if (error?.message === 'network_secret_master_not_configured') {
      return res.status(503).json({ success: false, error: 'hmac_not_configured' });
    }
    console.error('network-secret: rotation failed', {
      actorUid: caller.callerUid,
      networkId: networkId || null,
      code: error?.message,
    });
    return res.status(500).json({ success: false, error: 'network_secret_rotation_failed' });
  }
}

export default async function handler(req, res) {
  return handleNetworkSecret(req, res);
}
