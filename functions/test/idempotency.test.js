const test = require('node:test');
const assert = require('node:assert/strict');

const { __test } = require('../index');

const serverTimestamp = () => 'SERVER_TIMESTAMP';
const fieldValue = { serverTimestamp };

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

class FakeSnapshot {
  constructor(ref, value) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = value !== undefined;
    this._value = clone(value);
  }

  data() {
    return clone(this._value);
  }
}

class FakeRef {
  constructor(store, path) {
    this.store = store;
    this.path = path;
    this.id = path.split('/').pop();
  }

  collection(name) {
    return new FakeCollection(this.store, `${this.path}/${name}`);
  }
}

class FakeCollection {
  constructor(store, path) {
    this.store = store;
    this.path = path;
  }

  doc(id) {
    return new FakeRef(this.store, `${this.path}/${id}`);
  }
}

class FakeTransaction {
  constructor(store) {
    this.store = store;
    this.operations = [];
  }

  async get(ref) {
    return new FakeSnapshot(ref, this.store.values.get(ref.path));
  }

  set(ref, value, options = {}) {
    this.operations.push({ type: 'set', ref, value: clone(value), options });
  }

  update(ref, value) {
    this.operations.push({ type: 'update', ref, value: clone(value) });
  }

  commit() {
    for (const operation of this.operations) {
      const oldValue = this.store.values.get(operation.ref.path) || {};
      if (operation.type === 'update') {
        this.store.values.set(operation.ref.path, { ...clone(oldValue), ...clone(operation.value) });
      } else if (operation.options.merge) {
        this.store.values.set(operation.ref.path, { ...clone(oldValue), ...clone(operation.value) });
      } else {
        this.store.values.set(operation.ref.path, clone(operation.value));
      }
    }
  }
}

class FakeFirestore {
  constructor() {
    this.values = new Map();
    this.tail = Promise.resolve();
  }

  collection(name) {
    return new FakeCollection(this, name);
  }

