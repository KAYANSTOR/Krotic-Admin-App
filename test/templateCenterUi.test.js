import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');
const tabDir = path.join(root, 'src', 'pages', 'template-center');

async function readTabs() {
  const files = (await readdir(tabDir)).filter((name) => name.endsWith('.jsx'));
  const entries = await Promise.all(files.map(async (name) => [name, await readFile(path.join(tabDir, name), 'utf8')]));
  return Object.fromEntries(entries);
}

test('template center exposes a clear sub-route per domain', async () => {
  const page = await read('src/pages/TemplateCenterPage.jsx');
  for (const segment of ['wallets', 'inbound', 'outbound', 'releases', 'reconciliation']) {
    assert.match(page, new RegExp(`path="${segment}"`), `missing sub-route ${segment}`);
  }
  assert.match(page, /<Navigate to="wallets" replace \/>/);
});

test('draft actions are separated: import catalog, save draft, publish, rollback', async () => {
  const [panel, releases] = await Promise.all([
    read('src/pages/template-center/DraftScopePanel.jsx'),
    read('src/pages/template-center/ReleasesTab.jsx'),
  ]);
  assert.match(panel, /حفظ المسودة/);
  assert.match(panel, />\s*استيراد\s*</);
  assert.match(panel, />\s*نشر\s*</);
  assert.match(releases, /تراجع/);
});

test('the import action is labelled as importing into the draft, never as seeding', async () => {
  const panel = await read('src/pages/template-center/DraftScopePanel.jsx');
  assert.match(panel, />\s*استيراد\s*</);
  // No positive seeding claim anywhere in the UI (negations such as «لا تُزرع» are allowed).
  const tabs = await readTabs();
  for (const [name, source] of Object.entries(tabs)) {
    assert.doesNotMatch(source, /تم الزرع|زرعت العناصر|مزروع الآن/, `${name} must not claim seeding happened`);
  }
});

test('device application state is only shown from a verified ACK, never assumed', async () => {
  const [layout, releases, context] = await Promise.all([
    read('src/pages/template-center/TemplateCenterLayout.jsx'),
    read('src/pages/template-center/ReleasesTab.jsx'),
    read('src/pages/template-center/TemplateCenterContext.jsx'),
  ]);
  // The state is derived from the real (possibly null) ACK, not a hardcoded success.
  assert.match(layout, /deriveApplicationState\(\{ pointer: currentPointer, ack: currentAck \}\)/);
  assert.match(context, /selectVerifiedAck/);
  // The fallback wording is supplied by the shared view helper, not hardcoded in the layout.
  assert.match(layout, /applicationState\.detail/);
  assert.match(releases, /غير معروف/);
  // Never render a bare seeding/success claim about devices.
  assert.doesNotMatch(layout, /تم الزرع/);
  assert.doesNotMatch(releases, /تم الزرع/);
});

test('wallets screen carries no balance or financial field in the form', async () => {
  const wallets = await read('src/pages/template-center/WalletsTab.jsx');
  for (const forbidden of ['balance', 'amount', 'credit', 'debit', 'ledger']) {
    assert.doesNotMatch(wallets, new RegExp(forbidden, 'i'), `wallets form must not reference ${forbidden}`);
  }
});

test('outbound tab is visually and textually separate from FCM notifications', async () => {
  const outbound = await read('src/pages/template-center/OutboundTab.jsx');
  assert.match(outbound, /SMS/);
  assert.match(outbound, /منفصل/);
  assert.match(outbound, /\/notifications/);
  // Preview must state it sends nothing.
  assert.match(outbound, /لا تُرسَل أي رسالة/);
});

test('reconciliation screen states legacy phone data is unknown and not seeded', async () => {
  const reconciliation = await read('src/pages/template-center/ReconciliationTab.jsx');
  assert.match(reconciliation, /غير معروفة|غير متاح|غير متاحة/);
  assert.match(reconciliation, /لا تُزرع|لن تُزرع/);
  assert.match(reconciliation, /reconcileLegacy/);
});

test('empty lists are explained as "no items here", not proof of no legacy items', async () => {
  const wallets = await read('src/pages/template-center/WalletsTab.jsx');
  assert.match(wallets, /لا توجد مصادر بعد/);
});
