import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateCenterHandler } from '../server/_lib/templateCenterApi.js';
import { createFakeFirestore, createRes } from './helpers/fakeFirestore.js';

const hash = 'a'.repeat(64);
const deviceId = 'device-12345678';

function seed() {
  return {
    'template_center_releases/release-1': {
      status: 'published',
      scopeKey: 'global',
      scope: { type: 'global', networkId: null },
      version: '1.0.3',
      versionCode: 3,
      payloadHashSha256: hash,
      minAppVersion: '0.0.0',
      minAppBuild: 0,
      payload: { wallets: [], transferTemplates: [], outboundTemplates: [] },
    },
    'users/user-1': { uid: 'user-1', networkId: 'user-1', entitlementInstallationId: deviceId },
  };
}

function makeHandler({
  db = createFakeFirestore(seed()),
  user = { ok: true, uid: 'user-1' },
  admin = { ok: false, status: 403, error: 'not_admin' },
  now = Date.parse('2026-10-23T07:00:00.000Z'),
} = {}) {
  return createTemplateCenterHandler({
    ensureFirebaseAdmin: () => ({ ok: true }),
    authenticateUser: async () => user,
    authenticateAdmin: async () => admin,
    getDb: () => db,
    now,
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    timestampFromMillis: (value) => new Date(value),
  });
}

function validAck(overrides = {}) {
  return {
    action: 'ack',
    ackVersion: 1,
    installationId: deviceId,
    releaseId: 'release-1',
    payloadHash: hash,
    scopeKey: 'global',
    outcome: 'applied',
    appliedAt: '2026-10-23T06:59:00.000Z',
    insertedCount: 2,
    conflictCount: 0,
    parserRefreshed: true,
    appVersion: '1.0.16',
    appBuild: 16,
    ...overrides,
  };
}

function post(body) {
  return { method: 'POST', headers: { authorization: 'Bearer token' }, body };
}

test('ACK endpoint verifies and stores one server-owned latest record per device', async () => {
  const db = createFakeFirestore(seed());
  const handler = makeHandler({ db });
  const first = createRes();
  await handler(post(validAck()), first);
  assert.equal(first.statusCode, 201);
  assert.equal(first.body.success, true);
  assert.equal(first.body.duplicate, false);
  assert.equal(first.body.releaseId, 'release-1');
  assert.equal(first.body.payloadHash, hash);
  assert.equal(first.body.installationId, deviceId);
  assert.equal(first.body.scopeKey, 'global');

  const ackPath = `users/user-1/template_acks/${deviceId}`;
  const stored = db._store.get(ackPath);
  assert.equal(stored.writer, 'server');
  assert.equal(stored.uid, 'user-1');
  assert.equal(stored.device_id, deviceId);
  assert.equal(stored.network_id, 'user-1');
  assert.equal(stored.applied_version_id, 'release-1');
  assert.equal(stored.outcome, 'applied');
  assert.equal(stored.payload_hash_sha256, hash);
  assert.equal(db._store.has(`template_center_acks/user-1_${deviceId}_release-1`), false);

  const second = createRes();
  await handler(post(validAck()), second);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.ackId, first.body.ackId);
});

test('newer ACK overwrites the same device document instead of accumulating history', async () => {
  const data = seed();
  data['template_center_releases/release-2'] = {
    status: 'published', scopeKey: 'global', version: '1.0.4', versionCode: 4,
    payloadHashSha256: 'b'.repeat(64), payload: { wallets: [], transferTemplates: [], outboundTemplates: [] },
  };
  const db = createFakeFirestore(data);
  const handler = makeHandler({ db });
  await handler(post(validAck()), createRes());
  const updated = createRes();
  await handler(post(validAck({
    releaseId: 'release-2', payloadHash: 'b'.repeat(64), outcome: 'partially_applied',
    insertedCount: 1, conflictCount: 1, parserRefreshed: false,
  })), updated);
  assert.equal(updated.statusCode, 201);
  const ackDocs = [...db._store.keys()].filter((key) => key.startsWith('users/user-1/template_acks/'));
  assert.deepEqual(ackDocs, [`users/user-1/template_acks/${deviceId}`]);
  const latest = db._store.get(ackDocs[0]);
  assert.equal(latest.applied_version_id, 'release-2');
  assert.equal(latest.previous_version_id, 'release-1');
  assert.equal(latest.outcome, 'partially_applied');
});

