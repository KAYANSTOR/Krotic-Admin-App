import test from 'node:test';
import assert from 'node:assert/strict';
import { handleNetworkSecret } from '../server/_lib/networkSecretApi.js';
import { encryptNetworkSecret, generateNetworkSecret } from '../server/_lib/networkSecret.js';
import { networkSecretCandidates } from '../server/_lib/networkSecretStore.js';
import { createFakeFirestore, createRes } from './helpers/fakeFirestore.js';

const master = 'network-secret-api-test-master-key-32-bytes-0123456789';
const NOW = Date.parse('2026-10-27T10:00:00.000Z');
const networkSecret = generateNetworkSecret();

function seed() {
  return {
    'users/user-1': { uid: 'user-1', networkId: 'NET-10001', accessStatus: 'TRIAL' },
    'networks/NET-10001': {
      networkId: 'NET-10001',
      owner_uid: 'user-1',
      networkSecretEncrypted: encryptNetworkSecret(networkSecret, master),
      networkSecretVersion: 2,
    },
  };
}

function dependencies(db, { admin = null, userToken = 'user-token' } = {}) {
  return {
    ensureFirebaseAdmin: () => ({ ok: true }),
    getFirestore: () => db,
    getAuth: () => ({
      verifyIdToken: async (token) => {
        if (token === userToken) return { uid: 'user-1' };
        throw new Error('invalid token');
      },
    }),
    authenticateAdmin: async () => admin || { ok: false, status: 403, error: 'not_admin' },
    now: NOW,
  };
}

function post(body, token = 'user-token') {
  return {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
  };
}

test('returns the current key only to the authenticated network owner', async () => {
  const previous = process.env.KROTAK_HMAC_SECRET;
  process.env.KROTAK_HMAC_SECRET = master;
  try {
    const db = createFakeFirestore(seed());
    const res = createRes();
    await handleNetworkSecret(post({}), res, dependencies(db));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.networkSecret, networkSecret);
    assert.equal(res.body.networkSecretVersion, 2);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(JSON.stringify(res.body).includes('previousNetworkSecretEncrypted'), false);

    const anonymous = createRes();
    await handleNetworkSecret(post({}, ''), anonymous, dependencies(db));
    assert.equal(anonymous.statusCode, 401);

    const admin = createRes();
    const adminDb = createFakeFirestore({ ...seed(), 'Admins/user-1': { uid: 'user-1' } });
    await handleNetworkSecret(post({}), admin, dependencies(adminDb));
    assert.equal(admin.statusCode, 403);
    assert.equal(admin.body.error, 'not_client_account');
  } finally {
    if (previous === undefined) delete process.env.KROTAK_HMAC_SECRET;
    else process.env.KROTAK_HMAC_SECRET = previous;
  }
});

test('fails closed instead of returning a silent replacement key when decryption fails', async () => {
  const previous = process.env.KROTAK_HMAC_SECRET;
  process.env.KROTAK_HMAC_SECRET = master;
  try {
    const db = createFakeFirestore({
      ...seed(),
      'networks/NET-10001': {
        networkId: 'NET-10001',
        owner_uid: 'user-1',
        networkSecretEncrypted: encryptNetworkSecret(
          networkSecret,
          'old-master-key-that-is-at-least-32-bytes-0123456789',
        ),
        networkSecretVersion: 2,
      },
    });
    const res = createRes();
    await handleNetworkSecret(post({}), res, dependencies(db));
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, 'network_secret_unavailable');
    assert.equal(Object.prototype.hasOwnProperty.call(res.body, 'networkSecret'), false);
    assert.equal(db._store.get('networks/NET-10001').networkSecretVersion, 2);
  } finally {
    if (previous === undefined) delete process.env.KROTAK_HMAC_SECRET;
    else process.env.KROTAK_HMAC_SECRET = previous;
  }
});

test('admin rotation keeps the old key only for the grace period and audits the change', async () => {
  const previous = process.env.KROTAK_HMAC_SECRET;
  process.env.KROTAK_HMAC_SECRET = master;
  try {
    const db = createFakeFirestore(seed());
    const res = createRes();
    await handleNetworkSecret(
      post({ action: 'rotate', uid: 'user-1', reason: 'scheduled rotation' }),
      res,
      dependencies(db, { admin: { ok: true, callerUid: 'admin-1' } }),
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.rotated, true);
    assert.equal(res.body.networkSecretVersion, 3);
    assert.equal(res.body.previousNetworkSecretVersion, 2);
    assert.equal(res.body.previousNetworkSecretValidUntilMs, NOW + 24 * 60 * 60 * 1000);
    assert.equal(Object.prototype.hasOwnProperty.call(res.body, 'networkSecret'), false);

    const network = db._store.get('networks/NET-10001');
    assert.equal(network.previousNetworkSecretVersion, 2);
    assert.equal(network.networkSecretRotatedBy, 'admin-1');
    const candidates = networkSecretCandidates(network, { now: NOW + 1_000 });
    assert.deepEqual(candidates.map((entry) => entry.version), [3, 2]);
    assert.equal(candidates[1].secret, networkSecret);

    const audit = [...db._store.entries()].find(([path]) => path.startsWith('admin_audit_logs/'))?.[1];
    assert.ok(audit);
    assert.equal(audit.action, 'NETWORK_SECRET_ROTATE');
    assert.equal(audit.actorUid, 'admin-1');
    assert.equal(audit.details.previousVersion, 2);
    assert.equal(audit.details.version, 3);
  } finally {
    if (previous === undefined) delete process.env.KROTAK_HMAC_SECRET;
    else process.env.KROTAK_HMAC_SECRET = previous;
  }
});

test('rotation is rejected for non-admins and never returns the secret', async () => {
  const db = createFakeFirestore(seed());
  const res = createRes();
  await handleNetworkSecret(
    post({ action: 'rotate', uid: 'user-1' }),
    res,
    dependencies(db),
  );
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'not_admin');
  assert.equal(db._store.get('networks/NET-10001').networkSecretVersion, 2);
  assert.equal([...db._store.keys()].some((path) => path.startsWith('admin_audit_logs/')), false);
});

test('rejects unknown actions and missing network targets', async () => {
  const db = createFakeFirestore(seed());
  const unknown = createRes();
  await handleNetworkSecret(post({ action: 'delete' }), unknown, dependencies(db));
  assert.equal(unknown.statusCode, 400);
  assert.equal(unknown.body.error, 'action_invalid');

  const missing = createRes();
  await handleNetworkSecret(
    post({ action: 'rotate' }),
    missing,
    dependencies(db, { admin: { ok: true, callerUid: 'admin-1' } }),
  );
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.body.error, 'uid_or_network_id_required');
});
