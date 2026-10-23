// ============================================================
// Krotak Pro — server-owned account feature flags
// POST /api/admin/account-features (shared Vercel settings function)
// ============================================================

import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { authenticateAdmin, ensureFirebaseAdmin } from './firebaseAdmin.js';

export const ACCOUNT_FEATURES_VERSION = 1;
export const ACCOUNT_FEATURE_CATALOG = Object.freeze([
  Object.freeze({
    key: 'mikrotik_card_generator',
    label_ar: 'توليد وطباعة الكروت',
    description_ar: 'إنشاء وطباعة كروت ميكروتك.',
    default: false,
    status: 'active',
    min_app_build: 0,
  }),
  Object.freeze({
    key: 'hotspot_template_editor',
    label_ar: 'محرر صفحات الهوتسبوت',
    description_ar: 'تحرير قوالب وصفحات الهوتسبوت.',
    default: false,
    status: 'active',
    min_app_build: 0,
  }),
  Object.freeze({
    key: 'sms_auto_parser',
    label_ar: 'تحليل رسائل المحافظ والحوالات',
    description_ar: 'تحليل رسائل المحافظ والحوالات تلقائياً.',
    default: false,
    status: 'active',
    min_app_build: 0,
  }),
  Object.freeze({
    key: 'advanced_analytics',
    label_ar: 'التقارير المالية المتقدمة',
    description_ar: 'عرض التقارير والتحليلات المالية المتقدمة.',
    default: false,
    status: 'active',
    min_app_build: 0,
  }),
]);

const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const FEATURE_KEY_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
const CATALOG_PATH = ['app_settings', 'account_features_catalog'];

function objectBody(body) {
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return null; }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

function respond(res, status, body) {
  return res.status(status).json(body);
}

function catalogDocument(now) {
  return {
    schema_version: 1,
    updated_at_ms: now,
    features: ACCOUNT_FEATURE_CATALOG.map((feature) => ({ ...feature })),
  };
}

function validCatalogDocument(raw) {
  if (!raw || raw.schema_version !== 1
      || !Number.isSafeInteger(raw.updated_at_ms) || raw.updated_at_ms < 1_700_000_000_000
      || !Array.isArray(raw.features)) return false;
  if (Object.keys(raw).some((key) => !['schema_version', 'updated_at_ms', 'features'].includes(key))) return false;
  if (raw.features.length > 128) return false;
  const seen = new Set();
  return raw.features.every((feature) => {
    if (!feature || typeof feature !== 'object' || Array.isArray(feature)) return false;
    if (Object.keys(feature).some((key) => !['key', 'label_ar', 'description_ar', 'default', 'status', 'min_app_build'].includes(key))) return false;
    if (typeof feature.key !== 'string' || !FEATURE_KEY_PATTERN.test(feature.key) || seen.has(feature.key)) return false;
    if (typeof feature.label_ar !== 'string' || !feature.label_ar.trim() || feature.label_ar.length > 80) return false;
    if (feature.description_ar != null && (typeof feature.description_ar !== 'string' || feature.description_ar.length > 300)) return false;
    if (feature.default !== false || !['active', 'retired'].includes(feature.status)) return false;
    if (feature.min_app_build != null && (!Number.isInteger(feature.min_app_build) || feature.min_app_build < 0)) return false;
    seen.add(feature.key);
    return true;
  });
}

export function normalizeAccountFeatures(stored, catalog = ACCOUNT_FEATURE_CATALOG) {
  const source = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  return Object.fromEntries(catalog
    .filter((feature) => feature.status === 'active')
    .map((feature) => [feature.key, source[feature.key] === true]));
}

export function validateAccountFeatureInput(raw, catalog = ACCOUNT_FEATURE_CATALOG) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'features_must_be_object' };
  }
  const keys = Object.keys(raw);
  if (keys.length === 0) return { ok: false, error: 'features_empty' };
  const allowed = new Set(catalog.filter((feature) => feature.status === 'active').map((feature) => feature.key));
  const value = {};
  for (const key of keys) {
    if (!FEATURE_KEY_PATTERN.test(key) || !allowed.has(key)) return { ok: false, error: `unknown_feature:${key}` };
    if (typeof raw[key] !== 'boolean') return { ok: false, error: `${key}_must_be_boolean` };
    value[key] = raw[key];
  }
  return { ok: true, value };
}

async function getOrCreateCatalog(db, now) {
  const ref = db.collection(CATALOG_PATH[0]).doc(CATALOG_PATH[1]);
  const snapshot = await ref.get();
  if (snapshot.exists) {
    const data = snapshot.data();
    if (!validCatalogDocument(data)) throw new Error('account_feature_catalog_invalid');
    return data;
  }
  let result;
  await db.runTransaction(async (transaction) => {
    const latest = await transaction.get(ref);
    if (latest.exists) {
      result = latest.data();
      return;
    }
    result = catalogDocument(now);
    transaction.create(ref, result);
  });
  if (!validCatalogDocument(result)) throw new Error('account_feature_catalog_invalid');
  return result;
}

