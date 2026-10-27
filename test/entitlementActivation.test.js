import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import activateEntitlement from '../server/_lib/entitlementActivation.js';
import rebindEntitlementDevice from '../server/_lib/entitlementDeviceRebind.js';

const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const NOW = Date.parse('2026-10-20T12:00:00.000Z');

function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

function makeDb(user) {
  const docs = new Map();
  if (user !== undefined) docs.set('users/user-1', structuredClone(user));
  const writes = [];
  let autoId = 0;
  const ref = (collection, id) => ({ collection, id, key: `${collection}/${id}` });
  const db = {
    collection(name) {
      return { doc(id) { return ref(name, id ?? `auto-${++autoId}`); } };
    },
    async runTransaction(callback) {
      const transaction = {
        async get(documentRef) {
          const value = docs.get(documentRef.key);
          return { exists: value !== undefined, data: () => value };
        },
        set(documentRef, data, options = {}) {
          writes.push({ ref: documentRef, data, options });
          const previous = docs.get(documentRef.key);
          docs.set(documentRef.key, options.merge
            ? { ...(previous || {}), ...data }
            : data);
        },
      };
      return callback(transaction);
    },
  };
  return { db, docs, writes };
}

function request(body, { method = 'POST', token = 'valid-token' } = {}) {
  return {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
    query: {},
  };
}

