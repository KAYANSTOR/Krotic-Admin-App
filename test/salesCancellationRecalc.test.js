// Regression tests for owner decision O-07 rule 3 (issue #24):
// a CANCELLED sale stays visible but never counts in commission, outstanding,
// totals or settlement allocation — in the UI helpers and on the server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// Namespace imports so that, against the pre-fix code, missing helpers fail the
// individual tests (red) instead of failing the whole file at link time.
import * as commission from '../src/lib/commission.js';
import * as breakdown from '../src/lib/users/monthlyBreakdown.js';
import * as localQueries from '../src/lib/localDb/localQueries.js';
import { saleStatusMeta } from '../src/lib/dashboard/helpers.js';
import * as ledger from '../server/_lib/settlementLedger.js';
import { settleNetworkPayment } from '../server/_lib/networkLedger.js';
import { computeNetworkTotals, computeAggregate } from '../server/_lib/migration.js';

const {
  isCompletedSale, isCancelledSale, saleOutstanding, sumCommission, sumOutstanding,
  sumVerifiedCommission, sumVerifiedOutstanding, sumLegacyUnverifiedSales,
  hasUnverifiedCommission, summarizeCompletedSales, summarizeSalesWithVerification,
} = commission;
const { buildMonthlyBreakdown, createEmptyMonthBucket } = breakdown;
const { buildNetworkReport, buildDashboardReport, reconcileAggregateWithCancellations } = localQueries;
const { isCountableSale, saleOutstanding: serverSaleOutstanding, outstandingBalance, allocateFifo } = ledger;

const verified = {
  source: 'admin_api',
  verified: true,
  payloadHash: 'b'.repeat(64),
  verificationReceipt: '1762560000000.abcdef12',
  payloadPolicyVersion: 2,
  moneyPolicyVersion: 2,
};

const completedSale = (overrides = {}) => ({
  ...verified,
  id: 'sale-ok',
  status: 'COMPLETED',
  settlement_status: 'PENDING_SETTLEMENT',
  createdAt: new Date('2026-10-12T12:00:00.000Z'),
  faceValue: 100,
  amountRiyal: 100,
  commissionRiyal: 10,
  paidRiyal: 0,
  ...overrides,
});

// Exactly what POST /api/sales/cancel leaves on the document: the original
// commission fields stay unchanged, plus the cancellation fields.
const cancelledSale = (overrides = {}) => completedSale({
  id: 'sale-cancelled',
  status: 'CANCELLED',
  settlement_status: 'CANCELLED',
  cancelledAtMs: 1762560000000,
  cancelReason: 'device_reversal',
  cancelledAmountRiyal: 500,
  cancelledCommissionRiyal: 50,
  faceValue: 500,
  amountRiyal: 500,
  commissionRiyal: 50,
  ...overrides,
});

test('shared predicate: CANCELLED is never a completed/countable sale (UI and server agree)', () => {
  for (const sale of [cancelledSale(), { status: 'CANCELLED' }, { settlement_status: 'CANCELLED' }, { status: 'COMPLETED', settlement_status: 'CANCELLED' }]) {
    assert.equal(isCancelledSale(sale), true);
    assert.equal(isCompletedSale(sale), false);
    assert.equal(isCountableSale(sale), false);
  }
  for (const sale of [completedSale(), { commissionRiyal: 3 }]) {
    assert.equal(isCompletedSale(sale), true);
    assert.equal(isCountableSale(sale), true);
  }
});

test('UI commission helpers exclude a cancelled sale from commission due and outstanding', () => {
  const sales = [completedSale(), cancelledSale()];
  assert.equal(saleOutstanding(cancelledSale()), 0);
  assert.equal(sumCommission(sales), 10);
  assert.equal(sumOutstanding(sales), 10);
  assert.equal(sumVerifiedCommission(sales), 10);
  assert.equal(sumVerifiedOutstanding(sales), 10);
  assert.equal(sumLegacyUnverifiedSales([{ faceValue: 70, status: 'CANCELLED' }]), 0);
  assert.equal(hasUnverifiedCommission([{ faceValue: 70, status: 'CANCELLED' }]), false);
});

