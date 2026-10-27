import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACK_OUTCOME_LABELS, INBOUND_IDENTIFIER_LABELS, INBOUND_SIMULATION_REASON_LABELS,
  MESSAGE_SOURCE_MODE_LABELS, MESSAGE_SOURCE_STATUS_LABELS, OUTBOUND_PREVIEW_REASON_LABELS,
  OUTBOUND_SCOPE_LABELS, describeEntrySource, describeTemplateValidationError, labelAckOutcome,
  labelReason, reconcileLegacy, summarizeTemplateValidationErrors,
} from '../src/lib/templateCenterView.js';
import { TEMPLATE_CENTER_NAV, TEMPLATE_CENTER_ROOT, TEMPLATE_CENTER_TITLES } from '../src/lib/templateCenterRoutes.js';
import { createInboundTemplateId, createMessageSourceId, isAdminGeneratedId } from '../src/lib/templateCenterIds.js';
import { getTemplateCenterCatalog } from '../server/_lib/templateCenter.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

async function templateCenterSources() {
  const dir = path.join(root, 'src', 'pages', 'template-center');
  const files = await readdir(dir);
  const entries = await Promise.all(files.filter((name) => name.endsWith('.jsx'))
    .map(async (name) => [name, await readFile(path.join(dir, name), 'utf8')]));
  return Object.fromEntries(entries);
}

test('one route registry feeds every navigation surface (no drifting labels)', async () => {
  assert.equal(TEMPLATE_CENTER_NAV.length, 5);
  assert.deepEqual([...TEMPLATE_CENTER_NAV.map((item) => item.path)], [
    '/template-center/wallets', '/template-center/inbound', '/template-center/outbound',
    '/template-center/releases', '/template-center/reconciliation',
  ]);
  assert.equal(TEMPLATE_CENTER_TITLES[TEMPLATE_CENTER_ROOT.path], TEMPLATE_CENTER_ROOT.label);
  for (const item of TEMPLATE_CENTER_NAV) assert.equal(TEMPLATE_CENTER_TITLES[item.path], item.label);

  const [sidebar, bottomNav, layout, centerLayout] = await Promise.all([
    read('src/components/Sidebar.jsx'),
    read('src/components/BottomNav.jsx'),
    read('src/components/Layout.jsx'),
    read('src/pages/template-center/TemplateCenterLayout.jsx'),
  ]);
  assert.match(sidebar, /TEMPLATE_CENTER_NAV\.map/);
  assert.match(bottomNav, /TEMPLATE_CENTER_TITLES\[/);
  assert.match(bottomNav, /TEMPLATE_CENTER_ROOT\.label/);
  assert.match(layout, /\.\.\.TEMPLATE_CENTER_TITLES/);
  assert.match(centerLayout, /TEMPLATE_CENTER_NAV\.map/);

  // كل مسار مركز في أسطح التنقل يجب أن يكون معروفًا في السجل.
  for (const [name, source] of Object.entries({ sidebar, bottomNav })) {
    const paths = [...source.matchAll(/'(\/template-center[^']*)'/g)].map((match) => match[1]);
    for (const routePath of paths) {
      assert.ok(routePath === TEMPLATE_CENTER_ROOT.path || TEMPLATE_CENTER_TITLES[routePath],
        `${name} references unregistered path ${routePath}`);
    }
  }

  // لا تعود التسميات القديمة المتباينة إلى أي سطح تنقل.
  for (const [name, source] of Object.entries({ sidebar, bottomNav, layout, centerLayout })) {
    assert.doesNotMatch(source, /المحافظ ومصادر الرسائل/, `${name} still hardcodes the old label`);
    assert.doesNotMatch(source, /مركز القوالب والمحافظ|مركز القوالب الشامل/, `${name} still hardcodes an old center title`);
    assert.doesNotMatch(source, /الإصدارات والمؤشرات/, `${name} still uses the old releases label`);
  }
});

test('tab headings match the registered navigation labels', async () => {
  const tabs = await templateCenterSources();
  const fileByPath = {
    '/template-center/wallets': 'WalletsTab.jsx',
    '/template-center/inbound': 'InboundTab.jsx',
    '/template-center/outbound': 'OutboundTab.jsx',
    '/template-center/releases': 'ReleasesTab.jsx',
    '/template-center/reconciliation': 'ReconciliationTab.jsx',
  };
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const item of TEMPLATE_CENTER_NAV) {
    const source = tabs[fileByPath[item.path]];
    assert.ok(source, `missing tab file for ${item.path}`);
    assert.match(source, new RegExp(`title="${escape(item.label)}"`), `${fileByPath[item.path]} title must equal the registry label`);
  }
});

