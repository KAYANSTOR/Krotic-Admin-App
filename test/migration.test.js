import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAccessStatus,
  computeNetworkTotals,
  computeAggregate,
  planUserMigration,
} from '../server/_lib/migration.js';
import { mergeSalesPreferCurrent, validateMigrateInput, migrateLegacySalesForUser } from '../api/migrate.js';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

test('legacy accounts are classified into the server access model', () => {
  assert.equal(classifyAccessStatus({ is_active: false, is_trial: true }, NOW), 'SUSPENDED_GRACE');
  assert.equal(classifyAccessStatus({ is_active: true, is_trial: true, subscriptionEndMs: NOW - DAY }, NOW), 'LOCKED_EXPIRED');
  assert.equal(classifyAccessStatus({ is_active: true, is_trial: true, subscriptionEndMs: NOW + DAY }, NOW), 'TRIAL');
  assert.equal(classifyAccessStatus({ is_active: true, is_trial: false, subscriptionEndMs: NOW + DAY }, NOW), 'ACTIVE_PAID');
});

test('network totals recompute commission server-side and honour payments', () => {
  const sales = [
    { status: 'COMPLETED', faceValue: 1000 }, // no server commission -> 5% = 50
    { status: 'COMPLETED', faceValue: 2000, commissionMinor: 120 }, // server snapshot wins
    { status: 'ROLLED_BACK', faceValue: 500 }, // ignored
  ];
  const payments = [{ amount: 100 }, { amount: 30 }];
  const totals = computeNetworkTotals(sales, payments, 5);
  assert.deepEqual(totals, {
    totalSalesAmount: 3000,
    totalCommissionDue: 170,
    totalPaidAmount: 130,
    outstandingBalance: 40,
  });
});

test('V2 migration prefers explicit whole-Riyal values, including zero commission', () => {
  const totals = computeNetworkTotals([{
    status: 'COMPLETED', amountMinor: 50000, amountRiyal: 500, faceValue: 500,
    moneyPolicyVersion: 2, commissionMinor: 2500, commissionRiyal: 25,
  }], [], 5);
  assert.equal(totals.totalSalesAmount, 500);
  assert.equal(totals.totalCommissionDue, 25);
  assert.equal(computeNetworkTotals([{
    status: 'COMPLETED', faceValue: 100, moneyPolicyVersion: 2,
    commissionMinor: 0, commissionRiyal: 0,
  }], [], 5).totalCommissionDue, 0);
});

test('aggregate mirrors the panel schema and never goes negative', () => {
  const aggregate = computeAggregate([
    { status: 'COMPLETED', faceValue: 100, createdAt: '2026-01-10T00:00:00.000Z' },
    { status: 'COMPLETED', faceValue: 100, createdAt: '2026-01-20T00:00:00.000Z' },
    { status: 'COMPLETED', faceValue: 50, createdAt: '2026-02-02T00:00:00.000Z' },
  ], 5);
  assert.equal(aggregate.totalFaceValue, 250);
  assert.equal(aggregate.totalTransactions, 3);
  assert.equal(aggregate.totalCommissionDue, 13); // round(5)+round(5)+round(3)
  assert.deepEqual(aggregate.monthly['2026-01'], { face: 200, count: 2 });
  assert.deepEqual(aggregate.monthly['2026-02'], { face: 50, count: 1 });
});

test('migration rebuild prefers networkId sales and adds unique legacy UID sales once', () => {
  const current = [
    { id: 'current-1', saleUuid: 'sale-1', status: 'COMPLETED', faceValue: 500 },
  ];
  const legacy = [
    { id: 'legacy-1', saleUuid: 'sale-1', status: 'COMPLETED', faceValue: 500 },
    { id: 'legacy-2', saleId: 'sale-2', status: 'COMPLETED', faceValue: 300 },
  ];
  const merged = mergeSalesPreferCurrent(current, legacy);
  assert.deepEqual(merged, [current[0], legacy[1]]);
  const aggregate = computeAggregate(merged, 5);
  assert.equal(aggregate.totalFaceValue, 800);
  assert.equal(aggregate.totalTransactions, 2);
});

