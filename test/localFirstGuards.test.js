import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * حرّاس المعمارية «المحلية أولًا»: تمنع رجوع القراءة الكاملة من Firestore
 * إلى الشاشات. أي استثناء مسموح مذكور صريحًا هنا مع سببه.
 */

const SRC = new URL('../src/', import.meta.url);

async function listSourceFiles(dir = SRC) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) files.push(...await listSourceFiles(target));
    else if (/\.(js|jsx)$/.test(entry.name)) files.push(target);
  }
  return files;
}

const read = (url) => readFile(url, 'utf8');

test('no screen imports the removed legacy Firestore read layer', async () => {
  const files = await listSourceFiles();
  const offenders = [];
  for (const file of files) {
    const source = await read(file);
    if (/from\s+['"][^'"]*lib\/adminData['"]/.test(source)) offenders.push(file.pathname);
    if (/from\s+['"][^'"]*adminDataCache['"]/.test(source)) offenders.push(file.pathname);
  }
  assert.deepEqual(offenders, []);
});

test('local-first screens read through useLocalQuery, not Firestore', async () => {
  const screens = [
    'pages/AdminsPage.jsx',
    'pages/AuditPage.jsx',
    'pages/DashboardPage.jsx',
    'pages/NotificationsPage.jsx',
    'pages/PaidFeaturesPage.jsx',
    'pages/SalesPage.jsx',
    'pages/SettingsPage.jsx',
    'pages/UserProfilePage.jsx',
    'pages/UsersPage.jsx',
    'components/UserBillingModal.jsx',
  ];
  for (const screen of screens) {
    const source = await read(new URL(screen, SRC));
    assert.match(source, /useLocalQuery/, `${screen} must read from the local DB`);
    assert.doesNotMatch(source, /getDocsFromServer|getDocFromServer|getAggregateFromServer/, screen);
  }
});

test('the only remaining Firestore listener is the newest-user probe with limit(1)', async () => {
  const files = await listSourceFiles();
  const listeners = [];
  for (const file of files) {
    const source = await read(file);
    if (source.includes('onSnapshot(') && !source.includes('syncEngine.js')) listeners.push(file.pathname);
  }
  assert.equal(listeners.length, 1, 'expected a single listener file');
  assert.match(listeners[0], /Layout\.jsx$/);

  const layout = await read(new URL('components/Layout.jsx', SRC));
  assert.match(layout, /limit\(1\)/);
  assert.doesNotMatch(layout, /collection\(db, 'users'\)\s*\)/);
});

test('full-collection getDocs stays inside the sync engine (documented debt only)', async () => {
  const files = await listSourceFiles();
  const offenders = [];
  for (const file of files) {
    const source = await read(file);
    if (!source.includes('getDocs(')) continue;
    if (file.pathname.endsWith('/localDb/syncEngine.js')) continue;
    // دين تقني موثّق: حذف شبكة من العميل، ولوحة أجهزة مستخدم واحد.
    if (file.pathname.endsWith('/lib/adminApi.js')) continue;
    if (file.pathname.endsWith('/components/UserDevicesPanel.jsx')) continue;
    offenders.push(file.pathname);
  }
  assert.deepEqual(offenders, []);
});

test('no data cache is kept in localStorage anymore', async () => {
  const files = await listSourceFiles();
  const offenders = [];
  for (const file of files) {
    const source = await read(file);
    if (!source.includes('localStorage')) continue;
    if (/ADMIN_DATA_CACHE|adminDataCache|krotak:admin-data/.test(source)) offenders.push(file.pathname);
  }
  assert.deepEqual(offenders, []);
});

