// Admin delivery report (plan §4.4): pure display helpers used by src/pages/WhatsappDeliveriesPage.jsx.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DELIVERY_STATE_LABELS,
  WHATSAPP_STATUS_LABELS,
  FALLBACK_REASON_LABELS,
  FINAL_OUTCOME_LABELS,
  fallbackReasonLabel,
  outcomeTone,
  formatMs,
  relativeSeconds,
  deliveryDetailRows,
  deliveryNotices,
  deliveryErrorText,
  reportQuery,
} from '../src/lib/whatsappDeliveryReport.js';
import {
  DELIVERY_STATES,
  WHATSAPP_STATUSES,
  FALLBACK_REASONS,
  newDeliveryDoc,
  parseSendBody,
  toDeliveryView,
} from '../server/_lib/whatsappDeliveries.js';

test('every server state, WhatsApp status, fallback reason and outcome has an Arabic label', () => {
  for (const s of DELIVERY_STATES) assert.ok(DELIVERY_STATE_LABELS[s], `state ${s}`);
  for (const s of WHATSAPP_STATUSES) assert.ok(WHATSAPP_STATUS_LABELS[s], `status ${s}`);
  for (const r of FALLBACK_REASONS) assert.ok(FALLBACK_REASON_LABELS[r], `reason ${r}`);
  for (const o of ['whatsapp', 'sms', 'none', 'pending']) assert.ok(FINAL_OUTCOME_LABELS[o], `outcome ${o}`);
  assert.equal(fallbackReasonLabel('whatsapp_send_failed:not_connected'), 'فشل الإرسال: جلسة WhatsApp غير متصلة');
  assert.match(fallbackReasonLabel('whatsapp_send_failed:rate_limited'), /rate_limited/);
  assert.equal(fallbackReasonLabel(null), '—');
  assert.equal(outcomeTone('none'), 'danger');
  assert.equal(outcomeTone('whatsapp'), 'success');
});

test('time helpers', () => {
  assert.equal(formatMs(null), '—');
  assert.equal(formatMs(0), '—');
  assert.notEqual(formatMs(Date.UTC(2026, 10, 12, 10, 0, 0)), '—');
  assert.equal(relativeSeconds(1000, 4200), '+3.2 ث');
  assert.equal(relativeSeconds(null, 4200), null);
});

function sampleView(overrides = {}) {
  const parsed = parseSendBody({
    to: '967771234567', text: 'كرتك: 1234', deliveryOperationId: 'sale:S-1:card:C-9',
    saleRef: 'S-1', cardRef: 'C-9', templateKey: 'pos_order_card_line_template', smsFallback: true,
  });
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  const doc = newDeliveryDoc({ networkId: 'NET-1', ...parsed.value, now: 1_000 });
  return { ...toDeliveryView(doc), ...overrides };
}

test('detail rows cover every §4.4 field and never print the message text', () => {
  const view = sampleView({
    acceptedAtMs: 1_000, serverAckAtMs: 1_500, deliveredAtMs: 4_200, receiptDeadlineAtMs: 11_000,
    whatsappStatus: 'delivered', state: 'delivered', finalOutcome: 'whatsapp', messageId: 'WAMID1', attempts: 1,
  });
  const rows = deliveryDetailRows(view);
  const keys = rows.map((r) => r.key);
  for (const k of ['operation', 'order', 'customer', 'to', 'card', 'channel', 'template', 'sentAt', 'serverAck',
    'deliveredAt', 'readAt', 'whatsapp', 'deadline', 'reason', 'sms', 'attempts', 'lastError', 'messageId', 'outcome']) {
    assert.ok(keys.includes(k), `missing row ${k}`);
  }
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  assert.equal(byKey.operation, 'sale:S-1:card:C-9');
  assert.equal(byKey.card, 'C-9');
  assert.match(byKey.deliveredAt, /\+3\.2 ث/);
  assert.equal(byKey.whatsapp, WHATSAPP_STATUS_LABELS.delivered);
  assert.equal(byKey.outcome, FINAL_OUTCOME_LABELS.whatsapp);
  assert.ok(!JSON.stringify(rows).includes('كرتك: 1234'), 'message text must not be displayed');
});

test('fallback row shows reason and decider; non-card messages are labelled', () => {
  const view = sampleView({
    cardRef: null, state: 'sms_fallback_sent', finalOutcome: 'sms',
    fallback: { reason: 'delivery_timeout', decidedBy: 'gateway', atMs: 11_000 },
    sms: { status: 'sent', attempts: 1, sentAtMs: 12_000, lastError: null },
  });
  const byKey = Object.fromEntries(deliveryDetailRows(view).map((r) => [r.key, r.value]));
  assert.equal(byKey.card, 'رسالة بلا كرت');
  assert.match(byKey.reason, /انتهت مهلة العشر ثوانٍ/);
  assert.match(byKey.reason, /خادم WhatsApp/);
  assert.match(byKey.sms, /أُرسل/);
  assert.match(byKey.attempts, /SMS: 1/);
});

test('notices surface late delivery, SMS after delivered and recoverable SMS failure', () => {
  assert.deepEqual(deliveryNotices(sampleView()), []);
  const late = deliveryNotices(sampleView({ lateDelivery: { atMs: 20_000, whatsappStatus: 'delivered' } }));
  assert.equal(late.length, 1);
  assert.match(late[0].text, /متأخراً/);
  const after = deliveryNotices(sampleView({ smsAfterDelivered: { attempt: 2 } }));
  assert.match(after[0].text, /محاولة 2/);
  const failed = deliveryNotices(sampleView({ state: 'sms_fallback_failed' }));
  assert.equal(failed[0].tone, 'danger');
});

test('error text and query string', () => {
  assert.match(deliveryErrorText('delivery_index_missing'), /firestore\.indexes\.json/);
  assert.equal(deliveryErrorText('weird'), 'تعذر جلب تقرير التسليم.');
  assert.equal(reportQuery(), 'limit=200');
  assert.equal(
    reportQuery({ networkId: ' NET-1 ', state: 'delivered', from: '2026-11-01', to: '2026-11-12', limit: 50 }),
    'networkId=NET-1&state=delivered&from=2026-11-01&to=2026-11-12&limit=50',
  );
});
