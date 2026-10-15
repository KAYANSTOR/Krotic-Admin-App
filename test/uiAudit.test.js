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
  assert.match(dialog, /loading=\{submitting\}/);
  assert.match(dialog, /تعذر تنفيذ الإجراء/);
  assert.match(users, /await confirmAction\.action\(\); setConfirmAction\(null\)/);
  assert.match(profile, /await confirmAction\.action\(\); setConfirmAction\(null\)/);
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
