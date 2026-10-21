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
  'android-ack.schema.json',
  'android-application-state.schema.json',
  'feature-entitlements.schema.json',
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
  'android-ack.applied.json': 'android-ack.schema.json',
  'android-ack.conflict.json': 'android-ack.schema.json',
  'android-ack.failed.json': 'android-ack.schema.json',
  'android-application-state.sample.json': 'android-application-state.schema.json',
  'feature-entitlements.sample.json': 'feature-entitlements.schema.json',
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

test('ACK contract pins ackVersion=1 and requires the identity triple', async () => {
  const schema = await loadSchema('android-ack.schema.json');
  const base = {
    ackVersion: 1, uid: 'u1', installationId: 'i1', releaseId: 'r1',
    payloadHash: 'a'.repeat(64), scopeKey: 'global', outcome: 'applied',
    appliedAt: '2026-01-01T00:00:00.000Z',
  };
  assert.deepEqual(validateSchema(base, schema), []);
  assert.ok(validateSchema({ ...base, ackVersion: 2 }, schema).length > 0, 'wrong ackVersion must fail');
  assert.ok(validateSchema({ ...base, outcome: 'ok' }, schema).length > 0, 'unknown outcome must fail');
  const { uid, ...withoutUid } = base;
  assert.ok(validateSchema(withoutUid, schema).length > 0, 'uid is required');
  assert.ok(validateSchema({ ...base, payloadHash: 'short' }, schema).length > 0, 'hash must be 64 hex');
});

test('ACK contract is idempotency-shaped: identity triple is stable and secret-free', async () => {
  const schema = await loadSchema('android-ack.schema.json');
  const base = {
    ackVersion: 1, uid: 'u1', installationId: 'i1', releaseId: 'r1',
    payloadHash: 'b'.repeat(64), scopeKey: 'global', outcome: 'applied',
    appliedAt: '2026-01-01T00:00:00.000Z',
  };
  // Unknown fields (which could smuggle secrets or message bodies) are rejected.
  assert.ok(validateSchema({ ...base, messageBody: 'secret text' }, schema).length > 0);
  assert.ok(validateSchema({ ...base, networkSecret: 'abc' }, schema).length > 0);
  // The idempotency key fields are all present and typed.
  for (const key of ['uid', 'installationId', 'releaseId', 'payloadHash', 'outcome']) {
    assert.ok(key in base, `${key} must be part of the ACK`);
  }
});

test('application-state contract keeps applied states distinct from fetch/cache', async () => {
  const schema = await loadSchema('android-application-state.schema.json');
  for (const state of ['Draft', 'PublishedCentrally', 'Fetched', 'Cached', 'AppliedLocally', 'ParserRefreshed', 'Unknown']) {
    assert.deepEqual(validateSchema({ state }, schema), [], `${state} must be valid`);
  }
  assert.ok(validateSchema({ state: 'Done' }, schema).length > 0, 'invented state must fail');
  assert.ok(validateSchema({ state: 'AppliedLocally', evidence: 'guess' }, schema).length > 0, 'evidence enum is enforced');
});

test('feature-entitlements contract is boolean-only and separate from lease', async () => {
  const schema = await loadSchema('feature-entitlements.schema.json');
  assert.deepEqual(validateSchema({ hotspot_template_editor: true, mikrotik_card_generator: false }, schema), []);
  assert.ok(validateSchema({ hotspot_template_editor: 'yes' }, schema).length > 0, 'non-boolean must fail');
  // Lease/device fields must not leak into the entitlement map.
  assert.ok(validateSchema({ leaseExpiry: '2026-01-01T00:00:00Z' }, schema).length > 0);
  assert.ok(validateSchema({ installationId: 'i1' }, schema).length > 0);
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