test('administrative access changes and account deletion happen on the server only', async () => {
  const api = await read(new URL('lib/adminApi.js', SRC));
  // لا fallback من المتصفح: لا updateDoc ولا deleteDoc على مستخدم/شبكة.
  assert.doesNotMatch(api, /updateDoc\(/);
  assert.doesNotMatch(api, /deleteDoc\(/);
  assert.doesNotMatch(api, /firebase\/firestore/);
  // المسارات الخادمية المطلوبة موجودة.
  assert.match(api, /action: 'update-access'/);
  assert.match(api, /action: 'delete'/);
});

test('client-written audit logs carry the sync timestamp', async () => {
  const audit = await read(new URL('lib/auditLog.js', SRC));
  // بدون updatedAtMs لا يظهر الحدث في سجل العمليات المحلي أبدًا.
  assert.match(audit, /updatedAtMs: now/);
});

test('the updatedAtMs backfill covers every collection the sync engine reads', async () => {
  const sync = await read(new URL('lib/localDb/syncEngine.js', SRC));
  const backfill = await read(new URL('../scripts/backfill-updated-at.mjs', import.meta.url));
  const collections = new Set([
    ...[...sync.matchAll(/collection\(firestore, '([^']+)'\)/g)].map((match) => match[1]),
    ...[...sync.matchAll(/collectionGroup\(firestore, '([^']+)'\)/g)].map((match) => match[1]),
  ]);
  // الشواهد يُنشئها الخادم دائمًا مع updatedAtMs، وليست بيانات قديمة تحتاج ترحيلًا.
  collections.delete('sync_tombstones');
  assert.ok(collections.size >= 8);
  for (const name of collections) {
    assert.ok(backfill.includes(`'${name}'`), `backfill-updated-at.mjs is missing ${name}`);
  }
});

test('settings exposes a confirmed full-sync action that resets cursors', async () => {
  const settings = await read(new URL('pages/SettingsPage.jsx', SRC));
  assert.match(settings, /resetSyncCursors\(localDb\)/);
  assert.match(settings, /await runSync\(\{ reason: 'manual' \}\)/);
  assert.match(settings, /requireText="تأكيد"/);
});

test('notification history deletion stays on the server', async () => {
  const page = await read(new URL('pages/NotificationsPage.jsx', SRC));
  // Firestore rules set `allow write: if false` on notification_deliveries.
  assert.doesNotMatch(page, /deleteDoc\(/);
  assert.match(page, /fetch\('\/api\/send-fcm'/);
  assert.match(page, /action: 'delete'/);
});

test('collection-group sync queries have the indexes they need', async () => {
  const raw = await read(new URL('../firestore.indexes.json', import.meta.url));
  const indexes = JSON.parse(raw);
  const overrides = indexes.fieldOverrides || [];
  for (const group of ['sales', 'payments']) {
    const override = overrides.find((entry) => entry.collectionGroup === group && entry.fieldPath === 'updatedAtMs');
    assert.ok(override, `${group}.updatedAtMs needs a fieldOverride for the collection-group sync query`);
    const scopes = override.indexes.map((entry) => `${entry.order}:${entry.queryScope}`);
    assert.ok(scopes.includes('ASCENDING:COLLECTION_GROUP'), `${group} needs ASCENDING COLLECTION_GROUP`);
    assert.ok(scopes.includes('DESCENDING:COLLECTION_GROUP'), `${group} needs DESCENDING COLLECTION_GROUP`);
    // لا نُلغي نطاق المجموعة العادي الذي تستخدمه قراءات الشبكة الواحدة.
    assert.ok(scopes.includes('ASCENDING:COLLECTION'), `${group} must keep COLLECTION scope`);
  }
  const ackFields = overrides
    .filter((entry) => entry.collectionGroup === 'template_acks')
    .map((entry) => entry.fieldPath);
  assert.ok(ackFields.includes('synced_at'), 'template_acks.synced_at needs a collection-group index');
  assert.ok(ackFields.includes('applied_version_id'), 'device-acks filters on applied_version_id');
});

test('the sync engine only queries collections covered by those indexes', async () => {
  const sync = await read(new URL('lib/localDb/syncEngine.js', SRC));
  const groups = [...sync.matchAll(/collectionGroup\(firestore, '([^']+)'\)/g)].map((match) => match[1]);
  assert.deepEqual(groups.sort(), ['payments', 'sales']);
  // كل مصدر مجموعة يجب أن يفلتر/يرتّب على updatedAtMs حتى يعمل الفهرس الأحادي.
  assert.match(sync, /where\('updatedAtMs', '>=', cursorMs\), orderBy\('updatedAtMs', 'asc'\)/);
  assert.match(sync, /orderBy\('updatedAtMs', 'desc'\), limit\(1\)/);
});

test('manual refresh routes go through the incremental sync, never a forced full read', async () => {
  const sales = await read(new URL('pages/SalesPage.jsx', SRC));
  const users = await read(new URL('pages/UsersPage.jsx', SRC));
  const dashboard = await read(new URL('pages/DashboardPage.jsx', SRC));
  for (const source of [sales, users, dashboard]) {
    assert.match(source, /runSync\(\{ reason: 'manual' \}\)/);
    assert.doesNotMatch(source, /force:\s*true/);
  }
});
