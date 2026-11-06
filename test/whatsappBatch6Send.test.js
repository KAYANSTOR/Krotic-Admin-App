import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeFirestore, createRes } from './helpers/fakeFirestore.js';
import {
  classifyMetaSendError,
  buildCloudTextMessagePayload,
  sendCloudTextMessage,
} from '../server/_lib/whatsapp/metaCloudSend.js';
import { sendWhatsappForDeliveryOperation } from '../server/_lib/whatsapp/sendOrchestration.js';
import { createDeliveryOperation } from '../server/_lib/whatsapp/deliveryOperations.js';
import { resolveSmsCardAdapter, SMS_CARD_DELIVERY_CONTRACT } from '../server/_lib/whatsapp/smsAdapterContract.js';
import whatsappUnknownOutcomeHandler from '../server/_lib/whatsapp/unknownOutcomeApi.js';
import { markSmsOutcomeUnknown } from '../server/_lib/whatsapp/smsProvider.js';
import { sealNetworkAccessToken } from '../server/_lib/whatsapp/secrets.js';

const ensureOk = () => ({ ok: true });

test('classifyMetaSendError maps auth and rate limit', () => {
  assert.equal(classifyMetaSendError({ status: 401 }).retryable, false);
  assert.equal(classifyMetaSendError({ status: 429 }).retryable, true);
  assert.equal(classifyMetaSendError({ code: 190 }).reason, 'invalid_token');
});

test('buildCloudTextMessagePayload validates recipient', () => {
  assert.equal(buildCloudTextMessagePayload({ toE164: 'abc', text: 'hi' }).ok, false);
  const ok = buildCloudTextMessagePayload({ toE164: '+967770000001', text: 'card body', clientReferenceId: 'NET-10001__sale-1' });
  assert.equal(ok.ok, true);
  assert.equal(ok.body.to, '967770000001');
  assert.equal(ok.body.biz_opaque_callback_data, 'NET-10001__sale-1');
});

test('sendCloudTextMessage dry-run when live disabled', async () => {
  process.env.WHATSAPP_SECRETS_KEK = Buffer.alloc(32, 9).toString('base64');
  delete process.env.WHATSAPP_LIVE_SEND;
  const sealed = sealNetworkAccessToken('NET-10001', 'EAABtesttokenvalue1234567890');
  const db = createFakeFirestore({
    'networks/NET-10001': { whatsappPhoneNumberId: '1099', whatsappCloudLinkStatus: 'linked' },
    'whatsapp_network_secrets/NET-10001': { networkId: 'NET-10001', whatsappAccessTokenEnc: sealed.envelope },
  });
  const r = await sendCloudTextMessage(db, {
    networkId: 'NET-10001',
    toE164: '967770000001',
    text: 'hello',
  });
  assert.equal(r.error, 'live_send_disabled');
  assert.equal(r.dryRun, true);
  assert.ok(!JSON.stringify(r).includes('EAABtest'));
});

test('sendCloudTextMessage with injected fetch links message id', async () => {
  process.env.WHATSAPP_SECRETS_KEK = Buffer.alloc(32, 9).toString('base64');
  const sealed = sealNetworkAccessToken('NET-10001', 'EAABtesttokenvalue1234567890');
  const db = createFakeFirestore({
    'networks/NET-10001': { whatsappPhoneNumberId: '1099', whatsappCloudLinkStatus: 'linked' },
    'whatsapp_network_secrets/NET-10001': { networkId: 'NET-10001', whatsappAccessTokenEnc: sealed.envelope },
  });
  const r = await sendCloudTextMessage(db, {
    networkId: 'NET-10001',
    toE164: '967770000001',
    text: 'hello',
  }, {
    fetch: async (url, init) => {
      assert.ok(url.includes('/1099/messages'));
      assert.ok(String(init.headers.Authorization).startsWith('Bearer '));
      assert.ok(!String(init.body).includes('EAABtest')); // body is message not token
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ messages: [{ id: 'wamid.TEST1' }] }),
      };
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.providerMessageId, 'wamid.TEST1');
});

test('sendWhatsappForDeliveryOperation is idempotent on providerMessageId', async () => {
  process.env.WHATSAPP_SECRETS_KEK = Buffer.alloc(32, 9).toString('base64');
  const sealed = sealNetworkAccessToken('NET-10001', 'EAABtesttokenvalue1234567890');
  const db = createFakeFirestore({
    'networks/NET-10001': { whatsappPhoneNumberId: '1099', whatsappCloudLinkStatus: 'linked' },
    'whatsapp_network_secrets/NET-10001': { networkId: 'NET-10001', whatsappAccessTokenEnc: sealed.envelope },
    'users/u1': { account_features: { whatsapp_card_delivery: true } },
  });
  const op = await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'u1', saleUuid: 'sale-send-1', now: 1000,
  });
  const sendDeps = {
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ messages: [{ id: 'wamid.ONCE' }] }),
    }),
  };
  const a = await sendWhatsappForDeliveryOperation(db, op.deliveryOperationId, {
    toE164: '967770000001', text: 'card', now: 2000, sendDeps,
  });
  assert.equal(a.ok, true);
  const b = await sendWhatsappForDeliveryOperation(db, op.deliveryOperationId, {
    toE164: '967770000001', text: 'card', now: 3000, sendDeps,
  });
  assert.equal(b.alreadySent, true);
  assert.equal(b.providerMessageId, 'wamid.ONCE');
});

test('SMS card adapter reports not configured without inventing provider', () => {
  delete process.env.SMS_PROVIDER;
  const r = resolveSmsCardAdapter();
  assert.equal(r.ok, false);
  assert.equal(r.error, 'sms_provider_not_configured');
  assert.equal(r.contract.purpose, SMS_CARD_DELIVERY_CONTRACT.purpose);
});

test('unknown outcomes list and resolve without resend', async () => {
  const db = createFakeFirestore();
  const op = await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'u1', saleUuid: 'sale-unk-1', now: 1000,
  });
  await markSmsOutcomeUnknown(db, op.deliveryOperationId, 5000, 'request_started_no_accept');

  const resList = createRes();
  await whatsappUnknownOutcomeHandler(
    { method: 'POST', body: { action: 'list' }, headers: {} },
    resList,
    {
      db,
      ensureFirebaseAdmin: ensureOk,
      authenticateAdmin: async () => ({ ok: true, callerUid: 'admin-1' }),
    },
  );
  assert.equal(resList.statusCode, 200);
  assert.equal(resList.body.count, 1);

  const resResolve = createRes();
  await whatsappUnknownOutcomeHandler(
    { method: 'POST', body: { action: 'mark_resolved', deliveryOperationId: op.deliveryOperationId }, headers: {} },
    resResolve,
    {
      db,
      ensureFirebaseAdmin: ensureOk,
      authenticateAdmin: async () => ({ ok: true, callerUid: 'admin-1' }),
    },
  );
  assert.equal(resResolve.statusCode, 200);
  assert.equal(db._store.get(`whatsapp_delivery_operations/${op.deliveryOperationId}`).smsOutcomeUnknown, false);
});