test('a legacy user migration plan links the network and preserves the trial window', () => {
  const plan = planUserMigration({ uid: 'user-1', is_trial: true, is_active: true, commission_rate: 7, subscriptionEndMs: NOW + DAY }, { now: NOW });
  assert.equal(plan.accessStatus, 'TRIAL');
  assert.equal(plan.commissionRate, 7);
  assert.equal(plan.networkId, 'user-1');
  assert.equal(plan.ownerUid, 'user-1');
  assert.equal(plan.subscriptionEndsAt, NOW + DAY);
});

test('migrate input validates actions, cursor and limit', () => {
  assert.equal(validateMigrateInput({ action: 'classify-users' }).ok, true);
  assert.equal(validateMigrateInput({ action: 'classify-users', limit: 500 }).error, 'limit_invalid');
  assert.equal(validateMigrateInput({ action: 'rebuild-network' }).error, 'uid_invalid');
  assert.equal(validateMigrateInput({ action: 'rebuild-network', uid: 'user_1' }).ok, true);
  assert.equal(validateMigrateInput({ action: 'nope' }).error, 'unknown_action');
});


test('modern server access status wins over stale legacy booleans during migration', () => {
  assert.equal(classifyAccessStatus({
    accessStatus: 'SUSPENDED_GRACE',
    is_active: true,
    is_trial: true,
    subscriptionEndMs: NOW + DAY,
  }, NOW), 'SUSPENDED_GRACE');

  assert.equal(classifyAccessStatus({
    accessStatus: 'ACTIVE_PAID',
    is_active: false,
    is_trial: true,
    subscriptionEndMs: NOW + DAY,
  }, NOW), 'ACTIVE_PAID');

  assert.equal(classifyAccessStatus({
    accessStatus: 'unknown_future_status',
    is_active: true,
    is_trial: true,
    subscriptionEndMs: NOW + DAY,
  }, NOW), 'SUSPENDED_GRACE');
});

test('migration plan keeps an existing server suspension and stale expiry unchanged', () => {
  const plan = planUserMigration({
    uid: 'user-suspended',
    accessStatus: 'SUSPENDED_GRACE',
    is_active: true,
    is_trial: true,
    subscriptionEndMs: NOW + DAY,
  }, { now: NOW });

  assert.equal(plan.accessStatus, 'SUSPENDED_GRACE');
  assert.equal(plan.subscriptionEndsAt, NOW + DAY);
});

test('validateMigrateInput validates migrate-legacy-sales action and uid', () => {
  assert.equal(validateMigrateInput({ action: 'migrate-legacy-sales' }).ok, true);
  assert.equal(validateMigrateInput({ action: 'migrate-legacy-sales', uid: 'user-1' }).ok, true);
  assert.equal(validateMigrateInput({ action: 'migrate-legacy-sales', uid: 'invalid uid spaces' }).error, 'uid_invalid');
});

test('migrateLegacySalesForUser copies legacy UID sales to canonical networkId path idempotently', async () => {
  const { createFakeFirestore } = await import('./helpers/fakeFirestore.js');
  const db = createFakeFirestore({
    'users/user-1': { uid: 'user-1', networkId: 'net-canonical' },
    'networks/user-1/sales/sale-1': { saleUuid: 'uuid-1', status: 'COMPLETED', faceValue: 500 },
    'networks/user-1/sales/sale-2': { saleUuid: 'uuid-2', status: 'COMPLETED', faceValue: 300 },
    'networks/net-canonical/sales/sale-1': { saleUuid: 'uuid-1', status: 'COMPLETED', faceValue: 500 },
  });

  const res = await migrateLegacySalesForUser(db, { uid: 'user-1', actorUid: 'admin-1', now: NOW });
  assert.equal(res.status, 'migrated');
  assert.equal(res.copiedCount, 1);
  assert.equal(res.legacyCount, 2);

  // Second run copies 0 because sale-2 is now in canonical
  const repeated = await migrateLegacySalesForUser(db, { uid: 'user-1', actorUid: 'admin-1', now: NOW });
  assert.equal(repeated.status, 'migrated');
  assert.equal(repeated.copiedCount, 0);
});

