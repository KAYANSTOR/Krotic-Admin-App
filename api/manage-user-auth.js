// ============================================================
// Krotak Pro — Vercel Serverless Function
// POST /api/manage-user-auth — بيانات دخول عميل التطبيق
// ------------------------------------------------------------
// يتيح للمدير الموثّق:
//   { action: 'get', uid }           → عرض معرّف الدخول وحالة الحساب
//   { action: 'set-password', uid, password } → تعيين كلمة مرور جديدة
//
// كلمة المرور الحالية لا يمكن عرضها إطلاقاً: Firebase Authentication
// يخزّنها كتجزئة (hash) ولا يوفّر واجهة لقراءتها، لا هنا ولا في أي
// لوحة إدارة. المتاح هو التحقق من معرّف الدخول وتعيين كلمة مرور جديدة.
//
// يتطلب متغير البيئة: FIREBASE_SERVICE_ACCOUNT (نفس إعداد send-fcm).
// ============================================================

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const MIN_PASSWORD_LENGTH = 6;

function ensureInitialized() {
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

function normalizeBody(body) {
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body;
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function publicAuthInfo(record) {
  const providers = record.providerData || [];
  return {
    uid: record.uid,
    email: record.email || null,
    phoneNumber: record.phoneNumber || null,
    displayName: record.displayName || null,
    emailVerified: Boolean(record.emailVerified),
    disabled: Boolean(record.disabled),
    providers: providers.map((provider) => provider.providerId).filter(Boolean),
    createdAt: toIso(record.metadata?.creationTime),
    lastSignInAt: toIso(record.metadata?.lastSignInTime),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const init = ensureInitialized();
  if (!init.ok) {
    return res.status(503).json({ success: false, error: init.error });
  }

  const authHeader = String(req.headers.authorization || '');
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!idToken) {
    return res.status(401).json({ success: false, error: 'missing_token' });
  }

  let callerUid;
  try {
    const decoded = await getAuth().verifyIdToken(idToken);
    callerUid = decoded.uid;
  } catch {
    return res.status(401).json({ success: false, error: 'invalid_token' });
  }

  try {
    const adminSnap = await getFirestore().collection('Admins').doc(callerUid).get();
    const adminData = adminSnap.exists ? adminSnap.data() : null;
    if (!adminData || adminData.uid !== callerUid) {
      return res.status(403).json({ success: false, error: 'not_admin' });
    }
  } catch (error) {
    console.error('manage-user-auth: admin check failed', error);
    return res.status(500).json({ success: false, error: 'admin_check_failed' });
  }

  const body = normalizeBody(req.body);
  const action = String(body.action || 'get').trim();
  const uid = String(body.uid || '').trim();

  if (!uid) {
    return res.status(400).json({ success: false, error: 'uid_required' });
  }

  if (action === 'get') {
    try {
      const record = await getAuth().getUser(uid);
      return res.status(200).json({ success: true, user: publicAuthInfo(record) });
    } catch (error) {
      if (error?.code === 'auth/user-not-found') {
        return res.status(404).json({ success: false, error: 'user_not_found' });
      }
      console.error('manage-user-auth: get failed', error);
      return res.status(500).json({ success: false, error: 'lookup_failed' });
    }
  }

  if (action === 'set-password') {
    const password = String(body.password || '');
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ success: false, error: 'password_too_short' });
    }

    try {
      const record = await getAuth().updateUser(uid, { password });
      return res.status(200).json({ success: true, user: publicAuthInfo(record) });
    } catch (error) {
      if (error?.code === 'auth/user-not-found') {
        return res.status(404).json({ success: false, error: 'user_not_found' });
      }
      if (error?.code === 'auth/invalid-password' || error?.code === 'auth/password-does-not-meet-requirements') {
        return res.status(400).json({ success: false, error: 'password_rejected' });
      }
      console.error('manage-user-auth: set-password failed', error);
      return res.status(500).json({ success: false, error: 'update_failed' });
    }
  }

  return res.status(400).json({ success: false, error: 'unknown_action' });
}
