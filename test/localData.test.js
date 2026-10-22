import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDashboardReport,
  buildNetworkReport,
  mergeUsersWithNetworks,
  normalizeNotificationRow,
  readGlobalConfig,
  sortAuditDesc,
  sortSalesByCreatedDesc,
  summarizeAggregates,
  summarizeSubscriptionAlerts,
} from '../src/lib/localDb/localQueries.js';
import {
  loadLocalAuditLogs,
  loadLocalBillingHistory,
  loadLocalDashboard,
  loadLocalNotifications,
  loadLocalUsersWithBilling,
  loadLocalUserOptions,
} from '../src/lib/localDb/localData.js';
import { createMemoryDb } from './helpers/memoryDb.js';

function seedDb() {
  const db = createMemoryDb();
  const MemoryTable = db.users.constructor;
  db.audit_logs = new MemoryTable('id');
  db.notifications = new MemoryTable('id');
  db.admins = new MemoryTable('id');
  db.settings = new MemoryTable('key');
  return db;
}

test('users are merged with their network documents', () => {
  const users = mergeUsersWithNetworks(
    [{ uid: 'u1', phone: '700000000' }],
    [{ networkId: 'NET-1', owner_uid: 'u1', networkName: 'شبكة النور', phone: '711111111' }],
  );
  assert.equal(users.length, 1);
  assert.equal(users[0].networkName, 'شبكة النور');
  assert.equal(users[0].networkId, 'NET-1');
  assert.equal(users[0].phoneNumber, '711111111');
});

test('a network without a user document still appears in the list', () => {
  const users = mergeUsersWithNetworks([], [{ networkId: 'NET-2', owner_uid: 'u2', networkName: 'شبكة فقط' }]);
  assert.equal(users.length, 1);
  assert.equal(users[0].uid, 'u2');
  assert.equal(users[0].networkName, 'شبكة فقط');
});

test('aggregates are summed into the dashboard totals', () => {
  const { totals, monthlySales } = summarizeAggregates([
    { uid: 'u1', totalFaceValue: 100, totalTransactions: 2, totalCommissionDue: 10, totalPaid: 4 },
    { uid: 'u2', totalFaceValue: 50, totalTransactions: 1, totalCommissionDue: 5, totalPaid: 5 },
  ]);
  assert.equal(totals.totalFaceValue, 150);
  assert.equal(totals.totalTransactions, 3);
  assert.equal(totals.totalCommissionDue, 15);
  assert.equal(totals.totalPaid, 9);
  assert.equal(totals.totalCommissionOutstanding, 6);
  assert.equal(monthlySales.length, 6);
});

test('the dashboard report counts users and subscription alerts', () => {
  const now = Date.now();
  const report = buildDashboardReport({
    users: [
      { uid: 'u1', is_active: true, is_trial: false, subscription_end_date: now - 1000 },
      { uid: 'u2', is_active: true, is_trial: true, subscription_end_date: now + 1000 },
      { uid: 'u3', is_active: false, is_trial: false },
    ],
    aggregates: [{ uid: 'u1', totalFaceValue: 10, totalTransactions: 1, totalCommissionDue: 2, totalPaid: 1 }],
    config: { warning_days_before_expiry: 5 },
  });

  assert.equal(report.stats.totalUsers, 3);
  assert.equal(report.stats.activeUsers, 2);
  assert.equal(report.stats.blockedUsers, 1);
  assert.equal(report.stats.trialUsers, 1);
  assert.equal(report.alerts.expiredUsers, 1);
  assert.equal(report.alerts.expiringSoonUsers, 1);
  assert.equal(report.alerts.trialExpiringSoonUsers, 1);
});

test('subscription alerts ignore users without a subscription date', () => {
  const alerts = summarizeSubscriptionAlerts([{ uid: 'u1' }], {}, Date.now());
  assert.equal(alerts.expiredUsers, 0);
  assert.equal(alerts.expiringSoonUsers, 0);
});

test('the network report never invents commission and uses the server snapshot', () => {
  const report = buildNetworkReport({
    user: { uid: 'u1', networkName: 'شبكة' },
    sales: [{ status: 'COMPLETED', faceValue: 100, commissionRiyal: 5 }],
    payments: [],
    aggregate: { totalFaceValue: 100, totalTransactions: 1, totalCommissionDue: 5, totalPaid: 2 },
    defaultCommissionRate: 5,
  });
  assert.equal(report.reportedSalesValue, 100);
  assert.equal(report.commissionDue, 5);
  assert.equal(report.recordedPayments, 2);
  assert.equal(report.outstandingCommission, 3);
});

test('the global config falls back to safe defaults', async () => {
  const db = seedDb();
  const config = await readGlobalConfig(db);
  assert.equal(config.default_commission_rate, 5);
  assert.equal(config.is_app_active, true);
});

test('the global config is read from the local settings table', async () => {
  const db = seedDb();
  await db.settings.put({ key: 'global_config', default_commission_rate: 7, is_app_active: false });
  const config = await readGlobalConfig(db);
  assert.equal(config.default_commission_rate, 7);
  assert.equal(config.is_app_active, false);
  assert.equal(config.key, undefined);
});

