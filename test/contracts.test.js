// ============================================================
// Phase 1 — versioned contract + fixture validation.
// ------------------------------------------------------------
// هذه الاختبارات تجعل عقود المجلد `contracts/` قابلة للتنفيذ في CI:
//   - كل ملف schema JSON صالح ويحمل schemaVersion.
//   - كل fixture اصطناعي مطابق لمخطّطه.
//   - قواعد إضافية مهمة (فصل المجالات، رفض حقول الرصيد، idempotency).
// لا تتصل بشبكة ولا ببيئة إنتاج، ولا تقرأ أسرارًا.
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSchema } from '../contracts/lib/schemaValidator.js';
import {
  validateTemplatePayload,
  getTemplateCenterCatalog,
} from '../server/_lib/templateCenter.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemasDir = path.join(root, 'contracts', 'schemas');
const fixturesDir = path.join(root, 'contracts', 'fixtures');

const schemaCache = new Map();

async function loadJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function loadSchema(name) {
  if (!schemaCache.has(name)) {
    schemaCache.set(name, await loadJson(path.join(schemasDir, name)));
  }
  return schemaCache.get(name);
}

/** Resolves local `$ref: "<file>.schema.json"` references used by the release schema. */
async function resolveRefs(schema) {
  if (Array.isArray(schema)) {
    return Promise.all(schema.map(resolveRefs));
  }
  if (schema && typeof schema === 'object') {
    if (typeof schema.$ref === 'string' && schema.$ref.endsWith('.schema.json')) {
      return resolveRefs(await loadSchema(schema.$ref));
    }
    const out = {};
    for (const [key, value] of Object.entries(schema)) {
      out[key] = await resolveRefs(value);
    }
    return out;
  }
  return schema;
}

/** Fixtures carry `_synthetic`/`_note` markers; strip them before strict validation. */
function stripMarkers(value) {
  if (Array.isArray(value)) return value.map(stripMarkers);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (key.startsWith('_')) continue;
      out[key] = stripMarkers(item);
    }
    return out;
  }
  return value;
}

const SCHEMA_FILES = [
  'wallet.schema.json',
  'inbound-template.schema.json',
  'outbound-template.schema.json',
  'template-release.schema.json',
  'template-center-ack-request.schema.json',
  'template-ack.schema.json',
  'android-application-state.schema.json',
  'account-features.schema.json',
  'account-features-catalog.schema.json',
  'default-template-catalog.schema.json',
  'inventory-snapshot.schema.json',
  'entitlement-activate-request.schema.json',
  'entitlement-lease.schema.json',
  'sales-ingest-request.schema.json',
  'device-heartbeat-request.schema.json',
  'sms-device-task.schema.json',
];

test('every contract schema is valid JSON and carries a schemaVersion', async () => {
  const files = (await readdir(schemasDir)).filter((name) => name.endsWith('.schema.json'));
  assert.deepEqual([...files].sort(), [...SCHEMA_FILES].sort());
  for (const name of SCHEMA_FILES) {
    const schema = await loadSchema(name);
    assert.ok(Number.isInteger(schema.schemaVersion), `${name} must declare an integer schemaVersion`);
    assert.equal(schema.schemaVersion, 1, `${name} must be version 1`);
    assert.ok(schema.$id && schema.title, `${name} must declare $id and title`);
  }
});

const FIXTURE_SCHEMA_MAP = {
  'wallet.sample.json': 'wallet.schema.json',
  'inbound-template.sample.json': 'inbound-template.schema.json',
  'outbound-template.sample.json': 'outbound-template.schema.json',
  'template-release.sample.json': 'template-release.schema.json',
  'template-center-ack-request.sample.json': 'template-center-ack-request.schema.json',
  'template-ack.sample.json': 'template-ack.schema.json',
  'android-application-state.sample.json': 'android-application-state.schema.json',
  'account-features.sample.json': 'account-features.schema.json',
  'account-features-catalog.sample.json': 'account-features-catalog.schema.json',
  'android-default-catalog-v1.json': 'default-template-catalog.schema.json',
  'inventory-snapshot.sample.json': 'inventory-snapshot.schema.json',
  'entitlement-activate-request.sample.json': 'entitlement-activate-request.schema.json',
  'sales-ingest-request.sample.json': 'sales-ingest-request.schema.json',
  'device-heartbeat-request.sample.json': 'device-heartbeat-request.schema.json',
};

