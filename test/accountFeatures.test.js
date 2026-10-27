import test from 'node:test';
import assert from 'node:assert/strict';
import accountFeaturesHandler, {
  ACCOUNT_FEATURE_CATALOG,
  normalizeAccountFeatures,
  validateAccountFeatureInput,
} from '../server/_lib/accountFeatures.js';
import { createFakeFirestore, createRes } from './helpers/fakeFirestore.js';

const admin = async () => ({ ok: true, callerUid: 'admin-1' });
const configured = () => ({ ok: true });
const deps = (db, extra = {}) => ({
  db,
  ensureFirebaseAdmin: configured,
  authenticateAdmin: admin,
  getAuth: () => ({}),
  getFirestore: () => db,
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  now: 1_798_000_000_000,
  ...extra,
});

async function call(db, body, dependencies = deps(db), method = 'POST') {
  const res = createRes();
  await accountFeaturesHandler({ method, body, headers: {} }, res, dependencies);
  return res;
}

test('catalog is initialized once with the four approved closed-by-default keys', async () => {
  const db = createFakeFirestore();
  const first = await call(db, { action: 'catalog' });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body.catalog.features.map((feature) => feature.key), ACCOUNT_FEATURE_CATALOG.map((feature) => feature.key));
  assert.ok(first.body.catalog.features.every((feature) => feature.default === false && feature.status === 'active'));
  const saved = db._store.get('app_settings/account_features_catalog');
  assert.equal(saved.schema_version, 1);
  assert.equal(saved.updated_at_ms, 1_798_000_000_000);

  const customDb = createFakeFirestore({
    'app_settings/account_features_catalog': {
      schema_version: 1,
      updated_at_ms: 1_798_000_000_000,
      features: [{ key: 'custom_feature', label_ar: 'مخصص', default: false, status: 'active', min_app_build: 3 }],
    },
  });
  const existing = await call(customDb, { action: 'catalog' });
  assert.equal(existing.body.catalog.features[0].key, 'custom_feature');
});

test('old feature_entitlements are ignored and never copied into account_features', async () => {
  const db = createFakeFirestore({
    'users/user-1': {
      uid: 'user-1',
      feature_entitlements: { hotspot_template_editor: true, legacy_key: true },
      account_features: { advanced_analytics: true, unknown_key: true },
    },
  });
  const result = await call(db, { action: 'get', uid: 'user-1' });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.accountFeatures, {
    mikrotik_card_generator: false,
    hotspot_template_editor: false,
    sms_auto_parser: false,
    advanced_analytics: true,
  });
  assert.equal(normalizeAccountFeatures({ feature_entitlements: { hotspot_template_editor: true } }).hotspot_template_editor, false);
});

test('set merges catalog keys, stamps sync versions and appends per-user audit transactionally', async () => {
  const db = createFakeFirestore({
    'users/user-1': {
      uid: 'user-1',
      account_features: { advanced_analytics: true },
      account_features_updated_at_ms: 1_797_999_999_999,
      updatedAtMs: 1_798_000_000_000,
    },
  });
  const result = await call(db, {
    action: 'set',
    uid: 'user-1',
    features: { hotspot_template_editor: true, advanced_analytics: false },
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.accountFeatures, {
    mikrotik_card_generator: false,
    hotspot_template_editor: true,
    sms_auto_parser: false,
    advanced_analytics: false,
  });
  const user = db._store.get('users/user-1');
  assert.deepEqual(user.account_features, result.body.accountFeatures);
  assert.equal(user.account_features_version, 1);
  assert.equal(user.account_features_updated_at_ms, 1_798_000_000_000);
  assert.equal(user.account_features_updated_by, 'admin-1');
  assert.equal(user.account_features_source, 'admin_api');
  assert.equal(user.updatedAtMs, 1_798_000_000_001);
  assert.equal(user.feature_entitlements, undefined);
  const audit = [...db._store.entries()].find(([path]) => path.startsWith('users/user-1/account_feature_audit/'))?.[1];
  assert.ok(audit);
  assert.equal(audit.actor_uid, 'admin-1');
  assert.deepEqual(audit.next, result.body.accountFeatures);
  assert.deepEqual(audit.changed_keys, ['hotspot_template_editor', 'advanced_analytics']);
});

test('set rejects unknown keys, non-booleans, empty maps and unknown accounts', async () => {
  const db = createFakeFirestore({ 'users/user-1': { uid: 'user-1' } });
  for (const features of [{ not_a_feature: true }, { sms_auto_parser: 1 }, {}]) {
    const result = await call(db, { action: 'set', uid: 'user-1', features });
    assert.equal(result.statusCode, 400);
  }
  const missing = await call(db, { action: 'set', uid: 'absent-user', features: { sms_auto_parser: true } });
  assert.equal(missing.statusCode, 404);
  assert.equal(db._store.has('users/absent-user'), false);
});

test('endpoint requires POST and admin authorization', async () => {
  const db = createFakeFirestore();
  const wrongMethod = await call(db, { action: 'catalog' }, deps(db), 'GET');
  assert.equal(wrongMethod.statusCode, 405);
  const denied = await call(db, { action: 'catalog' }, deps(db, {
    authenticateAdmin: async () => ({ ok: false, status: 403, error: 'admin_required' }),
  }));
  assert.equal(denied.statusCode, 403);
  assert.equal(db._store.has('app_settings/account_features_catalog'), false);
});
