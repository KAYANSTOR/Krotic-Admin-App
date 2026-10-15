import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAccessStatus,
  computeNetworkTotals,
  computeAggregate,
  planUserMigration,
  isLegacyCommissionCandidate,
  saleCommissionMinor,
} from '../api/_lib/migration.js';
import { reconcileLegacyCommissionData, validateMigrateInput } from '../api/migrate.js';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

class FakeDocRef {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split('/').at(-1); }
  collection(name) { return new FakeCollection(this.db, `${this.path}/${name}`); }
  async get() {
    const value = this.db.docs.get(this.path);
    return { exists: value !== undefined, id: this.id, ref: this, data: () => value };
  }
  async set(value, options = {}) {
    const old = this.db.docs.get(this.path) || {};
    this.db.docs.set(this.path, options.merge ? { ...old, ...value } : value);
  }
}

class FakeQuery {
  constructor(db, path, pageLimit = Infinity, afterId = '') {
    this.db = db; this.path = path; this.pageLimit = pageLimit; this.afterId = afterId;
  }
  orderBy() { return this; }
  limit(value) { return new FakeQuery(this.db, this.path, value, this.afterId); }
  startAfter(last) { return new FakeQuery(this.db, this.path, this.pageLimit, last.id); }
  async get() {
    const prefix = `${this.path}/`;
    const docs = [...this.db.docs.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map(([path, value]) => ({ id: path.slice(prefix.length), ref: new FakeDocRef(this.db, path), data: () => value }))
      .filter((doc) => doc.id > this.afterId)
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, this.pageLimit);
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}

class FakeCollection extends FakeQuery {
  doc(id) { return new FakeDocRef(this.db, `${this.path}/${id}`); }
  async add(value) {
    const ref = this.doc(`auto-${this.db.nextId++}`);
    this.db.docs.set(ref.path, value);
    return ref;
  }
}

class FakeFirestore {
  constructor() { this.docs = new Map(); this.nextId = 1; }
  collection(name) { return new FakeCollection(this, name); }
  batch() {
    const writes = [];
    return {
      update: (ref, value) => writes.push({ ref, value, merge: true }),
      set: (ref, value, options = {}) => writes.push({ ref, value, merge: options.merge }),
      async commit() {
        for (const { ref, value, merge } of writes) {
          const old = ref.db.docs.get(ref.path) || {};
          ref.db.docs.set(ref.path, merge ? { ...old, ...value } : value);
        }
      },
    };
  }
}

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

test('legacy Android sales are eligible for actual server commission reconciliation at the current rate', () => {
  const sale = {
    source: 'krotak_app', status: 'COMPLETED', faceValue: 2000,
    commission: 0, commissionAmount: 0,
  };
  assert.equal(isLegacyCommissionCandidate(sale), true);
  assert.equal(saleCommissionMinor(sale, 7), 140);
  assert.equal(saleCommissionMinor(sale, 5), 100);
});

test('reconciliation never replaces an explicit server zero, positive legacy commission, or modern sale', () => {
  assert.equal(isLegacyCommissionCandidate({
    source: 'krotak_app', status: 'COMPLETED', faceValue: 100,
    commissionRiyal: 0, commission: 0,
  }), false);
  assert.equal(isLegacyCommissionCandidate({
    source: 'krotak_app', status: 'COMPLETED', faceValue: 100,
    commission: 5,
  }), false);
  assert.equal(isLegacyCommissionCandidate({
    source: 'krotak_app', status: 'COMPLETED', faceValue: 100,
    moneyPolicyVersion: 2, commission: 0,
  }), false);
});

test('legacy commission reconciliation writes current-rate snapshots and rebuilds network totals', async () => {
  const db = new FakeFirestore();
  db.docs.set('users/client-1', { networkId: 'NET-10001', commission_rate: 7 });
  db.docs.set('networks/NET-10001/sales/old-sale', {
    source: 'krotak_app', status: 'COMPLETED', faceValue: 2000,
    commission: 0, commissionAmount: 0, created_at: new Date('2026-10-02T12:00:00.000Z'),
  });
  db.docs.set('networks/NET-10001/sales/new-sale', {
    source: 'admin_api', status: 'COMPLETED', faceValue: 500,
    commissionRiyal: 25, commissionRateBps: 500, moneyPolicyVersion: 2,
    createdAt: new Date('2026-10-03T12:00:00.000Z'),
  });
  db.docs.set('networks/NET-10001/sales/rolled-back', {
    source: 'krotak_app', status: 'ROLLED_BACK', faceValue: 900, commission: 0,
  });
  db.docs.set('networks/NET-10001/payments/pay-1', { amount: 40 });

  const result = await reconcileLegacyCommissionData(db, {
    uid: 'client-1', actorUid: 'admin-1', now: NOW, globalCommissionRate: 5,
  });

  assert.equal(result.status, 'reconciled');
  assert.equal(result.updatedCount, 1);
  assert.equal(result.commissionRatePercent, 7);
  const oldSale = db.docs.get('networks/NET-10001/sales/old-sale');
  assert.equal(oldSale.commissionRiyal, 140);
  assert.equal(oldSale.commissionRateBps, 700);
  assert.equal(oldSale.commissionReconciliationSource, 'admin_legacy_backfill');
  assert.equal(db.docs.get('networks/NET-10001/sales/new-sale').commissionRiyal, 25);
  assert.equal(db.docs.get('networks/NET-10001').totalSalesAmount, 2500);
  assert.equal(db.docs.get('networks/NET-10001').totalCommissionDue, 165);
  assert.equal(db.docs.get('networks/NET-10001').outstandingBalance, 125);
  assert.equal(db.docs.get('admin_aggregates/client-1').totalCommissionDue, 165);
  assert.deepEqual(db.docs.get('admin_aggregates/client-1').monthly['2026-10'], { face: 2500, count: 2 });
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
  assert.equal(validateMigrateInput({ action: 'reconcile-legacy-commissions' }).error, 'uid_invalid');
  assert.equal(validateMigrateInput({ action: 'reconcile-legacy-commissions', uid: 'user_1' }).ok, true);
  assert.equal(validateMigrateInput({ action: 'preview-legacy-commissions', uid: 'user_1' }).error, 'unknown_action');
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
