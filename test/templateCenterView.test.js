import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scopeKeyFor,
  deriveApplicationState,
  reconcileLegacy,
  describeEntrySource,
  collectReleaseEntryIds,
  extractTemplateVariables,
  validateOutboundTemplate,
  selectVerifiedAck,
  countAcknowledgingDevices,
} from '../src/lib/templateCenterView.js';
import { getTemplateCenterCatalog } from '../server/_lib/templateCenter.js';
import { BUNDLED_TEMPLATE_PACK, cloneBundledPack } from '../src/lib/bundledTemplatePack.js';

test('scopeKeyFor matches the server scopeKey format', () => {
  assert.equal(scopeKeyFor({ type: 'global' }), 'global');
  assert.equal(scopeKeyFor(null), 'global');
  assert.equal(scopeKeyFor({ type: 'network', networkId: 'net-1' }), 'network:net-1');
});

test('application state is Unknown without an active release pointer', () => {
  const state = deriveApplicationState({ pointer: null, ack: null });
  assert.equal(state.state, 'Unknown');
  assert.equal(state.evidence, 'none');
});

test('published pointer without ACK stays PublishedCentrally, never Applied', () => {
  const state = deriveApplicationState({ pointer: { releaseId: 'rel-1' }, ack: null });
  assert.equal(state.state, 'PublishedCentrally');
  assert.equal(state.evidence, 'server');
  assert.match(state.detail, /غير معروفة/);
});

test('a trusted ACK is the only path to AppliedLocally / ParserRefreshed', () => {
  const pointer = { releaseId: 'rel-1' };
  const applied = deriveApplicationState({ pointer, ack: { outcome: 'applied', parserRefreshed: false } });
  assert.equal(applied.state, 'AppliedLocally');
  assert.equal(applied.evidence, 'ack');

  const refreshed = deriveApplicationState({ pointer, ack: { outcome: 'applied', parserRefreshed: true } });
  assert.equal(refreshed.state, 'ParserRefreshed');

  const partial = deriveApplicationState({ pointer, ack: { outcome: 'partially_applied', parserRefreshed: false } });
  assert.equal(partial.state, 'AppliedLocally');
  assert.equal(partial.tone, 'warning');
});

test('failed ACK downgrades the device state instead of reporting success', () => {
  const state = deriveApplicationState({ pointer: { releaseId: 'rel-1' }, ack: { outcome: 'failed', failureReason: 'x' } });
  assert.equal(state.state, 'Unknown');
  assert.equal(state.tone, 'danger');
});

test('selectVerifiedAck ignores unverified records and other releases/scopes', () => {
  const acks = [
    { verified: false, releaseId: 'r1', scopeKey: 'global', appliedAt: '2026-01-05T00:00:00.000Z', installationId: 'a' },
    { verified: true, releaseId: 'r2', scopeKey: 'global', appliedAt: '2026-01-05T00:00:00.000Z', installationId: 'b' },
    { verified: true, releaseId: 'r1', scopeKey: 'network:n1', appliedAt: '2026-01-05T00:00:00.000Z', installationId: 'c' },
    { verified: true, releaseId: 'r1', scopeKey: 'global', appliedAt: '2026-01-03T00:00:00.000Z', installationId: 'old' },
    { verified: true, releaseId: 'r1', scopeKey: 'global', appliedAt: '2026-01-04T00:00:00.000Z', installationId: 'new' },
  ];
  const latest = selectVerifiedAck(acks, { releaseId: 'r1', scopeKey: 'global' });
  assert.equal(latest.installationId, 'new');
  assert.equal(selectVerifiedAck(acks, { releaseId: null }), null);
  assert.equal(selectVerifiedAck(acks, { releaseId: 'r9' }), null);
});

test('countAcknowledgingDevices counts distinct installations only', () => {
  const acks = [
    { verified: true, releaseId: 'r1', scopeKey: 'global', installationId: 'dev-1' },
    { verified: true, releaseId: 'r1', scopeKey: 'global', installationId: 'dev-1' },
    { verified: true, releaseId: 'r1', scopeKey: 'global', installationId: 'dev-2' },
    { verified: false, releaseId: 'r1', scopeKey: 'global', installationId: 'dev-3' },
    { verified: true, releaseId: 'r2', scopeKey: 'global', installationId: 'dev-4' },
  ];
  assert.equal(countAcknowledgingDevices(acks, { releaseId: 'r1', scopeKey: 'global' }), 2);
  assert.equal(countAcknowledgingDevices(acks, { releaseId: null }), 0);
});

test('a verified ACK flips the derived state to AppliedLocally', () => {
  const state = deriveApplicationState({
    pointer: { releaseId: 'r1' },
    ack: { outcome: 'applied', parserRefreshed: false },
  });
  assert.equal(state.state, 'AppliedLocally');
  assert.equal(state.evidence, 'ack');
});

test('reconciliation reports unknown legacy data when there are no central releases', () => {
  const report = reconcileLegacy({ releases: [], networks: [] });
  assert.equal(report.known, false);
  assert.equal(report.missingReason, 'no_central_records');
  assert.match(report.summary, /غير متاحة مركزيًا/);
});

