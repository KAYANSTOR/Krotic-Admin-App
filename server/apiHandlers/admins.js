// ============================================================
// Krotak Pro — Vercel Serverless Function
// POST /api/admins — إدارة المدراء عبر مسار خادمي (قرار و3)
// ------------------------------------------------------------
// قرار المالك و3: الإجراءات الحساسة (إنشاء/حذف المدراء) تمرّ من الخادم فقط،
// وقواعد Firestore تمنع كتابة العميل على مجموعة Admins.
//
//   action=list    {}                                   → قائمة المدراء
//   action=create  { email, password, name, phone }     → إنشاء حساب + مستند Admins
//   action=update  { uid, name?, phone? }               → تحديث بيانات مدير
//   action=delete  { uid }                              → حذف مدير (لا يمكن حذف نفسك)
//
// يتطلب FIREBASE_SERVICE_ACCOUNT. مدير موثّق فقط.
// ============================================================

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { ensureFirebaseAdmin, authenticateAdmin } from '../_lib/firebaseAdmin.js';

const NAME_MAX = 120;
const PHONE_MAX = 40;
const EMAIL_MAX = 254;
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 128;
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const ADMIN_ACTIONS = ['list', 'create', 'update', 'delete'];

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

export function validateAdminInput(body) {
  const input = normalizeBody(body);
  const action = input.action === undefined ? 'list' : input.action;
  if (typeof action !== 'string' || !ADMIN_ACTIONS.includes(action.trim())) {
    return { ok: false, error: 'unknown_action' };
  }
  const normalizedAction = action.trim();

  if (normalizedAction === 'list') return { ok: true, value: { action: 'list' } };

  if (normalizedAction === 'create') {
    const email = typeof input.email === 'string' ? input.email.trim() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
    if (!name || name.length > NAME_MAX) return { ok: false, error: 'name_invalid' };
    if (!EMAIL_PATTERN.test(email) || email.length > EMAIL_MAX) return { ok: false, error: 'email_invalid' };
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      return { ok: false, error: 'password_rejected' };
    }
    if (phone.length > PHONE_MAX) return { ok: false, error: 'phone_invalid' };
    return { ok: true, value: { action: 'create', email, password, name, phone } };
  }

  const uid = typeof input.uid === 'string' ? input.uid.trim() : '';
  if (!UID_PATTERN.test(uid)) return { ok: false, error: 'uid_invalid' };

  if (normalizedAction === 'delete') return { ok: true, value: { action: 'delete', uid } };

  // update
  const value = { action: 'update', uid };
  let provided = 0;
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > NAME_MAX) {
      return { ok: false, error: 'name_invalid' };
    }
    value.name = input.name.trim(); provided += 1;
  }
  if (input.phone !== undefined) {
    if (typeof input.phone !== 'string' || input.phone.trim().length > PHONE_MAX) {
      return { ok: false, error: 'phone_invalid' };
    }
    value.phone = input.phone.trim(); provided += 1;
  }
  if (provided === 0) return { ok: false, error: 'no_fields' };
  return { ok: true, value };
}

async function audit(db, { action, actorUid, uid, details, now }) {
  await db.collection('admin_audit_logs').add({
    action,
    actorUid,
    targetType: 'admin',
    targetId: uid || null,
    details: details || null,
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: now,
    updatedAtMs: now,
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const init = ensureFirebaseAdmin();
  if (!init.ok) return res.status(503).json({ success: false, error: init.error });

  const caller = await authenticateAdmin(req, { getAuth, getFirestore });
  if (!caller.ok) return res.status(caller.status).json({ success: false, error: caller.error });

  const parsed = validateAdminInput(req.body);
  if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.error });

  const db = getFirestore();
  const auth = getAuth();
  const now = Date.now();
  const { action } = parsed.value;

  try {
    if (action === 'list') {
      const snap = await db.collection('Admins').get();
      const admins = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      return res.status(200).json({ success: true, admins });
    }

    if (action === 'create') {
      const { email, password, name, phone } = parsed.value;
      let record;
      try {
        record = await auth.createUser({ email, password, displayName: name });
      } catch (error) {
        if (error?.code === 'auth/email-already-in-use') {
          return res.status(409).json({ success: false, error: 'email_already_in_use' });
        }
        if (error?.code === 'auth/invalid-password' || error?.code === 'auth/password-does-not-meet-requirements') {
          return res.status(400).json({ success: false, error: 'password_rejected' });
        }
        throw error;
      }
      await db.collection('Admins').doc(record.uid).set({
        uid: record.uid,
        name,
        email,
        phone,
        createdAt: now,
        createdAtMs: now,
        updatedAtMs: now,
        createdBy: caller.callerUid,
      }, { merge: false });
      await audit(db, { action: 'ADMIN_CREATE', actorUid: caller.callerUid, uid: record.uid, details: { email, name }, now });
      return res.status(201).json({ success: true, uid: record.uid });
    }

    const { uid } = parsed.value;
    if (uid === caller.callerUid) {
      return res.status(400).json({ success: false, error: 'cannot_modify_self' });
    }

    if (action === 'update') {
      const patch = {};
      if (parsed.value.name !== undefined) patch.name = parsed.value.name;
      if (parsed.value.phone !== undefined) patch.phone = parsed.value.phone;
      patch.updatedAtMs = now;
      await db.collection('Admins').doc(uid).set(patch, { merge: true });
      await audit(db, { action: 'ADMIN_UPDATE', actorUid: caller.callerUid, uid, details: patch, now });
      return res.status(200).json({ success: true, uid });
    }

    // delete
    try {
      await auth.deleteUser(uid);
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') throw error;
    }
    await db.collection('Admins').doc(uid).delete();
    await audit(db, { action: 'ADMIN_DELETE', actorUid: caller.callerUid, uid, now });
    return res.status(200).json({ success: true, uid });
  } catch (error) {
    console.error('admins action failed', error);
    return res.status(500).json({ success: false, error: 'admin_action_failed' });
  }
}

