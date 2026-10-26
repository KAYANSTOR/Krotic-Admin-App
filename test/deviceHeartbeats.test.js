import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/device-heartbeats.js';

function responseMock() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function queryDb({ docs = [], error = null } = {}) {
  const calls = { collectionGroup: null, orderBy: null, limit: null };
  const query = {
    orderBy(field, direction) { calls.orderBy = [field, direction]; return this; },
    limit(value) { calls.limit = value; return this; },
    async get() {
      if (error) throw error;
      return { docs };
    },
  };
  return { calls, db: { collectionGroup(name) { calls.collectionGroup = name; return query; } } };
}

function dependencies(db, { admin = true } = {}) {
  return {
    ensureFirebaseAdmin: () => ({ ok: true }),
    auth: {
      verifyIdToken: async (token) => {
        if (token !== 'valid-token') throw new Error('invalid');
        return { uid: 'admin-1' };
      },
    },
    isAdminUid: async (uid, getDb) => uid === 'admin-1' && getDb() === db && admin,
    db,
  };
}

function deviceDoc() {
  return {
    id: 'install-1',
    ref: { parent: { parent: { id: 'NET-10001' } } },
    data: () => ({
      installationId: 'install-1',
      accountId: 'user-1',
      networkId: 'client-supplied-value',
      schemaVersion: 1,
      appVersion: '1.0.15',
      releaseId: '15',
      serverReceivedAt: '2026-10-26T05:30:00.000Z',
      serverReceivedAtMs: 1792992600000,
      pendingCount: 3,
      unknownDeliveryCount: 1,
      lastError: 'network_timeout',
      riskSignals: ['app_compromised'],
      hiddenSecret: 'must-not-be-returned',
    }),
  };
}

test('requires GET and an authenticated admin account', async () => {
  const { db } = queryDb();
  const methodRes = responseMock();
  await handler({ method: 'POST', headers: {}, url: '/api/device-heartbeats' }, methodRes, dependencies(db));
  assert.equal(methodRes.statusCode, 405);
  assert.equal(methodRes.headers.Allow, 'GET');

  const tokenRes = responseMock();
  await handler({ method: 'GET', headers: {}, url: '/api/device-heartbeats' }, tokenRes, dependencies(db));
  assert.equal(tokenRes.statusCode, 401);

  const adminRes = responseMock();
  await handler(
    { method: 'GET', headers: { authorization: 'Bearer valid-token' }, url: '/api/device-heartbeats' },
    adminRes,
    dependencies(db, { admin: false }),
  );
  assert.equal(adminRes.statusCode, 403);
  assert.equal(adminRes.body.error, 'not_admin');
});

test('orders by server timestamp, clamps the limit, and returns projected fields only', async () => {
  const { db, calls } = queryDb({ docs: [deviceDoc()] });
  const res = responseMock();
  await handler(
    { method: 'GET', headers: { authorization: 'Bearer valid-token' }, url: '/api/device-heartbeats?limit=999' },
    res,
    dependencies(db),
  );
  assert.equal(res.statusCode, 200);
  assert.equal(calls.collectionGroup, 'device_heartbeats');
  assert.deepEqual(calls.orderBy, ['serverReceivedAtMs', 'desc']);
  assert.equal(calls.limit, 200);
  assert.equal(res.body.devices.length, 1);
  assert.equal(res.body.devices[0].networkId, 'NET-10001');
  assert.equal(res.body.devices[0].pendingCount, 3);
  assert.equal(res.body.devices[0].unknownDeliveryCount, 1);
  assert.equal('hiddenSecret' in res.body.devices[0], false);
});

test('clamps small limits and maps Firestore quota errors to a safe response', async () => {
  const { db, calls } = queryDb({ error: Object.assign(new Error('RESOURCE_EXHAUSTED'), { code: 8 }) });
  const res = responseMock();
  await handler(
    { method: 'GET', headers: { authorization: 'Bearer valid-token' }, url: '/api/device-heartbeats?limit=-20' },
    res,
    dependencies(db),
  );
  assert.equal(calls.limit, 1);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'firestore_quota_exceeded');
  assert.equal('message' in res.body, false);
});