test('every synthetic fixture validates against its schema', async () => {
  const files = (await readdir(fixturesDir)).filter((name) => name.endsWith('.json'));
  assert.deepEqual([...files].sort(), Object.keys(FIXTURE_SCHEMA_MAP).sort());
  for (const [fixtureName, schemaName] of Object.entries(FIXTURE_SCHEMA_MAP)) {
    const fixture = stripMarkers(await loadJson(path.join(fixturesDir, fixtureName)));
    const schema = await resolveRefs(await loadSchema(schemaName));
    const errors = validateSchema(fixture, schema);
    assert.deepEqual(errors, [], `${fixtureName} must validate: ${errors.join('; ')}`);
  }
});

test('wallet contract rejects unknown and financial fields', async () => {
  const schema = await loadSchema('wallet.schema.json');
  const base = { id: 'w1', name: 'محفظة', status: 'active' };
  assert.deepEqual(validateSchema(base, schema), []);
  assert.ok(validateSchema({ ...base, balance: 100 }, schema).length > 0, 'balance must be rejected');
  assert.ok(validateSchema({ ...base, amountMinor: 1 }, schema).length > 0, 'amountMinor must be rejected');
  assert.ok(validateSchema({ ...base, status: 'open' }, schema).length > 0, 'unknown status must be rejected');
});

test('inbound template contract enforces identifierKind enum and priority bounds', async () => {
  const schema = await loadSchema('inbound-template.schema.json');
  const base = {
    id: 't1', name: 'قالب', pattern: '{amount}', priority: 1, identifierKind: 'phone', isActive: true,
  };
  assert.deepEqual(validateSchema(base, schema), []);
  assert.ok(validateSchema({ ...base, identifierKind: 'regex' }, schema).length > 0);
  assert.ok(validateSchema({ ...base, priority: -1 }, schema).length > 0);
  assert.ok(validateSchema({ ...base, priority: 10000 }, schema).length > 0);
});

test('release payload references validate wallet + template sub-schemas', async () => {
  const schema = await resolveRefs(await loadSchema('template-release.schema.json'));
  const good = {
    wallets: [{ id: 'w1', name: 'محفظة', status: 'active' }],
    transferTemplates: [{ id: 't1', name: 'ق', pattern: '{amount}', priority: 1, identifierKind: 'phone', isActive: true }],
    outboundTemplates: [{ key: 'customer_debt_payment_template', body: '{amount}' }],
  };
  assert.deepEqual(validateSchema(good, schema), []);
  const badWallet = { ...good, wallets: [{ id: 'w1', name: 'محفظة', status: 'active', balance: 5 }] };
  assert.ok(validateSchema(badWallet, schema).length > 0, 'financial field inside release must be rejected');
});

test('ACK request matches the Android-to-Vercel contract and rejects extra identity or secret fields', async () => {
  const schema = await loadSchema('template-center-ack-request.schema.json');
  const base = {
    action: 'ack', ackVersion: 1, installationId: 'device-12345678', releaseId: 'r1',
    payloadHash: 'b'.repeat(64), scopeKey: 'global', outcome: 'applied',
    appliedAt: '2026-10-23T10:00:00.000Z', insertedCount: 1, conflictCount: 0,
    parserRefreshed: true, appVersion: '1.2.3',
  };
  assert.deepEqual(validateSchema(base, schema), []);
  assert.ok(validateSchema({ ...base, messageBody: 'secret text' }, schema).length > 0);
  assert.ok(validateSchema({ ...base, networkSecret: 'abc' }, schema).length > 0);
  assert.ok(validateSchema({ ...base, uid: 'spoofed' }, schema).length > 0, 'uid is derived from Firebase token');
});

