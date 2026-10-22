// ============================================================
// المزايا المدفوعة — قراءة/كتابة إدارية آمنة (خادمي فقط)
// ------------------------------------------------------------
// الطبقة المفصولة عن عقد lease الموقّع وعن سجل الأجهزة.
// المصدر: users/{uid}.feature_entitlements (خريطة bool).
//
// قرار المالك: تُكتب هذه الخريطة من الخادم فقط، ولا يكتبها المتصفح
// مباشرة، حتى لو أُخفي الزر. هذه الوحدة هي المسار الوحيد للكتابة.
//
// ملاحظة عقد (2026-10-21): المستهلك المعلن في Android
// (PaidFeature/PaidFeatureGate) غير موجود في KAYANSTOR/Krotak-Pro@main.
// لذلك تبقى هذه الشاشة عقدًا إداريًا معلّقًا على قرار Android؛ لا ندّعي
// أن تغيير الخريطة يؤثر في سلوك جهاز فعلي قبل إثبات وجود المستهلك.
// ============================================================

import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { authenticateAdmin, ensureFirebaseAdmin } from './firebaseAdmin.js';

export const PAID_FEATURE_ENTITLEMENTS_VERSION = 1;

/**
 * المفاتيح المعتمدة فقط. أي مفتاح خارجها يُرفض صراحةً (لا تخمين).
 * المصدر: contracts/schemas/feature-entitlements.schema.json.
 */
export const PAID_FEATURE_KEYS = Object.freeze([
  'hotspot_template_editor',
  'mikrotik_card_generator',
]);

export const PAID_FEATURE_LABELS = Object.freeze({
  hotspot_template_editor: 'محرّر قوالب الهوتسبوت',
  mikrotik_card_generator: 'مولّد كروت ميكروتك',
});

const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function objectBody(body) {
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

function response(res, status, body) {
  return res.status(status).json(body);
}

/**
 * يتحقق من خريطة الاستحقاقات القادمة من الإدارة.
 * يقبل فقط المفاتيح المعتمدة وبقيم منطقية (true/false).
 * `null` يعني «امسح المفتاح» (لا يمنح الميزة).
 */
export function validatePaidFeatureInput(raw) {
  if (raw == null) return { ok: false, error: 'entitlements_must_be_object' };
  const input = objectBody(raw);
  if (!input) return { ok: false, error: 'entitlements_must_be_object' };
  const keys = Object.keys(input);
  if (keys.length === 0) return { ok: false, error: 'entitlements_empty' };
  const value = {};
  for (const key of keys) {
    if (!PAID_FEATURE_KEYS.includes(key)) {
      return { ok: false, error: `unknown_feature:${key}` };
    }
    if (typeof input[key] !== 'boolean') {
      return { ok: false, error: `${key}_must_be_boolean` };
    }
    value[key] = input[key];
  }
  return { ok: true, value };
}

/** يقرأ الخريطة المخزّنة ويطبّعها لمفاتيح معتمدة بقيم منطقية فقط. */
export function normalizeStoredEntitlements(stored) {
  const out = {};
  for (const key of PAID_FEATURE_KEYS) {
    out[key] = stored?.[key] === true;
  }
  return out;
}

/**
 * معالج خادمي: قراءة/كتابة خريطة المزايا المدفوعة لحساب واحد.
 * - action=get: يعيد الخريطة الحالية (تُطبّع لمفاتيح معتمدة).
 * - action=set: يدمج المفاتيح المعتمدة ويكتب سجل تدقيق.
 * المدير الموثّق فقط. لا يقرأ أسرارًا ولا يطبع محتوى رسائل.
 */
export default async function paidFeatureEntitlements(req, res, dependencies = {}) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return response(res, 405, { success: false, error: 'method_not_allowed' });
  }

  const input = objectBody(req.body);
  if (!input) return response(res, 400, { success: false, error: 'invalid_json' });

  const action = input.action === 'set' ? 'set' : input.action === 'get' ? 'get' : null;
  if (!action) return response(res, 400, { success: false, error: 'unknown_action' });

  const uid = typeof input.uid === 'string' ? input.uid.trim() : '';
  if (!UID_PATTERN.test(uid)) {
    return response(res, 400, { success: false, error: 'uid_invalid' });
  }

  let validated = null;
  if (action === 'set') {
    const parsed = validatePaidFeatureInput(input.entitlements);
    if (!parsed.ok) return response(res, 400, { success: false, error: parsed.error });
    validated = parsed.value;
  }

  const configured = dependencies.ensureFirebaseAdmin
    ? dependencies.ensureFirebaseAdmin()
    : ensureFirebaseAdmin();
  if (!configured?.ok) {
    return response(res, 503, { success: false, error: configured?.error || 'server_not_configured' });
  }
  const getAuthFn = dependencies.getAuth || getAuth;
  const getFirestoreFn = dependencies.getFirestore || getFirestore;
  const authorize = dependencies.authenticateAdmin || authenticateAdmin;
  const caller = await authorize(req, { getAuth: getAuthFn, getFirestore: getFirestoreFn });
  if (!caller.ok) {
    return response(res, caller.status, { success: false, error: caller.error });
  }

  const db = dependencies.db || getFirestoreFn();
  const serverTimestamp = dependencies.serverTimestamp || (() => FieldValue.serverTimestamp());
  const now = dependencies.now ?? Date.now();
  const userRef = db.collection('users').doc(uid);

  try {
    if (action === 'get') {
      const snapshot = await userRef.get();
      if (!snapshot.exists) return response(res, 404, { success: false, error: 'account_not_found' });
      return response(res, 200, {
        success: true,
        uid,
        schemaVersion: PAID_FEATURE_ENTITLEMENTS_VERSION,
        entitlements: normalizeStoredEntitlements(snapshot.data()?.feature_entitlements),
      });
    }

    const auditRef = db.collection('admin_audit_logs').doc();
    const result = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(userRef);
      if (!snapshot.exists) return { error: 'account_not_found', status: 404 };
      const previous = normalizeStoredEntitlements(snapshot.data()?.feature_entitlements);
      transaction.set(userRef, {
        feature_entitlements: validated,
        feature_entitlements_updated_at: serverTimestamp(),
        feature_entitlements_updated_by: caller.callerUid,
      }, { merge: true });
      transaction.set(auditRef, {
        action: 'PAID_FEATURE_ENTITLEMENT_UPDATE',
        actorUid: caller.callerUid,
        targetType: 'user',
        targetId: uid,
        details: { previous, next: validated },
        createdAt: serverTimestamp(),
        createdAtMs: now,
        updatedAtMs: now,
      }, { merge: false });
      return { previous, entitlements: { ...previous, ...validated } };
    });

    if (result?.error) {
      return response(res, result.status, { success: false, error: result.error });
    }
    return response(res, 200, {
      success: true,
      uid,
      schemaVersion: PAID_FEATURE_ENTITLEMENTS_VERSION,
      ...result,
    });
  } catch (error) {
    console.error('paid feature entitlement write failed', {
      uid,
      actorUid: caller.callerUid,
      code: error?.code,
    });
    return response(res, 500, { success: false, error: 'paid_feature_update_failed' });
  }
}
