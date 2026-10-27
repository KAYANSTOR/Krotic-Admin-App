import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { validateHeartbeat } from '../api/device-heartbeat.js';

const valid = {
  schemaVersion: 1,
  installationId: 'install-12345678',
  accountId: 'user-1',
  networkId: 'NET-10001',
  lastSeenAt: '2026-10-26T05:00:00.000Z',
  lastSyncAt: null,
  pendingCount: 2,
  oldestPendingAt: '2026-10-26T04:00:00.000Z',
  unknownDeliveryCount: 1,
  lastError: null,
  appVersion: '1.2.3',
  releaseId: 'release-42',
  riskSignals: ['debugger_detected'],
};

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

function fakeDb({ admin = false, legacyAdmin = false, user = { networkId: 'NET-10001' }, network = { owner_uid: 'user-1' } } = {}) {
  const stored = new Map();
  const snapshot = (value) => ({ exists: value !== undefined && value !== null, data: () => value });
  const collection = (name) => ({
    doc: (id) => {
      const path = `${name}/${id}`;
      return {
        path,
        get: async () => {
          if (name === 'Admins') return snapshot(admin ? { uid: id } : undefined);
          if (name === 'admins') return snapshot(legacyAdmin ? { uid: id } : undefined);
          if (name === 'users') return snapshot(user);
          if (name === 'networks') return snapshot(network);
          return snapshot(undefined);
        },
        set: async (value, options) => stored.set(path, { value, options }),
        collection: (child) => ({
          doc: (childId) => {
            const childPath = `${path}/${child}/${childId}`;
            return {
              path: childPath,
              get: async () => snapshot(stored.get(childPath)?.value),
              set: async (value, options) => stored.set(childPath, { value, options }),
            };
          },
        }),
      };
    },
  });
  const db = {
    collection,
    runTransaction: async (callback) => {
      const transaction = {
        get: async (ref) => ref.get(),
        set: (ref, value, options) => {
          stored.set(ref.path, { value, options });
          return transaction;
        },
      };
      return callback(transaction);
    },
  };
  return { db, stored };
}
function dependencies(db, claims = { uid: 'user-1' }) {
  return {
    ensureFirebaseAdmin: () => ({ ok: true }),
    auth: { verifyIdToken: async (token) => {
      if (token !== 'valid-token') throw new Error('invalid');
      return claims;
    } },
    db,
    now: Date.parse('2026-10-26T05:30:00.000Z'),
  };
}

test('validates heartbeat contract and normalizes optional timestamps', () => {
  const result = validateHeartbeat(valid);
  assert.equal(result.ok, true);
  assert.equal(result.value.schemaVersion, 1);
  assert.equal(result.value.lastSyncAt, null);
  assert.equal(result.value.oldestPendingAt, '2026-10-26T04:00:00.000Z');
});

test('rejects unsupported schema, negative counters, malformed timestamps and oversized signals', () => {
  assert.equal(validateHeartbeat({ ...valid, schemaVersion: 2 }).error, 'schema_version_unsupported');
  assert.equal(validateHeartbeat({ ...valid, pendingCount: -1 }).error, 'counter_invalid');
  assert.equal(validateHeartbeat({ ...valid, lastSyncAt: 'not-a-date' }).error, 'last_sync_at_invalid');
  assert.equal(validateHeartbeat({ ...valid, lastSeenAt: 'not-a-date' }).error, 'last_seen_at_invalid');
  assert.equal(validateHeartbeat({ ...valid, lastSeenAt: null }).error, 'last_seen_at_invalid');
  assert.equal(validateHeartbeat({ ...valid, riskSignals: Array(33).fill('x') }).error, 'risk_signals_invalid');
});

test('requires POST and a valid Firebase bearer token', async () => {
  const db = fakeDb().db;
  const getDependencies = dependencies(db);
  const methodRes = responseMock();
  await handler({ method: 'GET', headers: {}, body: valid }, methodRes, getDependencies);
  assert.equal(methodRes.statusCode, 405);

  const tokenRes = responseMock();
  await handler({ method: 'POST', headers: {}, body: valid }, tokenRes, getDependencies);
  assert.equal(tokenRes.statusCode, 401);
  assert.equal(tokenRes.body.error, 'missing_token');
});

