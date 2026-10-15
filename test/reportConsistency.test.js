import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('dashboard and customer cards use the shared completed-sales commission definition', async () => {
  const [dashboard, users, profile, commission] = await Promise.all([
    read('src/pages/DashboardPage.jsx'),
    read('src/pages/UsersPage.jsx'),
    read('src/pages/UserProfilePage.jsx'),
    read('src/lib/commission.js'),
  ]);
  assert.match(dashboard, /summarizeCompletedSales\(sales\)/);
  assert.match(dashboard, /totalCommissionOutstanding \+= summary\.outstandingCommission/);
  assert.match(users, /summarizeCompletedSales\(network\.sales \|\| \[\]\)/);
  assert.match(profile, /const outstanding = sumOutstanding\(sales\)/);
  assert.match(commission, /sale\?\.status === 'COMPLETED'/);
});

test('sales history is not silently restricted to the current month by default', async () => {
  const sales = await read('src/pages/SalesPage.jsx');
  assert.match(sales, /krotak:sales-filters:v4/);
  assert.match(sales, /useState\(savedFilters \? savedFilters\.dateFrom : ''\)/);
  assert.match(sales, /useState\(savedFilters \? savedFilters\.dateTo : ''\)/);
  assert.match(sales, /label: 'هذا الشهر'/);
});

test('customer history refresh cannot miss late offline sales with older createdAt', async () => {
  const data = await read('src/lib/adminData.js');
  assert.match(data, /Offline sales may arrive after a newer sale while carrying an older/);
  assert.doesNotMatch(data, /incrementalSales/);
  assert.match(data, /const sales = incomingSales/);
});

test('live sales report metadata indicates when initial network snapshots are incomplete', async () => {
  const [data, sales, users] = await Promise.all([
    read('src/lib/adminData.js'),
    read('src/pages/SalesPage.jsx'),
    read('src/pages/UsersPage.jsx'),
  ]);
  assert.match(data, /initialSnapshotsCount/);
  assert.match(data, /ready, expectedCount, initialSnapshotsCount/);
  assert.match(sales, /!realtimeReady/);
  assert.match(users, /!liveSalesReady/);
});

test('aggregate triggers resolve the owner UID instead of confusing it with networkId', async () => {
  const source = await read('functions/index.js');
  assert.match(source, /networks\/\{networkId\}\/sales/);
  assert.match(source, /networks\/\{networkId\}\/payments/);
  assert.match(source, /resolveAggregateOwnerUid\(event\.params\.networkId\)/);
  assert.match(source, /uid: ownerUid/);
});

test('forced refresh bypasses Firestore local cache for current reports', async () => {
  const data = await read('src/lib/adminData.js');
  assert.match(data, /force \? await getDocsFromServer\(usersRef\) : await getDocs\(usersRef\)/);
  assert.match(data, /force \? await getDocFromServer\(aggregateRef\) : await getDoc\(aggregateRef\)/);
  assert.match(data, /force \? getDocsFromServer\(firestoreQuery\) : getDocs\(firestoreQuery\)/);
  assert.match(data, /force \? await getDocFromServer\(configRef\) : await getDoc\(configRef\)/);
});

test('user billing totals stream the real payment ledger, not inferred sale allocations', async () => {
  const [data, users] = await Promise.all([
    read('src/lib/adminData.js'),
    read('src/pages/UsersPage.jsx'),
  ]);
  assert.match(data, /includePaymentTotals = false/);
  assert.match(data, /recordedPayments: includePaymentTotals \? \(paymentTotalsByUid\.get\(uid\) \|\| 0\) : undefined/);
  assert.match(users, /\{ includePaymentTotals: true \}/);
  assert.match(users, /recordedPayments: Number\(network\.recordedPayments\) \|\| 0/);
});
