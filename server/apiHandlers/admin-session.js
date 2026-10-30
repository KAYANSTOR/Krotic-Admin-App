// ============================================================
// Krotak Pro — Vercel / Express API
// POST /api/admin-session — جلسة المدير والمزامنة الشاملة لمستخدمي النظام
// ------------------------------------------------------------
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import {
  ensureFirebaseAdmin,
  getAppFirestore,
  PRIMARY_ADMIN_EMAIL,
  PRIMARY_ADMIN_UID,
  syncDatabaseInstancesIfNeeded,
} from '../_lib/firebaseAdmin.js';
import { decideAdminBootstrap } from '../_lib/adminBootstrap.js';

function extractPhoneFromEmail(email) {
  if (!email) return '';
  const atIdx = email.indexOf('@');
  if (atIdx === -1) return '';
  const local = email.slice(0, atIdx).trim();
  // Strip non-digits
  const digits = local.replace(/[^0-9]/g, '');
  return digits;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const init = ensureFirebaseAdmin();
  if (!init.ok) {
    return res.status(503).json({ success: false, error: init.error });
  }

  const authHeader = String(req.headers.authorization || '');
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!idToken) {
    return res.status(401).json({ success: false, error: 'missing_token' });
  }

  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(idToken);
  } catch (err) {
    console.error('admin-session token verification failed:', err?.message);
    return res.status(401).json({ success: false, error: 'invalid_token' });
  }

  const callerUid = decoded.uid;
  const callerEmail = (decoded.email || '').toLowerCase();
  const body = req.body || {};
  const action = body.action || 'bootstrap';

  const db = getAppFirestore();

  // 1. BOOTSTRAP / SELF-HEAL ADMIN ACCOUNT
  if (action === 'bootstrap') {
    try {
      // كتابة مستندات المالك الأساسي لا تُشغَّل إلا من حسابه، لا من أي مستدعٍ مسجّل.
      if (callerUid === PRIMARY_ADMIN_UID) await syncDatabaseInstancesIfNeeded();

      const adminSnap = await db.collection('Admins').doc(callerUid).get().catch(() => null);
      const existingData = adminSnap?.exists ? adminSnap.data() : null;

      const decision = decideAdminBootstrap({
        callerUid,
        callerEmail,
        emailVerified: decoded.email_verified === true,
        existingAdminData: existingData,
        primaryUid: PRIMARY_ADMIN_UID,
        primaryEmail: PRIMARY_ADMIN_EMAIL,
      });

      if (!decision.allow) {
        // لا يُمنح أي حساب غير المالك صلاحية مدير تلقائيًا. المدراء يُنشأون عبر /api/admins فقط.
        const isClientEmail = callerEmail.endsWith('@krotak.app');
        const userSnap = await db.collection('users').doc(callerUid).get().catch(() => null);
        if (isClientEmail || userSnap?.exists) {
          return res.status(403).json({
            success: false,
            error: 'client_account',
            message: 'هذا الحساب مسجل كصاحب شبكة/عميل في التطبيق وليس كمدير للنظام. للدخول إلى لوحة التحكم، يرجى استخدام حساب المدير.',
          });
        }
        return res.status(403).json({ success: false, error: 'not_admin' });
      }

      if (!decision.create) {
        return res.status(200).json({
          success: true,
          admin: {
            uid: callerUid,
            email: callerEmail,
            name: existingData?.name || 'مدير النظام',
            role: 'admin',
          },
        });
      }
      const adminRecord = {
        uid: callerUid,
        email: callerEmail,
        name: decoded.name || 'مدير Krotak Pro',
        phone: decoded.phone_number || '',
        role: 'admin',
        createdAt: Date.now(),
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      };

      await Promise.all([
        db.collection('Admins').doc(callerUid).set(adminRecord, { merge: true }),
        db.collection('admins').doc(callerUid).set(adminRecord, { merge: true }),
      ]);

      return res.status(200).json({ success: true, admin: adminRecord });
    } catch (err) {
      console.error('admin bootstrap failed:', err);
      return res.status(500).json({ success: false, error: 'bootstrap_failed' });
    }
  }

  // 2. SYNC AND LIST ALL DATABASE USERS (FROM FIRESTORE + FIREBASE AUTH)
  if (action === 'sync-auth-users') {
    try {
      // Caller must be an admin: مستند Admins بمعرّف مطابق، أو المالك الأساسي بالـ UID فقط (لا بالبريد).
      let adminSnap = null;
      try {
        adminSnap = await db.collection('Admins').doc(callerUid).get();
      } catch (adminErr) {
        console.warn('Admin check failed in sync-auth-users:', adminErr?.message);
      }
      const isAdmin = Boolean(
        callerUid === PRIMARY_ADMIN_UID ||
        (adminSnap?.exists && adminSnap.data()?.uid === callerUid)
      );

      if (!isAdmin) {
        return res.status(403).json({ success: false, error: 'not_admin' });
      }

      // Query all Firebase Auth users (Auth has separate quota from Firestore)
      let authList;
      try {
        authList = await getAuth().listUsers(1000);
      } catch (authErr) {
        console.warn('getAuth().listUsers in sync-auth-users failed:', authErr?.message);
        return res.status(200).json({ success: true, count: 0, users: [], warning: 'auth_unavailable' });
      }

      const syncedUsers = [];
      const now = Date.now();
      // لا يُعامَل أي مدير كمشترك: تُستثنى كل حسابات Admins لا المالك الأساسي فقط.
      const adminUidSet = new Set(
        (await db.collection('Admins').get().catch(() => ({ docs: [] }))).docs.map((d) => d.id),
      );

      // Read existing Firestore users and networks in bulk (2 total requests instead of N*2)
      const existingUserDocs = new Map();
      const existingNetworkOwners = new Map();

      try {
        const [usersSnap, netsSnap] = await Promise.all([
          db.collection('users').get().catch(() => null),
          db.collection('networks').get().catch(() => null),
        ]);
        if (usersSnap) {
          usersSnap.forEach((doc) => existingUserDocs.set(doc.id, doc.data()));
        }
        if (netsSnap) {
          netsSnap.forEach((doc) => {
            const data = doc.data() || {};
            const owner = data.owner_uid || data.ownerUid;
            if (owner && !existingNetworkOwners.has(owner)) {
              existingNetworkOwners.set(owner, doc.id);
            }
          });
        }
      } catch (fsErr) {
        console.warn('Firestore bulk read in sync-auth-users deferred:', fsErr?.message);
      }

      const missingUsersToCreate = [];
      const missingNetsToCreate = [];

      for (const authUser of (authList?.users || [])) {
        const uEmail = (authUser.email || '').toLowerCase();
        // Skip admins
        if (uEmail === PRIMARY_ADMIN_EMAIL.toLowerCase() || authUser.uid === PRIMARY_ADMIN_UID || adminUidSet.has(authUser.uid)) {
          continue;
        }

        const phone = authUser.phoneNumber || extractPhoneFromEmail(uEmail) || '';
        const phoneFormatted = phone.startsWith('967') ? phone.slice(3) : phone;
        const displayName = authUser.displayName || `مشترك (${phoneFormatted || authUser.uid.slice(0, 6)})`;
        const netName = authUser.displayName || `شبكة ${phoneFormatted || authUser.uid.slice(0, 6)}`;
        const defaultNetId = `NET-${authUser.uid.slice(0, 8).toUpperCase()}`;

        const existingUserData = existingUserDocs.get(authUser.uid);
        let userData;
        if (existingUserData) {
          userData = { uid: authUser.uid, ...existingUserData };
        } else {
          userData = {
            uid: authUser.uid,
            phone: phone || phoneFormatted,
            phoneNumber: phone || phoneFormatted,
            network_name: netName,
            networkName: netName,
            name: displayName,
            platform: 'android',
            app_version: '1.0.0',
            is_active: !authUser.disabled,
            is_trial: true,
            accessStatus: 'TRIAL',
            created_at: new Date(authUser.metadata?.creationTime || now),
            last_seen_at: new Date(authUser.metadata?.lastSignInTime || now),
          };
          missingUsersToCreate.push(userData);
        }

        const netId = existingNetworkOwners.get(authUser.uid);
        if (netId) {
          userData.networkId = netId;
        } else {
          userData.networkId = defaultNetId;
          missingNetsToCreate.push({
            networkId: defaultNetId,
            owner_uid: authUser.uid,
            networkName: userData.network_name || netName,
            phone: userData.phone || phone,
            is_active: true,
            is_trial: true,
            accessStatus: 'TRIAL',
            totalSalesAmount: 0,
            totalCommissionDue: 0,
            totalPaidAmount: 0,
            outstandingBalance: 0,
            createdAt: new Date(authUser.metadata?.creationTime || now),
            updatedAt: new Date(now),
          });
        }

        syncedUsers.push(userData);
      }

      // If any records were missing, persist in a single batch with try/catch to avoid breaking on quota exhaustion
      if (missingUsersToCreate.length > 0 || missingNetsToCreate.length > 0) {
        try {
          const batch = db.batch();
          let ops = 0;
          for (const u of missingUsersToCreate.slice(0, 100)) {
            batch.set(db.collection('users').doc(u.uid), u, { merge: true });
            ops += 1;
          }
          for (const n of missingNetsToCreate.slice(0, 100)) {
            batch.set(db.collection('networks').doc(n.networkId), n, { merge: true });
            ops += 1;
          }
          if (ops > 0) {
            await batch.commit();
          }
        } catch (batchErr) {
          console.warn('Batch write in sync-auth-users deferred (quota or offline):', batchErr?.message);
        }
      }

      return res.status(200).json({
        success: true,
        count: syncedUsers.length,
        users: syncedUsers,
      });
    } catch (err) {
      console.warn('sync-auth-users caught error, returning safe fallback:', err?.message || err);
      return res.status(200).json({
        success: true,
        count: 0,
        users: [],
        warning: err?.message || 'sync_fallback',
      });
    }
  }

  return res.status(400).json({ success: false, error: 'unknown_action' });
}