function baseUser(overrides = {}) {
  return {
    uid: 'user-1',
    accessStatus: 'TRIAL',
    trialStartedAt: new Date(NOW - 24 * 60 * 60 * 1000),
    subscriptionEndsAt: new Date(NOW + 20 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

function activationDependencies(db, overrides = {}) {
  return {
    ensureFirebaseAdmin: () => ({ ok: true }),
    auth: { verifyIdToken: async () => ({ uid: 'user-1' }) },
    db,
    privateKey,
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    now: NOW,
    ...overrides,
  };
}

test('رفض طرق HTTP غير POST', async () => {
  const res = makeResponse();
  await activateEntitlement(request({}, { method: 'GET' }), res, {});
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'POST');
});

test('يتطلب Firebase ID token صالحاً وهوية مطابقة', async () => {
  const { db } = makeDb(baseUser());
  const missing = makeResponse();
  await activateEntitlement(
    request({ userId: 'user-1', deviceId: 'install-a' }, { token: '' }),
    missing,
    activationDependencies(db),
  );
  assert.equal(missing.statusCode, 401);

  const invalid = makeResponse();
  await activateEntitlement(
    request({ userId: 'user-1', deviceId: 'install-a' }),
    invalid,
    activationDependencies(db, { auth: { verifyIdToken: async () => { throw new Error('bad token'); } } }),
  );
  assert.equal(invalid.statusCode, 401);

  const mismatch = makeResponse();
  await activateEntitlement(
    request({ userId: 'other-user', deviceId: 'install-a' }),
    mismatch,
    activationDependencies(db),
  );
  assert.equal(mismatch.statusCode, 403);
  assert.equal(mismatch.body.error, 'user_identity_mismatch');
});

test('يرفض الحالات غير المؤهلة والتاريخ المنتهي', async () => {
  for (const user of [
    baseUser({ accessStatus: 'SUSPENDED_GRACE' }),
    baseUser({ accessStatus: 'UNKNOWN' }),
    baseUser({ accessStatus: undefined }),
    baseUser({ subscriptionEndsAt: new Date(NOW - 1) }),
    baseUser({ subscriptionEndsAt: null, subscription_end_date: null }),
  ]) {
    const { db } = makeDb(user);
    const res = makeResponse();
    await activateEntitlement(
      request({ userId: 'user-1', deviceId: 'install-a' }),
      res,
      activationDependencies(db),
    );
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'account_not_eligible');
  }
});

test('يربط أول تثبيت ويصدر حمولة Lease صالحة بتوقيع Ed25519', async () => {
  const { db, docs, writes } = makeDb(baseUser());
  const res = makeResponse();
  const privateKeyEnv = privateKey.trimEnd().replace(/\n/g, '\\n');
  await activateEntitlement(
    request({ userId: 'user-1', deviceId: 'install-a' }),
    res,
    activationDependencies(db, { privateKey: privateKeyEnv }),
  );

  assert.equal(res.statusCode, 200);
  assert.equal(docs.get('users/user-1').entitlementInstallationId, 'install-a');
  assert.equal(docs.get('device_bindings/install-a').uid, 'user-1');
  assert.equal(writes.length, 2);
  assert.equal(res.body.payload.uid, 'user-1');
  assert.equal(res.body.payload.installationId, 'install-a');
  assert.equal(res.body.payload.userId, 'user-1');
  assert.equal(res.body.payload.deviceId, 'install-a');
  assert.equal(res.body.payload.keyId, 'ed25519-krotak-2026-10-v1');
  assert.equal(res.body.payload.version, 1);
  assert.equal(res.body.payload.trialEndsAt, new Date(NOW + 20 * 24 * 60 * 60 * 1000).toISOString());
  assert.equal(res.body.payload.commercialUntil, res.body.payload.trialEndsAt);
  assert.equal(res.body.payload.expiry, res.body.payload.commercialUntil);
  assert.equal(res.body.payload.maxOfflineUntil,
    new Date(NOW + 27 * 24 * 60 * 60 * 1000).toISOString());
  assert.equal(res.body.payload.serverTime, res.body.payload.issuedAt);
  assert.equal(res.body.payload.notBefore, res.body.payload.issuedAt);
  assert.deepEqual(res.body.payload.operations, ['sell', 'settle', 'sync', 'support', 'readOnly']);
  assert.equal(verify(
    null,
    Buffer.from(JSON.stringify(res.body.payload), 'utf8'),
    publicKey,
    Buffer.from(res.body.signature, 'base64'),
  ), true);
});

test('يشتق الهوية من التوكن عندما لا يرسل العميل userId', async () => {
  const { db } = makeDb(baseUser({ accessStatus: 'ACTIVE_PAID' }));
  const res = makeResponse();
  await activateEntitlement(
    request({ installationId: 'install-a', serverTime: '2000-01-01T00:00:00.000Z', now: 1 }),
    res,
    activationDependencies(db),
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.payload.uid, 'user-1');
  assert.equal(res.body.payload.trialEndsAt, undefined);
  assert.equal(res.body.payload.serverTime, new Date(NOW).toISOString());
  assert.equal(res.body.payload.issuedAt, new Date(NOW).toISOString());
  assert.equal(res.body.payload.commercialUntil,
    new Date(NOW + 20 * 24 * 60 * 60 * 1000).toISOString());

  // A modified payload no longer verifies against the issued signature.
  const tampered = { ...res.body.payload, commercialUntil: '2099-01-01T00:00:00.000Z' };
  assert.equal(verify(
    null,
    Buffer.from(JSON.stringify(tampered), 'utf8'),
    publicKey,
    Buffer.from(res.body.signature, 'base64'),
  ), false);

  const emptyUserId = makeResponse();
  await activateEntitlement(
    request({ userId: '', installationId: 'install-a' }),
    emptyUserId,
    activationDependencies(db),
  );
  assert.equal(emptyUserId.statusCode, 200);
  assert.equal(emptyUserId.body.payload.uid, 'user-1');
});

test('سياسة العمل دون اتصال لها سقف مستقل عن نهاية الاشتراك الطويلة', async () => {
  const longSubscription = baseUser({
    accessStatus: 'ACTIVE_PAID',
    subscriptionEndsAt: new Date(NOW + 120 * 24 * 60 * 60 * 1000),
  });
  const { db } = makeDb(longSubscription);
  const res = makeResponse();
  await activateEntitlement(
    request({ installationId: 'install-a' }),
    res,
    activationDependencies(db),
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.payload.commercialUntil,
    new Date(NOW + 120 * 24 * 60 * 60 * 1000).toISOString());
  assert.equal(res.body.payload.maxOfflineUntil,
    new Date(NOW + 30 * 24 * 60 * 60 * 1000).toISOString());
  assert.ok(Date.parse(res.body.payload.maxOfflineUntil) < Date.parse(res.body.payload.commercialUntil));
});

test('يرفض التثبيت المختلف بعد الربط ولا يغير الوثيقة', async () => {
  const { db, docs, writes } = makeDb(baseUser({ entitlementInstallationId: 'install-a' }));
  const res = makeResponse();
  await activateEntitlement(
    request({ userId: 'user-1', deviceId: 'install-b' }),
    res,
    activationDependencies(db),
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'installation_mismatch');
  assert.equal(docs.get('users/user-1').entitlementInstallationId, 'install-a');
  assert.equal(writes.length, 0);
});

test('يرفض تثبيتاً مرتبطاً بحساب آخر قبل كتابة أي شيء', async () => {
  const { db, docs, writes } = makeDb(baseUser());
  docs.set('device_bindings/install-a', { uid: 'other-user', installationId: 'install-a' });
  const res = makeResponse();
  await activateEntitlement(
    request({ installationId: 'install-a' }),
    res,
    activationDependencies(db),
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'installation_bound_to_another_account');
  assert.equal(docs.get('users/user-1').entitlementInstallationId, undefined);
  assert.equal(writes.length, 0);
});

test('يرفض طلب التوقيع إذا لم يكن مفتاح البيئة مهيأً', async () => {
  const { db, writes } = makeDb(baseUser());
  const res = makeResponse();
  await activateEntitlement(
    request({ userId: 'user-1', deviceId: 'install-a' }),
    res,
    activationDependencies(db, { privateKey: '' }),
  );
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'entitlement_signing_not_configured');
  assert.equal(writes.length, 0);
});