test('reconciliation counts identifiers from central releases only', () => {
  const releases = [{
    payload: {
      wallets: [{ id: 'w1' }, { id: 'w2' }],
      transferTemplates: [{ id: 't1' }],
      outboundTemplates: [{ key: 'customer_debt_payment_template' }],
    },
  }];
  const report = reconcileLegacy({ releases, networks: [{ id: 'n1' }] });
  assert.equal(report.known, true);
  const byKind = Object.fromEntries(report.rows.map((row) => [row.kind, row.count]));
  assert.equal(byKind.wallets, 2);
  assert.equal(byKind.transferTemplates, 1);
  assert.equal(byKind.outboundTemplates, 1);
  assert.equal(byKind.networks, 1);
});

test('entry source distinguishes bundled, release, and draft-only items', () => {
  const bundledIds = new Set(['kuraimi']);
  const releaseIds = new Set(['rel-wallet']);
  assert.equal(describeEntrySource({ id: 'kuraimi' }, { bundledIds, releaseIds }).kind, 'bundled');
  assert.equal(describeEntrySource({ id: 'rel-wallet' }, { bundledIds, releaseIds }).kind, 'release');
  assert.equal(describeEntrySource({ id: 'fresh' }, { bundledIds, releaseIds }).kind, 'draft');
  assert.equal(describeEntrySource({ key: 'customer_debt_payment_template' }, { releaseIds: new Set(['customer_debt_payment_template']) }).kind, 'release');
});

test('collectReleaseEntryIds gathers ids from every release payload', () => {
  const ids = collectReleaseEntryIds([
    { payload: { wallets: [{ id: 'w1' }], transferTemplates: [{ id: 't1' }], outboundTemplates: [{ key: 'k1' }] } },
    { payload: { wallets: [{ id: 'w2' }], transferTemplates: [], outboundTemplates: [] } },
  ]);
  assert.deepEqual([...ids.wallets].sort(), ['w1', 'w2']);
  assert.deepEqual([...ids.transferTemplates], ['t1']);
  assert.deepEqual([...ids.outboundTemplates], ['k1']);
});

test('extractTemplateVariables supports {name} and %name and de-duplicates', () => {
  const variables = extractTemplateVariables('مرحباً {amount} و%amount و{pos_name}');
  assert.deepEqual([...variables].sort(), ['amount', 'pos_name']);
});

test('outbound validation flags empty body, unknown and missing variables', () => {
  const catalog = getTemplateCenterCatalog();
  assert.equal(validateOutboundTemplate({ key: 'customer_debt_payment_template', body: '', catalog }).ok, false);
  assert.ok(validateOutboundTemplate({ key: 'customer_debt_payment_template', body: 'مرحباً {amount}', catalog }).ok);

  const unknown = validateOutboundTemplate({ key: 'customer_debt_payment_template', body: '{amount} {nonsense}', catalog });
  assert.equal(unknown.ok, false);
  assert.ok(unknown.errors.some((error) => error.startsWith('unknown_variable:')));

  const missing = validateOutboundTemplate({ key: 'customer_debt_payment_template', body: 'بلا متغيرات', catalog });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.includes('required_variable_missing:amount'));

  assert.equal(validateOutboundTemplate({ key: 'no_such_key', body: '{amount}', catalog }).errors.includes('unknown_key'), true);
});

test('bundled pack stays consistent with the server catalog (no invented keys, required vars present)', () => {
  const catalog = getTemplateCenterCatalog();
  const knownKeys = new Set(catalog.outboundTemplates.map((item) => item.key));
  for (const template of BUNDLED_TEMPLATE_PACK.outboundTemplates) {
    assert.ok(knownKeys.has(template.key), `bundled key ${template.key} must exist in the server catalog`);
    const validation = validateOutboundTemplate({ key: template.key, body: template.body, catalog });
    assert.equal(validation.ok, true, `bundled template ${template.key} must be publishable: ${validation.errors.join(', ')}`);
  }
});

test('bundled pack clone is mutable and does not mutate the frozen source', () => {
  const clone = cloneBundledPack('2026-01-01T00:00:00.000Z');
  clone.wallets[0].name = 'معدّل';
  assert.notEqual(clone.wallets[0].name, BUNDLED_TEMPLATE_PACK.wallets[0].name);
  assert.equal(clone.wallets[0].createdAt, '2026-01-01T00:00:00.000Z');
  assert.notEqual(BUNDLED_TEMPLATE_PACK.wallets[0].createdAt, '2026-01-01T00:00:00.000Z');
});

test('bundled wallets never carry financial fields', () => {
  for (const wallet of BUNDLED_TEMPLATE_PACK.wallets) {
    for (const forbidden of ['balance', 'amount', 'amountMinor', 'credit', 'debt']) {
      assert.equal(forbidden in wallet, false, `wallet ${wallet.id} must not have ${forbidden}`);
    }
  }
});
