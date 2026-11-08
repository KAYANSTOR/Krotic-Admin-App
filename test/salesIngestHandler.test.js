import test from 'node:test';
import assert from 'node:assert/strict';
import handler, {
  createInternalReceipt,
  validateIngestInput,
} from '../server/apiHandlers/sales-ingest.js';
import { encryptNetworkSecret, generateNetworkSecret } from '../server/_lib/networkSecret.js';
import { createFakeFirestore, createRes } from './helpers/fakeFirestore.js';

const master = 'sales-handler-test-master-key-at-least-32-bytes-0123456789';
const NOW = Date.parse('2026-10-27T12:00:00.000Z');
const networkSecret = generateNetworkSecret();

function seed() {
  return {
    'users/user-1': {
      uid: 'user-1',
      networkId: 'NET-10001',
      accessStatus: 'ACTIVE_PAID',
      subscriptionEndsAt: new Date(NOW + 30 * 24 * 60 * 60 * 1000),
      commission_rate: 5,
    },
    'networks/NET-10001': {
      networkId: 'NET-10001',
      owner_uid: 'user-1',
      networkSecretEncrypted: encryptNetworkSecret(networkSecret, master),
      networkSecretVersion: 1,
      totalSalesAmount: 0,
      totalCommissionDue: 0,
      totalPaidAmount: 0,
    },
  };
}

function body(overrides = {}) {
  return {
    saleUuid: 'sale-handler-1',
    amountMinor: 100_000,
    currencyCode: 'YER',
    createdMs: NOW - 1_000,
    customerId: '',
    cardId: '',
    ...overrides,
  };
}

function receiptFor(payload) {
  return createInternalReceipt({ payload, timestamp: NOW, secret: networkSecret });
}

function deps(db) {
  return {
    ensureFirebaseAdmin: () => ({ ok: true }),
    getAuth: () => ({
      verifyIdToken: async (token) => {
        if (token === 'valid-token') return { uid: 'user-1' };
        throw new Error('invalid token');
      },
    }),
    getFirestore: () => db,
    isAdminUid: async () => false,
    now: NOW,
  };
}

function request(input, receipt) {
  return {
    method: 'POST',
    headers: {
      authorization: 'Bearer valid-token',
      ...(receipt ? { 'x-verification-receipt': receipt } : {}),
    },
    body: input,
  };
}

function normalizedPayload(input) {
  return { ...validateIngestInput(input).value, uid: 'user-1' };
}

test('handler returns 201, then 200 ACK, then 409 payload_conflict without double counting', async () => {
  const previous = process.env.KROTAK_HMAC_SECRET;
  process.env.KROTAK_HMAC_SECRET = master;
  try {
    const db = createFakeFirestore(seed());
    const input = body();
    const receipt = receiptFor(normalizedPayload(input));

    const created = createRes();
    await handler(request(input, receipt), created, deps(db));
    assert.equal(created.statusCode, 201);
    assert.equal(created.body.success, true);
    assert.equal(created.body.status, 'CREATED');
    assert.equal(created.body.commissionRiyal, 50);
    assert.equal(created.body.amountRiyal, 1000);
    const sale = db._store.get('networks/NET-10001/sales/sale-handler-1');
    assert.equal(sale.serverReceivedAtMs, NOW);
    assert.equal(sale.serverReceivedAt, new Date(NOW).toISOString());
    assert.equal(sale.networkSecretVersion, 1);
    assert.equal(sale.commissionRiyal, 50);
    assert.equal(sale.netAmount, 950);
    assert.equal(db._store.get('networks/NET-10001').totalSalesAmount, 1000);

    const repeated = createRes();
    await handler(request(input, receipt), repeated, deps(db));
    assert.equal(repeated.statusCode, 200);
    assert.equal(repeated.body.status, 'ALREADY_EXISTS_ACKED');
    assert.equal(repeated.body.ack, true);
    assert.equal(db._store.get('networks/NET-10001').totalSalesAmount, 1000);
    assert.equal(db._store.get('networks/NET-10001').totalCommissionDue, 50);

    const altered = body({ amountMinor: 200_000 });
    const conflict = createRes();
    await handler(request(altered, receiptFor(normalizedPayload(altered))), conflict, deps(db));
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.body.error, 'payload_conflict');
    assert.equal(db._store.get('networks/NET-10001').totalSalesAmount, 1000);
    assert.equal(db._store.get('networks/NET-10001/sales/sale-handler-1').amountRiyal, 1000);
  } finally {
    if (previous === undefined) delete process.env.KROTAK_HMAC_SECRET;
    else process.env.KROTAK_HMAC_SECRET = previous;
  }
});