test('the UI vocabulary calls Android wallets "message sources", never a financial wallet', async () => {
  const tabs = await templateCenterSources();
  const uiFiles = {
    ...tabs,
    'Sidebar.jsx': await read('src/components/Sidebar.jsx'),
    'BottomNav.jsx': await read('src/components/BottomNav.jsx'),
    'Layout.jsx': await read('src/components/Layout.jsx'),
    'DashboardPage.jsx': await read('src/pages/DashboardPage.jsx'),
  };
  for (const [name, source] of Object.entries(uiFiles)) {
    assert.doesNotMatch(source, /المحافظ(?!\s*\/)/, `${name} still shows the financial-sounding "المحافظ"`);
    assert.doesNotMatch(source, /محفظة|محافظ في المسودة/, `${name} still shows wallet wording`);
  }
  assert.match(tabs['WalletsTab.jsx'], /مصادر الرسائل/);
});

test('static "how to use" instruction blocks are gone; guidance lives in one-line context', async () => {
  const tabs = await templateCenterSources();
  for (const [name, source] of Object.entries(tabs)) {
    assert.doesNotMatch(source, /دليل الاستخدام|إرشادات الاستخدام/, `${name} reintroduced a static guidance block`);
    assert.doesNotMatch(source, /ماذا سوف يحدث/, `${name} reintroduced narrative instructions`);
  }
  // الشرح القصير يبقى في وصف القسم/التبويب فقط.
  for (const name of ['WalletsTab.jsx', 'InboundTab.jsx', 'OutboundTab.jsx', 'ReleasesTab.jsx', 'ReconciliationTab.jsx']) {
    assert.match(tabs[name], /<Section[\s\S]*?description=/, `${name} must keep a one-line section description`);
  }
});


test('every server vocabulary value has exactly one Arabic label', () => {
  const catalog = getTemplateCenterCatalog();
  for (const kind of catalog.identifierKinds) {
    assert.ok(INBOUND_IDENTIFIER_LABELS[kind], `missing identifier label for ${kind}`);
  }
  for (const scope of ['outboundCustomer', 'outboundPos', 'outboundSystem']) {
    assert.ok(OUTBOUND_SCOPE_LABELS[scope], `missing scope label for ${scope}`);
  }
  assert.equal(Object.keys(INBOUND_IDENTIFIER_LABELS).length, catalog.identifierKinds.length);
  assert.equal(Object.keys(OUTBOUND_SCOPE_LABELS).length, 3);
  for (const mode of ['sms', 'notification']) assert.ok(MESSAGE_SOURCE_MODE_LABELS[mode]);
  for (const status of ['active', 'suspended', 'archived']) assert.ok(MESSAGE_SOURCE_STATUS_LABELS[status]);
  for (const outcome of ['applied', 'partially_applied', 'failed']) assert.ok(ACK_OUTCOME_LABELS[outcome]);
  assert.equal(labelAckOutcome('applied'), 'مطبَّق');
  assert.equal(labelAckOutcome('rejected'), 'مرفوض');
});

