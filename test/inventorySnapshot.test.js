import test from 'node:test';
import assert from 'node:assert/strict';
import handler, {
  validateInventorySnapshot,
  decideInventoryOutcome,
} from '../api/inventory/snapshot.js';

const valid = {
  schemaVersion: 1,
  networkId: 'NET-10001',
  snapshotId: 'snap-2026-10-27-01',
  inventoryRevision: 12,
  generatedAt: '2026-10-27T05:00:00.000Z',
  totalAvailableCards: 40,
  totalReservedCards: 3,
  totalSoldCards: 100,
  totalInvalidCards: 1,
  breakdown: [
    {
      catalogId: 'cat-yer-100',
      denomination: 100,
      currency: 'YER',
      availableCount: 20,
      reservedCount: 1,
      soldCount: 50,
    },
  ],
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

function fakeDb({
  admin = false,
  legacyAdmin = false,
  user = { networkId: 'NET-10001' },
  network = { owner_uid: 'user-1' },
  storedSnapshot = undefined,
} = {}) {
  const stored = new Map();
  if (storedSnapshot !== undefined) {
    stored.set('networks/NET-10001/inventory_snapshot/current', { value: storedSnapshot, options: { merge: false } });
  }
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
    auth: {
      verifyIdToken: async (token) => {
        if (token !== 'valid-token') throw new Error('invalid');
        return claims;
      },
    },
    db,
    now: Date.parse('2026-10-27T05:30:00.000Z'),
  };
}

test('validates the inventory contract and normalizes the generated timestamp', () => {
  const result = validateInventorySnapshot(valid);
  assert.equal(result.ok, true);
  assert.equal(result.value.networkId, 'NET-10001');
  assert.equal(result.value.inventoryRevision, 12);
  assert.equal(result.value.generatedAt, '2026-10-27T05:00:00.000Z');
  assert.equal(result.value.generatedAtMs, Date.parse('2026-10-27T05:00:00.000Z'));
  assert.equal(result.value.breakdown.length, 1);
  assert.equal(result.value.breakdown[0].currency, 'YER');
});

