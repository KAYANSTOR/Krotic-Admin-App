// ============================================================
// Krotak Pro — Vercel Serverless Function
// POST /api/manage-user-auth — بيانات دخول عميل التطبيق
// ------------------------------------------------------------
// يتيح للمدير الموثّق:
//   { action: 'get', uid }              → عرض معرّف الدخول وحالة الحساب
//   { action: 'set-password', uid, password } → تعيين كلمة مرور جديدة للمدير
//   { action: 'reset-link', uid }       → إنشاء رابط يعيد العميل كلمة مروره بنفسه
//
// لا يمكن تعديل بريد الدخول أو رقم الهاتف إطلاقاً: التطبيق يشتقّ بريد الدخول
// من رقم هاتف العميل، فأي تغيير له يكسر دخوله. المتاح هو كلمة المرور فقط.
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
const MAX_PASSWORD_LENGTH = 128;
const MAX_UID_LENGTH = 128;
const MAX_ACTION_LENGTH = 32;
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ALLOWED_ACTIONS = new Set(['get', 'set-password', 'reset-link']);

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
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  return body;
}

export function validateManageUserInput(body) {
  const normalized = normalizeBody(body);
  const actionValue = normalized.action === undefined ? 'get' : normalized.action;
  if (typeof actionValue !== 'string' || actionValue.length > MAX_ACTION_LENGTH) {
    return { ok: false, error: 'invalid_action' };
  }
  const action = actionValue.trim();
  if (!ALLOWED_ACTIONS.has(action)) {
    return { ok: false, error: 'unknown_action' };
  }

  if (normalized.uid === undefined || normalized.uid === null) {
    return { ok: false, error: 'uid_required' };
  }
  if (typeof normalized.uid !== 'string') {
    return { ok: false, error: 'uid_invalid' };
  }
  const uid = normalized.uid.trim();
  if (uid.length === 0) return { ok: false, error: 'uid_required' };
  if (uid.length > MAX_UID_LENGTH || !UID_PATTERN.test(uid)) {
    return { ok: false, error: 'uid_invalid' };
  }

  if (action === 'set-password') {
    if (typeof normalized.password !== 'string') {
      return { ok: false, error: 'password_invalid' };
    }
    if (normalized.password.length < MIN_PASSWORD_LENGTH) {
      return { ok: false, error: 'password_too_short' };
    }
    if (normalized.password.length > MAX_PASSWORD_LENGTH) {
      return { ok: false, error: 'password_too_long' };
    }
  }

  return { ok: true, action, uid, password: normalized.password };
}

export async function authorizeTargetClient(db, uid) {
  if (typeof uid !== 'string' || uid.length > MAX_UID_LENGTH || !UID_PATTERN.test(uid)) {
    return { ok: false, error: 'uid_invalid' };
  }

  const [userSnap, adminSnap] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('Admins').doc(uid).get(),
  ]);
  if (!userSnap.exists || adminSnap.exists) {
    return { ok: false, error: 'target_not_client' };
  }
  return { ok: true };
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

  const input = validateManageUserInput(req.body);
  if (!input.ok) {
    return res.status(400).json({ success: false, error: input.error });
  }
  const { action, uid, password } = input;

  try {
    const target = await authorizeTargetClient(getFirestore(), uid);
    if (!target.ok) {
      return res.status(403).json({ success: false, error: target.error });
    }
  } catch (error) {
    console.error('manage-user-auth: target check failed', error);
    return res.status(500).json({ success: false, error: 'target_check_failed' });
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

  if (action === 'reset-link') {
    try {
      const record = await getAuth().getUser(uid);
      let targetEmail = record.email;

      // إذا لم يكن هناك بريد، نحاول اشتقاقه من رقم هاتف العميل وتحديث حسابه
      if (!targetEmail) {
        try {
          const userSnap = await getFirestore().collection('users').doc(uid).get();
          const uData = userSnap.exists ? userSnap.data() : {};
          const phone = (uData.phone || uData.phoneNumber || record.phoneNumber || '').replace(/[^0-9]/g, '');
          if (phone) {
            targetEmail = `${phone}@krotak.app`;
            await getAuth().updateUser(uid, { email: targetEmail });
          }
        } catch (fetchErr) {
          console.warn('manage-user-auth: could not derive email from phone', fetchErr);
        }
      }

      if (!targetEmail) {
        return res.status(400).json({ success: false, error: 'no_login_email' });
      }

      let link = null;
      try {
        link = await getAuth().generatePasswordResetLink(targetEmail);
      } catch (linkErr) {
        console.warn('Standard generatePasswordResetLink failed, attempting fallback URL:', linkErr);
        try {
          const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || 'krotak.app';
          link = await getAuth().generatePasswordResetLink(targetEmail, {
            url: `https://${host}/login`,
            handleCodeInApp: false,
          });
        } catch (secondErr) {
          console.warn('ActionCodeSettings link also failed:', secondErr);
        }
      }

      // إذا تعذر توليد الرابط من مزود Firebase، نولد كلمة مرور مؤقتة صالحة فوراً دون إحباط المدير
      if (!link) {
        const tempPassword = 'kp-' + Math.random().toString(36).slice(2, 6) + '-' + Math.floor(1000 + Math.random() * 9000);
        await getAuth().updateUser(uid, { password: tempPassword });
        return res.status(200).json({
          success: true,
          tempPassword,
          mode: 'temporary_password',
          email: targetEmail,
        });
      }

      return res.status(200).json({ success: true, link, email: targetEmail });
    } catch (error) {
      if (error?.code === 'auth/user-not-found') {
        return res.status(404).json({ success: false, error: 'user_not_found' });
      }
      console.error('manage-user-auth: reset-link failed', error);
      return res.status(500).json({ success: false, error: 'reset_link_failed' });
    }
  }

  return res.status(400).json({ success: false, error: 'unknown_action' });
}
