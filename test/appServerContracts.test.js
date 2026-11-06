/**
 * Binds the app ⇄ server contracts in contracts/schemas to the code that
 * actually enforces them. A schema that drifts from its validator or from the
 * server's real output fails here, not in production.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateKeyPairSync, verify } from 'node:crypto';
import { validateSchema } from '../contracts/lib/schemaValidator.js';
import activateEntitlement from '../server/_lib/entitlementActivation.js';
import { validateIngestInput } from '../server/apiHandlers/sales-ingest.js';
import { validateHeartbeat } from '../server/_lib/deviceHeartbeat.js';

const load = async (name) => JSON.parse(await readFile(new URL(`../contracts/${name}`, import.meta.url), 'utf8'));
const NOW = Date.parse('2026-11-01T12:00:00.000Z');

test('activation request: fixture valid for schema and accepted shape by server', async () => {
  const schema = await load('schemas/entitlement-activate-request.schema.json');
  const fixture = await load('fixtures/entitlement-activate-request.sample.json');
  assert.deepEqual(validateSchema(fixture, schema), []);
  assert.ok(validateSchema({ userId: 'u1' }, schema).length > 0, 'installation is required');
  assert.ok(validateSchema({ installationId: 'i-1', role: 'admin' }, schema).length > 0, 'unknown fields rejected');
});

test('signed lease produced by the server matches the lease contract and verifies', async () => {
  const schema = await load('schemas/entitlement-lease.schema.json');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const user = {
    uid: 'user-1',
    accessStatus: 'TRIAL',
    trialStartedAt: new Date(NOW - 86_400_000),
    subscriptionEndsAt: new Date(NOW + 20 * 86_400_000),
  };
  const docs = new Map([['users/user-1', user]]);
  const ref = (c, id) => ({ key: `${c}/${id}` });
  const db = {
    collection: (c) => ({ doc: (id) => ref(c, id ?? 'auto'), add: async () => ref(c, 'auto') }),
    runTransaction: async (fn) => fn({
      get: async (r) => ({ exists: docs.has(r.key), data: () => docs.get(r.key) }),
      set: (r, data, o = {}) => docs.set(r.key, o.merge ? { ...(docs.get(r.key) || {}), ...data } : data),
    }),
  };
  const res = { statusCode: 0, body: null, setHeader() {}, status(v) { this.statusCode = v; return this; }, json(v) { this.body = v; return this; } };
  await activateEntitlement(
    { method: 'POST', headers: { authorization: 'Bearer t' }, body: { userId: 'user-1', installationId: 'inst-a' }, query: {} },
    res,
    { ensureFirebaseAdmin: () => ({ ok: true }), auth: { verifyIdToken: async () => ({ uid: 'user-1' }) }, db, privateKey, serverTimestamp: () => 'TS', now: NOW },
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(validateSchema(res.body, schema), []);
  // Key order is part of the signed bytes: the required list documents it.
  const order = Object.keys(res.body.payload).filter((k) => k !== 'trialEndsAt');
  assert.deepEqual(order, schema.properties.payload.required);
  assert.ok(verify(null, Buffer.from(JSON.stringify(res.body.payload)), publicKey, Buffer.from(res.body.signature, 'base64')));
  const p = res.body.payload;
  assert.ok(Date.parse(p.maxOfflineUntil) - Date.parse(p.issuedAt) <= 29 * 86_400_000, 'offline window capped at 29 days');
});

test('sales ingest: schema and server validator agree', async () => {
  const schema = await load('schemas/sales-ingest-request.schema.json');
  const fixture = await load('fixtures/sales-ingest-request.sample.json');
  assert.deepEqual(validateSchema(fixture, schema), []);
  assert.equal(validateIngestInput(fixture).ok, true);
  const cases = [
    { ...fixture, commissionMinor: 0 },
    { ...fixture, uid: 'x' },
    { ...fixture, currencyCode: 'USD' },
    { ...fixture, amountMinor: 150 },
    { ...fixture, saleUuid: 'bad/id' },
    { ...fixture, saleUuid: 'x'.repeat(129) },
  ];
  for (const bad of cases) {
    assert.equal(validateIngestInput(bad).ok, false, JSON.stringify(bad));
  }
  for (const bad of cases.slice(0, 3).concat(cases.slice(4))) {
    assert.ok(validateSchema(bad, schema).length > 0, JSON.stringify(bad));
  }
});

test('device heartbeat: schema and server validator agree', async () => {
  const schema = await load('schemas/device-heartbeat-request.schema.json');
  const fixture = await load('fixtures/device-heartbeat-request.sample.json');
  assert.deepEqual(validateSchema(fixture, schema), []);
  assert.equal(validateHeartbeat(fixture).ok, true);
  for (const bad of [{ ...fixture, schemaVersion: 2 }, { ...fixture, pendingCount: -1 }, { ...fixture, lastSeenAt: 'x' }]) {
    assert.equal(validateHeartbeat(bad).ok, false);
    assert.ok(validateSchema(bad, schema).length > 0);
  }
});
