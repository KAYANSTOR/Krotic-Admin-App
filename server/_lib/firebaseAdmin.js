import fs from 'node:fs';
import path from 'node:path';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore as getBaseFirestore } from 'firebase-admin/firestore';

// Short-lived membership cache limits repeated Admins/{uid} reads from client retry bursts.
// Membership changes take effect within at most 15 seconds; Firestore failures are never cached.
const ADMIN_MEMBERSHIP_CACHE_TTL_MS = 15_000;
const ADMIN_MEMBERSHIP_CACHE_MAX = 500;
const adminMembershipCache = new Map();

export const PRIMARY_ADMIN_EMAIL = 'jarallhalkboudi@gmail.com';
export const PRIMARY_ADMIN_UID = 'akicZMi3cqcDXqlLUZMLL9OdAg53';

export function getAppDatabaseId() {
  if (process.env.VITE_FIRESTORE_DATABASE_ID) {
    return process.env.VITE_FIRESTORE_DATABASE_ID;
  }
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (cfg?.firestoreDatabaseId) return cfg.firestoreDatabaseId;
    }
  } catch {}
  return '(default)';
}

export function getAppFirestore() {
  const dbId = getAppDatabaseId();
  return dbId && dbId !== '(default)' ? getBaseFirestore(dbId) : getBaseFirestore();
}

export async function isAdminUid(uid, getFirestoreParam) {
  const now = Date.now();
  const cached = adminMembershipCache.get(uid);
  if (cached && cached.expiresAt > now) return cached.isAdmin;
  if (cached) adminMembershipCache.delete(uid);

  // If primary admin, they are inherently authorized without needing extra Firestore quota
  if (uid === PRIMARY_ADMIN_UID) {
    adminMembershipCache.set(uid, { isAdmin: true, expiresAt: now + ADMIN_MEMBERSHIP_CACHE_TTL_MS });
    return true;
  }

  const db = (typeof getFirestoreParam === 'function' ? getFirestoreParam() : null) || getAppFirestore();
  let snap = null;
  try {
    snap = await db.collection('Admins').doc(uid).get();
  } catch (err) {
    if (err?.code === 8 || err?.message?.includes('RESOURCE_EXHAUSTED')) {
      console.warn('Admins check encountered Firestore quota limit');
    }
  }
  const data = snap?.exists ? snap.data() : null;
  let isAdmin = Boolean(data && data.uid === uid);

  // If this is the primary owner account and the document is not yet in this database instance,
  // self-heal and create the verified document now.
  if (!isAdmin && uid === PRIMARY_ADMIN_UID) {
    try {
      await db.collection('Admins').doc(uid).set({
        uid,
        email: PRIMARY_ADMIN_EMAIL,
        name: 'مدير Krotak Pro',
        role: 'admin',
        createdAt: 1791156000000,
      }, { merge: true });
      isAdmin = true;
    } catch {}
  }

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
  let callerEmail;
  try {
    const decoded = await getAuth().verifyIdToken(idToken);
    callerUid = decoded.uid;
    callerEmail = decoded.email;
  } catch {
    return { ok: false, status: 401, error: 'invalid_token' };
  }

  try {
    if (callerEmail === PRIMARY_ADMIN_EMAIL || callerUid === PRIMARY_ADMIN_UID) {
      await isAdminUid(callerUid, getFirestore);
    }
    if (!(await isAdminUid(callerUid, getFirestore))) return { ok: false, status: 403, error: 'not_admin' };
  } catch (error) {
    console.error('admin check failed', { code: error?.code, message: error?.message });
    if (error?.code === 8 || error?.code === 'RESOURCE_EXHAUSTED') {
      return { ok: false, status: 503, error: 'firestore_quota_exceeded' };
    }
    return { ok: false, status: 500, error: 'admin_check_failed' };
  }
  return { ok: true, callerUid, callerEmail };
}

export async function syncDatabaseInstancesIfNeeded() {
  const init = ensureFirebaseAdmin();
  if (!init.ok) return;

  const adminDocData = {
    uid: PRIMARY_ADMIN_UID,
    email: PRIMARY_ADMIN_EMAIL,
    name: 'مدير Krotak Pro',
    role: 'admin',
    createdAt: 1791156000000,
  };

  try {
    const db = getAppFirestore();
    await Promise.all([
      db.collection('Admins').doc(PRIMARY_ADMIN_UID).set(adminDocData, { merge: true }).catch(() => null),
      db.collection('admins').doc(PRIMARY_ADMIN_UID).set(adminDocData, { merge: true }).catch(() => null),
    ]);
  } catch (err) {
    console.warn('Could not ensure primary admin doc:', err?.message);
  }
}