test('handler rejects invalid or expired HMAC receipts and unauthorised accounts', async () => {
  const previous = process.env.KROTAK_HMAC_SECRET;
  process.env.KROTAK_HMAC_SECRET = master;
  try {
    const input = body();
    const bad = createRes();
    await handler(request(input, 'not-a-valid-receipt'), bad, deps(createFakeFirestore(seed())));
    assert.equal(bad.statusCode, 401);
    assert.equal(bad.body.error, 'hmac_invalid');

    const expiredReceipt = createInternalReceipt({
      payload: normalizedPayload(input),
      timestamp: NOW - 6 * 60 * 1000,
      secret: networkSecret,
    });
    const expired = createRes();
    await handler(request(input, expiredReceipt), expired, deps(createFakeFirestore(seed())));
    assert.equal(expired.statusCode, 401);
    assert.equal(expired.body.error, 'hmac_expired_or_malformed');
    assert.equal(expired.body.serverTime, new Date(NOW).toISOString());

    const suspendedDb = createFakeFirestore({
      ...seed(),
      'users/user-1': {
        ...seed()['users/user-1'],
        accessStatus: 'SUSPENDED_MANUAL',
        is_active: false,
      },
    });
    const suspended = createRes();
    await handler(request(input, receiptFor(normalizedPayload(input))), suspended, deps(suspendedDb));
    assert.equal(suspended.statusCode, 403);
    assert.equal(suspended.body.error, 'account_suspended');

    const futureInput = body({ createdMs: NOW + 25 * 60 * 60 * 1000 });
    const future = createRes();
    await handler(request(futureInput, receiptFor(normalizedPayload(futureInput))), future, deps(createFakeFirestore(seed())));
    assert.equal(future.statusCode, 400);
    assert.equal(future.body.error, 'created_at_in_future');
    assert.equal(future.body.serverTime, new Date(NOW).toISOString());
  } finally {
    if (previous === undefined) delete process.env.KROTAK_HMAC_SECRET;
    else process.env.KROTAK_HMAC_SECRET = previous;
  }
});

test('re-ingesting a cancelled sale with the same payload ACKs with saleStatus CANCELLED and writes nothing', async () => {
  const previous = process.env.KROTAK_HMAC_SECRET;
  process.env.KROTAK_HMAC_SECRET = master;
  try {
    const db = createFakeFirestore(seed());
    const input = body();
    const receipt = receiptFor(normalizedPayload(input));
    const created = createRes();
    await handler(request(input, receipt), created, deps(db));
    assert.equal(created.statusCode, 201);

    // Simulate the state written by POST /api/sales/cancel (totals reversed).
    const salePath = 'networks/NET-10001/sales/sale-handler-1';
    db._store.set(salePath, {
      ...db._store.get(salePath),
      status: 'CANCELLED',
      settlement_status: 'CANCELLED',
      cancellationId: 'cxl_0123456789abcdef0123456789abcdef',
    });
    db._store.set('networks/NET-10001', {
      ...db._store.get('networks/NET-10001'),
      totalSalesAmount: 0,
      totalCommissionDue: 0,
      outstandingBalance: 0,
    });
    const before = JSON.stringify([...db._store.entries()]);

    const repeated = createRes();
    await handler(request(input, receipt), repeated, deps(db));
    assert.equal(repeated.statusCode, 200);
    assert.equal(repeated.body.success, true);
    assert.equal(repeated.body.status, 'ALREADY_EXISTS_ACKED');
    assert.equal(repeated.body.ack, true);
    assert.equal(repeated.body.saleStatus, 'CANCELLED');
    assert.equal(JSON.stringify([...db._store.entries()]), before, 'nothing may be written or reactivated');
    assert.equal(db._store.get(salePath).status, 'CANCELLED');
    assert.equal(db._store.get('networks/NET-10001').totalSalesAmount, 0);
  } finally {
    if (previous === undefined) delete process.env.KROTAK_HMAC_SECRET;
    else process.env.KROTAK_HMAC_SECRET = previous;
  }
});
