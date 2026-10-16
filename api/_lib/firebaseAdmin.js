// ============================================================
// Krotak Pro — shared Firebase Admin initializer for Vercel functions
// ------------------------------------------------------------
// Not a route: Vercel does not deploy files/directories whose name starts
// with an underscore, so `api/_lib/*` is import-only.
// Requires env var: FIREBASE_SERVICE_ACCOUNT (JSON text or base64 of it).
// ============================================================

import { initializeApp, getApps, cert } from 'firebase-admin/app';

// Short-lived membership cache limits repeated Admins/{uid} reads from client retry bursts.
// Membership changes take effect within at most 15 seconds; Firestore failures are never cached.
const ADMIN_MEMBERSHIP_CACHE_TTL_MS = 15_000;
const ADMIN_MEMBERSHIP_CACHE_MAX = 500;
const adminMembershipCache = new Map();

export async function isAdminUid(uid, getFirestore) {
  const now = Date.now();
  const cached = adminMembershipCache.get(uid);
  if (cached && cached.expiresAt > now) return cached.isAdmin;
  if (cached) adminMembershipCache.delete(uid);

  const snap = await getFirestore().collection('Admins').doc(uid).get();
  const data = snap.exists ? snap.data() : null;
  const isAdmin = Boolean(data && data.uid === uid);
  adminMembershipCache.set(uid, { isAdmin, expiresAt: now + ADMIN_MEMBERSHIP_CACHE_TTL_MS });
  while (adminMembershipCache.size > ADMIN_MEMBERSHIP_CACHE_MAX) {
    adminMembershipCache.delete(adminMembershipCache.keys().next().value);
  }
  return isAdmin;
}

export function ensureFirebaseAdmin() {
  if (getApps().length > 0) return { ok: true };

  if (process.env.FIREBASE_EMULATOR === 'true') {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-krotic-local' });
    return { ok: true };
  }

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
    if (!(await isAdminUid(callerUid, getFirestore))) return { ok: false, status: 403, error: 'not_admin' };
  } catch (error) {
    console.error('admin check failed', { code: error?.code, message: error?.message });
    if (error?.code === 8 || error?.code === 'RESOURCE_EXHAUSTED') {
      return { ok: false, status: 503, error: 'firestore_quota_exceeded' };
    }
    return { ok: false, status: 500, error: 'admin_check_failed' };
  }
  return { ok: true, callerUid };
}