test('tab-local label maps are removed in favour of the shared glossary', async () => {
  const tabs = await templateCenterSources();
  const forbidden = [
    /const\s+SOURCE_MODE_LABELS\s*=/, /const\s+STATUS_LABELS\s*=/,
    /const\s+IDENTIFIER_LABELS\s*=/, /const\s+SCOPE_LABELS\s*=/,
  ];
  for (const [name, source] of Object.entries(tabs)) {
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${name} defines a local label map`);
  }
});

test('server reason codes are shown in Arabic instead of raw English tokens', async () => {
  assert.equal(labelReason(INBOUND_SIMULATION_REASON_LABELS, 'no_template_matched'), 'لا يوجد قالب مطابق');
  assert.equal(labelReason(OUTBOUND_PREVIEW_REASON_LABELS, 'variable_scope_invalid'), 'المتغير خارج نطاق هذا القالب');
  assert.match(labelReason(OUTBOUND_PREVIEW_REASON_LABELS, 'something_new'), /سبب غير مترجم \(something_new\)/);

  const [inbound, outbound] = await Promise.all([
    read('src/pages/template-center/InboundTab.jsx'),
    read('src/pages/template-center/OutboundTab.jsx'),
  ]);
  assert.match(inbound, /labelReason\(INBOUND_SIMULATION_REASON_LABELS/);
  assert.match(outbound, /labelReason\(OUTBOUND_PREVIEW_REASON_LABELS/);
});

test('admin-created ids are generated, namespaced, and never typed by hand', async () => {
  const walletId = createMessageSourceId();
  const templateId = createInboundTemplateId();
  assert.match(walletId, /^wallet-admin-[a-f0-9]{16}$/);
  assert.match(templateId, /^tpl-admin-[a-f0-9]{16}$/);
  assert.ok(SAFE_ID.test(walletId) && SAFE_ID.test(templateId));
  assert.ok(isAdminGeneratedId(walletId) && isAdminGeneratedId(templateId));
  assert.ok(!isAdminGeneratedId('wallet-default-jaib'));
  assert.ok(!isAdminGeneratedId('wallet-3'));

  const generated = new Set(Array.from({ length: 500 }, () => createMessageSourceId()));
  assert.equal(generated.size, 500, 'ids must not repeat in normal use');

  const [wallets, inbound] = await Promise.all([
    read('src/pages/template-center/WalletsTab.jsx'),
    read('src/pages/template-center/InboundTab.jsx'),
  ]);
  for (const [name, source] of Object.entries({ WalletsTab: wallets, InboundTab: inbound })) {
    assert.match(source, /readOnly disabled/, `${name} must render the id read-only`);
    assert.doesNotMatch(source, /Math\.random\(\)\.toString\(36\)/, `${name} must not hand-roll ids`);
  }
});

test('reconciliation speaks the same vocabulary as the rest of the center', () => {
  const report = reconcileLegacy({
    releases: [{ payload: { wallets: [{ id: 'w1' }], transferTemplates: [{ id: 't1' }], outboundTemplates: [{ key: 'k1' }] } }],
    networks: [{ id: 'n1' }],
  });
  assert.deepEqual(report.rows.map((row) => row.label), [
    'مصادر الرسائل', 'قوالب الرسائل الواردة', 'الرسائل الصادرة', 'الشبكات',
  ]);
  assert.equal(describeEntrySource({ id: 'w1' }, { bundledIds: new Set(['w1']) }).label, 'مضمّن في كتالوج Android');
});

test('server validation codes are summarized in Arabic, never dumped raw', () => {
  assert.equal(describeTemplateValidationError('wallets[0]_created_at_invalid'), 'مصدر رسائل #1: تاريخ الإنشاء مفقود أو غير صالح');
  assert.equal(describeTemplateValidationError('transferTemplates[2]_wallet_id_invalid'), 'قالب وارد #3: مصدر الرسائل المرتبط غير موجود');
  assert.equal(describeTemplateValidationError('outboundTemplates[0]_variable_scope_invalid'), 'قالب صادر #1: المتغير خارج نطاق هذا القالب');
  assert.equal(describeTemplateValidationError('payload_too_large'), 'حجم الحمولة يتجاوز الحد المسموح');

  const summary = summarizeTemplateValidationErrors([
    'wallets[0]_name_invalid', 'wallets[0]_name_invalid', 'wallets[1]_status_invalid',
    'transferTemplates[0]_pattern_invalid', 'outboundTemplates[0]_body_invalid',
  ]);
  assert.match(summary, /^مصدر رسائل #1: الاسم مطلوب/);
  assert.match(summary, /و1 خطأ آخر$/);
  assert.doesNotMatch(summary, /wallets\[|_invalid|transferTemplates/);

  // رموز مجهولة لا تُعرض خامًا.
  assert.equal(describeTemplateValidationError('some_new_code'), 'خطأ تحقق غير معروف');
  assert.equal(describeTemplateValidationError(null), 'خطأ تحقق غير معروف');
  assert.equal(summarizeTemplateValidationErrors([]), '');
});

test('admin API error glossary has no duplicate keys (last-wins bugs)', async () => {
  const source = await read('src/lib/adminApi.js');
  const start = source.indexOf('export const ADMIN_API_ERRORS');
  const block = source.slice(start, source.indexOf('};', start) + 2);
  const keys = [...block.matchAll(/^\s{2}([a-z0-9_]+):/gm)].map((match) => match[1]);
  assert.ok(keys.length > 50);
  assert.equal(new Set(keys).size, keys.length, 'duplicate error keys silently override each other');
  for (const key of [
    'template_center_read_failed', 'simulation_input_invalid', 'release_conflict',
    'draft_id_invalid', 'app_version_invalid',
  ]) {
    assert.ok(keys.includes(key), `missing template-center error key ${key}`);
  }
});

test('account features UI keeps server collection paths out of primary copy', async () => {
  const page = await read('src/pages/PaidFeaturesPage.jsx');
  assert.doesNotMatch(page, /account_feature_audit|account_features_catalog|account_features_version/);
  assert.match(page, /حُفظت مزايا الحساب على الخادم/);
  // التحذير الدلالي يبقى: الاستحقاق على الحساب لا يعني تفعيله في Android.
  assert.match(page, /لا يفعّل ميزة في إصدار Android/);
});