test('inventory snapshot contract is counts-only and rejects identity or secret fields', async () => {
  const schema = await loadSchema('inventory-snapshot.schema.json');
  const base = {
    schemaVersion: 1,
    networkId: 'NET-10001',
    snapshotId: 'snap-1',
    inventoryRevision: 3,
    generatedAt: '2026-10-27T05:00:00.000Z',
    totalAvailableCards: 40,
    totalReservedCards: 1,
    totalSoldCards: 10,
    totalInvalidCards: 0,
    breakdown: [{ catalogId: 'c1', denomination: 100, currency: 'YER', availableCount: 40, reservedCount: 1, soldCount: 10 }],
  };
  assert.deepEqual(validateSchema(base, schema), []);
  assert.ok(validateSchema({ ...base, uid: 'spoofed' }, schema).length > 0, 'uid is derived from the Firebase token');
  assert.ok(validateSchema({ ...base, pin: '1234' }, schema).length > 0, 'secret card fields are not allowed');
  assert.ok(validateSchema({ ...base, totalAvailableCards: -1 }, schema).length > 0);
  assert.ok(validateSchema({ ...base, breakdown: [{ ...base.breakdown[0], extra: 1 }] }, schema).length > 0);
  assert.ok(validateSchema({ ...base, generatedAt: 'yesterday' }, schema).length > 0);

  // نفس القواعد مفروضة فعلياً في نقطة النهاية الخادمية.
  const { validateInventorySnapshot } = await import('../server/apiHandlers/inventory-snapshot.js');
  assert.equal(validateInventorySnapshot(base).ok, true);
  assert.equal(validateInventorySnapshot({ ...base, uid: 'spoofed' }).error, 'unknown_field');
  assert.equal(validateInventorySnapshot({ ...base, cardNumber: '1234' }).error, 'secret_field_forbidden');
  assert.equal(validateInventorySnapshot({ ...base, totalReservedCards: '1' }).error, 'counter_invalid');
});

test('application-state contract keeps applied states distinct from fetch/cache', async () => {
  const schema = await loadSchema('android-application-state.schema.json');
  for (const state of ['Draft', 'PublishedCentrally', 'Fetched', 'Cached', 'AppliedLocally', 'ParserRefreshed', 'Unknown']) {
    assert.deepEqual(validateSchema({ state }, schema), [], `${state} must be valid`);
  }
  assert.ok(validateSchema({ state: 'Done' }, schema).length > 0, 'invented state must fail');
  assert.ok(validateSchema({ state: 'AppliedLocally', evidence: 'guess' }, schema).length > 0, 'evidence enum is enforced');
});

test('account_features schema is the sole boolean entitlement map', async () => {
  const schema = await loadSchema('account-features.schema.json');
  const valid = {
    account_features: { hotspot_template_editor: true, mikrotik_card_generator: false },
    account_features_version: 1,
    account_features_updated_at_ms: 1761177600000,
  };
  assert.deepEqual(validateSchema(valid, schema), []);
  assert.ok(validateSchema({ ...valid, account_features: { sms_auto_parser: 'yes' } }, schema).length > 0);
  assert.ok(validateSchema({ account_features: valid.account_features }, schema).length > 0, 'version and timestamp are required');

  const catalogSchema = await loadSchema('account-features-catalog.schema.json');
  const { ACCOUNT_FEATURE_CATALOG } = await import('../server/_lib/accountFeatures.js');
  const catalog = {
    schema_version: 1,
    updated_at_ms: 1761177600000,
    features: ACCOUNT_FEATURE_CATALOG.map((feature) => ({ ...feature })),
  };
  assert.deepEqual(validateSchema(catalog, catalogSchema), []);
});

