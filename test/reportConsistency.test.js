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
  const [data, queries] = await Promise.all([
    read('src/lib/localDb/localData.js'),
    read('src/lib/localDb/localQueries.js'),
  ]);
  // يُعاد حساب السجل من الصفوف المحلية كاملة، مع ضم مسار UID القديم للشبكة
  // canonical حتى لا تُفقد المبيعات القديمة بعد ترحيل networkId.
  assert.match(data, /export async function loadLocalBillingHistory/);
  assert.match(data, /sortSalesByCreatedDesc\(salesForNetwork\(salesRows, networkId, uid\)\)/);
  assert.match(data, /salesForNetwork\(salesRows, networkId, user\.uid\)/);
  assert.match(queries, /export function salesForNetwork\(salesRows, networkId, legacyNetworkId = null\)/);
  assert.match(queries, /mergeCanonicalFirst\(currentRows, legacyRows, saleIdentityKeys\)/);
  assert.doesNotMatch(data, /incrementa|sinceMs|cursor/i);
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

test('no force reads remain outside the incremental sync engine', async () => {
  const [sync, core, data] = await Promise.all([
    read('src/lib/localDb/syncEngine.js'),
    read('src/lib/localDb/syncCore.js'),
    read('src/lib/localDb/localData.js'),
  ]);
  // القراءة الكاملة صارت مزامنة تزايدية بمؤشر updatedAtMs داخل syncEngine فقط.
  assert.match(sync, /where\('updatedAtMs', '>=', cursorMs\)/);
  assert.match(core, /await localDb\.sync_state\.put\(\{ key: src\.key, cursorMs: nextCursor/);
  assert.match(sync, /export async function resetSyncCursors/);
  // طبقة القراءة المحلية لا تتحدث إلى Firestore إطلاقاً.
  assert.doesNotMatch(data, /firebase\/firestore|getDocsFromServer|getDocFromServer/);
  // الملف القديم الذي كان يفرض قراءات قسرية أُزيل بالكامل.
  await assert.rejects(() => read('src/lib/adminData.js'));
});

test('user billing totals stream the real payment ledger, not inferred sale allocations', async () => {
  const [queries, users] = await Promise.all([
    read('src/lib/localDb/localQueries.js'),
    read('src/pages/UsersPage.jsx'),
  ]);
  // المبالغ تأتي من ملخص الخادم (admin_aggregates) لا من استنتاج دفعات من المبيعات.
  assert.match(queries, /const recordedPayments = Number\(aggregateData\.totalPaid\)/);
  assert.match(queries, /outstandingCommission: Math\.max\(0, due - recordedPayments\)/);
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
