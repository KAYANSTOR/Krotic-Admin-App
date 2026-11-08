// ============================================================
// توثيق طلبات جهاز مالك الشبكة (sales/ingest و sales/cancel)
// ------------------------------------------------------------
// 1) Firebase ID token -> UID من التوكن فقط، وحسابات المدير مرفوضة.
// 2) users/{uid} -> networkId (أو UID للحسابات القديمة) ومالك الشبكة.
// 3) HMAC-SHA256 بسر الشبكة على `timestamp.canonical` بانحراف ±5 دقائق،
//    مع المفتاح السابق خلال نافذة التدوير فقط.
// كل مسار يمرر تمثيله القانوني الخاص؛ قواعد التوثيق واحدة.
// ============================================================

import { createHmac, timingSafeEqual } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { isAdminUid } from './firebaseAdmin.js';

export const HMAC_MAX_SKEW_MS = 5 * 60 * 1000;
const NETWORK_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function signCanonicalReceipt({ canonical, timestamp, secret }) {
  return `${timestamp}.${createHmac('sha256', secret)
    .update(`${timestamp}.${canonical}`)
    .digest('hex')}`;
}

export function verifyCanonicalReceipt({ token, canonical, secret, now = Date.now(), maxSkewMs = HMAC_MAX_SKEW_MS }) {
  if (!token || !secret) return { ok: false, error: 'hmac_invalid' };
  const separator = token.indexOf('.');
  if (separator <= 0) return { ok: false, error: 'hmac_invalid' };
  const timestamp = Number(token.slice(0, separator));
  const signature = token.slice(separator + 1);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > maxSkewMs || !/^[a-f0-9]{64}$/i.test(signature)) {
    return { ok: false, error: 'hmac_expired_or_malformed' };
  }
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${canonical}`)
    .digest('hex');
  const actualBytes = Buffer.from(signature, 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    return { ok: false, error: 'hmac_invalid' };
  }
  return { ok: true, timestamp };
}

/**
 * Tries the current network key first and the previous key only while the
 * server-defined rotation grace window still includes it (the candidate list
 * from networkSecretCandidates already applies that window).
 */
export function verifyCanonicalReceiptWithCandidates({ token, canonical, candidates, now = Date.now() }) {
  let lastError = 'hmac_invalid';
  for (const candidate of candidates || []) {
    const attempt = verifyCanonicalReceipt({ token, canonical, secret: candidate.secret, now });
    if (attempt.ok) {
      return { ...attempt, secretVersion: candidate.version, usedPrevious: candidate.current === false };
    }
    if (attempt.error !== 'hmac_invalid') lastError = attempt.error;
  }
  return { ok: false, error: lastError };
}

/** Bearer ID token -> UID; Admins/{uid} is rejected (client accounts only). */
export async function resolveClientUid(req, dependencies = {}, { label = 'sales' } = {}) {
  const authHeader = String(req.headers?.authorization || '');
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!idToken) return { ok: false, status: 401, error: 'missing_token' };

  const getAuthFn = dependencies.getAuth || getAuth;
  let uid;
  try {
    uid = (await getAuthFn().verifyIdToken(idToken)).uid;
  } catch {
    return { ok: false, status: 401, error: 'invalid_token' };
  }

  const getFirestoreFn = dependencies.getFirestore || getFirestore;
  const adminCheck = dependencies.isAdminUid || isAdminUid;
  try {
    if (await adminCheck(uid, getFirestoreFn)) return { ok: false, status: 403, error: 'not_client_account' };
  } catch (error) {
    console.error(`${label}: admin lookup failed`, { code: error?.code, message: error?.message });
    if (error?.code === 8 || error?.code === 'RESOURCE_EXHAUSTED') {
      return { ok: false, status: 503, error: 'firestore_quota_exceeded' };
    }
    return { ok: false, status: 500, error: 'admin_check_failed' };
  }
  return { ok: true, uid };
}

/**
 * users/{uid} -> owned networks/{networkId}. Firestore errors propagate to the
 * caller, which maps them together with the network key errors.
 */
export async function resolveOwnedNetwork(db, uid) {
  const userSnapshot = await db.collection('users').doc(uid).get();
  if (!userSnapshot.exists) return { ok: false, status: 404, error: 'account_not_found' };
  const user = userSnapshot.data() || {};
  const networkId = typeof user.networkId === 'string' && user.networkId.trim() ? user.networkId.trim()
    : typeof user.network_id === 'string' && user.network_id.trim() ? user.network_id.trim()
      : uid;
  if (!NETWORK_ID_PATTERN.test(networkId)) {
    return { ok: false, status: 409, error: 'network_mapping_invalid' };
  }
  const networkSnapshot = await db.collection('networks').doc(networkId).get();
  if (!networkSnapshot.exists) return { ok: false, status: 409, error: 'network_not_provisioned' };
  const network = networkSnapshot.data() || {};
  if ((network.owner_uid && network.owner_uid !== uid) || (!network.owner_uid && networkId !== uid)) {
    return { ok: false, status: 403, error: 'network_owner_mismatch' };
  }
  return { ok: true, userSnapshot, user, networkId, network };
}

/** Maps an exception thrown during user/network/key lookup to an HTTP error. */
export function networkLookupFailure(error, { label = 'sales', uid } = {}) {
  if (error?.message === 'network_secret_master_not_configured') {
    return { status: 503, error: 'hmac_not_configured' };
  }
  if (error?.message === 'network_secret_decryption_failed' || error?.message === 'network_secret_envelope_invalid') {
    console.error(`${label}: network key unavailable`, { uid });
    return { status: 503, error: 'network_secret_unavailable' };
  }
  console.error(`${label}: network key lookup failed`, {
    uid,
    code: error?.code,
    message: error?.message,
  });
  return { status: 500, error: 'network_secret_lookup_failed' };
}