test('the local dashboard reads users, aggregates and config in one pass', async () => {
  const db = seedDb();
  await db.users.put({ uid: 'u1', network_name: 'شبكة', updatedAtMs: 1 });
  await db.aggregates.put({ uid: 'u1', totalFaceValue: 100, totalTransactions: 1, totalCommissionDue: 5, totalPaid: 0, updatedAtMs: 1 });
  await db.settings.put({ key: 'global_config', default_commission_rate: 5, is_app_active: true });

  const report = await loadLocalDashboard(db);
  assert.equal(report.stats.totalUsers, 1);
  assert.equal(report.stats.totalSales, 100);
});

test('users with billing combine the local sales and the local aggregates', async () => {
  const db = seedDb();
  await db.users.put({ uid: 'u1', network_name: 'شبكة', networkId: 'NET-1', updatedAtMs: 1 });
  await db.sales.put({ networkId: 'NET-1', id: 's1', status: 'COMPLETED', faceValue: 200, commissionRiyal: 10, updatedAtMs: 1 });
  await db.aggregates.put({ uid: 'u1', totalFaceValue: 200, totalTransactions: 1, totalCommissionDue: 10, totalPaid: 4, updatedAtMs: 1 });

  const { users } = await loadLocalUsersWithBilling(db);
  assert.equal(users.length, 1);
  assert.equal(users[0].reportedSalesValue, 200);
  assert.equal(users[0].commissionDue, 10);
  assert.equal(users[0].outstandingCommission, 6);
});

test('audit logs are capped at the newest 200 entries', async () => {
  const db = seedDb();
  for (let index = 0; index < 250; index += 1) {
    await db.audit_logs.put({ id: `log-${index}`, action: 'TEST', createdAtMs: index });
  }
  const logs = await loadLocalAuditLogs(db, 200);
  assert.equal(logs.length, 200);
  assert.equal(logs[0].id, 'log-249');
});

test('audit logs are sorted newest first', () => {
  const logs = sortAuditDesc([
    { id: 'a', createdAtMs: 10 },
    { id: 'b', createdAtMs: 30 },
    { id: 'c', createdAtMs: 20 },
  ]);
  assert.deepEqual(logs.map((log) => log.id), ['b', 'c', 'a']);
});

test('sales are sorted newest first by their creation time', () => {
  const sales = sortSalesByCreatedDesc([
    { id: 'a', createdAtMs: 10 },
    { id: 'b', createdAtMs: 30 },
    { id: 'c', createdAt: 20 },
  ]);
  assert.deepEqual(sales.map((sale) => sale.id), ['b', 'c', 'a']);
});

test('notification rows are normalized for the history screen', () => {
  const row = normalizeNotificationRow({ id: 'n1', title: 'تنبيه', body: 'نص', sent: 3, createdAtMs: 500 });
  assert.equal(row.message, 'نص');
  assert.equal(row.sentCount, 3);
  assert.equal(row.displayTimestamp, 500);
  assert.equal(row.status, 'sent');
});

test('the local notification history reads from the local table', async () => {
  const db = seedDb();
  await db.notifications.put({ id: 'n1', title: 'أ', body: 'نص', createdAtMs: 100 });
  await db.notifications.put({ id: 'n2', title: 'ب', body: 'نص', createdAtMs: 900 });
  const list = await loadLocalNotifications(db);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, 'n2');
});

test('user options for selectors come from the local users table only', async () => {
  const db = seedDb();
  await db.users.put({ uid: 'u1', network_name: 'شبكة النور', phone: '700000000', updatedAtMs: 1 });
  await db.users.put({ uid: 'u2', updatedAtMs: 1 });

  const options = await loadLocalUserOptions(db);
  assert.equal(options.length, 2);
  const first = options.find((option) => option.uid === 'u1');
  assert.equal(first.name, 'شبكة النور');
  assert.equal(first.phone, '700000000');
  assert.equal(first.networkName, first.name);
  // بلا اسم: يبقى معرّف مختصر بدل قيمة فارغة.
  const second = options.find((option) => option.uid === 'u2');
  assert.match(second.name, /^مشترك \(/);
});

test('billing history for one network never touches rows of another network', async () => {
  const db = seedDb();
  await db.users.put({ uid: 'u1', networkId: 'NET-1', updatedAtMs: 1 });
  await db.sales.put({ networkId: 'NET-1', id: 's1', status: 'COMPLETED', faceValue: 100, createdAtMs: 10 });
  await db.sales.put({ networkId: 'NET-2', id: 's2', status: 'COMPLETED', faceValue: 999, createdAtMs: 20 });
  await db.payments.put({ networkId: 'NET-1', id: 'p1', amount: 5, updatedAtMs: 1 });
  await db.payments.put({ networkId: 'NET-2', id: 'p2', amount: 77, updatedAtMs: 1 });

  const history = await loadLocalBillingHistory(db, 'u1');
  assert.deepEqual(history.sales.map((sale) => sale.id), ['s1']);
  assert.deepEqual(history.payments.map((payment) => payment.id), ['p1']);
});