test('rejects identity mismatch and admin accounts', async () => {
  const identityRes = responseMock();
  await handler({ method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: { ...valid, accountId: 'other-user' } },
    identityRes, dependencies(fakeDb().db));
  assert.equal(identityRes.statusCode, 403);
  assert.equal(identityRes.body.error, 'account_identity_mismatch');

  const adminRes = responseMock();
  await handler({ method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: valid },
    adminRes, dependencies(fakeDb({ admin: true }).db));
  assert.equal(adminRes.statusCode, 403);
  assert.equal(adminRes.body.error, 'not_client_account');

  const legacyAdminRes = responseMock();
  await handler({ method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: valid },
    legacyAdminRes, dependencies(fakeDb({ legacyAdmin: true }).db));
  assert.equal(legacyAdminRes.statusCode, 403);
  assert.equal(legacyAdminRes.body.error, 'not_client_account');
});

test('rejects a network ID not bound to the authenticated account', async () => {
  const res = responseMock();
  await handler({ method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: { ...valid, networkId: 'NET-OTHER' } },
    res, dependencies(fakeDb().db));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'network_identity_mismatch');
});

test('throttles repeated heartbeat writes using the server timestamp', async () => {
  const fixture = fakeDb();
  const previousAt = Date.parse('2026-10-26T05:29:00.000Z');
  fixture.stored.set('networks/NET-10001/device_heartbeats/install-12345678', {
    value: { serverReceivedAtMs: previousAt, serverReceivedAt: new Date(previousAt).toISOString() },
    options: { merge: true },
  });
  const res = responseMock();
  await handler(
    { method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: valid },
    res,
    dependencies(fixture.db),
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.throttled, true);
  assert.equal(fixture.stored.get('networks/NET-10001/device_heartbeats/install-12345678').value.serverReceivedAtMs, previousAt);
});

test('stores heartbeat with server receipt time and acknowledges it', async () => {
  const fake = fakeDb();
  const res = responseMock();
  await handler({ method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: valid },
    res, dependencies(fake.db));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.receivedAt, '2026-10-26T05:30:00.000Z');
  const stored = fake.stored.get('networks/NET-10001/device_heartbeats/install-12345678');
  assert.equal(stored.value.serverReceivedAtMs, Date.parse('2026-10-26T05:30:00.000Z'));
  assert.equal(stored.value.accountId, 'user-1');
  assert.equal(stored.value.pendingCount, 2);
});

test('rejects a device that is not the account-bound installation or a suspended account', async () => {
  const mismatch = responseMock();
  await handler(
    { method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: valid },
    mismatch,
    dependencies(fakeDb({
      user: { networkId: 'NET-10001', entitlementInstallationId: 'install-other' },
    }).db),
  );
  assert.equal(mismatch.statusCode, 403);
  assert.equal(mismatch.body.error, 'installation_mismatch');

  const suspended = responseMock();
  await handler(
    { method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: valid },
    suspended,
    dependencies(fakeDb({
      user: { networkId: 'NET-10001', accessStatus: 'SUSPENDED_GRACE' },
    }).db),
  );
  assert.equal(suspended.statusCode, 403);
  assert.equal(suspended.body.error, 'account_suspended');
});

test('stores the server-bound installation flag without granting anything', async () => {
  const fake = fakeDb({
    user: { networkId: 'NET-10001', entitlementInstallationId: 'install-12345678' },
  });
  const res = responseMock();
  await handler(
    { method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: valid },
    res,
    dependencies(fake.db),
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.schemaVersion, 1);
  const stored = fake.stored.get('networks/NET-10001/device_heartbeats/install-12345678');
  assert.equal(stored.value.installationBound, true);
  assert.equal(stored.value.serverReceivedAtMs, Date.parse('2026-10-26T05:30:00.000Z'));
});
