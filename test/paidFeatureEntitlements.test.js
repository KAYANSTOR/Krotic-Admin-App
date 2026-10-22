import test from 'node:test';
import assert from 'node:assert/strict';
import paidFeatureEntitlements, {
  validatePaidFeatureInput,
  normalizeStoredEntitlements,
  PAID_FEATURE_KEYS,
} from '../server/_lib/paidFeatureEntitlements.js';

const NOW = Date.parse('2026-10-21T12:00:00.000Z');

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
      return {
        doc(id) {
          const documentRef = ref(name, id ?? `auto-${++autoId}`);
          return {
            ...documentRef,
            async get() {
              const value = docs.get(documentRef.key);
              return { exists: value !== undefined, data: () => value };
            },
          };
        },
      };
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
          docs.set(documentRef.key, options.merge ? { ...(previous || {}), ...data } : data);
        },
      };
      return callback(transaction);
    },
  };
  return { db, docs, writes };
}

function request(body, { method = 'POST' } = {}) {
  return { method, headers: {}, body, query: {} };
}

function deps(db, overrides = {}) {
  return {
    ensureFirebaseAdmin: () => ({ ok: true }),
    authenticateAdmin: async () => ({ ok: true, callerUid: 'admin-1' }),
    db,
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    now: NOW,
    ...overrides,
  };
}

test('validatePaidFeatureInput يقبل المفاتيح المعتمدة فقط', () => {
  assert.deepEqual(
    validatePaidFeatureInput({ hotspot_template_editor: true }),
    { ok: true, value: { hotspot_template_editor: true } },
  );
  assert.equal(validatePaidFeatureInput({}).ok, false);
  assert.equal(validatePaidFeatureInput(null).ok, false);
  assert.equal(validatePaidFeatureInput({ nope: true }).error, 'unknown_feature:nope');
  assert.equal(validatePaidFeatureInput({ mikrotik_card_generator: 'yes' }).error,
    'mikrotik_card_generator_must_be_boolean');
});

test('normalizeStoredEntitlements يطبّع لمفاتيح معتمدة بقيم منطقية', () => {
  const result = normalizeStoredEntitlements({ hotspot_template_editor: 1, junk: true });
  assert.deepEqual(result, { hotspot_template_editor: false, mikrotik_card_generator: false });
  assert.deepEqual(Object.keys(result).sort(), [...PAID_FEATURE_KEYS].sort());
  assert.deepEqual(
    normalizeStoredEntitlements({ mikrotik_card_generator: true }),
    { hotspot_template_editor: false, mikrotik_card_generator: true },
  );
});

test('يرفض الطرق غير POST', async () => {
  const res = makeResponse();
  await paidFeatureEntitlements(request({}, { method: 'GET' }), res, {});
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'POST');
});

test('يرفض body غير صالح وإجراء غير معروف ومعرّف غير صالح', async () => {
  const { db } = makeDb({ uid: 'user-1' });
  const badJson = makeResponse();
  await paidFeatureEntitlements(request('{not json'), badJson, deps(db));
  assert.equal(badJson.statusCode, 400);
  assert.equal(badJson.body.error, 'invalid_json');

  const badAction = makeResponse();
  await paidFeatureEntitlements(request({ action: 'wipe', uid: 'user-1' }), badAction, deps(db));
  assert.equal(badAction.statusCode, 400);
  assert.equal(badAction.body.error, 'unknown_action');

  const badUid = makeResponse();
  await paidFeatureEntitlements(request({ action: 'get', uid: 'bad id!' }), badUid, deps(db));
  assert.equal(badUid.statusCode, 400);
  assert.equal(badUid.body.error, 'uid_invalid');
});

test('يرفض ميزة غير معروفة أو قيمة غير منطقية', async () => {
  const { db, writes } = makeDb({ uid: 'user-1' });
  const unknown = makeResponse();
  await paidFeatureEntitlements(
    request({ action: 'set', uid: 'user-1', entitlements: { nope: true } }),
    unknown,
    deps(db),
  );
  assert.equal(unknown.statusCode, 400);
  assert.equal(unknown.body.error, 'unknown_feature:nope');

  const nonBoolean = makeResponse();
  await paidFeatureEntitlements(
    request({ action: 'set', uid: 'user-1', entitlements: { hotspot_template_editor: 'on' } }),
    nonBoolean,
    deps(db),
  );
  assert.equal(nonBoolean.statusCode, 400);
  assert.equal(writes.length, 0);
});

test('يرفض غير المدير', async () => {
  const { db, writes } = makeDb({ uid: 'user-1' });
  const res = makeResponse();
  await paidFeatureEntitlements(
    request({ action: 'set', uid: 'user-1', entitlements: { hotspot_template_editor: true } }),
    res,
    deps(db, { authenticateAdmin: async () => ({ ok: false, status: 403, error: 'forbidden' }) }),
  );
  assert.equal(res.statusCode, 403);
  assert.equal(writes.length, 0);
});

test('يرجع 404 عند غياب الحساب', async () => {
  const { db } = makeDb();
  const getRes = makeResponse();
  await paidFeatureEntitlements(request({ action: 'get', uid: 'user-1' }), getRes, deps(db));
  assert.equal(getRes.statusCode, 404);
  assert.equal(getRes.body.error, 'account_not_found');

  const setRes = makeResponse();
  await paidFeatureEntitlements(
    request({ action: 'set', uid: 'user-1', entitlements: { hotspot_template_editor: true } }),
    setRes,
    deps(db),
  );
  assert.equal(setRes.statusCode, 404);
});

test('get يطبّع الخريطة المخزّنة للمفاتيح المعتمدة', async () => {
  const { db } = makeDb({ uid: 'user-1', feature_entitlements: { hotspot_template_editor: true, junk: true } });
  const res = makeResponse();
  await paidFeatureEntitlements(request({ action: 'get', uid: 'user-1' }), res, deps(db));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.entitlements, { hotspot_template_editor: true, mikrotik_card_generator: false });
});

test('set يدمج ويكتب سجل تدقيق مع معرّف المدير', async () => {
  const { db, docs, writes } = makeDb({ uid: 'user-1', feature_entitlements: { hotspot_template_editor: false } });
  const res = makeResponse();
  await paidFeatureEntitlements(
    request({ action: 'set', uid: 'user-1', entitlements: { mikrotik_card_generator: true } }),
    res,
    deps(db),
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.entitlements.hotspot_template_editor, false);
  assert.equal(res.body.entitlements.mikrotik_card_generator, true);

  const stored = docs.get('users/user-1');
  assert.equal(stored.feature_entitlements_updated_by, 'admin-1');
  assert.equal(stored.feature_entitlements_updated_at, 'SERVER_TIMESTAMP');

  const audit = writes.find((entry) => entry.ref.collection === 'admin_audit_logs');
  assert.ok(audit, 'يجب كتابة سجل تدقيق');
  assert.equal(audit.data.action, 'PAID_FEATURE_ENTITLEMENT_UPDATE');
  assert.equal(audit.data.actorUid, 'admin-1');
  assert.equal(audit.data.targetId, 'user-1');
  assert.deepEqual(audit.data.details.next, { mikrotik_card_generator: true });
});