test('shared summaries count only completed sales and expose cancelled counters separately', () => {
  const sales = [completedSale(), cancelledSale()];
  const summary = summarizeCompletedSales(sales);
  assert.equal(summary.reportedSalesValue, 100);
  assert.equal(summary.reportedTransactions, 1);
  assert.equal(summary.commissionDue, 10);
  assert.equal(summary.outstandingCommission, 10);
  assert.equal(summary.cancelledTransactions, 1);
  assert.equal(summary.cancelledSalesValue, 500);
  assert.equal(summary.cancelledCommission, 50);

  const withVerification = summarizeSalesWithVerification(sales);
  assert.equal(withVerification.verifiedTransactions, 1);
  assert.equal(withVerification.verifiedCommissionDue, 10);
  assert.equal(withVerification.verifiedOutstandingCommission, 10);
  assert.equal(withVerification.cancelledTransactions, 1);
});

test('monthly breakdown excludes a cancelled sale from commission and shows it in cancelled counters', () => {
  const months = buildMonthlyBreakdown([completedSale(), cancelledSale()], [], ['2026-10']);
  const october = months.find((month) => month.month === '2026-10');
  assert.ok(october);
  assert.equal(october.sales.length, 2, 'the cancelled sale stays visible in the month list');
  assert.equal(october.totalSales, 100);
  assert.equal(october.verifiedCount, 1);
  assert.equal(october.verifiedSalesTotal, 100);
  assert.equal(october.verifiedCommissionDue, 10);
  assert.equal(october.commissionDue, 10);
  assert.equal(october.verifiedOutstanding, 10);
  assert.equal(october.outstanding, 10);
  assert.equal(october.legacyCount, 0);
  assert.equal(october.cancelledCount, 1);
  assert.equal(october.cancelledSalesTotal, 500);
  assert.equal(october.cancelledCommission, 50);
});

test('monthly breakdown does not count rolled-back or pending sales either (status filter bug)', () => {
  const months = buildMonthlyBreakdown([
    completedSale(),
    completedSale({ id: 'rb', status: 'ROLLED_BACK', commissionRiyal: 90, faceValue: 900 }),
    completedSale({ id: 'sms', status: 'SMS_PENDING', commissionRiyal: 70, faceValue: 700 }),
  ], [], []);
  const [october] = months;
  assert.equal(october.totalSales, 100);
  assert.equal(october.commissionDue, 10);
  assert.equal(october.outstanding, 10);
  assert.equal(october.excludedCount, 2);
  assert.equal(october.cancelledCount, 0);
});

test('a month whose only sale was cancelled has zero commission due', () => {
  const [october] = buildMonthlyBreakdown([cancelledSale()], [], []);
  assert.equal(october.commissionDue, 0);
  assert.equal(october.outstanding, 0);
  assert.equal(october.totalSales, 0);
  assert.equal(october.cancelledCount, 1);
  const empty = createEmptyMonthBucket('2026-11');
  assert.equal(empty.cancelledCount, 0);
  assert.equal(empty.cancelledSalesTotal, 0);
});

test('local network/dashboard report ignores cancelled sales, including its monthly chart', () => {
  const report = buildNetworkReport({
    user: { uid: 'u1', networkId: 'n1' },
    sales: [completedSale(), cancelledSale()],
    payments: [],
    // A stale server aggregate built before the cancellation must not leak back.
    aggregate: { totalFaceValue: 600, totalTransactions: 2, totalCommissionDue: 60, monthly: { '2026-10': { face: 600, count: 2 } } },
    preferAggregateSales: false,
  });
  assert.equal(report.reportedSalesValue, 100);
  assert.equal(report.reportedTransactions, 1);
  assert.equal(report.commissionDue, 10);
  assert.equal(report.outstandingCommission, 10);
  assert.equal(report.cancelledTransactions, 1);
  assert.deepEqual(report.monthly, { '2026-10': { face: 100, count: 1 } });

  const dashboard = buildDashboardReport({
    users: [{ uid: 'u1', networkId: 'n1' }],
    aggregates: [],
    salesRows: [{ ...completedSale(), networkId: 'n1' }, { ...cancelledSale(), networkId: 'n1' }],
    paymentRows: [],
    config: {},
  });
  assert.equal(dashboard.stats.totalCommissionOutstanding, 10);
  assert.equal(dashboard.stats.totalSales, 100);
});