  runTransaction(work) {
    const run = this.tail.then(async () => {
      const transaction = new FakeTransaction(this);
      const result = await work(transaction);
      transaction.commit();
      return result;
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  read(path) {
    return clone(this.values.get(path));
  }
}

function sale(faceValue, createdAt = '2026-01-10T00:00:00.000Z') {
  return { status: 'COMPLETED', faceValue, createdAt };
}

function saleUpdater(value) {
  return (summary) => __test.applySaleDelta(summary, null, value);
}

test('legacy completed sale contributions normalize status and amount aliases', () => {
  assert.deepEqual(__test.saleContribution({
    amount: 250,
    commissionRiyal: 12,
    createdAt: '2026-01-10T00:00:00.000Z',
  }), { face: 250, count: 1, commission: 12, month: '2026-01' });

  assert.deepEqual(__test.saleContribution({
    amountMinor: 12500,
    moneyPolicyVersion: 2,
    commissionRiyal: 6,
    createdAt: '2026-01-10T00:00:00.000Z',
  }), { face: 125, count: 1, commission: 6, month: '2026-01' });

  assert.deepEqual(__test.saleContribution({
    status: 'SMS_PENDING', faceValue: 500, createdAt: '2026-01-10T00:00:00.000Z',
  }), { face: 0, count: 0, commission: 0, month: null });
});

test('the same sale event is applied once even when delivered twice', async () => {
  const firestore = new FakeFirestore();
  const args = {
    firestore,
    fieldValue,
    uid: 'user-1',
    eventType: 'sale',
    eventId: 'sale-event-1',
    updater: saleUpdater(sale(100)),
    now: 1_800_000_000_123,
  };

  assert.equal(await __test.updateAggregateForEvent(args), true);
  assert.equal(await __test.updateAggregateForEvent(args), false);
  assert.deepEqual(firestore.read('admin_aggregates/user-1'), {
    totalFaceValue: 100,
    totalTransactions: 1,
    totalCommissionDue: 0,
    totalPaid: 0,
    monthly: { '2026-01': { face: 100, count: 1 } },
    updatedAt: 'SERVER_TIMESTAMP',
    updatedAtMs: 1_800_000_000_123,
  });
});

test('different sale event ids both apply their deltas', async () => {
  const firestore = new FakeFirestore();
  const common = { firestore, fieldValue, uid: 'user-1', eventType: 'sale' };
  assert.equal(await __test.updateAggregateForEvent({ ...common, eventId: 'sale-event-1', updater: saleUpdater(sale(100)) }), true);
  assert.equal(await __test.updateAggregateForEvent({ ...common, eventId: 'sale-event-2', updater: saleUpdater(sale(50, '2026-02-10T00:00:00.000Z')) }), true);
  const aggregate = firestore.read('admin_aggregates/user-1');
  assert.equal(aggregate.totalFaceValue, 150);
  assert.equal(Object.hasOwn(aggregate, 'totalAdminEarnings'), false);
  assert.equal(aggregate.totalTransactions, 2);
  assert.equal(aggregate.monthly['2026-01'].count, 1);
  assert.equal(aggregate.monthly['2026-02'].count, 1);
});

test('aggregate sums server commission snapshots without inventing one', () => {
  const noCommission = __test.applySaleDelta({}, null, sale(100));
  assert.equal(noCommission.totalFaceValue, 100);
  assert.equal(noCommission.totalTransactions, 1);
  assert.equal(noCommission.totalCommissionDue, 0);
  assert.deepEqual(noCommission.monthly['2026-01'], { face: 100, count: 1 });
  assert.equal(Object.hasOwn(noCommission, 'totalAdminEarnings'), false);

  const withCommission = __test.applySaleDelta({}, null, { ...sale(100), commissionMinor: 5 });
  assert.equal(withCommission.totalCommissionDue, 5);
  const v2Commission = __test.applySaleDelta({}, null, {
    ...sale(100), moneyPolicyVersion: 2, commissionMinor: 2500, commissionRiyal: 25,
  });
  assert.equal(v2Commission.totalCommissionDue, 25);
});

test('unchanged sale contribution is recognized before any aggregate transaction', () => {
  assert.equal(
    __test.hasSameSaleAggregateContribution(
      sale(100, '2026-01-10T00:00:00.000Z'),
      sale(100, '2026-01-31T23:59:59.000Z'),
    ),
    true,
  );
  assert.equal(
    __test.hasSameSaleAggregateContribution(
      sale(100, '2026-01-10T00:00:00.000Z'),
      sale(101, '2026-01-10T00:00:00.000Z'),
    ),
    false,
  );
  assert.equal(
    __test.hasSameSaleAggregateContribution(
      sale(100, '2026-01-10T00:00:00.000Z'),
      sale(100, '2026-02-01T00:00:00.000Z'),
    ),
    false,
  );
  assert.equal(__test.hasSameSaleAggregateContribution(null, sale(100)), false);
  assert.equal(__test.hasSameSaleAggregateContribution(null, { ...sale(100), status: 'PENDING' }), true);
});

test('FCM sends every target in batches of at most 500 and maps invalid tokens to actual device ids', async () => {
  const tokens = Array.from({ length: 501 }, (_, index) => `token-${index}`);
  const tokenDocIds = new Map(tokens.map((token, index) => [token, [`device-doc-${index}`]]));
  tokenDocIds.set('token-500', ['actual-device-document', 'duplicate-token-document']);
  const batchSizes = [];
  let accepted = false;

  const result = await __test.sendTokensInBatches({
    tokens,
    tokenDocIds,
    message: { notification: { title: 'Title', body: 'Body' } },
    sendEachForMulticast: async ({ tokens: batch }) => {
      batchSizes.push(batch.length);
      return {
        successCount: batch.length - (batch.includes('token-500') ? 1 : 0),
        failureCount: batch.includes('token-500') ? 1 : 0,
        responses: batch.map((token) => token === 'token-500'
          ? { success: false, error: { code: 'messaging/registration-token-not-registered' } }
          : { success: true }),
      };
    },
    onAccepted: () => { accepted = true; },
  });

  assert.deepEqual(batchSizes, [500, 1]);
  assert.equal(accepted, true);
  assert.equal(result.sent, 500);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.invalidDeviceDocIds.sort(), ['actual-device-document', 'duplicate-token-document']);
});

test('FCM retries only transiently failed tokens and does not resend accepted tokens', async () => {
  const calls = [];
  const result = await __test.sendTokensInBatches({
    tokens: ['accepted-token', 'temporary-token'],
    tokenDocIds: new Map(),
    message: {},
    sleep: async () => {},
    sendEachForMulticast: async ({ tokens }) => {
      calls.push([...tokens]);
      if (calls.length === 1) {
        return {
          successCount: 1,
          failureCount: 1,
          responses: [
            { success: true },
            { success: false, error: { code: 'messaging/server-unavailable' } },
          ],
        };
      }
      return { successCount: 1, failureCount: 0, responses: [{ success: true }] };
    },
  });

  assert.deepEqual(calls, [['accepted-token', 'temporary-token'], ['temporary-token']]);
  assert.equal(result.sent, 2);
  assert.equal(result.failed, 0);
});

test('malformed per-token FCM response is rejected instead of being counted as delivery', async () => {
  await assert.rejects(__test.sendTokensInBatches({
    tokens: ['token-1'],
    tokenDocIds: new Map(),
    message: {},
    sendEachForMulticast: async () => ({
      successCount: 0,
      failureCount: 1,
      responses: [{}],
    }),
  }), /fcm_malformed_multicast_response/);
});

test('FCM network exceptions are marked as attempted before the call can reject', async () => {
  let attempted = false;
  await assert.rejects(__test.sendTokensInBatches({
    tokens: ['token-1'],
    tokenDocIds: new Map(),
    message: {},
    onAttempt: () => { attempted = true; },
    sendEachForMulticast: async () => { throw new Error('network timeout'); },
  }), /network timeout/);
  assert.equal(attempted, true);
});

test('delivery-uncertain notification claims are terminal to avoid duplicate delivery', async () => {
  const firestore = new FakeFirestore();
  const ref = firestore.collection('notification_requests').doc('request-1');
  firestore.values.set(ref.path, { status: 'delivery_uncertain', dispatchLeaseUntil: 0 });
  assert.equal(await __test.claimDispatchRequest({ ref, id: ref.id }, { firestore, now: 10_000 }), null);
});

test('pre-FCM failures are rescheduled with bounded exponential backoff', async () => {
  const firestore = new FakeFirestore();
  const ref = firestore.collection('notification_requests').doc('request-retry');
  firestore.values.set(ref.path, {
    status: 'processing',
    dispatchClaimId: 'claim-retry',
    dispatchAttempt: 3,
  });

  const updated = await __test.schedulePreFcmRetry(
    ref,
    { claimId: 'claim-retry', request: { dispatchAttempt: 3 } },
    new Error('temporary device query failure'),
    { firestore, fieldValue, now: 1_000 },
  );

  assert.equal(updated, true);
  assert.equal(firestore.read(ref.path).status, 'scheduled');
  assert.equal(firestore.read(ref.path).scheduledAt, 241_000);
  assert.equal(firestore.read(ref.path).error, 'temporary device query failure');
  assert.equal(firestore.read(ref.path).dispatchLeaseUntil, null);
});

test('payment events have an independent id namespace and duplicate payment delivery is ignored', async () => {
  const firestore = new FakeFirestore();
  const payment = {
    firestore,
    fieldValue,
    uid: 'user-1',
    eventType: 'payment',
    eventId: 'shared-event-id',
    updater: (summary) => ({ ...summary, totalPaid: Number(summary.totalPaid || 0) + 25 }),
  };
  const saleEvent = {
    firestore,
    fieldValue,
    uid: 'user-1',
    eventType: 'sale',
    eventId: 'shared-event-id',
    updater: saleUpdater(sale(20)),
  };

  assert.equal(await __test.updateAggregateForEvent(payment), true);
  assert.equal(await __test.updateAggregateForEvent(payment), false);
  // The same raw event id is intentionally valid in the sale namespace too.
  assert.equal(await __test.updateAggregateForEvent(saleEvent), true);
  const aggregate = firestore.read('admin_aggregates/user-1');
  assert.equal(aggregate.totalPaid, 25);
  assert.equal(aggregate.totalFaceValue, 20);
});

test('only one concurrent worker claims a request and an expired lease is recoverable', async () => {
  const firestore = new FakeFirestore();
  const ref = firestore.collection('notification_requests').doc('request-1');
  firestore.values.set(ref.path, { title: 'Title', body: 'Body', status: 'scheduled', scheduledAt: 0 });
  const snapshot = new FakeSnapshot(ref, firestore.read(ref.path));

  const [first, second] = await Promise.all([
    __test.claimDispatchRequest(snapshot, { firestore, now: 1000, leaseMs: 100 }),
    __test.claimDispatchRequest(snapshot, { firestore, now: 1000, leaseMs: 100 }),
  ]);
  assert.equal(Boolean(first) !== Boolean(second), true);
  assert.equal(firestore.read(ref.path).status, 'processing');

  firestore.values.set(ref.path, { ...firestore.read(ref.path), dispatchLeaseUntil: 1000 });
  const recovered = await __test.claimDispatchRequest(snapshot, { firestore, now: 1001, leaseMs: 100 });
  assert.ok(recovered);
  assert.equal(firestore.read(ref.path).dispatchAttempt, 2);
});