test('ACK endpoint accepts a matching published network scope and derives network_id', async () => {
  const data = seed();
  data['users/user-1'] = { ...data['users/user-1'], networkId: 'network-1' };
  data['networks/network-1'] = { networkId: 'network-1', owner_uid: 'user-1', networkName: 'Test' };
  data['template_center_releases/release-network'] = {
    status: 'published', scopeKey: 'network:network-1', scope: { type: 'network', networkId: 'network-1' },
    version: '1.1.0', versionCode: 10, payloadHashSha256: hash,
    payload: { wallets: [], transferTemplates: [], outboundTemplates: [] },
  };
  const db = createFakeFirestore(data);
  const handler = makeHandler({ db });
  const res = createRes();
  await handler(post(validAck({ releaseId: 'release-network', scopeKey: 'network:network-1' })), res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.scopeKey, 'network:network-1');
  assert.equal(db._store.get(`users/user-1/template_acks/${deviceId}`).network_id, 'network-1');
});

test('ACK endpoint rejects unauthenticated calls, uid spoofing, and missing device binding', async () => {
  const unauthenticated = makeHandler({ user: { ok: false, status: 401, error: 'missing_token' } });
  const noToken = createRes();
  await unauthenticated(post(validAck()), noToken);
  assert.equal(noToken.statusCode, 401);

  const uidRes = createRes();
  await makeHandler()(post(validAck({ uid: 'someone-else' })), uidRes);
  assert.equal(uidRes.statusCode, 403);
  assert.equal(uidRes.body.error, 'uid_mismatch');

  const noBindingDb = createFakeFirestore({ ...seed(), 'users/user-1': { uid: 'user-1' } });
  const noBinding = createRes();
  await makeHandler({ db: noBindingDb })(post(validAck()), noBinding);
  assert.equal(noBinding.statusCode, 403);
  assert.equal(noBinding.body.error, 'installation_not_bound');
});

test('ACK rejects hash mismatch, scope mismatch and unknown releases without writing', async () => {
  const db = createFakeFirestore(seed());
  const handler = makeHandler({ db });
  const badHash = createRes();
  await handler(post(validAck({ payloadHash: 'b'.repeat(64) })), badHash);
  assert.equal(badHash.statusCode, 409);
  assert.equal(badHash.body.error, 'payload_hash_mismatch');

  const unknown = createRes();
  await handler(post(validAck({ releaseId: 'missing' })), unknown);
  assert.equal(unknown.statusCode, 404);

  const wrongNetwork = createRes();
  await handler(post(validAck({ scopeKey: 'network:elsewhere' })), wrongNetwork);
  assert.equal(wrongNetwork.statusCode, 409);
  assert.equal(wrongNetwork.body.error, 'scope_mismatch');
  assert.equal([...db._store.keys()].filter((key) => key.startsWith('users/user-1/template_acks/')).length, 0);
});

test('ACK endpoint enforces installation binding and network ownership', async () => {
  const db = createFakeFirestore(seed());
  const handler = makeHandler({ db });
  const mismatched = createRes();
  await handler(post(validAck({ installationId: 'device-87654321' })), mismatched);
  assert.equal(mismatched.statusCode, 403);
  assert.equal(mismatched.body.error, 'installation_mismatch');

  const wrongNetworkData = seed();
  wrongNetworkData['users/user-1'] = { ...wrongNetworkData['users/user-1'], networkId: 'network-1' };
  wrongNetworkData['networks/network-1'] = { networkId: 'network-1', owner_uid: 'someone-else' };
  wrongNetworkData['template_center_releases/release-network'] = {
    status: 'published', scopeKey: 'network:network-1',
    scope: { type: 'network', networkId: 'network-1' }, version: '1.0.4', versionCode: 4,
    payloadHashSha256: hash, payload: { wallets: [], transferTemplates: [], outboundTemplates: [] },
  };
  const wrongNetwork = createRes();
  await makeHandler({ db: createFakeFirestore(wrongNetworkData) })(
    post(validAck({ releaseId: 'release-network', scopeKey: 'network:network-1' })), wrongNetwork,
  );
  assert.equal(wrongNetwork.statusCode, 403);
  assert.equal(wrongNetwork.body.error, 'network_scope_mismatch');
});

