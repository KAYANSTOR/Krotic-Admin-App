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
  assert.match(users, /b\.verifiedOutstandingCommission \?\? b\.outstandingCommission \?\? 0/);
  assert.match(profile, /const outstanding = sumOutstanding\(sales\)/);
  assert.match(commission, /sale\.status === 'COMPLETED'/);
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

test('live sales report metadata indicates when the local snapshot is still loading', async () => {
  const [sales, users, sync] = await Promise.all([
    read('src/pages/SalesPage.jsx'),
    read('src/pages/UsersPage.jsx'),
    read('src/lib/localDb/syncEngine.js'),
  ]);
  // بعد الترحيل: الجاهزية تأتي من القاعدة المحلية لا من مستمعات Firestore.
  assert.match(sales, /const realtimeReady = !salesQuery\.loading/);
  assert.match(sales, /!realtimeReady/);
  // القائمة تُعلن فشل القراءة المحلية بدل أخطاء تحميل المجاميع الحيّة.
  assert.match(users, /partialErrors/);
  assert.match(users, /usersQuery\.error/);
  // المزامنة تنزّل كل التغييرات على صفحات (لا لقطات كاملة غير محدودة).
  assert.match(sync, /const PAGE_SIZE = \d+/);
  assert.match(sync, /where\('updatedAtMs', '>=', cursorMs\)/);
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
  assert.match(data, /trackRead\('users:canonical',\s*\(\)\s*=>\s*\(force \? getDocsFromServer\(usersRef\) : getDocs\(usersRef\)\)\)/);
  assert.match(data, /trackRead\(`aggregate:summary:\$\{uid\}`,\s*\(\)\s*=>\s*\(force \? getDocFromServer\(aggregateRef\) : getDoc\(aggregateRef\)\)\)/);
  assert.match(data, /trackRead\(label,\s*\(\)\s*=>\s*\(force\s*\?\s*getDocsFromServer\(firestoreQuery\)\s*:\s*getDocs\(firestoreQuery\)\)\)/);
  assert.match(data, /trackRead\('config:global',\s*\(\)\s*=>\s*\(force \? getDocFromServer\(configRef\) : getDoc\(configRef\)\)\)/);
});

test('user billing totals stream the real payment ledger, not inferred sale allocations', async () => {
  const [data, users] = await Promise.all([
    read('src/lib/adminData.js'),
    read('src/pages/UsersPage.jsx'),
  ]);
  // The billing figures come from the server aggregate snapshot (recordedPayments
  // and outstandingCommission), never from inferring payments from sales.
  assert.match(data, /const recordedPayments = Number\(aggregate\.totalPaid\) \|\| 0/);
  assert.match(data, /outstandingCommission: Math\.max\(0, commissionDue - recordedPayments\)/);
  assert.match(data, /recordedPayments: previous\.recordedPayments \?\? 0/);
  assert.match(users, /billing\.verifiedOutstandingCommission \?\? 0/);
  assert.match(users, /billing\.reportedSalesValue \|\| 0/);
});

test('row action buttons remain visible and usable on phone-sized screens', async () => {
  const [css, profile, users] = await Promise.all([
    read('src/index.css'),
    read('src/pages/UserProfilePage.jsx'),
    read('src/pages/UsersPage.jsx'),
  ]);
  assert.match(css, /\.row-action\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.row-action\s*\{[^}]*background:\s*var\(--ui-surface\)/);
  assert.match(css, /\.row-action--danger\s*\{[^}]*background:\s*var\(--ui-danger-soft\)/);
  assert.match(css, /\.row-action--success\s*\{[^}]*background:\s*var\(--ui-success-soft\)/);
  assert.match(css, /\.row-action:focus-visible/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.row-action \{ min-height: 48px/);
  assert.match(profile, /aria-label=\{user\.is_active === false \? 'إلغاء حظر المستخدم' : 'حظر المستخدم'\}/);
  assert.match(users, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
});


test('phone reports stay visible during refresh while the local snapshot loads', async () => {
  const [dashboard, sales, users] = await Promise.all([
    read('src/pages/DashboardPage.jsx'),
    read('src/pages/SalesPage.jsx'),
    read('src/pages/UsersPage.jsx'),
  ]);
  assert.match(dashboard, /if \(loading && !stats\)/);
  assert.match(sales, /if \(loading && networkSales\.length === 0\)/);
  // القائمة تُعرض من القاعدة المحلية مباشرة، فلا تنتظر أي fan-out على الشبكة.
  assert.match(users, /loadLocalUsersWithBilling\(localDb\)/);
  assert.match(users, /const loading = usersQuery\.loading && !hasLoadedUsers\.current/);
  assert.match(users, /if \(loading && users\.length === 0\)/);
});