test('users-page report removes a sale cancelled after the last server aggregate rebuild', () => {
  const builtAtMs = Date.parse('2026-10-20T00:00:00.000Z');
  const aggregate = {
    updatedAtMs: builtAtMs,
    totalFaceValue: 600,
    totalTransactions: 2,
    totalCommissionDue: 60,
    totalPaid: 0,
    monthly: { '2026-10': { face: 600, count: 2 } },
  };
  const cancelledAfterRebuild = cancelledSale({ cancelReceivedAtMs: builtAtMs + 1000 });
  const report = buildNetworkReport({
    user: { uid: 'u1', networkId: 'n1' },
    sales: [completedSale(), cancelledAfterRebuild],
    payments: [],
    aggregate,
  });
  assert.equal(report.reportedSalesValue, 100);
  assert.equal(report.reportedTransactions, 1);
  assert.equal(report.commissionDue, 10);
  assert.equal(report.outstandingCommission, 10);
  assert.deepEqual(report.monthly, { '2026-10': { face: 100, count: 1 } });

  // A rebuild after the cancellation already excludes it: nothing is subtracted twice.
  const rebuilt = { ...aggregate, updatedAtMs: builtAtMs + 5000, totalFaceValue: 100, totalTransactions: 1, totalCommissionDue: 10 };
  assert.equal(reconcileAggregateWithCancellations(rebuilt, [cancelledAfterRebuild]), rebuilt);
});

test('server settlement ledger: cancelled sale has zero outstanding and is skipped by FIFO allocation', () => {
  assert.equal(serverSaleOutstanding(cancelledSale()), 0);
  assert.equal(outstandingBalance([completedSale(), cancelledSale()]), 10);
  const allocation = allocateFifo([cancelledSale({ id: 'c1' }), completedSale({ id: 's1' })], 30);
  assert.deepEqual(allocation.allocations.map((entry) => entry.id), ['s1']);
  assert.equal(allocation.allocations[0].appliedMinor, 10);
  assert.equal(allocation.remainingMinor, 20);
});

test('server monthly settlement never writes to or counts a cancelled sale', async () => {
  const networkRef = {};
  const writes = [];
  const docs = [
    { id: 'c1', ref: { id: 'c1' }, data: () => ({ ...cancelledSale(), id: undefined }) },
    { id: 's1', ref: { id: 's1' }, data: () => ({ ...completedSale(), id: undefined }) },
  ];
  const transaction = {
    async get(ref) {
      if (ref === networkRef) return { exists: true, data: () => ({ totalCommissionDue: 10, totalPaidAmount: 0 }) };
      return { docs };
    },
    update(...args) { writes.push(['update', ...args]); },
    set(...args) { writes.push(['set', ...args]); },
  };
  const exceeded = await settleNetworkPayment(transaction, {
    networkRef, salesQuery: {}, amountMinor: 11, settlementId: 'p0', month: '2026-10',
  });
  assert.equal(exceeded.status, 'month_balance_exceeded');
  assert.equal(exceeded.monthlyOutstanding, 10);

  await settleNetworkPayment(transaction, {
    networkRef, salesQuery: {}, amountMinor: 10, settlementId: 'p1', month: '2026-10',
  });
  const updatedSaleIds = writes.filter(([kind]) => kind === 'update').map(([, ref]) => ref.id);
  assert.deepEqual(updatedSaleIds, ['s1']);
});

test('server rebuild of network totals and aggregates excludes cancelled sales', () => {
  const sales = [completedSale(), cancelledSale(), { settlement_status: 'CANCELLED', faceValue: 40, commissionRiyal: 4 }];
  const totals = computeNetworkTotals(sales, [], 5);
  assert.equal(totals.totalSalesAmount, 100);
  assert.equal(totals.totalCommissionDue, 10);
  const aggregate = computeAggregate(sales, 5);
  assert.equal(aggregate.totalTransactions, 1);
  assert.equal(aggregate.totalCommissionDue, 10);
});

test('cancelled status has an Arabic label in the dashboard and the sales screen', () => {
  assert.equal(saleStatusMeta('CANCELLED').label, 'ملغى');
  assert.equal(saleStatusMeta('CANCELLED').tone, 'danger');
  // src/lib/sales/constants.js uses Vite extensionless imports, so it is checked as source.
  const constants = readFileSync(new URL('../src/lib/sales/constants.js', import.meta.url), 'utf8');
  assert.match(constants, /CANCELLED:\s*\{\s*text:\s*'ملغى'/);
  assert.match(constants, /\{ value: 'CANCELLED', label: 'ملغى' \}/);
  const saleRow = readFileSync(new URL('../src/components/sales/SaleRow.jsx', import.meta.url), 'utf8');
  assert.match(saleRow, /isCancelledSale\(sale\)/);
  const monthCard = readFileSync(new URL('../src/components/userProfile/MonthCard.jsx', import.meta.url), 'utf8');
  assert.match(monthCard, /m\.cancelledCount/);
});
