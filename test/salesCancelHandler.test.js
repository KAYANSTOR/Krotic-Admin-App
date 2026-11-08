import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import cancelHandler, {
  cancellationIdFor,
  createCancelReceipt,
  validateCancelInput,
} from '../server/apiHandlers/sales-cancel.js';
import ingestHandler, {
  createInternalReceipt,
  validateIngestInput,
} from '../server/apiHandlers/sales-ingest.js';
import routerHandler, { API_ROUTE_HANDLERS } from '../api/router.js';
import { encryptNetworkSecret, generateNetworkSecret } from '../server/_lib/networkSecret.js';
import { saleDocumentId } from '../server/_lib/saleIdentity.js';
import { createFakeFirestore, createRes } from './helpers/fakeFirestore.js';

const master = 'sales-cancel-test-master-key-at-least-32-bytes-0123456789';
const NOW = Date.parse('2026-11-08T09:00:00.000Z');
const networkSecret = generateNetworkSecret();
const previousSecret = generateNetworkSecret();
const NETWORK = 'networks/NET-20001';
const SALE_UUID = '7850.73';
const SALE_PATH = `${NETWORK}/sales/${saleDocumentId(SALE_UUID)}`;
const CANCELLATION_ID = cancellationIdFor(SALE_UUID);

let previousMaster;
before(() => {
  previousMaster = process.env.KROTAK_HMAC_SECRET;
  process.env.KROTAK_HMAC_SECRET = master;
});
after(() => {
  if (previousMaster === undefined) delete process.env.KROTAK_HMAC_SECRET;
  else process.env.KROTAK_HMAC_SECRET = previousMaster;
});

function seed(overrides = {}) {
  return {
    'users/owner-1': {
      uid: 'owner-1',
      networkId: 'NET-20001',
      accessStatus: 'ACTIVE_PAID',
      subscriptionEndsAt: new Date(NOW + 30 * 86_400_000),
      commission_rate: 5,
    },
    [NETWORK]: {
      networkId: 'NET-20001',
      owner_uid: 'owner-1',
      networkSecretEncrypted: encryptNetworkSecret(networkSecret, master),
      networkSecretVersion: 2,
      totalSalesAmount: 0,
      totalCommissionDue: 0,
      totalPaidAmount: 0,
      outstandingBalance: 0,
    },
    ...overrides,
  };
}

function deps(db, { uid = 'owner-1', admin = false, now = NOW } = {}) {
  return {
    ensureFirebaseAdmin: () => ({ ok: true }),
    getAuth: () => ({
      verifyIdToken: async (token) => {
        if (token === 'valid-token') return { uid };
        throw new Error('invalid token');
      },
    }),
    getFirestore: () => db,
    isAdminUid: async () => admin,
    now,
  };
}

function cancelBody(overrides = {}) {
  return {
    saleUuid: SALE_UUID,
    cancellationId: CANCELLATION_ID,
    cancelledMs: NOW - 60_000,
    reason: 'device_reversal',
    ...overrides,
  };
}

function cancelReceipt(input, { uid = 'owner-1', secret = networkSecret, timestamp = NOW } = {}) {
  const parsed = validateCancelInput(input);
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  return createCancelReceipt({ payload: { ...parsed.value, uid }, timestamp, secret });
}

function post(input, receipt, { token = 'valid-token' } = {}) {
  return {
    method: 'POST',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(receipt ? { 'x-verification-receipt': receipt } : {}),
    },
    body: input,
  };
}

async function cancel(db, input = cancelBody(), options = {}) {
  const res = createRes();
  const receipt = options.receipt === undefined ? cancelReceipt(input, options) : options.receipt;
  await cancelHandler(post(input, receipt, options), res, deps(db, options));
  return res;
}

const ingestInput = {
  saleUuid: SALE_UUID,
  amountMinor: 100_000,
  currencyCode: 'YER',
  createdMs: Date.parse('2026-11-02T08:00:00.000Z'),
  customerId: 'cust-1',
  cardId: 'card-1',
};

async function ingest(db, input = ingestInput) {
  const payload = { ...validateIngestInput(input).value, uid: 'owner-1' };
  const res = createRes();
  await ingestHandler(
    post(input, createInternalReceipt({ payload, timestamp: NOW, secret: networkSecret })),
    res,
    deps(db),
  );
  return res;
}

const snapshot = (db) => JSON.stringify([...db._store.entries()].sort(([a], [b]) => a.localeCompare(b)));