test('admin list returns only latest server ACKs from nested user documents', async () => {
  const data = seed();
  data[`users/user-1/template_acks/${deviceId}`] = {
    writer: 'server', uid: 'user-1', device_id: deviceId, network_id: 'user-1',
    applied_version_id: 'release-1', applied_version: '1.0.3', payload_hash_sha256: hash,
    scope_key: 'global', outcome: 'applied', parser_refreshed: true,
    inserted_count: 2, conflict_count: 0, app_version: '1.0.16', app_build: 16,
    applied_at: new Date('2026-10-23T06:59:00.000Z'), synced_at: new Date('2026-10-23T07:00:00.000Z'),
  };
  const db = createFakeFirestore(data);
  const handler = makeHandler({ db, admin: { ok: true, callerUid: 'admin-1' } });
  const res = createRes();
  await handler(post({ action: 'list' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.acks.length, 1);
  assert.equal(res.body.acks[0].verified, true);
  assert.equal(res.body.acks[0].uid, 'user-1');
  assert.equal(res.body.acks[0].installationId, deviceId);
  assert.equal(res.body.acks[0].releaseId, 'release-1');
});

test('admin device-acks queries the nested latest ACK collection and maps it', async () => {
  const data = seed();
  data[`users/user-1/template_acks/${deviceId}`] = {
    writer: 'server', uid: 'user-1', device_id: deviceId, network_id: 'user-1',
    applied_version_id: 'release-1', applied_version: '1.0.3', payload_hash_sha256: hash,
    scope_key: 'global', outcome: 'applied', parser_refreshed: true,
    inserted_count: 2, conflict_count: 0, app_version: '1.0.16', app_build: 16,
    applied_at: new Date('2026-10-23T06:59:00.000Z'), synced_at: new Date('2026-10-23T07:00:00.000Z'),
  };
  const handler = makeHandler({
    db: createFakeFirestore(data),
    admin: { ok: true, callerUid: 'admin-1' },
  });
  const res = createRes();
  await handler(post({ action: 'device-acks', releaseId: 'release-1' }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.acks.length, 1);
  assert.equal(res.body.acks[0].verified, true);
  assert.equal(res.body.acks[0].uid, 'user-1');
  assert.equal(res.body.acks[0].installationId, deviceId);
  assert.equal(res.body.acks[0].releaseId, 'release-1');
  assert.equal(res.body.acks[0].outcome, 'applied');
});

test('admin actions still require an authenticated admin', async () => {
  const handler = makeHandler();
  const res = createRes();
  await handler(post({ action: 'list' }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'not_admin');
});

test('read-active needs a user token; non-POST and unknown actions are rejected', async () => {
  const unauthenticated = makeHandler({ user: { ok: false, status: 401, error: 'invalid_token' } });
  const readRes = createRes();
  await unauthenticated(post({ action: 'read-active', appVersion: '1.0.0', appBuild: 1 }), readRes);
  assert.equal(readRes.statusCode, 401);

  const handler = makeHandler({ admin: { ok: true, callerUid: 'admin-1' } });
  const getRes = createRes();
  await handler({ method: 'GET', headers: {}, body: {} }, getRes);
  assert.equal(getRes.statusCode, 405);
  const unknownRes = createRes();
  await handler(post({ action: 'delete-everything' }), unknownRes);
  assert.equal(unknownRes.statusCode, 400);
  assert.equal(unknownRes.body.error, 'unknown_action');
});

test('template catalog still returns to an authenticated admin', async () => {
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
