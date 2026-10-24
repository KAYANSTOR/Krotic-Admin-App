// ============================================================
// Krotak Pro — Vercel Serverless Function
// POST /api/settings — تعديل الإعدادات العامة عبر مسار خادمي مقيّد
// ------------------------------------------------------------
// قرار المالك (ح1/ح2): كتابة العميل على app_settings مغلقة في القواعد،
// والتعديل يمرّ من هنا فقط بحدود صريحة + سجل تدقيق.
//   - default_trial_days: 0–30 (عدد صحيح)
//   - default_commission_rate: 0–20 (%)
//   - warning_days_before_expiry: 1–7 (عدد صحيح)
// يتطلب FIREBASE_SERVICE_ACCOUNT. المدير الموثّق فقط.
// ============================================================

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { ensureFirebaseAdmin, authenticateAdmin } from '../server/_lib/firebaseAdmin.js';
import templateCenterHandler from '../server/_lib/templateCenterApi.js';
import activateEntitlement from '../server/_lib/entitlementActivation.js';
import rebindEntitlementDevice from '../server/_lib/entitlementDeviceRebind.js';
import accountFeaturesHandler from '../server/_lib/accountFeatures.js';

export const SETTINGS_BOUNDS = {
  default_trial_days: { min: 0, max: 30, integer: true },
  default_commission_rate: { min: 0, max: 20, integer: false },
  warning_days_before_expiry: { min: 1, max: 7, integer: true },
  app_latest_version_code: { min: 1, max: 2147483647, integer: true },
};
export const SETTINGS_STRING_FIELDS = ['maintenance_message', 'default_trial_warning', 'global_official_warning', 'app_latest_version'];
export const SETTINGS_MAX_STRING = 500;

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

function validateNumericField(field, raw) {
  const bound = SETTINGS_BOUNDS[field];
  const value = Number(raw);
  if (!Number.isFinite(value)) return { ok: false, error: `${field}_invalid` };
  if (bound.integer && !Number.isInteger(value)) return { ok: false, error: `${field}_invalid` };
  if (value < bound.min || value > bound.max) return { ok: false, error: `${field}_out_of_range` };
  return { ok: true, value };
}

/**
 * يتحقق من حمولة الإعدادات ويُرجع فقط الحقول المسموحة ضمن الحدود.
 * الحقول غير المعروفة تُرفض بدل تجاهلها بصمت.
 */
export function validateSettingsInput(body) {
  const input = normalizeBody(body);
  const keys = Object.keys(input);
  if (keys.length === 0) return { ok: false, error: 'no_fields' };

  const value = {};
  for (const key of keys) {
    if (SETTINGS_BOUNDS[key]) {
      const parsed = validateNumericField(key, input[key]);
      if (!parsed.ok) return parsed;
      value[key] = parsed.value;
      continue;
    }
    if (SETTINGS_STRING_FIELDS.includes(key)) {
      if (typeof input[key] !== 'string') return { ok: false, error: `${key}_invalid` };
      if (input[key].length > SETTINGS_MAX_STRING) return { ok: false, error: `${key}_too_long` };
      if (key === 'app_latest_version' && input[key].trim() !== ''
          && !/^\d+\.\d+\.\d+$/.test(input[key].trim())) {
        return { ok: false, error: 'app_latest_version_invalid' };
      }
      value[key] = key === 'app_latest_version' ? input[key].trim() : input[key];
      continue;
    }
    if (key === 'is_app_active') {
      if (typeof input[key] !== 'boolean') return { ok: false, error: 'is_app_active_invalid' };
      value[key] = input[key];
      continue;
    }
    return { ok: false, error: `unknown_field:${key}` };
  }
  return { ok: true, value };
}

export async function applySettings({ db, callerUid, value, now = Date.now() }) {
  const ref = db.collection('app_settings').doc('global_config');
  const auditRef = db.collection('admin_audit_logs').doc();
  await db.runTransaction(async (transaction) => {
    transaction.set(ref, { ...value, updatedAt: FieldValue.serverTimestamp(), updatedAtMs: now, updatedBy: callerUid }, { merge: true });
    transaction.set(auditRef, {
      action: 'SETTINGS_SAVE',
      actorUid: callerUid,
      targetType: 'settings',
      targetId: 'global_config',
      details: value,
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: now,
      updatedAtMs: now,
    }, { merge: false });
  });
  return { updated: Object.keys(value) };
}

export default async function handler(req, res) {
  if (req.query?.__apiRoute === 'entitlement-activate') {
    return activateEntitlement(req, res);
  }
  if (req.query?.__apiRoute === 'entitlement-device-rebind') {
    return rebindEntitlementDevice(req, res);
  }
  if (req.query?.__apiRoute === 'template-center') {
    return templateCenterHandler(req, res);
  }
  if (req.query?.__apiRoute === 'account-features') {
    return accountFeaturesHandler(req, res);
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const init = ensureFirebaseAdmin();
  if (!init.ok) return res.status(503).json({ success: false, error: init.error });

  const caller = await authenticateAdmin(req, { getAuth, getFirestore });
  if (!caller.ok) return res.status(caller.status).json({ success: false, error: caller.error });

  const parsed = validateSettingsInput(req.body);
  if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.error });

  try {
    const result = await applySettings({ db: getFirestore(), callerUid: caller.callerUid, value: parsed.value });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('settings update failed', error);
    return res.status(500).json({ success: false, error: 'settings_failed' });
  }
}
