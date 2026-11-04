import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { ensureFirebaseAdmin, isAdminUid } from '../firebaseAdmin.js';

const NETWORK_ID_PATTERN = /^[A-Za-z0-9_-]{6,128}$/;

export function bearerToken(req) {
  const header = String(req?.headers?.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

export function normalizeNetworkId(value) {
  const networkId = typeof value === 'string' ? value.trim() : '';
  return NETWORK_ID_PATTERN.test(networkId) ? networkId : null;
}

/** Verify Firebase identity and authorize either the network owner or an admin. */
export async function authorizeNetworkRequest(req, networkId, dependencies = {}) {
  const ensure = dependencies.ensureFirebaseAdmin || ensureFirebaseAdmin;
  const configured = ensure();
  if (!configured?.ok) {
    return { ok: false, status: 503, error: configured?.error || 'server_not_configured' };
  }

  const idToken = bearerToken(req);
  if (!idToken) return { ok: false, status: 401, error: 'missing_token' };

  const getAuthFn = dependencies.getAuth || getAuth;
  const db = dependencies.db || (dependencies.getFirestore || getFirestore)();
  let callerUid;
  try {
    const decoded = await getAuthFn().verifyIdToken(idToken);
    callerUid = decoded?.uid;
  } catch {
    return { ok: false, status: 401, error: 'invalid_token' };
  }
  if (typeof callerUid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(callerUid)) {
    return { ok: false, status: 401, error: 'invalid_token' };
  }

  let networkSnap;
  try {
    networkSnap = await db.collection('networks').doc(networkId).get();
  } catch (error) {
    console.error('whatsapp network authorization read failed', { code: error?.code });
    return { ok: false, status: 503, error: 'network_lookup_failed' };
  }
  if (!networkSnap.exists) return { ok: false, status: 404, error: 'network_not_found' };
  const network = networkSnap.data() || {};
  const ownerUid = [network.owner_uid, network.ownerUid, network.uid]
    .find((candidate) => typeof candidate === 'string' && candidate.length > 0)
    || (networkId === callerUid ? callerUid : null);

  let admin = false;
  try {
    admin = await (dependencies.isAdminUid || isAdminUid)(callerUid, () => db);
  } catch (error) {
    console.error('whatsapp admin authorization check failed', { code: error?.code });
    return { ok: false, status: 503, error: 'admin_check_failed' };
  }
  if (!admin && ownerUid !== callerUid) {
    return { ok: false, status: 403, error: 'network_owner_mismatch' };
  }
  return { ok: true, db, network, networkId, callerUid, ownerUid, isAdmin: admin };
}