const CANCEL_FIELDS = [
  'status', 'settlement_status', 'cancellationId', 'cancelReason', 'cancelledAtMs', 'cancelledAt',
  'cancelReceivedAtMs', 'cancelVerificationReceipt', 'cancelledAmountRiyal', 'cancelledCommissionRiyal',
  'cancelNetworkSecretVersion', 'updatedAtMs',
];

test('router and rewrite deliver /api/sales/cancel to the cancel handler', async () => {
  assert.equal(API_ROUTE_HANDLERS['sales-cancel'], cancelHandler);
  const res = createRes();
  await routerHandler({ method: 'GET', headers: {}, query: { __router: 'sales-cancel' } }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'POST');
});

test('ingested sale is cancelled: totals reversed, ingest fields untouched, audit written, retry is idempotent', async () => {
  const db = createFakeFirestore(seed());
  db._store.set(NETWORK, { ...db._store.get(NETWORK), totalSalesAmount: 4000, totalCommissionDue: 200, totalPaidAmount: 120, outstandingBalance: 80 });
  assert.equal((await ingest(db)).statusCode, 201);
  const ingested = { ...db._store.get(SALE_PATH) };
  assert.equal(db._store.get(NETWORK).totalSalesAmount, 5000);
  assert.equal(db._store.get(NETWORK).totalCommissionDue, 250);

  const input = cancelBody();
  const receipt = cancelReceipt(input);
  const res = await cancel(db, input, { receipt });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, {
    success: true,
    status: 'CANCELLED',
    ack: true,
    saleUuid: SALE_UUID,
    cancellationId: CANCELLATION_ID,
    reversedAmountRiyal: 1000,
    reversedCommissionRiyal: 50,
    policyVersion: 2,
  });

  const sale = db._store.get(SALE_PATH);
  assert.equal(sale.status, 'CANCELLED');
  assert.equal(sale.settlement_status, 'CANCELLED');
  assert.equal(sale.cancellationId, CANCELLATION_ID);
  assert.equal(sale.cancelReason, 'device_reversal');
  assert.equal(sale.cancelledAtMs, NOW - 60_000);
  assert.ok(sale.cancelledAt instanceof Date);
  assert.equal(sale.cancelledAt.getTime(), NOW - 60_000);
  assert.equal(sale.cancelReceivedAtMs, NOW);
  assert.equal(sale.cancelVerificationReceipt, receipt);
  assert.equal(sale.cancelledAmountRiyal, 1000);
  assert.equal(sale.cancelledCommissionRiyal, 50);
  assert.equal(sale.cancelNetworkSecretVersion, 2);
  assert.equal(sale.updatedAtMs, NOW);
  // Every original ingest field is unchanged (only the cancellation fields differ).
  for (const [key, value] of Object.entries(ingested)) {
    if (CANCEL_FIELDS.includes(key)) continue;
    assert.deepEqual(sale[key], value, `ingest field ${key} must not change`);
  }
  assert.equal(sale.payloadHash, ingested.payloadHash);
  assert.equal(sale.verificationReceipt, ingested.verificationReceipt);
  assert.equal(sale.createdAtMs, ingestInput.createdMs);
  assert.equal(sale.amountRiyal, 1000);
  assert.equal(sale.commissionRiyal, 50);

  const network = db._store.get(NETWORK);
  assert.equal(network.totalSalesAmount, 4000);
  assert.equal(network.totalCommissionDue, 200);
  assert.equal(network.totalPaidAmount, 120);
  assert.equal(network.outstandingBalance, 80);
  assert.equal(network.updatedAtMs, NOW);

  const audit = db._store.get(`admin_audit_logs/sale_cancel_${saleDocumentId(SALE_UUID)}`);
  assert.equal(audit.action, 'SALE_CANCELLED_BY_DEVICE');
  assert.equal(audit.actorUid, 'owner-1');
  assert.equal(audit.networkId, 'NET-20001');
  assert.deepEqual(audit.details, {
    saleUuid: SALE_UUID,
    saleDocumentId: saleDocumentId(SALE_UUID),
    cancellationId: CANCELLATION_ID,
    reason: 'device_reversal',
    cancelledAtMs: NOW - 60_000,
    reversedAmountRiyal: 1000,
    reversedCommissionRiyal: 50,
  });

  // Retry (same request, and a later retry with a different id/reason): ACK, nothing written.
  const beforeRetry = snapshot(db);
  const retry = await cancel(db, input, { receipt });
  assert.equal(retry.statusCode, 200);
  assert.deepEqual(retry.body, {
    success: true, status: 'ALREADY_CANCELLED_ACKED', ack: true, saleUuid: SALE_UUID, cancellationId: CANCELLATION_ID,
  });
  const other = cancelBody({ cancellationId: 'cxl_ffffffffffffffffffffffffffffffff', reason: 'operator_error' });
  const otherRetry = await cancel(db, other);
  assert.equal(otherRetry.statusCode, 200);
  assert.equal(otherRetry.body.status, 'ALREADY_CANCELLED_ACKED');
  assert.equal(otherRetry.body.cancellationId, CANCELLATION_ID, 'the stored cancellationId is returned');
  assert.equal(snapshot(db), beforeRetry, 'idempotent retries write nothing');
  assert.equal(db._store.get(NETWORK).totalSalesAmount, 4000, 'no double reversal');

  // Re-ingesting the same sale does not reactivate it (O-07 rule 4).
  const reingest = await ingest(db);
  assert.equal(reingest.statusCode, 200);
  assert.equal(reingest.body.status, 'ALREADY_EXISTS_ACKED');
  assert.equal(reingest.body.saleStatus, 'CANCELLED');
  assert.equal(snapshot(db), beforeRetry, 're-ingest writes nothing');
});

