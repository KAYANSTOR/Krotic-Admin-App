import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeOutstanding,
  PENDING_SETTLEMENT,
  SETTLED,
  PARTIAL,
  monthBounds,
  monthlySalesQuery,
  settleNetworkPayment,
} from '../server/_lib/networkLedger.js';

test('running balance is totalCommissionDue minus totalPaidAmount, never negative', () => {
  assert.equal(computeOutstanding(1000, 400), 600);
  assert.equal(computeOutstanding(1000, 1000), 0);
  assert.equal(computeOutstanding(1000, 1200), 0);
  assert.equal(computeOutstanding(undefined, 50), 0);
});

test('ledger settlement statuses are explicit', () => {
  assert.equal(PENDING_SETTLEMENT, 'PENDING_SETTLEMENT');
  assert.equal(SETTLED, 'SETTLED');
  assert.equal(PARTIAL, 'PARTIAL');
});

test('calendar month bounds use Yemen local time and a half-open interval', () => {
  const bounds = monthBounds('2026-10');
  assert.equal(bounds.start.toISOString(), '2026-09-30T21:00:00.000Z');
  assert.equal(bounds.end.toISOString(), '2026-10-31T21:00:00.000Z');
  assert.equal(monthBounds('2026-13'), null);
  assert.equal(monthBounds('2026-00'), null);
  assert.equal(monthBounds('202610'), null);
});

test('monthly sales query scopes FIFO candidates to only the selected month', () => {
  const calls = [];
  const query = {
    where(...args) { calls.push(['where', ...args]); return this; },
    orderBy(...args) { calls.push(['orderBy', ...args]); return this; },
    limit(...args) { calls.push(['limit', ...args]); return this; },
  };
  const ref = { collection(name) { calls.push(['collection', name]); return query; } };
  assert.equal(monthlySalesQuery(ref, '2026-10', 400), query);
  assert.deepEqual(calls.map((call) => call[0]), ['collection', 'where', 'where', 'orderBy', 'limit']);
  assert.equal(calls[0][1], 'sales');
  assert.deepEqual(calls[1].slice(1, 3), ['createdAt', '>=']);
  assert.deepEqual(calls[2].slice(1, 3), ['createdAt', '<']);
  assert.equal(calls[3][1], 'createdAt');
  assert.equal(calls[4][1], 400);
  assert.throws(() => monthlySalesQuery(ref, '2026-13'), /month_invalid/);
});

test('a monthly payment above the selected month balance is rejected without writes', async () => {
  const networkRef = {};
  const salesQuery = {};
  const writes = [];
  const docs = [
    { id: 'oct-sale-1', ref: { id: 'oct-sale-1' }, data: () => ({ commissionRiyal: 60, paidRiyal: 0 }) },
    { id: 'oct-sale-2', ref: { id: 'oct-sale-2' }, data: () => ({ commissionRiyal: 40, paidRiyal: 0 }) },
    { id: 'oct-sale-3', ref: { id: 'oct-sale-3' }, data: () => ({ commissionRiyal: 250, paidRiyal: 0, status: 'ROLLED_BACK' }) },
  ];
  const transaction = {
    async get(ref) {
      if (ref === networkRef) return { exists: true, data: () => ({ totalCommissionDue: 300, totalPaidAmount: 100 }) };
      return { docs };
    },
    update(...args) { writes.push(['update', ...args]); },
    set(...args) { writes.push(['set', ...args]); },
  };
  const result = await settleNetworkPayment(transaction, {
    networkRef,
    salesQuery,
    amountMinor: 101,
    settlementId: 'oct-payment-1',
    month: '2026-10',
  });
  assert.equal(result.status, 'month_balance_exceeded');
  assert.equal(result.monthlyOutstanding, 100);
  assert.equal(result.requestedAmount, 101);
  assert.deepEqual(writes, []);
});

test('settlement marks every changed sale and network with the same update cursor', async () => {
  const networkRef = {};
  const salesQuery = {};
  const now = 1_800_000_000_123;
  const writes = [];
  const docs = [{
    id: 'sale-1',
    ref: { id: 'sale-1' },
    data: () => ({ commissionMinor: 2500, paidMinor: 0, commissionRiyal: 25, paidRiyal: 0 }),
  }];
  const transaction = {
    async get(ref) {
      if (ref === networkRef) return { exists: true, data: () => ({ totalCommissionDue: 25, totalPaidAmount: 0 }) };
      return { docs };
    },
    update(...args) { writes.push(['update', ...args]); },
    set(...args) { writes.push(['set', ...args]); },
  };

  const result = await settleNetworkPayment(transaction, {
    networkRef,
    salesQuery,
    amountMinor: 20,
    settlementId: 'payment-1',
    month: '2026-10',
    now,
  });

  assert.equal(result.allocatedMinor, 20);
  assert.equal(writes[0][2].updatedAtMs, now);
  assert.equal(writes[1][2].updatedAtMs, now);
});

test('settlement reads canonical and legacy sales, deduplicates, and writes to each original sale path', async () => {
  const networkRef = { id: 'NET-1' };
  const legacyNetworkRef = { id: 'legacy-uid' };
  const currentQuery = {};
  const legacyQuery = {};
  const currentSaleRef = { path: 'networks/NET-1/sales/shared' };
  const legacyDuplicateRef = { path: 'networks/legacy-uid/sales/shared' };
  const legacySaleRef = { path: 'networks/legacy-uid/sales/legacy-only' };
  const doc = (id, ref, data) => ({ id, ref, data: () => data });
  const writes = [];
  const transaction = {
    async get(ref) {
      if (ref === networkRef) return { exists: true, data: () => ({ totalCommissionDue: 100, totalPaidAmount: 0 }) };
      if (ref === legacyNetworkRef) return { exists: true, data: () => ({ totalCommissionDue: 100, totalPaidAmount: 0 }) };
      if (ref === currentQuery) return { docs: [doc('shared', currentSaleRef, { saleUuid: 'shared-key', createdAt: new Date('2026-10-02'), commissionRiyal: 40, paidRiyal: 0 })] };
      if (ref === legacyQuery) return { docs: [
        doc('shared', legacyDuplicateRef, { saleUuid: 'shared-key', createdAt: new Date('2026-10-02'), commissionRiyal: 40, paidRiyal: 0 }),
        doc('legacy-only', legacySaleRef, { saleUuid: 'legacy-key', createdAt: new Date('2026-10-03'), commissionRiyal: 50, paidRiyal: 0 }),
      ] };
      throw new Error('unexpected transaction read');
    },
    update(...args) { writes.push(['update', ...args]); },
    set(...args) { writes.push(['set', ...args]); },
  };

  const result = await settleNetworkPayment(transaction, {
    networkRef,
    networkRefs: [networkRef, legacyNetworkRef],
    salesQueries: [currentQuery, legacyQuery],
    amountMinor: 60,
    settlementId: 'dual-path-payment',
    month: '2026-10',
    now: 1_800_000_000_123,
  });

  assert.equal(result.allocatedMinor, 60);
  assert.equal(result.settledSales, 2);
  const updatedSaleRefs = writes.filter(([kind]) => kind === 'update').map(([, ref]) => ref);
  assert.deepEqual(updatedSaleRefs, [currentSaleRef, legacySaleRef]);
  assert.equal(updatedSaleRefs.includes(legacyDuplicateRef), false);
  const networkWrites = writes.filter(([kind]) => kind === 'set').map(([, ref]) => ref);
  assert.deepEqual(networkWrites, [networkRef, legacyNetworkRef]);
});
