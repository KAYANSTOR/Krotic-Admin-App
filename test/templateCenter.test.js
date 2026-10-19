import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getTemplateCenterCatalog,
  normalizeDraftInput,
  previewOutboundTemplate,
  simulateInboundTemplates,
  validateTemplatePayload,
} from '../server/_lib/templateCenter.js';

const validPayload = {
  wallets: [{
    id: 'wallet-one',
    name: 'محفظة تجريبية',
    status: 'active',
    sourceMode: 'sms',
    createdAt: '2026-10-19T00:00:00.000Z',
  }],
  transferTemplates: [{
    id: 'transfer-one',
    name: 'تحويل وارد',
    pattern: 'تحويل {amount} الى {phone}',
    identifierKind: 'phone',
    walletId: 'wallet-one',
    priority: 10,
    isActive: true,
    requireReference: false,
  }],
  outboundTemplates: [{
    key: 'customer_debt_payment_template',
    body: 'تم استلام {amount} من الحساب',
  }],
};

test('normalizes draft data using the published transferTemplates contract', () => {
  const result = normalizeDraftInput({
    title: 'مسودة اختبار',
    scope: { type: 'global' },
    payload: validPayload,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value.payload.transferTemplates, validPayload.transferTemplates);
  assert.equal('inboundTemplates' in result.value.payload, false);
});

test('rejects a published transfer template without an amount placeholder', () => {
  const payload = structuredClone(validPayload);
  payload.transferTemplates[0].pattern = 'تم التحويل إلى {phone}';

  const result = validateTemplatePayload(payload, { allowDrafts: false });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('transferTemplates[0]_required_amount_missing'));
});

test('simulates matching Arabic digits without causing a financial side effect', () => {
  const result = simulateInboundTemplates(validPayload, { body: 'تحويل ١٥٠٠ الى ٧٧١٢٣٤٥٦٧' });

  assert.equal(result.matched, true);
  assert.equal(result.extracted.amount, '1500');
  assert.equal(result.financialSideEffect, false);
});

test('previews only known outbound variables in the template scope', () => {
  const template = validPayload.outboundTemplates[0];
  assert.deepEqual(previewOutboundTemplate(template, { amount: '1500' }), {
    ok: true,
    preview: 'تم استلام 1500 من الحساب',
  });
  assert.equal(previewOutboundTemplate(template, { amount: '1500', transfers: '3' }).reason, 'variable_scope_invalid');
  assert.equal(previewOutboundTemplate({ ...template, body: 'تم الدفع' }, {}).reason, 'required_variable_missing');
});

test('exposes the server catalog used by the admin template editor', () => {
  const catalog = getTemplateCenterCatalog();
  assert.ok(catalog.identifierKinds.includes('balanceRequestCode'));
  assert.ok(catalog.outboundTemplates.some((template) => template.key === 'customer_debt_payment_template'));
  assert.ok(catalog.outboundVariables.includes('amount'));
});