test('account_features uses the approved catalog and remains server-only', async () => {
  const {
    ACCOUNT_FEATURE_CATALOG,
    validateAccountFeatureInput,
    normalizeAccountFeatures,
  } = await import('../server/_lib/accountFeatures.js');
  assert.deepEqual(ACCOUNT_FEATURE_CATALOG.map((feature) => feature.key).sort(), [
    'advanced_analytics',
    'hotspot_phone_recharge',
    'hotspot_template_editor',
    'mikrotik_card_generator',
    'smart_delivery_routing',
    'sms_auto_parser',
    'whatsapp_card_delivery',
  ]);
  const { KROTAK_PRO_REQUIRED_FEATURE_KEYS } = await import('../server/_lib/accountFeatures.js');
  const catalogSet = new Set(ACCOUNT_FEATURE_CATALOG.map((feature) => feature.key));
  for (const key of KROTAK_PRO_REQUIRED_FEATURE_KEYS) {
    assert.ok(catalogSet.has(key), `missing Krotak Pro key ${key}`);
  }
  assert.equal(KROTAK_PRO_REQUIRED_FEATURE_KEYS.length, 5);
  assert.ok(ACCOUNT_FEATURE_CATALOG.every((feature) => feature.default === false));
  assert.equal(validateAccountFeatureInput({ made_up_feature: true }).ok, false);
  assert.equal(validateAccountFeatureInput({ hotspot_template_editor: 1 }).ok, false);
  assert.equal(normalizeAccountFeatures({ feature_entitlements: { hotspot_template_editor: true } }).hotspot_template_editor, false);
  const rules = await readFile(path.join(root, 'firestore.rules'), 'utf8');
  assert.match(rules, /'account_features'/u, 'rules must block client writes to account_features');
  assert.match(rules, /subcollection != 'template_acks'/u, 'template ACK writes must be server-only');
  assert.match(rules, /subcollection != 'account_feature_audit'/u, 'feature audit writes must be server-only');
});

test('release fixture also passes the real server publish validation (not just the schema)', async () => {
  const release = stripMarkers(await loadJson(path.join(fixturesDir, 'template-release.sample.json')));
  const publish = validateTemplatePayload(release, { allowDrafts: false });
  assert.deepEqual(publish.errors, [], 'fixture must be publishable by server/_lib/templateCenter.js');
  assert.equal(publish.ok, true);
});

test('outbound template fixture key and variables exist in the server catalog', async () => {
  const outbound = stripMarkers(await loadJson(path.join(fixturesDir, 'outbound-template.sample.json')));
  const catalog = getTemplateCenterCatalog();
  const definition = catalog.outboundTemplates.find((item) => item.key === outbound.key);
  assert.ok(definition, `key ${outbound.key} must exist in the server outbound catalog`);
  // Every variable used by the fixture body must be a known canonical variable.
  const known = new Set(catalog.outboundVariables);
  const used = [...outbound.body.matchAll(/\{([^{}]+)\}/gu)].map((match) => match[1]);
  for (const variable of used) {
    assert.ok(known.has(variable), `variable ${variable} must be in the catalog`);
  }
  for (const required of definition.required) {
    assert.ok(used.includes(required), `required variable ${required} must appear in the fixture body`);
  }
});

test('outbound template contract is separate from inbound and FCM', async () => {
  const schema = await loadSchema('outbound-template.schema.json');
  assert.deepEqual(validateSchema({ key: 'k', body: '{amount}' }, schema), []);
  // Inbound-only fields must be rejected (different domain).
  assert.ok(validateSchema({ key: 'k', body: '{amount}', identifierKind: 'phone' }, schema).length > 0);
  // FCM-only fields must be rejected.
  assert.ok(validateSchema({ key: 'k', body: '{amount}', topic: 'all' }, schema).length > 0);
});
