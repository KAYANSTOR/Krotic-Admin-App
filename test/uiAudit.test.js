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

test('mobile action and modal close controls have comfortable tap targets', async () => {
  const css = await read('src/index.css');
  assert.match(css, /\.modal__close\s*\{[^}]*width:44px; height:44px;/);
  assert.match(css, /\.user-card__actions \.row-action\s*\{\s*min-height:44px;/);
});