test('totals reversal is floored at 0 and outstandingBalance is recomputed', async () => {
  const db = createFakeFirestore(seed());
  assert.equal((await ingest(db)).statusCode, 201);
  // Drifted totals smaller than the sale (e.g. a legacy repair) must never go negative.
  db._store.set(NETWORK, { ...db._store.get(NETWORK), totalSalesAmount: 300, totalCommissionDue: 20, totalPaidAmount: 5, outstandingBalance: 15 });
  const res = await cancel(db);
  assert.equal(res.statusCode, 200);
  const network = db._store.get(NETWORK);
  assert.equal(network.totalSalesAmount, 0);
  assert.equal(network.totalCommissionDue, 0);
  assert.equal(network.totalPaidAmount, 5);
  assert.equal(network.outstandingBalance, 0);
});

function storedSale(overrides = {}) {
  return {
    saleId: SALE_UUID, saleUuid: SALE_UUID, amountMinor: 100_000, amountRiyal: 1000, commissionRiyal: 50,
    status: 'COMPLETED', settlement_status: 'PENDING_SETTLEMENT', paidRiyal: 0, paidMinor: 0,
    payloadHash: 'h', moneyPolicyVersion: 2, createdAtMs: NOW - 86_400_000,
    ...overrides,
  };
}

for (const [label, saleOverrides] of [
  ['paidRiyal > 0', { paidRiyal: 10, paidMinor: 1000, settlement_status: 'PARTIAL' }],
  ['settlement_status PARTIAL', { settlement_status: 'PARTIAL' }],
  ['settlement_status SETTLED', { settlement_status: 'SETTLED', paidRiyal: 50, paidMinor: 5000 }],
  ['paidRiyal > 0 with a stale PENDING_SETTLEMENT status', { paidRiyal: 1 }],
]) {
  test(`paid sale (${label}) -> 409 sale_already_settled, registry written, sale and totals unchanged`, async () => {
    const totals = { totalSalesAmount: 1000, totalCommissionDue: 50, totalPaidAmount: 50, outstandingBalance: 0 };
    const db = createFakeFirestore(seed({
      [NETWORK]: { ...seed()[NETWORK], ...totals },
      [SALE_PATH]: storedSale(saleOverrides),
    }));
    const saleBefore = JSON.stringify(db._store.get(SALE_PATH));
    const networkBefore = JSON.stringify(db._store.get(NETWORK));
    const input = cancelBody({ reason: 'customer_return' });
    const receipt = cancelReceipt(input);
    const res = await cancel(db, input, { receipt });
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.body, { success: false, error: 'sale_already_settled', saleUuid: SALE_UUID });
    assert.equal(JSON.stringify(db._store.get(SALE_PATH)), saleBefore);
    assert.equal(JSON.stringify(db._store.get(NETWORK)), networkBefore);
    assert.equal(db._store.has(`admin_audit_logs/sale_cancel_${saleDocumentId(SALE_UUID)}`), false);
    const registry = db._store.get(`sale_cancellation_registry/owner-1_${saleDocumentId(SALE_UUID)}`);
    assert.equal(registry.reason, 'sale_already_settled');
    assert.equal(registry.uid, 'owner-1');
    assert.equal(registry.networkId, 'NET-20001');
    assert.equal(registry.saleUuid, SALE_UUID);
    assert.equal(registry.cancellationId, CANCELLATION_ID);
    assert.equal(registry.cancelReason, 'customer_return');
    assert.equal(registry.cancelledAtMs, input.cancelledMs);
    assert.equal(registry.verificationReceipt, receipt);
    assert.equal(registry.recordedAtMs, NOW);
  });
}

