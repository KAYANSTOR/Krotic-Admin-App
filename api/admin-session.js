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
} from '../server/_lib/firebaseAdmin.js';
import { decideAdminBootstrap } from '../server/_lib/adminBootstrap.js';

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
      const adminSnap = await db.collection('Admins').doc(callerUid).get().catch(() => null);
      const isAdmin = Boolean(
        callerUid === PRIMARY_ADMIN_UID ||
        (adminSnap?.exists && adminSnap.data()?.uid === callerUid)
      );

      if (!isAdmin) {
        return res.status(403).json({ success: false, error: 'not_admin' });
      }

      // Query all Firebase Auth users
      const authList = await getAuth().listUsers(1000);
      const syncedUsers = [];
      const now = Date.now();
      // لا يُعامَل أي مدير كمشترك: تُستثنى كل حسابات Admins لا المالك الأساسي فقط.
      const adminUidSet = new Set(
        (await db.collection('Admins').get().catch(() => ({ docs: [] }))).docs.map((d) => d.id),
      );

      for (const authUser of authList.users) {
        const uEmail = (authUser.email || '').toLowerCase();
        // Skip admins
        if (uEmail === PRIMARY_ADMIN_EMAIL.toLowerCase() || authUser.uid === PRIMARY_ADMIN_UID || adminUidSet.has(authUser.uid)) {
          continue;
        }

        const phone = authUser.phoneNumber || extractPhoneFromEmail(uEmail) || '';
        const phoneFormatted = phone.startsWith('967') ? phone.slice(3) : phone;
        const displayName = authUser.displayName || `مشترك (${phoneFormatted || authUser.uid.slice(0, 6)})`;
        const netName = authUser.displayName || `شبكة ${phoneFormatted || authUser.uid.slice(0, 6)}`;

        // Check if user document exists in db
        const userDocRef = db.collection('users').doc(authUser.uid);
        const userDocSnap = await userDocRef.get();

        let userData;
        if (!userDocSnap.exists) {
          // Synthesize missing user record
          userData = {
            uid: authUser.uid,
            phone: phone || phoneFormatted,
            phoneNumber: phone || phoneFormatted,
            network_name: netName,
            networkName: netName,
            name: displayName,
            platform: 'android',
            app_version: '1.0.0',
            is_active: true,
            is_trial: true,
            accessStatus: 'TRIAL',
            created_at: new Date(authUser.metadata.creationTime || now),
            last_seen_at: new Date(authUser.metadata.lastSignInTime || now),
          };

          await userDocRef.set(userData, { merge: true });
        } else {
          userData = { uid: authUser.uid, ...userDocSnap.data() };
        }

        // Check if corresponding network exists
        const netQuery = await db.collection('networks').where('owner_uid', '==', authUser.uid).get();
        if (netQuery.empty) {
          const defaultNetId = `NET-${authUser.uid.slice(0, 8).toUpperCase()}`;
          const netRecord = {
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
            createdAt: new Date(authUser.metadata.creationTime || now),
            updatedAt: new Date(now),
          };

          await db.collection('networks').doc(defaultNetId).set(netRecord, { merge: true });
          userData.networkId = defaultNetId;
        } else {
          userData.networkId = netQuery.docs[0].id;
        }

        syncedUsers.push(userData);
      }

      return res.status(200).json({
        success: true,
        count: syncedUsers.length,
        users: syncedUsers,
      });
    } catch (err) {
      console.error('sync-auth-users failed:', err);
      return res.status(500).json({ success: false, error: 'sync_failed' });
    }
  }

  return res.status(400).json({ success: false, error: 'unknown_action' });
}
