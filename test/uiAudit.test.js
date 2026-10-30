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

