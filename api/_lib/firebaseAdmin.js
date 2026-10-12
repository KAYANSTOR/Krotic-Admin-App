// ============================================================
// Krotak Pro — shared Firebase Admin initializer for Vercel functions
// ------------------------------------------------------------
// Not a route: Vercel does not deploy files/directories whose name starts
// with an underscore, so `api/_lib/*` is import-only.
// Requires env var: FIREBASE_SERVICE_ACCOUNT (JSON text or base64 of it).
// ============================================================

import { initializeApp, getApps, cert } from 'firebase-admin/app';

export function ensureFirebaseAdmin() {
  if (getApps().length > 0) return { ok: true };

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw || !raw.trim()) return { ok: false, error: 'server_not_configured' };

  let text = raw.trim();
  if (!text.startsWith('{')) {
    try {
      text = Buffer.from(text, 'base64').toString('utf8');
    } catch {
      return { ok: false, error: 'invalid_service_account' };
    }
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid_service_account' };
  }

  try {
    initializeApp({ credential: cert(serviceAccount) });
  } catch {
    return { ok: false, error: 'invalid_service_account' };
  }
  return { ok: true };
}

/** Verifies the Bearer ID token and that the caller owns an Admins/{uid} doc. */
export async function authenticateAdmin(req, { getAuth, getFirestore }) {
  const authHeader = String(req.headers.authorization || '');
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!idToken) return { ok: false, status: 401, error: 'missing_token' };

  let callerUid;
  try {
    callerUid = (await getAuth().verifyIdToken(idToken)).uid;
  } catch {
    return { ok: false, status: 401, error: 'invalid_token' };
  }

  try {
    const adminSnap = await getFirestore().collection('Admins').doc(callerUid).get();
    const admin = adminSnap.exists ? adminSnap.data() : null;
    if (!admin || admin.uid !== callerUid) return { ok: false, status: 403, error: 'not_admin' };
  } catch (error) {
    console.error('admin check failed', error);
    return { ok: false, status: 500, error: 'admin_check_failed' };
  }
  return { ok: true, callerUid };
}
