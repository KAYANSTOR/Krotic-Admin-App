import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAccessStatus,
  computeNetworkTotals,
  computeAggregate,
  planUserMigration,
} from '../api/_lib/migration.js';
import { validateMigrateInput } from '../api/migrate.js';

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
