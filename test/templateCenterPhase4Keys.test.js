import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RETIRED_OUTBOUND_TEMPLATE_KEYS,
  getTemplateCenterCatalog,
  normalizeDraftInput,
  previewOutboundTemplate,
  validateTemplatePayload,
} from '../server/_lib/templateCenter.js';
import { ANDROID_DEFAULT_OUTBOUND_TEMPLATES } from '../src/lib/androidSeedCatalog.js';

const NEW_KEYS = {
  pos_order_card_line_template: { scope: 'outboundCustomer', required: ['serial', 'secret'] },
  pos_order_card_line_serial_only_template: { scope: 'outboundCustomer', required: ['serial'] },
  broadcast_customers_template: { scope: 'outboundCustomer', required: [] },
  broadcast_pos_template: { scope: 'outboundPos', required: [] },
  outbound_test_message_template: { scope: 'outboundSystem', required: [] },
};

test('phase-4 outbound keys are registered with the app scope and required variables', () => {
  const catalog = new Map(getTemplateCenterCatalog().outboundTemplates.map((item) => [item.key, item]));
  for (const [key, expected] of Object.entries(NEW_KEYS)) {
    assert.ok(catalog.has(key), `${key} must be registered`);
    assert.equal(catalog.get(key).scope, expected.scope);
    assert.deepEqual(catalog.get(key).required, expected.required);
  }
});

test('phase-4 Android defaults are publishable (valid variables, scopes and required set)', () => {
  const outboundTemplates = ANDROID_DEFAULT_OUTBOUND_TEMPLATES.filter((t) => NEW_KEYS[t.key]);
  assert.equal(outboundTemplates.length, Object.keys(NEW_KEYS).length);
  const result = validateTemplatePayload({ wallets: [], transferTemplates: [], outboundTemplates }, { allowDrafts: false });
  assert.deepEqual(result.errors ?? [], []);
  assert.equal(result.ok, true);
  const line = previewOutboundTemplate(outboundTemplates.find((t) => t.key === 'pos_order_card_line_template'),
    { serial: '123', secret: '999' });
  assert.equal(line.ok, true);
  assert.equal(line.preview, 'رقم الكرت: 123\nالرمز: 999');
});

test('card line template without {secret} is rejected (required variable)', () => {
  const result = validateTemplatePayload({
    wallets: [], transferTemplates: [], outboundTemplates: [{ key: 'pos_order_card_line_template', body: 'رقم الكرت: {serial}' }],
  }, { allowDrafts: false });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.endsWith('_required_variable_missing')));
});

test('salafni_card_delivery_template is retired: not in catalog or seeds, old releases stay valid, drafts drop it', () => {
  assert.deepEqual([...RETIRED_OUTBOUND_TEMPLATE_KEYS], ['salafni_card_delivery_template']);
  const keys = getTemplateCenterCatalog().outboundTemplates.map((item) => item.key);
  assert.ok(!keys.includes('salafni_card_delivery_template'));
  assert.ok(!ANDROID_DEFAULT_OUTBOUND_TEMPLATES.some((t) => t.key === 'salafni_card_delivery_template'));

  const legacy = { key: 'salafni_card_delivery_template', body: 'كرتك من خدمة سلفني\n{network_name}\n{الفئة}\n{الرقم}\n{الرمز}' };
  const kept = { key: 'card_delivery_cash_template', body: 'كرتك من شبكة {network_name}\n{الفئة}\n{الرقم}\n{الرمز}' };
  // A release published before retirement must not become invalid (the app would lose its active pack).
  const release = validateTemplatePayload({ wallets: [], transferTemplates: [], outboundTemplates: [legacy, kept] }, { allowDrafts: false });
  assert.equal(release.ok, true, JSON.stringify(release.errors));

  const draft = normalizeDraftInput({ scope: { type: 'global' }, payload: { outboundTemplates: [legacy, kept] } });
  assert.equal(draft.ok, true);
  assert.deepEqual(draft.value.payload.outboundTemplates.map((t) => t.key), ['card_delivery_cash_template']);

  assert.equal(previewOutboundTemplate(legacy).ok, false);
});
