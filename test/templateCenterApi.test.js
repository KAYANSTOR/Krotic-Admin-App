import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateCenterHandler } from '../server/_lib/templateCenterApi.js';
import { createFakeFirestore, createRes } from './helpers/fakeFirestore.js';

const hash = 'a'.repeat(64);

function seed() {
  return {
    'template_center_releases/release-1': {
      status: 'published',
      scopeKey: 'global',
      scope: { type: 'global', networkId: null },
      payloadHashSha256: hash,
      minAppVersion: '0.0.0',
      minAppBuild: 0,
      payload: { wallets: [], transferTemplates: [], outboundTemplates: [] },
    },
    'users/user-1': { uid: 'user-1', entitlementInstallationId: 'install-1' },
  };
}

function makeHandler({
  db = createFakeFirestore(seed()),
  user = { ok: true, uid: 'user-1' },
  admin = { ok: false, status: 403, error: 'not_admin' },
} = {}) {
  return createTemplateCenterHandler({
    ensureFirebaseAdmin: () => ({ ok: true }),
    authenticateUser: async () => user,
    authenticateAdmin: async () => admin,
    getDb: () => db,
  });
}

function validAck(overrides = {}) {
  return {
    action: 'ack',
    ackVersion: 1,
    installationId: 'install-1',
    releaseId: 'release-1',
    payloadHash: hash,
    scopeKey: 'global',
    outcome: 'applied',
    appliedAt: '2026-01-01T00:00:00.000Z',
    insertedCount: 2,
    conflictCount: 0,
    ...overrides,
  };
}

function post(body) {
  return { method: 'POST', headers: { authorization: 'Bearer token' }, body };
}

test('ACK endpoint records a verified ACK and is idempotent on resend', async () => {
  const db = createFakeFirestore(seed());
  const handler = makeHandler({ db });
  const res1 = createRes();
  await handler(post(validAck()), res1);
  assert.equal(res1.statusCode, 201);
  assert.equal(res1.body.success, true);
  assert.equal(res1.body.duplicate, false);
  assert.equal(res1.body.releaseId, 'release-1');
  assert.equal(res1.body.payloadHash, hash);
  assert.equal(res1.body.installationId, 'install-1');
  assert.equal(res1.body.scopeKey, 'global');

  const res2 = createRes();
  await handler(post(validAck()), res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.duplicate, true);
  assert.equal(res2.body.ackId, res1.body.ackId);

  const ackDocs = [...db._store.keys()].filter((key) => key.startsWith('template_center_acks/'));
  assert.equal(ackDocs.length, 1);
});

test('ACK endpoint accepts and echoes the published network scope', async () => {
  const data = seed();
  data['template_center_releases/release-network'] = {
    status: 'published',
    scopeKey: 'network:network-1',
    scope: { type: 'network', networkId: 'network-1' },
    payloadHashSha256: hash,
    payload: { wallets: [], transferTemplates: [], outboundTemplates: [] },
  };
  const db = createFakeFirestore(data);
  const handler = makeHandler({ db });
  const res = createRes();
  await handler(post(validAck({
    releaseId: 'release-network',
    scopeKey: 'network:network-1',
  })), res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.scopeKey, 'network:network-1');
  assert.equal(res.body.releaseId, 'release-network');
});

test('ACK endpoint rejects unauthenticated callers and mismatched uid', async () => {
  const handler = makeHandler({ user: { ok: false, status: 401, error: 'missing_token' } });
  const res = createRes();
  await handler(post(validAck()), res);
  assert.equal(res.statusCode, 401);

  const uidHandler = makeHandler();
  const uidRes = createRes();
  await uidHandler(post(validAck({ uid: 'someone-else' })), uidRes);
  assert.equal(uidRes.statusCode, 403);
  assert.equal(uidRes.body.error, 'uid_mismatch');
});

test('ACK endpoint rejects hash mismatch and unknown release without recording anything', async () => {
  const db = createFakeFirestore(seed());
  const handler = makeHandler({ db });
  const badHash = createRes();
  await handler(post(validAck({ payloadHash: 'b'.repeat(64) })), badHash);
  assert.equal(badHash.statusCode, 409);
  assert.equal(badHash.body.error, 'payload_hash_mismatch');

  const unknown = createRes();
  await handler(post(validAck({ releaseId: 'missing' })), unknown);
  assert.equal(unknown.statusCode, 404);

  const ackDocs = [...db._store.keys()].filter((key) => key.startsWith('template_center_acks/'));
  assert.equal(ackDocs.length, 0);
});

test('ACK endpoint enforces the account-bound installation', async () => {
  const db = createFakeFirestore(seed());
  const handler = makeHandler({ db });
  const res = createRes();
  await handler(post(validAck({ installationId: 'unbound-install' })), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'installation_mismatch');
});

test('admin actions still require an authenticated admin', async () => {
  const handler = makeHandler();
  const res = createRes();
  await handler(post({ action: 'list' }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'not_admin');
});

test('read-active needs a user token', async () => {
  const handler = makeHandler({ user: { ok: false, status: 401, error: 'invalid_token' } });
  const res = createRes();
  await handler(post({ action: 'read-active', appVersion: '1.0.0', appBuild: 1 }), res);
  assert.equal(res.statusCode, 401);
});

test('non-POST and unknown actions are rejected', async () => {
  const handler = makeHandler({ admin: { ok: true, callerUid: 'admin-1' } });
  const getRes = createRes();
  await handler({ method: 'GET', headers: {}, body: {} }, getRes);
  assert.equal(getRes.statusCode, 405);

  const unknownRes = createRes();
  await handler(post({ action: 'delete-everything' }), unknownRes);
  assert.equal(unknownRes.statusCode, 400);
  assert.equal(unknownRes.body.error, 'unknown_action');
});

test('catalog action returns the server catalog to an admin', async () => {
  const handler = makeHandler({ admin: { ok: true, callerUid: 'admin-1' } });
  const res = createRes();
  await handler(post({ action: 'catalog' }), res);
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.catalog.outboundTemplates));
});

test('server not configured returns 503 before any work', async () => {
  const handler = createTemplateCenterHandler({
    ensureFirebaseAdmin: () => ({ ok: false, error: 'server_not_configured' }),
    authenticateUser: async () => ({ ok: true, uid: 'u' }),
    authenticateAdmin: async () => ({ ok: false, status: 403, error: 'not_admin' }),
    getDb: () => createFakeFirestore(),
  });
  const res = createRes();
  await handler(post(validAck()), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'server_not_configured');
});