for (const [label, saleOverrides] of [
  ['unknown status', { status: 'PENDING' }],
  ['legacy sale without server amounts', { amountRiyal: undefined, commissionRiyal: undefined }],
  ['missing settlement_status', { settlement_status: undefined }],
]) {
  test(`${label} -> 409 sale_not_cancellable and nothing is written`, async () => {
    const sale = storedSale(saleOverrides);
    for (const key of Object.keys(sale)) if (sale[key] === undefined) delete sale[key];
    const db = createFakeFirestore(seed({ [SALE_PATH]: sale }));
    const before = snapshot(db);
    const res = await cancel(db);
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.body, { success: false, error: 'sale_not_cancellable', saleUuid: SALE_UUID });
    assert.equal(snapshot(db), before);
  });
}

test('legacy sale with no status (but unpaid and with server amounts) is cancellable', async () => {
  const sale = storedSale();
  delete sale.status;
  const db = createFakeFirestore(seed({
    [NETWORK]: { ...seed()[NETWORK], totalSalesAmount: 1000, totalCommissionDue: 50 },
    [SALE_PATH]: sale,
  }));
  const res = await cancel(db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'CANCELLED');
  assert.equal(db._store.get(SALE_PATH).status, 'CANCELLED');
  assert.equal(db._store.get(NETWORK).totalSalesAmount, 0);
});

test('sale_not_found -> 404 and nothing is written', async () => {
  const db = createFakeFirestore(seed());
  const before = snapshot(db);
  const res = await cancel(db);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { success: false, error: 'sale_not_found', saleUuid: SALE_UUID });
  assert.equal(snapshot(db), before);
});

test('forbidden identity/financial/unknown fields and malformed bodies are rejected with ingest codes', async () => {
  const cases = [
    [{ uid: 'owner-1' }, 'client_identity_field_forbidden'],
    [{ networkId: 'NET-20001' }, 'client_identity_field_forbidden'],
    [{ owner_uid: 'owner-1' }, 'client_identity_field_forbidden'],
    [{ status: 'CANCELLED' }, 'client_financial_field_forbidden'],
    [{ amount: 1000 }, 'client_financial_field_forbidden'],
    [{ commission: 0 }, 'client_financial_field_forbidden'],
    [{ commissionRiyal: 0 }, 'client_financial_field_forbidden'],
    [{ paidRiyal: 0 }, 'client_financial_field_forbidden'],
    [{ settlement_status: 'CANCELLED' }, 'client_financial_field_forbidden'],
    [{ verificationReceipt: 'x' }, 'client_financial_field_forbidden'],
    [{ amountMinor: 100 }, 'client_field_forbidden'],
    [{ payloadHash: 'a'.repeat(64) }, 'client_field_forbidden'],
    [{ saleId: 'other' }, 'sale_id_mismatch'],
    [{ saleUuid: '' }, 'sale_id_required'],
    [{ saleUuid: 'bad/id' }, 'sale_id_invalid'],
    [{ cancellationId: undefined }, 'cancellation_id_required'],
    [{ cancellationId: 'short' }, 'cancellation_id_invalid'],
    [{ cancellationId: 42 }, 'cancellation_id_invalid'],
    [{ cancelledMs: '1793990600000' }, 'cancelled_at_invalid'],
    [{ cancelledMs: -1 }, 'cancelled_at_invalid'],
    [{ cancelledMs: undefined }, 'cancelled_at_invalid'],
    [{ reason: undefined }, 'reason_required'],
    [{ reason: 'refund' }, 'reason_invalid'],
  ];
  for (const [overrides, error] of cases) {
    const input = cancelBody(overrides);
    for (const key of Object.keys(input)) if (input[key] === undefined) delete input[key];
    const db = createFakeFirestore(seed({ [SALE_PATH]: storedSale() }));
    const before = snapshot(db);
    const res = createRes();
    await cancelHandler(post(input, 'ignored'), res, deps(db));
    assert.equal(res.statusCode, 400, JSON.stringify(overrides));
    assert.deepEqual(res.body, { success: false, error }, JSON.stringify(overrides));
    assert.equal(snapshot(db), before);
  }
  const legacyAlias = cancelBody({ saleUuid: undefined, saleId: SALE_UUID });
  delete legacyAlias.saleUuid;
  assert.equal(validateCancelInput(legacyAlias).ok, true);
  assert.equal(validateCancelInput(JSON.stringify(cancelBody())).ok, true, 'string JSON bodies are parsed');
});