test('إعادة ربط التثبيت تتطلب مديراً وتُسجّل التدقيق', async () => {
  const { db, docs, writes } = makeDb(baseUser({ entitlementInstallationId: 'install-a' }));
  const denied = makeResponse();
  await rebindEntitlementDevice(
    request({ uid: 'user-1', installationId: 'install-b', reason: 'جهاز بديل' }),
    denied,
    {
      ensureFirebaseAdmin: () => ({ ok: true }),
      db,
      authenticateAdmin: async () => ({ ok: false, status: 403, error: 'not_admin' }),
    },
  );
  assert.equal(denied.statusCode, 403);
  assert.equal(docs.get('users/user-1').entitlementInstallationId, 'install-a');

  const allowed = makeResponse();
  await rebindEntitlementDevice(
    request({ uid: 'user-1', installationId: 'install-b', reason: 'جهاز بديل' }),
    allowed,
    {
      ensureFirebaseAdmin: () => ({ ok: true }),
      db,
      authenticateAdmin: async () => ({ ok: true, callerUid: 'admin-1' }),
      serverTimestamp: () => 'SERVER_TIMESTAMP',
      now: NOW,
    },
  );
  assert.equal(allowed.statusCode, 200);
  assert.equal(docs.get('users/user-1').entitlementInstallationId, 'install-b');
  assert.equal(docs.get('users/user-1').entitlementVersion, 2);
  assert.equal(docs.get('users/user-1').entitlementPreviousInstallationId, 'install-a');
  assert.equal(docs.get('users/user-1').entitlementLeaseRevokedAtMs, NOW);
  assert.equal(docs.get('device_bindings/install-b').uid, 'user-1');
  const audit = writes.find((write) => write.ref.collection === 'admin_audit_logs');
  assert.equal(audit.data.action, 'ENTITLEMENT_DEVICE_REBIND');
  assert.equal(audit.data.actorUid, 'admin-1');
  assert.equal(audit.data.targetId, 'user-1');
  assert.equal(audit.data.details.previousInstallationId, 'install-a');
  assert.equal(audit.data.details.installationId, 'install-b');
  assert.equal(audit.data.details.previousVersion, 1);
  assert.equal(audit.data.details.version, 2);
});

test('إعادة الربط لا تسرق جهازاً مرتبطاً بحساب آخر', async () => {
  const { db, docs, writes } = makeDb(baseUser({ entitlementInstallationId: 'install-a' }));
  docs.set('device_bindings/install-b', { uid: 'other-user', installationId: 'install-b' });
  const res = makeResponse();
  await rebindEntitlementDevice(
    request({ uid: 'user-1', installationId: 'install-b', reason: 'جهاز بديل' }),
    res,
    {
      ensureFirebaseAdmin: () => ({ ok: true }),
      db,
      authenticateAdmin: async () => ({ ok: true, callerUid: 'admin-1' }),
      serverTimestamp: () => 'SERVER_TIMESTAMP',
      now: NOW,
    },
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'installation_bound_to_another_account');
  assert.equal(docs.get('users/user-1').entitlementInstallationId, 'install-a');
  assert.equal(writes.length, 0);
});
