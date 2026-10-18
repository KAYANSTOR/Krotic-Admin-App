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

  const db = (typeof getFirestoreParam === 'function' ? getFirestoreParam() : null) || getAppFirestore();
  const snap = await db.collection('Admins').doc(uid).get();
  const data = snap.exists ? snap.data() : null;
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

/**
 * Ensures data is available in the target database instance (e.g. newly provisioned custom database),
 * replicating pre-existing data from (default) if the target is initially unpopulated.
 */
export async function syncDatabaseInstancesIfNeeded() {
  const init = ensureFirebaseAdmin();
  if (!init.ok) return;

  const targetDbId = getAppDatabaseId();
  const targetDb = getAppFirestore();

  // Always ensure primary admin document exists in both Admins and admins collections across database instances
  const adminDocData = {
    uid: PRIMARY_ADMIN_UID,
    email: PRIMARY_ADMIN_EMAIL,
    name: 'مدير Krotak Pro',
    role: 'admin',
    createdAt: 1791156000000,
  };

  try {
    const defaultDb = getBaseFirestore();
    await Promise.all([
      targetDb.collection('Admins').doc(PRIMARY_ADMIN_UID).set(adminDocData, { merge: true }).catch(() => null),
      targetDb.collection('admins').doc(PRIMARY_ADMIN_UID).set(adminDocData, { merge: true }).catch(() => null),
      defaultDb.collection('Admins').doc(PRIMARY_ADMIN_UID).set(adminDocData, { merge: true }).catch(() => null),
      defaultDb.collection('admins').doc(PRIMARY_ADMIN_UID).set(adminDocData, { merge: true }).catch(() => null),
    ]);
  } catch (err) {
    console.warn('Could not set primary admin doc:', err?.message);
  }

  if (!targetDbId || targetDbId === '(default)') return;

  try {
    const defaultDb = getBaseFirestore();
    const targetUsers = await targetDb.collection('users').limit(1).get().catch(() => null);
    if (!targetUsers || targetUsers.empty) {
      console.log(`[syncDatabase] Replicating collections from (default) to ${targetDbId}...`);
      // Copy Admins
      const adminsSnap = await defaultDb.collection('Admins').get();
      for (const doc of adminsSnap.docs) {
        await targetDb.collection('Admins').doc(doc.id).set(doc.data(), { merge: true });
      }

      // Copy users
      const usersSnap = await defaultDb.collection('users').get();
      for (const doc of usersSnap.docs) {
        await targetDb.collection('users').doc(doc.id).set(doc.data(), { merge: true });
        const devs = await doc.ref.collection('devices').get().catch(() => ({ docs: [] }));
        for (const d of devs.docs) {
          await targetDb.collection('users').doc(doc.id).collection('devices').doc(d.id).set(d.data(), { merge: true });
        }
        const notifs = await doc.ref.collection('notifications').get().catch(() => ({ docs: [] }));
        for (const n of notifs.docs) {
          await targetDb.collection('users').doc(doc.id).collection('notifications').doc(n.id).set(n.data(), { merge: true });
        }
      }

      // Copy networks
      const networksSnap = await defaultDb.collection('networks').get();
      for (const doc of networksSnap.docs) {
        await targetDb.collection('networks').doc(doc.id).set(doc.data(), { merge: true });
        const meta = await doc.ref.collection('_metadata').get().catch(() => ({ docs: [] }));
        for (const m of meta.docs) {
          await targetDb.collection('networks').doc(doc.id).collection('_metadata').doc(m.id).set(m.data(), { merge: true });
        }
        const sales = await doc.ref.collection('sales').get().catch(() => ({ docs: [] }));
        for (const s of sales.docs) {
          await targetDb.collection('networks').doc(doc.id).collection('sales').doc(s.id).set(s.data(), { merge: true });
        }
        const payments = await doc.ref.collection('payments').get().catch(() => ({ docs: [] }));
        for (const p of payments.docs) {
          await targetDb.collection('networks').doc(doc.id).collection('payments').doc(p.id).set(p.data(), { merge: true });
        }
        const settlements = await doc.ref.collection('settlements').get().catch(() => ({ docs: [] }));
        for (const st of settlements.docs) {
          await targetDb.collection('networks').doc(doc.id).collection('settlements').doc(st.id).set(st.data(), { merge: true });
        }
      }

      // Copy audit logs
      const logsSnap = await defaultDb.collection('admin_audit_logs').get().catch(() => ({ docs: [] }));
      for (const doc of logsSnap.docs) {
        await targetDb.collection('admin_audit_logs').doc(doc.id).set(doc.data(), { merge: true });
      }

      console.log(`[syncDatabase] Successfully replicated data to ${targetDbId}.`);
    }
  } catch (err) {
    console.warn('[syncDatabase] Warning during database replication:', err?.message);
  }
}