test('cancelledMs more than 24h in the future -> 400 cancelled_at_in_future with serverTime', async () => {
  const db = createFakeFirestore(seed({ [SALE_PATH]: storedSale() }));
  const ok = await cancel(db, cancelBody({ cancelledMs: NOW + 23 * 3_600_000 }));
  assert.equal(ok.statusCode, 200, 'within 24h is accepted');
  const db2 = createFakeFirestore(seed({ [SALE_PATH]: storedSale() }));
  const res = await cancel(db2, cancelBody({ cancelledMs: NOW + 25 * 3_600_000 }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'cancelled_at_in_future');
  assert.equal(res.body.serverTime, new Date(NOW).toISOString());
});

test('HMAC: wrong secret, tampered body, missing and expired receipts are 401 with serverTime', async () => {
  const db = createFakeFirestore(seed({ [SALE_PATH]: storedSale() }));
  const before = snapshot(db);
  const wrong = await cancel(db, cancelBody(), { secret: generateNetworkSecret() });
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.body.error, 'hmac_invalid');
  assert.equal(wrong.body.serverTime, new Date(NOW).toISOString());

  const tampered = await cancel(db, cancelBody({ reason: 'operator_error' }), { receipt: cancelReceipt(cancelBody()) });
  assert.equal(tampered.statusCode, 401);
  assert.equal(tampered.body.error, 'hmac_invalid');

  const otherUid = await cancel(db, cancelBody(), { receipt: cancelReceipt(cancelBody(), { uid: 'someone-else' }) });
  assert.equal(otherUid.statusCode, 401, 'the uid from the token is part of the signed bytes');

  const ingestStyle = createInternalReceipt({ payload: { ...validateIngestInput(ingestInput).value, uid: 'owner-1' }, timestamp: NOW, secret: networkSecret });
  const crossEndpoint = await cancel(db, cancelBody(), { receipt: ingestStyle });
  assert.equal(crossEndpoint.statusCode, 401, 'an ingest receipt cannot authorise a cancellation');

  const missing = await cancel(db, cancelBody(), { receipt: '' });
  assert.equal(missing.statusCode, 401);
  assert.equal(missing.body.error, 'hmac_invalid');

  const expired = await cancel(db, cancelBody(), { timestamp: NOW - 6 * 60_000 });
  assert.equal(expired.statusCode, 401);
  assert.equal(expired.body.error, 'hmac_expired_or_malformed');
  assert.equal(expired.body.serverTime, new Date(NOW).toISOString());
  assert.equal(snapshot(db), before, 'rejected receipts write nothing');
});

test('HMAC: previous key accepted only inside the rotation grace window', async () => {
  const rotated = {
    ...seed()[NETWORK],
    networkSecretVersion: 3,
    previousNetworkSecretEncrypted: encryptNetworkSecret(previousSecret, master),
    previousNetworkSecretVersion: 2,
    previousNetworkSecretValidUntilMs: NOW + 60_000,
    totalSalesAmount: 1000,
    totalCommissionDue: 50,
  };
  const db = createFakeFirestore(seed({ [NETWORK]: rotated, [SALE_PATH]: storedSale() }));
  const grace = await cancel(db, cancelBody(), { secret: previousSecret });
  assert.equal(grace.statusCode, 200, JSON.stringify(grace.body));
  assert.equal(db._store.get(SALE_PATH).cancelNetworkSecretVersion, 2);

  const expiredDb = createFakeFirestore(seed({
    [NETWORK]: { ...rotated, previousNetworkSecretValidUntilMs: NOW - 1 },
    [SALE_PATH]: storedSale(),
  }));
  const late = await cancel(expiredDb, cancelBody(), { secret: previousSecret });
  assert.equal(late.statusCode, 401);
  assert.equal(late.body.error, 'hmac_invalid');
  assert.equal(expiredDb._store.get(SALE_PATH).status, 'COMPLETED');
});

