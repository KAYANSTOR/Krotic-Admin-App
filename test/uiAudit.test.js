import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('mobile quick-action sheet is in its visible state when mounted', async () => {
  const [nav, css] = await Promise.all([
    read('src/components/BottomNav.jsx'),
    read('src/index.css'),
  ]);
  assert.match(nav, /className="sheet sheet--quick is-open"/);
  assert.match(css, /\.sheet\.is-open\s*\{\s*transform:\s*translateY\(0\)/);
  assert.match(nav, /event\.key === 'Escape'/);
});

test('quick actions do not repeat bottom navigation pages and include the template center', async () => {
  const nav = await read('src/components/BottomNav.jsx');
  const primaryStart = nav.indexOf('const primaryItems = [');
  const quickStart = nav.indexOf('const quickItems = [');
  const primary = nav.slice(primaryStart, nav.indexOf('\n];', primaryStart));
  const quick = nav.slice(quickStart, nav.indexOf('\n];', quickStart));
  const primaryPaths = new Set([...primary.matchAll(/path:\s*'([^']+)'/g)].map((match) => match[1]));
  const quickPaths = [...quick.matchAll(/path:\s*'([^']+)'/g)].map((match) => match[1]);

  assert.ok(quickPaths.includes('/template-center'));
  assert.equal(new Set(quickPaths).size, quickPaths.length, 'Quick action targets must be unique');
  for (const path of quickPaths) assert.ok(!primaryPaths.has(path), `Duplicate bottom navigation target: ${path}`);
});

test('login controls have explicit labels and visible validation for invalid input', async () => {
  const login = await read('src/pages/LoginPage.jsx');
  assert.match(login, /noValidate/);
  assert.match(login, /name="email"/);
  assert.match(login, /name="password"/);
  assert.match(login, /htmlFor="login-email"/);
  assert.match(login, /htmlFor="login-password"/);
  assert.match(login, /role="alert"/);
  assert.match(login, /form\.querySelector\(':invalid'\)\?\.focus\(\)/);
});

test('keyboard activation of an inner user action does not activate the whole mobile card', async () => {
  const users = await read('src/pages/UsersPage.jsx');
  assert.match(users, /if \(event\.target !== event\.currentTarget\) return;/);
  assert.match(users, /aria-label=\{\`تجديد اشتراك:/);
});

test('disabled button-like links suppress clicks and keyboard focus', async () => {
  const button = await read('src/components/ui/Button.jsx');
  assert.match(button, /aria-disabled=\{isDisabled \|\| undefined\}/);
  assert.match(button, /tabIndex=\{isDisabled \? -1 : rest\.tabIndex\}/);
  assert.match(button, /event\.preventDefault\(\); event\.stopPropagation\(\)/);
});

test('notification scheduling copy matches the deployed daily cron cadence', async () => {
  const [page, configText] = await Promise.all([
    read('src/pages/NotificationsPage.jsx'),
    read('vercel.json'),
  ]);
  const config = JSON.parse(configText);
  const job = config.crons?.find((item) => item.path === '/api/dispatch-notifications');
  assert.equal(job?.schedule, '0 6 * * *');
  assert.match(page, /مرة واحدة يومياً قرابة 06:00 UTC/);
  assert.doesNotMatch(page, /يُرسَل تلقائياً في الوقت المحدد/);
});

test('app navigation links point to declared route loaders', async () => {
  const [nav, routes, sidebar] = await Promise.all([
    read('src/components/BottomNav.jsx'),
    read('src/lib/routeLoaders.js'),
    read('src/components/Sidebar.jsx'),
  ]);
  const declared = new Set([...routes.matchAll(/['"]([^'"]+)['"]\s*:\s*\(\)\s*=>\s*import/g)].map((match) => match[1]));
  const paths = [...nav, ...sidebar].join('\n').matchAll(/path:\s*'([^']+)'/g);
  for (const match of paths) assert.ok(declared.has(match[1]), `Navigation target has no route loader: ${match[1]}`);
});

test('mobile action buttons are visible, distinct, labelled and easy to tap', async () => {
  const [css, users, profile] = await Promise.all([
    read('src/index.css'),
    read('src/pages/UsersPage.jsx'),
    read('src/pages/UserProfilePage.jsx'),
  ]);
  assert.match(css, /\.row-action\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.row-action--danger[^}]*background:\s*var\(--ui-danger-soft\)/);
  assert.match(css, /\.row-action--success[^}]*background:\s*var\(--ui-success-soft\)/);
  assert.match(css, /\.row-action:focus-visible/);
  assert.match(css, /@media \(max-width: 640px\)\s*\{\s*\.row-action \{ min-height: 48px/);
  assert.match(users, /<span>تجديد<\/span>/);
  assert.match(users, /<span>تعديل<\/span>/);
  assert.match(users, /<span>الدخول<\/span>/);
  assert.match(users, /aria-label=\{user\.is_active === false \? 'إلغاء حظر المستخدم' : 'حظر المستخدم'\}/);
  assert.match(profile, /<span>تجديد<\/span>/);
  assert.match(profile, /<span>تعديل<\/span>/);
  assert.match(profile, /<span>الدخول<\/span>/);
  assert.match(css, /\.modal__close\s*\{[^}]*width:44px; height:44px;/);
  assert.match(css, /\.notif-item__delete\s*\{[\s\S]*?width: 44px; height: 44px;/);
  assert.match(css, /\.notif-item__delete[^}]*background: var\(--ui-danger-soft\)/);
});

test('confirmation dialogs wait for async actions and expose failures', async () => {
  const [dialog, users, profile, billing] = await Promise.all([
    read('src/components/ConfirmDialog.jsx'),
    read('src/pages/UsersPage.jsx'),
    read('src/pages/UserProfilePage.jsx'),
    read('src/components/UserBillingModal.jsx'),
  ]);
  assert.match(dialog, /await onConfirm\?\.\(\)/);
  assert.match(dialog, /if \(result === false\)/);
  assert.match(dialog, /loading=\{submitting\}/);
  assert.match(dialog, /تعذر تنفيذ الإجراء/);
  assert.match(users, /await confirmAction\.action\(\)/);
  assert.match(users, /if \(result === false\) return false;[\s\S]*?setConfirmAction\(null\)/);
  assert.match(profile, /await confirmAction\.action\(\)/);
  assert.match(profile, /if \(result === false\) return false;[\s\S]*?setConfirmAction\(null\)/);
  assert.match(billing, /finally \{\s*setSavingPayment\(false\)/);
  assert.match(billing, /Payment submission failed/);
  assert.match(billing, /void refreshBillingHistory\(\)/);
});

test('application status audit is written only after the server confirms settings were saved', async () => {
  const settings = await read('src/pages/SettingsPage.jsx');
  assert.match(settings, /if \(previousAppStatus !== patch\.is_app_active\)/);
  assert.match(settings, /savedAppStatus\.current = patch\.is_app_active/);
  const confirmHandler = settings.slice(
    settings.indexOf('const confirmDisableApp = () => {'),
    settings.indexOf('\n  };', settings.indexOf('const confirmDisableApp = () => {')) + 5,
  );
  assert.doesNotMatch(confirmHandler, /logAdminAction/);
  assert.match(settings, /لن يُطبَّق التغيير على المستخدمين إلا بعد الضغط على/);
});


test('failed admin actions leave confirmation open and always release loading states', async () => {
  const [users, profile, admins, notifications, settings] = await Promise.all([
    read('src/pages/UsersPage.jsx'),
    read('src/pages/UserProfilePage.jsx'),
    read('src/pages/AdminsPage.jsx'),
    read('src/pages/NotificationsPage.jsx'),
    read('src/pages/SettingsPage.jsx'),
  ]);
  assert.match(users, /if \(!result\.ok\) \{[\s\S]*?return false;/);
  assert.match(profile, /if \(!result\.ok\) \{[\s\S]*?return false;/);
  assert.match(admins, /if \(!result\.ok\) \{[\s\S]*?return false;/);
  assert.match(notifications, /catch \(error\) \{[\s\S]*?return false;\s*\} finally \{\s*setDeleting\(false\)/);
  assert.match(settings, /if \(!result\.ok\) \{\s*toast\.error\(adminApiError\(result\.error, 'تعذر تحديث تواريخ الانتهاء'\)\);\s*return false;/);
  assert.match(settings, /finally \{\s*setUpdatingBatch\(false\)/);
  const batchHandler = settings.slice(
    settings.indexOf('const handleBatchUpdateExpiry = async () => {'),
    settings.indexOf('const update = (patch)', settings.indexOf('const handleBatchUpdateExpiry = async () => {')),
  );
  assert.ok(batchHandler.indexOf('if (!result.ok)') < batchHandler.indexOf('setShowBatchConfirm(false)'));
});

test('all modal dialogs escape the pull-to-refresh containing block on mobile', async () => {
  const [modal, pullToRefresh, css] = await Promise.all([
    read('src/components/ui/Modal.jsx'),
    read('src/components/PullToRefresh.jsx'),
    read('src/index.css'),
  ]);
  assert.match(pullToRefresh, /className="ptr__content"[^>]*style=\{\{ transform: pull \? \`translateY/);
  assert.match(css, /\.ptr__content \{[^}]*will-change: transform/);
  assert.match(modal, /import \{ createPortal \} from 'react-dom'/);
  assert.match(modal, /return createPortal\([\s\S]*?document\.body/);
  assert.match(modal, /const onCloseRef = useRef\(onClose\)/);
  assert.match(modal, /\}, \[isOpen\]\);/);
});

test('account-features screen writes through the server path and never touches Firestore directly', async () => {
  const page = await read('src/pages/PaidFeaturesPage.jsx');
  // الكتابة تمر بالمسار الخادمي المقيّد فقط.
  assert.match(page, /updateAccountFeatures/);
  assert.match(page, /fetchAccountFeatures/);
  assert.match(page, /fetchAccountFeatureCatalog/);
  assert.match(page, /account_features/);
  // لا كتابة عميل مباشرة على Firestore من الشاشة.
  assert.doesNotMatch(page, /from 'firebase\/firestore'/);
  assert.doesNotMatch(page, /setDoc|updateDoc|addDoc/);
  // لا تدّعي الشاشة أن التخزين الإداري وحده يفعّل ميزة على كل إصدار Android.
  assert.match(page, /ما لم يكن ذلك الإصدار يقرأ عقد account_features/);
});


test('dashboard page uses focused modules and removes stale duplicated logic', async () => {
  const [page, helpers, progress, welcome, alerts, summary, services, settlement, operations, repair] = await Promise.all([
    read('src/pages/DashboardPage.jsx'),
    read('src/lib/dashboard/helpers.js'),
    read('src/lib/dashboard/repairProgress.js'),
    read('src/components/dashboard/DashWelcome.jsx'),
    read('src/components/dashboard/DashAlerts.jsx'),
    read('src/components/dashboard/DashSummary.jsx'),
    read('src/components/dashboard/DashServices.jsx'),
    read('src/components/dashboard/DashSettlement.jsx'),
    read('src/components/dashboard/RecentOperations.jsx'),
    read('src/components/dashboard/AggregateRepairTool.jsx'),
  ]);

  assert.ok(page.length < 12000, 'DashboardPage should remain an orchestration layer');
  assert.ok(page.includes('salesSnapshotsReady = !dashboardQuery.loading && !salesQuery.loading'));
  assert.ok(page.includes('useAppRefresh(stableRefresh)'));
  assert.ok(page.includes('refreshRef.current()'));
  assert.ok(!page.includes('window.confirm'));
  assert.ok(!['summarizeRealtimeSales', 'MONTH_LABELS', 'partialErrors', 'monthlySales ='].some((token) => page.includes(token)));
  assert.ok(page.includes("String(adminData?.name ?? '').trim()"));
  assert.ok(page.includes('ConfirmDialog'));
  for (const component of [welcome, alerts, summary, services, settlement, operations, repair]) {
    assert.ok(component.includes('export default function'));
  }
  assert.ok(helpers.includes('SALE_STATUS_FALLBACK'));
  assert.ok(progress.includes('AGGREGATE_REPAIR_PROGRESS_KEY'));
});

test('aggregate repair is routed through adminApi and guarded against parallel runs', async () => {
  const [page, api, progress, repair] = await Promise.all([
    read('src/pages/DashboardPage.jsx'),
    read('src/lib/adminApi.js'),
    read('src/lib/dashboard/repairProgress.js'),
    read('src/components/dashboard/AggregateRepairTool.jsx'),
  ]);

  assert.ok(page.includes('rebuildFinancialAggregatesPage({ cursor, limit: 1 })'));
  assert.ok(page.includes('repairInFlightRef'));
  assert.ok(page.includes('saveRepairProgress(nextProgress)'));
  assert.ok(api.includes('export async function rebuildFinancialAggregatesPage'));
  assert.ok(api.includes("callAdminApi('/api/migrate'"));
  assert.ok(progress.includes('function loadRepairProgress'));
  assert.ok(progress.includes('function saveRepairProgress'));
  assert.ok(repair.includes('هذا المتصفح فقط'));
  assert.ok(repair.includes('disabled={rebuilding || refreshing}'));
});

test('dashboard summary, settlement progress and recent operation links are accessible', async () => {
  const [summary, settlement, operations, helpers, salesPage] = await Promise.all([
    read('src/components/dashboard/DashSummary.jsx'),
    read('src/components/dashboard/DashSettlement.jsx'),
    read('src/components/dashboard/RecentOperations.jsx'),
    read('src/lib/dashboard/helpers.js'),
    read('src/pages/SalesPage.jsx'),
  ]);

  assert.ok(summary.includes('Number(stats?.totalSales) || 0'));
  assert.ok(summary.includes('aria-pressed={!balanceVisible}'));
  assert.ok(summary.includes('min-w-[44px] min-h-[44px]'));
  assert.ok(settlement.includes('aria-valuetext='));
  assert.ok(settlement.includes(' بالمئة'));
  assert.ok(!settlement.includes('dash-progress__percent" aria-hidden'));
  assert.ok(operations.includes('state={operation.id ? { focusSaleId: operation.id } : undefined}'));
  assert.ok(operations.includes('function operationKey'));
  assert.ok(operations.includes('تم تحديث قائمة العمليات'));
  assert.ok(helpers.includes('loadBalanceVisible'));
  assert.ok(helpers.includes('saveBalanceVisible'));
  assert.ok(salesPage.includes('const focusSaleId = location.state?.focusSaleId'));
  assert.ok(salesPage.includes("setActiveTab('live')"));
  assert.ok(salesPage.includes('scrollIntoView'));
});


test('user profile KPIs cover all history by default and handle query failures without endless loading', async () => {
  const [page, hook, query, helpers, inventory] = await Promise.all([
    read('src/pages/UserProfilePage.jsx'),
    read('src/hooks/userProfile/useUserProfile.js'),
    read('src/lib/localDb/useLocalQuery.js'),
    read('src/lib/users/profileHelpers.js'),
    read('src/components/userProfile/UserInventorySection.jsx'),
  ]);

  assert.ok(page.includes("useState('all')"));
  assert.ok(page.includes("value={historyMonth}"));
  assert.ok(page.includes('formatMonthArabic(historyMonth)'));
  assert.ok(!page.includes('load({ force: true })'));
  assert.ok(!page.includes('window.confirm'));
  assert.ok(page.includes('title: block ?'));
  assert.ok(page.includes('message: block'));
  assert.ok(inventory.includes('Array.isArray(snapshot?.breakdown)'));
  assert.ok(hook.includes('const loading = Boolean(uid) && !user && usersQuery.loading && !userLoadError'));
  assert.ok(hook.includes('historyError = historyQuery.error?.profileUid === uid'));
  assert.ok(query.includes('setState({ data: null, error, loading: false })'));
  assert.ok(helpers.includes("return normalized || 'غير مُبلّغ'"));
});

test('monthly breakdown creates buckets once and keeps approved commission outstanding separate from payment totals', async () => {
  const [page, breakdown, monthCard, badge] = await Promise.all([
    read('src/pages/UserProfilePage.jsx'),
    read('src/lib/users/monthlyBreakdown.js'),
    read('src/components/userProfile/MonthCard.jsx'),
    read('src/components/userProfile/SaleVerificationBadge.jsx'),
  ]);

  assert.ok(page.includes('buildMonthlyBreakdown(allSales, allPayments, monthOptions)'));
  assert.ok(breakdown.includes('export function createEmptyMonthBucket'));
  assert.ok(breakdown.includes('export function paymentMonthKey(payment)'));
  assert.ok(breakdown.includes('bucket.outstanding = bucket.verifiedOutstanding'));
  assert.ok(monthCard.includes('Number(m.verifiedOutstanding) || 0'));
  assert.ok(!monthCard.includes('m.commissionDue - m.totalPaid'));
  assert.ok(!badge.includes('Hash:'));
});
