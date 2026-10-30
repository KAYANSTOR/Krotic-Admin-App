import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyMetaSignature, verifyMetaSubscription } from '../server/_lib/whatsapp/signature.js';
import {
  buildInboundEventDocId,
  buildDeliveryOperationId,
  WHATSAPP_PROVIDER_META,
} from '../server/_lib/whatsapp/eventIdentity.js';
import {
  validateNetworkWhatsappInput,
  readNetworkWhatsappConfig,
} from '../server/_lib/whatsapp/networkConfig.js';
import {
  canTransition,
  canStartSmsFallback,
  canMarkDeliveredLateAfterSms,
  computeWhatsappDeadlineAtMs,
  isWhatsappDeadlineExpired,
  WHATSAPP_CONFIRMATION_WINDOW_MS,
} from '../server/_lib/whatsapp/deliveryState.js';
import { isWhatsappCardDeliveryEnabled } from '../server/_lib/whatsapp/entitlementsGate.js';
import { secretsReadinessReport } from '../server/_lib/whatsapp/secrets.js';

const APP_SECRET = 'test_meta_app_secret_value_32chars!!';

test('verifyMetaSignature accepts valid HMAC and rejects bad signatures', () => {
  const body = '{"object":"whatsapp_business_account"}';
  const hex = createHmac('sha256', APP_SECRET).update(body).digest('hex');
  assert.equal(verifyMetaSignature(body, `sha256=${hex}`, APP_SECRET).ok, true);
  assert.equal(verifyMetaSignature(body, 'sha256=deadbeef', APP_SECRET).ok, false);
  assert.equal(verifyMetaSignature(body, '', APP_SECRET).error, 'signature_missing');
  assert.equal(verifyMetaSignature(body, `sha256=${hex}`, '').error, 'app_secret_missing');
  assert.equal(verifyMetaSignature('tampered', `sha256=${hex}`, APP_SECRET).ok, false);
});

test('verifyMetaSubscription checks mode and token', () => {
  const ok = verifyMetaSubscription({
    mode: 'subscribe',
    token: 'verify-token-value-ok',
    challenge: '12345',
    expectedToken: 'verify-token-value-ok',
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.challenge, '12345');
  assert.equal(verifyMetaSubscription({
    mode: 'subscribe', token: 'wrong', challenge: '1', expectedToken: 'verify-token-value-ok',
  }).ok, false);
});

test('inbound event doc id includes provider + network + message', () => {
  const r = buildInboundEventDocId({
    providerId: WHATSAPP_PROVIDER_META,
    networkId: 'NET-10001',
    inboundMessageId: 'wamid.ABCDEF',
  });
  assert.equal(r.ok, true);
  assert.equal(r.docId, 'meta_NET-10001_wamid.ABCDEF');
  assert.equal(buildInboundEventDocId({
    providerId: 'meta', networkId: 'bad id', inboundMessageId: 'x',
  }).ok, false);
});

test('delivery operation id is deterministic per network+sale', () => {
  const a = buildDeliveryOperationId({ networkId: 'NET-10001', saleUuid: 'sale-uuid-001' });
  const b = buildDeliveryOperationId({ networkId: 'NET-10001', saleUuid: 'sale-uuid-001' });
  assert.equal(a.ok && b.ok, true);
  assert.equal(a.deliveryOperationId, b.deliveryOperationId);
  assert.equal(a.deliveryOperationId, 'NET-10001__sale-uuid-001');
});

test('network config rejects secrets and local_gateway until D4', () => {
  assert.equal(validateNetworkWhatsappInput({ accessToken: 'x' }).ok, false);
  assert.equal(validateNetworkWhatsappInput({ whatsappPrimaryProvider: 'local_gateway' }).error, 'local_gateway_not_enabled');
  const ok = validateNetworkWhatsappInput({
    whatsappPrimaryProvider: 'cloud_api',
    whatsappPhoneNumberId: '1234567890',
    whatsappCloudLinkStatus: 'linked',
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.whatsappPrimaryProvider, 'cloud_api');
});

test('readNetworkWhatsappConfig never invents provider', () => {
  const empty = readNetworkWhatsappConfig({});
  assert.equal(empty.whatsappPrimaryProvider, null);
  assert.equal(empty.whatsappCloudLinkStatus, 'unlinked');
});

test('delivery state machine transitions', () => {
  assert.equal(canTransition('accepted', 'sent'), true);
  assert.equal(canTransition('sent', 'sms_pending'), true);
  assert.equal(canTransition('sms_pending', 'sms_sent'), true);
  assert.equal(canTransition('sms_sent', 'delivered_late_after_sms'), true);
  assert.equal(canTransition('sms_sent', 'sent'), false);
  assert.equal(canTransition('delivered', 'sms_pending'), false);
  assert.equal(canStartSmsFallback('sent'), true);
  assert.equal(canMarkDeliveredLateAfterSms('sms_sent'), true);
  assert.equal(canMarkDeliveredLateAfterSms('sent'), false);
});

test('10s deadline helpers', () => {
  const sent = 1_000_000;
  const deadline = computeWhatsappDeadlineAtMs(sent);
  assert.equal(deadline, sent + WHATSAPP_CONFIRMATION_WINDOW_MS);
  assert.equal(isWhatsappDeadlineExpired(deadline, sent + 9_999), false);
  assert.equal(isWhatsappDeadlineExpired(deadline, sent + 10_000), true);
});

test('whatsapp entitlement is fail-closed', () => {
  assert.equal(isWhatsappCardDeliveryEnabled(undefined), false);
  assert.equal(isWhatsappCardDeliveryEnabled({}), false);
  assert.equal(isWhatsappCardDeliveryEnabled({ whatsapp_card_delivery: false }), false);
  assert.equal(isWhatsappCardDeliveryEnabled({ whatsapp_card_delivery: true }), true);
  assert.equal(isWhatsappCardDeliveryEnabled({ whatsapp_card_delivery: 'true' }), false);
});

test('secrets readiness does not claim GCP success', () => {
  const report = secretsReadinessReport();
  assert.ok(['not_configured', 'secret_manager'].includes(report.backend));
  assert.notEqual(report.cloudTasks, 'ready');
});