test('auth, account and network ownership checks come before the transaction', async () => {
  const fresh = () => createFakeFirestore(seed({ [SALE_PATH]: storedSale() }));

  const get = createRes();
  await cancelHandler({ method: 'GET', headers: {} }, get, deps(fresh()));
  assert.equal(get.statusCode, 405);

  const notReady = createRes();
  await cancelHandler(post(cancelBody(), 'x'), notReady, { ...deps(fresh()), ensureFirebaseAdmin: () => ({ ok: false, error: 'firebase_not_configured' }) });
  assert.equal(notReady.statusCode, 503);

  const noToken = await cancel(fresh(), cancelBody(), { token: '' });
  assert.deepEqual([noToken.statusCode, noToken.body.error], [401, 'missing_token']);
  const badToken = await cancel(fresh(), cancelBody(), { token: 'forged' });
  assert.deepEqual([badToken.statusCode, badToken.body.error], [401, 'invalid_token']);

  const adminDb = fresh();
  const admin = await cancel(adminDb, cancelBody(), { admin: true });
  assert.deepEqual([admin.statusCode, admin.body.error], [403, 'not_client_account']);
  assert.equal(adminDb._store.get(SALE_PATH).status, 'COMPLETED');

  const stranger = await cancel(fresh(), cancelBody(), { uid: 'stranger' });
  assert.deepEqual([stranger.statusCode, stranger.body.error], [404, 'account_not_found']);

  const mismatchDb = createFakeFirestore(seed({
    'users/intruder': { uid: 'intruder', networkId: 'NET-20001' },
    [SALE_PATH]: storedSale(),
  }));
  const mismatch = await cancel(mismatchDb, cancelBody(), { uid: 'intruder' });
  assert.deepEqual([mismatch.statusCode, mismatch.body.error], [403, 'network_owner_mismatch']);
  assert.equal(mismatchDb._store.get(SALE_PATH).status, 'COMPLETED');

  const invalidMapping = createFakeFirestore(seed({ 'users/owner-1': { uid: 'owner-1', networkId: 'NET/1' } }));
  const mapping = await cancel(invalidMapping);
  assert.deepEqual([mapping.statusCode, mapping.body.error], [409, 'network_mapping_invalid']);

  const noNetwork = createFakeFirestore(seed({ 'users/owner-1': { uid: 'owner-1', networkId: 'NET-99999' } }));
  const missingNetwork = await cancel(noNetwork);
  assert.deepEqual([missingNetwork.statusCode, missingNetwork.body.error], [409, 'network_not_provisioned']);

  const noSecret = createFakeFirestore(seed({ [NETWORK]: { ...seed()[NETWORK], networkSecretEncrypted: undefined } }));
  const secretMissing = await cancel(noSecret);
  assert.deepEqual([secretMissing.statusCode, secretMissing.body.error], [409, 'network_secret_not_provisioned']);
});

test('an expired or suspended subscription does not block cancellation (sync-only, lowers commission)', async () => {
  for (const user of [
    { accessStatus: 'ACTIVE_PAID', subscriptionEndsAt: new Date(NOW - 86_400_000) },
    { accessStatus: 'SUSPENDED_MANUAL', is_active: false },
  ]) {
    const db = createFakeFirestore(seed({
      'users/owner-1': { uid: 'owner-1', networkId: 'NET-20001', ...user },
      [NETWORK]: { ...seed()[NETWORK], totalSalesAmount: 1000, totalCommissionDue: 50 },
      [SALE_PATH]: storedSale(),
    }));
    const res = await cancel(db);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'CANCELLED');
  }
});

test('legacy accounts whose network document is keyed by the uid can cancel', async () => {
  const legacySale = 'legacy-sale_1';
  const db = createFakeFirestore({
    'users/legacy-1': { uid: 'legacy-1' },
    'networks/legacy-1': {
      networkSecretEncrypted: encryptNetworkSecret(networkSecret, master),
      totalSalesAmount: 1000, totalCommissionDue: 50, totalPaidAmount: 0,
    },
    [`networks/legacy-1/sales/${legacySale}`]: storedSale({ saleId: legacySale, saleUuid: legacySale }),
  });
  const input = cancelBody({ saleUuid: legacySale, cancellationId: cancellationIdFor(legacySale) });
  const res = await cancel(db, input, { uid: 'legacy-1' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(db._store.get(`networks/legacy-1/sales/${legacySale}`).status, 'CANCELLED');
  assert.equal(db._store.get('networks/legacy-1').totalSalesAmount, 0);
});
