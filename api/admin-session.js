// ============================================================
// Krotak Pro — Vercel / Express API
// POST /api/admin-session — جلسة المدير والمزامنة الشاملة لمستخدمي النظام
// ------------------------------------------------------------
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  ensureFirebaseAdmin,
  getAppFirestore,
  PRIMARY_ADMIN_EMAIL,
  PRIMARY_ADMIN_UID,
  syncDatabaseInstancesIfNeeded,
} from './_lib/firebaseAdmin.js';

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

  const targetDb = getAppFirestore();
  const defaultDb = getFirestore();

  // 1. BOOTSTRAP / SELF-HEAL ADMIN ACCOUNT
  if (action === 'bootstrap') {
    try {
      await syncDatabaseInstancesIfNeeded();

      // Check if caller already has an admin record
      const [targetAdminSnap, defaultAdminSnap] = await Promise.all([
        targetDb.collection('Admins').doc(callerUid).get().catch(() => null),
        defaultDb.collection('Admins').doc(callerUid).get().catch(() => null),
      ]);

      const existingData = (targetAdminSnap?.exists ? targetAdminSnap.data() : null) ||
                           (defaultAdminSnap?.exists ? defaultAdminSnap.data() : null);

      if (existingData && (existingData.uid === callerUid || !existingData.uid)) {
        return res.status(200).json({
          success: true,
          admin: {
            uid: callerUid,
            email: callerEmail,
            name: existingData.name || 'مدير النظام',
            role: 'admin',
          },
        });
      }

      // Check if this is the primary admin account
      const isPrimary = callerEmail === PRIMARY_ADMIN_EMAIL.toLowerCase() || callerUid === PRIMARY_ADMIN_UID;
      
      // Check if this account belongs to an app network client rather than an admin
      const isClientEmail = callerEmail.endsWith('@krotak.app');
      const [userSnapTarget, userSnapDefault] = await Promise.all([
        targetDb.collection('users').doc(callerUid).get().catch(() => null),
        defaultDb.collection('users').doc(callerUid).get().catch(() => null),
      ]);
      const isExistingClient = Boolean(userSnapTarget?.exists || userSnapDefault?.exists);

      if (!isPrimary && (isClientEmail || isExistingClient)) {
        return res.status(403).json({
          success: false,
          error: 'client_account',
          message: 'هذا الحساب مسجل كصاحب شبكة/عميل في التطبيق وليس كمدير للنظام. للدخول إلى لوحة التحكم، يرجى استخدام حساب المدير.',
        });
      }

      // If primary admin or designated admin, create the doc across all databases
      const adminRecord = {
        uid: callerUid,
        email: callerEmail,
        name: decoded.name || 'مدير Krotak Pro',
        phone: decoded.phone_number || '',
        role: 'admin',
        createdAt: Date.now(),
      };

      await Promise.all([
        targetDb.collection('Admins').doc(callerUid).set(adminRecord, { merge: true }),
        targetDb.collection('admins').doc(callerUid).set(adminRecord, { merge: true }),
        defaultDb.collection('Admins').doc(callerUid).set(adminRecord, { merge: true }),
        defaultDb.collection('admins').doc(callerUid).set(adminRecord, { merge: true }),
      ]);

      return res.status(200).json({
        success: true,
        admin: adminRecord,
      });
    } catch (err) {
      console.error('admin bootstrap failed:', err);
      return res.status(500).json({ success: false, error: 'bootstrap_failed' });
    }
  }

  // 2. SYNC AND LIST ALL DATABASE USERS (FROM FIRESTORE + FIREBASE AUTH)
  if (action === 'sync-auth-users') {
    try {
      // Caller must be an admin
      const [targetAdmin, defaultAdmin] = await Promise.all([
        targetDb.collection('Admins').doc(callerUid).get().catch(() => null),
        defaultDb.collection('Admins').doc(callerUid).get().catch(() => null),
      ]);
      const isAdmin = Boolean(
        callerEmail === PRIMARY_ADMIN_EMAIL.toLowerCase() ||
        callerUid === PRIMARY_ADMIN_UID ||
        targetAdmin?.exists ||
        defaultAdmin?.exists
      );

      if (!isAdmin) {
        return res.status(403).json({ success: false, error: 'not_admin' });
      }

      // Query all Firebase Auth users
      const authList = await getAuth().listUsers(1000);
      const syncedUsers = [];
      const now = Date.now();

      for (const authUser of authList.users) {
        const uEmail = (authUser.email || '').toLowerCase();
        // Skip admins
        if (uEmail === PRIMARY_ADMIN_EMAIL.toLowerCase() || authUser.uid === PRIMARY_ADMIN_UID) {
          continue;
        }

        const phone = authUser.phoneNumber || extractPhoneFromEmail(uEmail) || '';
        const phoneFormatted = phone.startsWith('967') ? phone.slice(3) : phone;
        const displayName = authUser.displayName || `مشترك (${phoneFormatted || authUser.uid.slice(0, 6)})`;
        const netName = authUser.displayName || `شبكة ${phoneFormatted || authUser.uid.slice(0, 6)}`;

        // Check if user document exists in targetDb
        const userDocRef = targetDb.collection('users').doc(authUser.uid);
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

          // Save to targetDb & defaultDb
          await Promise.all([
            userDocRef.set(userData, { merge: true }),
            defaultDb.collection('users').doc(authUser.uid).set(userData, { merge: true }).catch(() => null),
          ]);
        } else {
          userData = { uid: authUser.uid, ...userDocSnap.data() };
        }

        // Check if corresponding network exists
        const netQuery = await targetDb.collection('networks').where('owner_uid', '==', authUser.uid).get();
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

          await Promise.all([
            targetDb.collection('networks').doc(defaultNetId).set(netRecord, { merge: true }),
            defaultDb.collection('networks').doc(defaultNetId).set(netRecord, { merge: true }).catch(() => null),
          ]);
          userData.networkId = defaultNetId;
        } else {
          userData.networkId = netQuery.docs[0].id;
        }

        syncedUsers.push(userData);
      }

      // Ensure broadcast notifications exist in all users' notification inboxes
      try {
        const broadcastSnaps = await targetDb
          .collection('notification_deliveries')
          .get()
          .catch(() => ({ docs: [] }));

        const globalBroadcasts = broadcastSnaps.docs.filter((d) => {
          const t = d.data()?.target || '';
          return t.startsWith('topic:') || d.data()?.audienceType === 'global';
        });

        if (globalBroadcasts.length > 0) {
          for (const u of syncedUsers) {
            const userNotifs = await targetDb.collection('users').doc(u.uid).collection('notifications').limit(1).get().catch(() => ({ empty: true }));
            if (userNotifs.empty) {
              const batch = targetDb.batch();
              const defBatch = defaultDb.batch();
              globalBroadcasts.forEach((bDoc) => {
                const bData = bDoc.data() || {};
                const item = {
                  title: bData.title || '',
                  body: bData.body || bData.message || '',
                  message: bData.body || bData.message || '',
                  is_read: false,
                  timestamp: bData.timestamp || (bData.createdAt && typeof bData.createdAt.toMillis === 'function' ? bData.createdAt.toMillis() : Date.now()),
                  createdAt: bData.createdAt || FieldValue.serverTimestamp(),
                  route: '/account-notifications',
                  source: 'admin_broadcast',
                  audienceType: 'global',
                };
                const ref = targetDb.collection('users').doc(u.uid).collection('notifications').doc(bDoc.id);
                batch.set(ref, item, { merge: true });
                const defRef = defaultDb.collection('users').doc(u.uid).collection('notifications').doc(bDoc.id);
                defBatch.set(defRef, item, { merge: true });
              });
              await batch.commit().catch(() => null);
              await defBatch.commit().catch(() => null);
            }
          }
        }
      } catch (seedErr) {
        console.warn('Seeding broadcast notifications to inboxes warning:', seedErr);
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