test('accepts an epoch-millis generatedAt and uppercases the currency', () => {
  const result = validateInventorySnapshot({
    ...valid,
    generatedAt: 1792992600000,
    breakdown: [{ ...valid.breakdown[0], currency: 'yer' }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.generatedAtMs, 1792992600000);
  assert.equal(result.value.breakdown[0].currency, 'YER');
});

test('rejects negative or non-numeric counters', () => {
  assert.equal(validateInventorySnapshot({ ...valid, totalAvailableCards: -1 }).error, 'counter_invalid');
  assert.equal(validateInventorySnapshot({ ...valid, totalReservedCards: '3' }).error, 'counter_invalid');
  assert.equal(validateInventorySnapshot({ ...valid, totalSoldCards: 1.5 }).error, 'counter_invalid');
  assert.equal(validateInventorySnapshot({
    ...valid,
    breakdown: [{ ...valid.breakdown[0], availableCount: -5 }],
  }).error, 'counter_invalid');
});

test('rejects forbidden secret card fields anywhere in the payload', () => {
  for (const field of ['pin', 'password', 'cardNumber', 'secret', 'code', 'rawCard']) {
    const result = validateInventorySnapshot({ ...valid, [field]: 'should-not-be-here' });
    assert.equal(result.error, 'secret_field_forbidden', `${field} must be rejected`);
    assert.equal(result.field, field);
  }
  const nested = validateInventorySnapshot({
    ...valid,
    breakdown: [{ ...valid.breakdown[0], card_number: '1234' }],
  });
  assert.equal(nested.error, 'secret_field_forbidden');
  assert.equal(nested.field, 'card_number');
});

test('rejects unsupported schema, unknown fields and malformed identity fields', () => {
  assert.equal(validateInventorySnapshot({ ...valid, schemaVersion: 2 }).error, 'schema_version_unsupported');
  assert.equal(validateInventorySnapshot({ ...valid, extra: 1 }).error, 'unknown_field');
  assert.equal(validateInventorySnapshot({ ...valid, networkId: 'bad id!' }).error, 'network_id_invalid');
  assert.equal(validateInventorySnapshot({ ...valid, snapshotId: '' }).error, 'snapshot_id_invalid');
  assert.equal(validateInventorySnapshot({ ...valid, inventoryRevision: -1 }).error, 'revision_invalid');
  assert.equal(validateInventorySnapshot({ ...valid, generatedAt: 'not-a-date' }).error, 'generated_at_invalid');
  assert.equal(validateInventorySnapshot({ ...valid, breakdown: 'nope' }).error, 'breakdown_invalid');
  assert.equal(validateInventorySnapshot({ ...valid, breakdown: [{ ...valid.breakdown[0], currency: '' }] }).error, 'currency_invalid');
});

test('decideInventoryOutcome acknowledges the same snapshot id', () => {
  const existing = { snapshotId: 'snap-1', inventoryRevision: 7 };
  const same = decideInventoryOutcome(existing, { snapshotId: 'snap-1', inventoryRevision: 7 });
  assert.equal(same.status, 'already_acked');
  assert.equal(same.inventoryRevision, 7);
});

test('decideInventoryOutcome rejects a stale revision', () => {
  const existing = { snapshotId: 'snap-2', inventoryRevision: 9 };
  const stale = decideInventoryOutcome(existing, { snapshotId: 'snap-3', inventoryRevision: 8 });
  assert.equal(stale.status, 'stale');
  assert.equal(stale.currentRevision, 9);
});

test('decideInventoryOutcome accepts a newer revision and a first snapshot', () => {
  assert.equal(decideInventoryOutcome(null, { snapshotId: 'snap-1', inventoryRevision: 1 }).status, 'accepted');
  assert.equal(decideInventoryOutcome(
    { snapshotId: 'snap-2', inventoryRevision: 9 },
    { snapshotId: 'snap-3', inventoryRevision: 10 },
  ).status, 'accepted');
});

test('requires POST and a valid Firebase bearer token', async () => {
  const methodRes = responseMock();
  await handler({ method: 'GET', headers: {}, body: valid }, methodRes, dependencies(fakeDb().db));
  assert.equal(methodRes.statusCode, 405);
  assert.equal(methodRes.body.error, 'method_not_allowed');

  const tokenRes = responseMock();
  await handler({ method: 'POST', headers: {}, body: valid }, tokenRes, dependencies(fakeDb().db));
  assert.equal(tokenRes.statusCode, 401);
  assert.equal(tokenRes.body.error, 'missing_token');

  const invalidRes = responseMock();
  await handler({ method: 'POST', headers: { authorization: 'Bearer nope' }, body: valid }, invalidRes, dependencies(fakeDb().db));
  assert.equal(invalidRes.statusCode, 401);
  assert.equal(invalidRes.body.error, 'invalid_token');
});

test('rejects admin accounts and network identity mismatches', async () => {
  const adminRes = responseMock();
  await handler({ method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: valid },
    adminRes, dependencies(fakeDb({ admin: true }).db));
  assert.equal(adminRes.statusCode, 403);
  assert.equal(adminRes.body.error, 'not_client_account');

  const mismatchRes = responseMock();
  await handler({ method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: { ...valid, networkId: 'NET-OTHER' } },
    mismatchRes, dependencies(fakeDb().db));
  assert.equal(mismatchRes.statusCode, 403);
  assert.equal(mismatchRes.body.error, 'network_identity_mismatch');

  const ownerRes = responseMock();
  await handler({ method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: valid },
    ownerRes, dependencies(fakeDb({ network: { owner_uid: 'someone-else' } }).db));
  assert.equal(ownerRes.statusCode, 403);
  assert.equal(ownerRes.body.error, 'network_owner_mismatch');
});

test('stores a newer snapshot with a server timestamp and acknowledges it', async () => {
  const fake = fakeDb();
  const res = responseMock();
  await handler({ method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: valid },
    res, dependencies(fake.db));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.status, 'acked');
  assert.equal(res.body.snapshotId, 'snap-2026-10-27-01');
  assert.equal(res.body.inventoryRevision, 12);
  const stored = fake.stored.get('networks/NET-10001/inventory_snapshot/current');
  assert.equal(stored.value.totalAvailableCards, 40);
  assert.equal(stored.value.serverReceivedAtMs, Date.parse('2026-10-27T05:30:00.000Z'));
  assert.ok(stored.value.updatedAt, 'the write must carry a serverTimestamp');
});

test('re-acknowledges the same snapshot id without writing again', async () => {
  const fake = fakeDb({ storedSnapshot: { snapshotId: valid.snapshotId, inventoryRevision: 12, totalAvailableCards: 40 } });
  const res = responseMock();
  await handler({ method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: valid },
    res, dependencies(fake.db));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'already_acked');
  assert.equal(res.body.inventoryRevision, 12);
});

test('rejects an older revision with 409 STALE_REVISION and the current revision', async () => {
  const fake = fakeDb({ storedSnapshot: { snapshotId: 'snap-older', inventoryRevision: 20 } });
  const res = responseMock();
  await handler({ method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: { ...valid, inventoryRevision: 19 } },
    res, dependencies(fake.db));
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'STALE_REVISION');
  assert.equal(res.body.currentRevision, 20);
});

test('rejects the payload with a 400 before touching Firestore', async () => {
  const res = responseMock();
  await handler({ method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: { ...valid, totalAvailableCards: -3 } },
    res, dependencies(fakeDb().db));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'counter_invalid');
});
