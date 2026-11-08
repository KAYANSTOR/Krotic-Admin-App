import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import {
  CANCEL_REASONS,
  cancelSale,
  cancellationIdFor,
  canonicalCancelPayload,
  createCancelReceipt,
  reversedNetworkTotals,
  saleHasPayment,
  saleIsCancellable,
  validateCancelInput,
  verifyCancelReceiptWithCandidates,
} from '../server/_lib/saleCancellation.js';
import { saleDocumentId } from '../server/_lib/saleIdentity.js';
import { CLIENT_FINANCIAL_FIELDS, CLIENT_IDENTITY_FIELDS } from '../server/_lib/clientSaleRequest.js';

// Strict transaction double: reads after the first write throw (Firestore rule),
// and writes are applied only when the callback resolves.
class StrictDb {
  constructor(docs = {}) { this.docs = new Map(Object.entries(docs)); this.writes = []; }
  collection(name) { return this.#col(name); }
  #col(path) { return { doc: (id) => this.#doc(`${path}/${id}`) }; }
  #doc(path) { return { path, collection: (name) => this.#col(`${path}/${name}`) }; }
  async runTransaction(callback) {
    const pending = [];
    let wrote = false;
    const tx = {
      get: async (ref) => {
        if (wrote) throw new Error('read after write in transaction');
        const value = this.docs.get(ref.path);
        return { exists: value !== undefined, data: () => value };
      },
      set: (ref, value, options = {}) => { wrote = true; pending.push({ path: ref.path, value, options }); },
    };
    const result = await callback(tx);
    for (const { path, value, options } of pending) {
      this.writes.push({ path, options });
      this.docs.set(path, options.merge ? { ...(this.docs.get(path) || {}), ...value } : value);
    }
    return result;
  }
}

const NOW = 1_794_000_000_000;
const payload = (overrides = {}) => ({
  saleId: '7850.73', saleUuid: '7850.73', uid: 'owner-1',
  cancellationId: cancellationIdFor('7850.73'), cancelledMs: NOW - 1000, reason: 'device_reversal',
  ...overrides,
});
const salePath = `networks/NET-1/sales/${saleDocumentId('7850.73')}`;
const activeSale = (overrides = {}) => ({
  saleUuid: '7850.73', amountRiyal: 2000, commissionRiyal: 100, status: 'COMPLETED',
  settlement_status: 'PENDING_SETTLEMENT', paidRiyal: 0, paidMinor: 0, payloadHash: 'abc',
  verificationReceipt: 'r-ingest', createdAtMs: NOW - 86_400_000, ...overrides,
});

test('cancellationId client rule is deterministic: cxl_ + 32 hex of sha256("sale_cancel:"+saleUuid)', () => {
  const expected = `cxl_${createHash('sha256').update('sale_cancel:7850.73').digest('hex').slice(0, 32)}`;
  assert.equal(cancellationIdFor('7850.73'), expected);
  assert.match(expected, /^cxl_[a-f0-9]{32}$/);
  assert.equal(cancellationIdFor('7850.73'), cancellationIdFor('7850.73'));
  assert.notEqual(cancellationIdFor('7850.73'), cancellationIdFor('7850.74'));
});

test('canonical string pins the exact key order and the uid from the token', () => {
  assert.equal(
    canonicalCancelPayload(payload()),
    `{"saleId":"7850.73","uid":"owner-1","cancellationId":"${cancellationIdFor('7850.73')}","cancelledMs":${NOW - 1000},"reason":"device_reversal"}`,
  );
  const secret = 'network-secret';
  const receipt = createCancelReceipt({ payload: payload(), timestamp: NOW, secret });
  const expectedSig = createHmac('sha256', secret).update(`${NOW}.${canonicalCancelPayload(payload())}`).digest('hex');
  assert.equal(receipt, `${NOW}.${expectedSig}`);
  const candidates = [{ secret, version: 4, current: true }];
  assert.deepEqual(
    verifyCancelReceiptWithCandidates({ token: receipt, payload: payload(), candidates, now: NOW }),
    { ok: true, timestamp: NOW, secretVersion: 4, usedPrevious: false },
  );
  assert.equal(verifyCancelReceiptWithCandidates({ token: receipt, payload: payload({ cancelledMs: NOW }), candidates, now: NOW }).ok, false);
  assert.equal(verifyCancelReceiptWithCandidates({ token: receipt, payload: payload(), candidates, now: NOW + 5 * 60_000 + 1 }).error, 'hmac_expired_or_malformed');
});

test('validator accepts every reason, rejects every server-owned field', () => {
  const body = { saleUuid: '7850.73', cancellationId: cancellationIdFor('7850.73'), cancelledMs: NOW, reason: 'device_reversal' };
  for (const reason of CANCEL_REASONS) assert.equal(validateCancelInput({ ...body, reason }).ok, true, reason);
  assert.deepEqual(validateCancelInput({ ...body, saleUuid: ' 7850.73 ' }).value.saleUuid, '7850.73');
  for (const field of CLIENT_IDENTITY_FIELDS) {
    assert.equal(validateCancelInput({ ...body, [field]: 'x' }).error, 'client_identity_field_forbidden', field);
  }
  for (const field of CLIENT_FINANCIAL_FIELDS) {
    assert.equal(validateCancelInput({ ...body, [field]: 0 }).error, 'client_financial_field_forbidden', field);
  }
  assert.equal(validateCancelInput({ ...body, cancelledMs: Number.MAX_SAFE_INTEGER + 2 }).error, 'cancelled_at_invalid');
  assert.equal(validateCancelInput({ ...body, cancellationId: 'x'.repeat(129) }).error, 'cancellation_id_invalid');
  assert.equal(validateCancelInput(null).error, 'sale_id_required');
  assert.equal(validateCancelInput('not json').error, 'sale_id_required');
});

test('payment and cancellability rules (O-07)', () => {
  assert.equal(saleHasPayment(activeSale()), false);
  assert.equal(saleHasPayment(activeSale({ paidRiyal: 1 })), true);
  assert.equal(saleHasPayment(activeSale({ paidMinor: 100 })), true);
  assert.equal(saleHasPayment(activeSale({ settlement_status: 'PARTIAL' })), true);
  assert.equal(saleHasPayment(activeSale({ settlement_status: 'SETTLED' })), true);
  assert.equal(saleIsCancellable(activeSale()), true);
  assert.equal(saleIsCancellable(activeSale({ status: undefined })), true);
  assert.equal(saleIsCancellable(activeSale({ status: 'PENDING' })), false);
  assert.equal(saleIsCancellable(activeSale({ settlement_status: undefined })), false);
  assert.equal(saleIsCancellable(activeSale({ amountRiyal: null })), false);
  assert.equal(saleIsCancellable(activeSale({ commissionRiyal: undefined })), false);
});

test('reversal math: subtract, floor at 0, outstanding = max(0, due - paid)', () => {
  assert.deepEqual(
    reversedNetworkTotals({ totalSalesAmount: 10_000, totalCommissionDue: 500, totalPaidAmount: 300 }, { amountRiyal: 2000, commissionRiyal: 100 }),
    { totalSalesAmount: 8000, totalCommissionDue: 400, totalPaidAmount: 300, outstandingBalance: 100 },
  );
  assert.deepEqual(
    reversedNetworkTotals({ totalSalesAmount: 10_000, totalCommissionDue: 500, totalPaidAmount: 450 }, { amountRiyal: 2000, commissionRiyal: 100 }),
    { totalSalesAmount: 8000, totalCommissionDue: 400, totalPaidAmount: 450, outstandingBalance: 0 },
  );
  assert.deepEqual(
    reversedNetworkTotals({ totalSalesAmount: 100, totalCommissionDue: 5 }, { amountRiyal: 2000, commissionRiyal: 100 }),
    { totalSalesAmount: 0, totalCommissionDue: 0, totalPaidAmount: 0, outstandingBalance: 0 },
  );
  assert.deepEqual(
    reversedNetworkTotals(undefined, { amountRiyal: 1, commissionRiyal: 0 }),
    { totalSalesAmount: 0, totalCommissionDue: 0, totalPaidAmount: 0, outstandingBalance: 0 },
  );
});

test('cancelSale reads everything before writing and merges only cancellation fields', async () => {
  const original = activeSale();
  const db = new StrictDb({
    [salePath]: original,
    'networks/NET-1': { totalSalesAmount: 5000, totalCommissionDue: 250, totalPaidAmount: 100, outstandingBalance: 150, owner_uid: 'owner-1' },
  });
  const result = await cancelSale({ db, uid: 'owner-1', networkId: 'NET-1', payload: payload(), receipt: 'r-cancel', secretVersion: 3, now: NOW });
  assert.deepEqual(result, {
    status: 'cancelled', saleUuid: '7850.73', cancellationId: cancellationIdFor('7850.73'),
    reversedAmountRiyal: 2000, reversedCommissionRiyal: 100,
  });
  assert.deepEqual(db.writes.map((w) => [w.path, Boolean(w.options.merge)]), [
    [salePath, true],
    ['networks/NET-1', true],
    [`admin_audit_logs/sale_cancel_${saleDocumentId('7850.73')}`, false],
  ]);
  const sale = db.docs.get(salePath);
  for (const key of ['saleUuid', 'amountRiyal', 'commissionRiyal', 'payloadHash', 'verificationReceipt', 'createdAtMs', 'paidRiyal']) {
    assert.deepEqual(sale[key], original[key], key);
  }
  assert.equal(sale.status, 'CANCELLED');
  assert.equal(sale.cancelVerificationReceipt, 'r-cancel');
  assert.equal(sale.cancelNetworkSecretVersion, 3);
  const network = db.docs.get('networks/NET-1');
  assert.equal(network.owner_uid, 'owner-1');
  assert.deepEqual(
    [network.totalSalesAmount, network.totalCommissionDue, network.totalPaidAmount, network.outstandingBalance],
    [3000, 150, 100, 50],
  );

  const again = await cancelSale({ db, uid: 'owner-1', networkId: 'NET-1', payload: payload(), receipt: 'r2', now: NOW + 1 });
  assert.equal(again.status, 'already_cancelled');
  assert.equal(db.writes.length, 3, 'the retry writes nothing');
});

test('cancelSale: settled sale writes only the registry; missing and unknown sales write nothing', async () => {
  const db = new StrictDb({ [salePath]: activeSale({ paidRiyal: 100, settlement_status: 'SETTLED' }) });
  const settled = await cancelSale({ db, uid: 'owner-1', networkId: 'NET-1', payload: payload(), receipt: 'r', now: NOW });
  assert.equal(settled.status, 'already_settled');
  assert.deepEqual(db.writes.map((w) => w.path), [`sale_cancellation_registry/owner-1_${saleDocumentId('7850.73')}`]);

  const empty = new StrictDb();
  assert.equal((await cancelSale({ db: empty, uid: 'owner-1', networkId: 'NET-1', payload: payload(), receipt: 'r', now: NOW })).status, 'not_found');
  assert.equal(empty.writes.length, 0);

  const odd = new StrictDb({ [salePath]: activeSale({ status: 'VOID' }) });
  assert.equal((await cancelSale({ db: odd, uid: 'owner-1', networkId: 'NET-1', payload: payload(), receipt: 'r', now: NOW })).status, 'not_cancellable');
  assert.equal(odd.writes.length, 0);
});