/** Reads/writes account_features only; legacy feature_entitlements are never read or copied. */
export default async function accountFeaturesHandler(req, res, dependencies = {}) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return respond(res, 405, { success: false, error: 'method_not_allowed' });
  }
  const input = objectBody(req.body);
  if (!input) return respond(res, 400, { success: false, error: 'invalid_json' });
  const action = ['catalog', 'get', 'set'].includes(input.action) ? input.action : null;
  if (!action) return respond(res, 400, { success: false, error: 'unknown_action' });
  const uid = typeof input.uid === 'string' ? input.uid.trim() : '';
  if (action !== 'catalog' && !UID_PATTERN.test(uid)) {
    return respond(res, 400, { success: false, error: 'uid_invalid' });
  }

  const ensure = dependencies.ensureFirebaseAdmin || ensureFirebaseAdmin;
  const configured = ensure();
  if (!configured?.ok) return respond(res, 503, { success: false, error: configured?.error || 'server_not_configured' });
  const getAuthFn = dependencies.getAuth || getAuth;
  const getFirestoreFn = dependencies.getFirestore || getFirestore;
  const authorize = dependencies.authenticateAdmin || authenticateAdmin;
  const caller = await authorize(req, { getAuth: getAuthFn, getFirestore: getFirestoreFn });
  if (!caller.ok) return respond(res, caller.status, { success: false, error: caller.error });

  const db = dependencies.db || getFirestoreFn();
  const serverTimestamp = dependencies.serverTimestamp || (() => FieldValue.serverTimestamp());
  const now = dependencies.now ?? Date.now();

  try {
    const catalog = await getOrCreateCatalog(db, now);
    if (action === 'catalog') {
      return respond(res, 200, { success: true, catalog });
    }

    const userRef = db.collection('users').doc(uid);
    if (action === 'get') {
      const snapshot = await userRef.get();
      if (!snapshot.exists) return respond(res, 404, { success: false, error: 'account_not_found' });
      const user = snapshot.data() || {};
      return respond(res, 200, {
        success: true,
        uid,
        schemaVersion: ACCOUNT_FEATURES_VERSION,
        accountFeatures: normalizeAccountFeatures(user.account_features, catalog.features),
        updatedAtMs: Number.isSafeInteger(user.account_features_updated_at_ms) ? user.account_features_updated_at_ms : null,
      });
    }

    const parsed = validateAccountFeatureInput(input.features, catalog.features);
    if (!parsed.ok) return respond(res, 400, { success: false, error: parsed.error });
    const auditRef = userRef.collection('account_feature_audit').doc();
    const result = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(userRef);
      if (!snapshot.exists) return { error: 'account_not_found', status: 404 };
      const previousUser = snapshot.data() || {};
      const previous = normalizeAccountFeatures(previousUser.account_features, catalog.features);
      const next = { ...previous, ...parsed.value };
      const oldUpdatedAtMs = Number(previousUser.updatedAtMs);
      const oldFeatureUpdatedAtMs = Number(previousUser.account_features_updated_at_ms);
      const syncUpdatedAtMs = Math.max(now, Number.isSafeInteger(oldUpdatedAtMs) ? oldUpdatedAtMs + 1 : now);
      const featureUpdatedAtMs = Math.max(now, Number.isSafeInteger(oldFeatureUpdatedAtMs) ? oldFeatureUpdatedAtMs + 1 : now);
      transaction.set(userRef, {
        account_features: next,
        account_features_version: ACCOUNT_FEATURES_VERSION,
        account_features_updated_at_ms: featureUpdatedAtMs,
        updatedAt: serverTimestamp(),
        updatedAtMs: syncUpdatedAtMs,
      }, { merge: true });
      transaction.set(auditRef, {
        schema_version: 1,
        action: 'account_features_update',
        actor_uid: caller.callerUid,
        account_uid: uid,
        previous,
        next,
        changed_keys: Object.keys(parsed.value),
        created_at: serverTimestamp(),
        created_at_ms: now,
      }, { merge: false });
      return { accountFeatures: next, updatedAtMs: featureUpdatedAtMs, syncUpdatedAtMs };
    });

    if (result?.error) return respond(res, result.status, { success: false, error: result.error });
    return respond(res, 200, {
      success: true,
      uid,
      schemaVersion: ACCOUNT_FEATURES_VERSION,
      ...result,
    });
  } catch (error) {
    console.error('account_features request failed', {
      uid: uid || null,
      actorUid: caller.callerUid,
      code: error?.code || error?.message,
    });
    const invalidCatalog = error?.message === 'account_feature_catalog_invalid';
    return respond(res, invalidCatalog ? 503 : 500, {
      success: false,
      error: invalidCatalog ? 'account_feature_catalog_invalid' : 'account_features_failed',
    });
  }
}
