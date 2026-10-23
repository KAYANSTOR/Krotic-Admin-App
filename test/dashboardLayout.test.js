import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('dashboard keeps its local-first data sources and incremental refresh', async () => {
  const page = await read('src/pages/DashboardPage.jsx');
  assert.match(page, /loadLocalDashboard/);
  assert.match(page, /loadLocalNetworkSales/);
  assert.match(page, /useLocalQuery/);
  assert.match(page, /runSync\(\{ reason: 'manual' \}\)/);
  assert.doesNotMatch(page, /force:\s*true/);
  assert.match(page, /useAppRefresh\(refresh\)/);
  assert.match(page, /if \(loading && !stats\)/);
});

test('dashboard follows the reference hierarchy and keeps only real destinations', async () => {
  const page = await read('src/pages/DashboardPage.jsx');

  // ترتيب الهيكل: ترحيب ← بطاقة رئيسية ← إجراءات ← خدمات ← ملخص ثانوي ← عمليات.
  const positions = {
    welcome: page.indexOf('className="dash-welcome"'),
    summary: page.indexOf('className="dash-summary"'),
    quick: page.indexOf('className="dash-quick"'),
    services: page.indexOf('className="dash-services"'),
    progress: page.indexOf('className="dash-progress"'),
    recent: page.indexOf('className="recent-operations"'),
  };
  for (const [key, value] of Object.entries(positions)) {
    assert.ok(value > 0, `missing dashboard region: ${key}`);
  }
  assert.ok(positions.welcome < positions.summary);
  assert.ok(positions.summary < positions.quick);
  assert.ok(positions.quick < positions.services);
  assert.ok(positions.services < positions.progress);
  assert.ok(positions.progress < positions.recent);

  // أربعة إجراءات سريعة فقط، وكلها مسارات موجودة في التطبيق.
  const quickBlock = page.slice(positions.quick, page.indexOf('</nav>', positions.quick));
  const quickTargets = [...quickBlock.matchAll(/to="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(quickTargets, ['/users', '/sales', '/notifications', '/template-center']);

  // ست خدمات/أقسام، بلا أهداف وهمية.
  const servicesBlock = page.slice(positions.services, page.indexOf('</Section>', positions.services));
  const serviceTargets = [...servicesBlock.matchAll(/to="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(serviceTargets, [
    '/template-center/inbound',
    '/template-center/outbound',
    '/template-center/wallets',
    '/template-center/releases',
    '/template-center/reconciliation',
    '/settings',
  ]);
});

test('dashboard uses real aggregates and never reference sample content', async () => {
  const page = await read('src/pages/DashboardPage.jsx');
  assert.match(page, /formatNumber\(stats\.totalSales\)/);
  assert.match(page, /stats\.totalCommissionOutstanding/);
  assert.match(page, /stats\.totalUsers/);
  assert.match(page, /ريال يمني/);

  // لا بيانات أو نصوص من الصورة المرجعية.
  assert.doesNotMatch(page, /2,450,000|124,500|Total balance|Add money|Savings goal|New laptop|Netflix|₦/i);
  assert.doesNotMatch(page, /const\s+mock|sampleData|dummy/i);
});

test('settlement progress is derived from real commission values only', async () => {
  const page = await read('src/pages/DashboardPage.jsx');
  assert.match(page, /const commissionDue = Math\.max\(0, Number\(stats\?\.totalCommissionDue\) \|\| 0\)/);
  assert.match(page, /const commissionOutstanding = Math\.max\(0, Number\(stats\?\.totalCommissionOutstanding\) \|\| 0\)/);
  assert.match(page, /const commissionSettled = Math\.max\(0, commissionDue - commissionOutstanding\)/);
  assert.match(page, /role="progressbar"/);
  assert.match(page, /aria-valuenow=\{settlementPercent\}/);
  assert.match(page, /width: `\$\{settlementPercent\}%`/);
  assert.match(page, /لا توجد عمولات مستحقة مسجّلة حتى الآن/);
  assert.doesNotMatch(page, /72%|progress:\s*72/);
});

test('recent activity keeps ordering, empty state and real status labels', async () => {
  const page = await read('src/pages/DashboardPage.jsx');
  assert.match(page, /\.sort\(\(a, b\) => \(toDate\(b\.createdAt\)\?\.getTime\(\) \|\| 0\) - \(toDate\(a\.createdAt\)\?\.getTime\(\) \|\| 0\)\)/);
  assert.match(page, /\.slice\(0, 8\)/);
  assert.match(page, /recentOperations\.map\(\(operation, index\)/);
  assert.match(page, /<EmptyState/);
  assert.match(page, /COMPLETED: \{ label: 'مكتمل', tone: 'success' \}/);
  assert.match(page, /ROLLED_BACK: \{ label: 'مسترجع', tone: 'warning' \}/);
  assert.match(page, /SMS_PENDING: \{ label: 'بانتظار SMS', tone: 'info' \}/);
  assert.match(page, /<Badge tone=\{status\.tone\} dot>\{status\.label\}<\/Badge>/);
});

test('advanced repair tools stay functional but no longer push primary content down', async () => {
  const page = await read('src/pages/DashboardPage.jsx');
  const recent = page.indexOf('className="recent-operations"');
  const maintenance = page.indexOf('className="dash-maintenance"');
  assert.ok(recent > 0 && maintenance > recent, 'maintenance tools must follow the primary sections');
  assert.match(page, /<details open=\{aggregateRepairProgress\.cursor \|\| aggregateRepairProgress\.processed > 0 \? true : undefined\}>/);
  assert.match(page, /onClick=\{repairFinancialAggregates\}/);
  assert.match(page, /loading=\{rebuildingAggregates\} disabled=\{rebuildingAggregates\}/);
});

test('dashboard layout styles reuse tokens and mobile-first grids', async () => {
  const css = await read('src/index.css');
  assert.match(css, /\.dash-summary__hero \{[\s\S]*?var\(--ui-primary-green\)/);
  assert.match(css, /\.dash-quick \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.dash-services \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(min-width: 640px\) \{\s*\.dash-services \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/);
  assert.match(css, /\.dash-service__label \{[\s\S]*?overflow-wrap: anywhere/);
  assert.doesNotMatch(css, /\.dash-service__label[^}]*-webkit-line-clamp/, 'لا نقصّ تسميات الأقسام على الهاتف');
  assert.match(css, /\.recent-operation \{[\s\S]*?min-height: 68px/);
  assert.match(css, /\.dash-welcome__freshness \{[\s\S]*?grid-column: 1 \/ -1/);

  // بقايا الهيكل السابق يجب ألا تبقى كأنماط منافسة.
  assert.doesNotMatch(css, /\.dash-finance|\.dash-actions|\.dash-action__/);
});
