import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createFakeFirestore, createRes } from './helpers/fakeFirestore.js';
import whatsappNetworkConfigHandler from '../server/_lib/whatsapp/networkConfigApi.js';
import whatsappWebhookHandler, {
  extractMetaInboundMessages,
  resolveNetworkIdByPhoneNumberId,
} from '../server/_lib/whatsapp/webhookHandler.js';
import whatsappDispatchHandler from '../server/_lib/whatsapp/dispatchHandler.js';
import {
  completeSmsFallbackFromDevice,
  createDeliveryOperation,
  tryStartSmsFallback,
  transitionDeliveryStatus,
} from '../server/_lib/whatsapp/deliveryOperations.js';
import { createInboundEvent } from '../server/_lib/whatsapp/inboundEvents.js';

const APP_SECRET = 'unit_test_meta_app_secret_32b_xx';
const VERIFY_TOKEN = 'unit_test_verify_token_value';
const DISPATCH_SECRET = 'unit_dispatch_secret_value_xx';

const adminOk = async () => ({ ok: true, callerUid: 'admin-1' });
const ensureOk = () => ({ ok: true });

test('extractMetaInboundMessages parses Cloud API payload', () => {
  const msgs = extractMetaInboundMessages({
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: '109900' },
          messages: [{ id: 'wamid.1', from: '9677', type: 'text', text: { body: 'hi' }, timestamp: '1700000000' }],
        },
      }],
    }],
  });
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].inboundMessageId, 'wamid.1');
  assert.equal(msgs[0].phoneNumberId, '109900');
});

test('network-config get/set requires admin and writes networks only', async () => {
  const db = createFakeFirestore({
    'networks/NET-10001': { owner_uid: 'user-1', networkId: 'NET-10001' },
  });
  const res = createRes();
  await whatsappNetworkConfigHandler(
    { method: 'POST', body: { action: 'set', networkId: 'NET-10001', config: { whatsappPrimaryProvider: 'cloud_api', whatsappPhoneNumberId: '109900', whatsappCloudLinkStatus: 'linked' } }, headers: {} },
    res,
    {
      db,
      ensureFirebaseAdmin: ensureOk,
      authenticateAdmin: adminOk,
      getAuth: () => ({}),
      getFirestore: () => db,
      serverTimestamp: () => 'TS',
      now: 1_800_000_000_000,
    },
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.config.whatsappPrimaryProvider, 'cloud_api');
  assert.equal(db._store.get('networks/NET-10001').whatsappPhoneNumberId, '109900');
  assert.equal(db._store.has('users/user-1'), false);
});

test('webhook rejects bad signature', async () => {
  const db = createFakeFirestore();
  const res = createRes();
  const body = '{"object":"whatsapp_business_account","entry":[]}';
  await whatsappWebhookHandler(
    { method: 'POST', body: JSON.parse(body), headers: { 'x-hub-signature-256': 'sha256=00' } },
    res,
    {
      db,
      ensureFirebaseAdmin: ensureOk,
      getMetaAppSecret: async () => ({ ok: true, value: APP_SECRET }),
      rawBody: body,
    },
  );
  assert.equal(res.statusCode, 401);
});

test('webhook creates inbound event once for resolved network', async () => {
  const db = createFakeFirestore({
    'networks/NET-10001': { owner_uid: 'user-1', whatsappPhoneNumberId: '109900' },
  });
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: '109900' },
          messages: [{ id: 'wamid.ABC', from: '967700', type: 'text', text: { body: 'card please' }, timestamp: '1700000000' }],
        },
      }],
    }],
  };
  const rawBody = JSON.stringify(payload);
  const hex = createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');

  const res1 = createRes();
  await whatsappWebhookHandler(
    { method: 'POST', body: payload, headers: { 'x-hub-signature-256': `sha256=${hex}` } },
    res1,
    {
      db,
      ensureFirebaseAdmin: ensureOk,
      getMetaAppSecret: async () => ({ ok: true, value: APP_SECRET }),
      rawBody,
      now: 1_800_000_000_000,
    },
  );
  assert.equal(res1.statusCode, 200);
  assert.equal(res1.body.accepted, 1);
  assert.ok(db._store.has('whatsapp_inbound_events/meta_NET-10001_wamid.ABC'));
  assert.equal(db._store.get('whatsapp_inbound_events/meta_NET-10001_wamid.ABC').text, 'card please');

  const res2 = createRes();
  await whatsappWebhookHandler(
    { method: 'POST', body: payload, headers: { 'x-hub-signature-256': `sha256=${hex}` } },
    res2,
    {
      db,
      ensureFirebaseAdmin: ensureOk,
      getMetaAppSecret: async () => ({ ok: true, value: APP_SECRET }),
      rawBody,
      now: 1_800_000_000_100,
    },
  );
  assert.equal(res2.body.duplicates, 1);
  assert.equal(res2.body.accepted, 0);
});

test('delivery operation create is once-only; SMS path no second op', async () => {
  const db = createFakeFirestore();
  const a = await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'user-1', saleUuid: 'sale-001', now: 1000,
  });
  const b = await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'user-1', saleUuid: 'sale-001', now: 1001,
  });
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  assert.equal(a.deliveryOperationId, b.deliveryOperationId);

  await transitionDeliveryStatus(db, a.deliveryOperationId, 'sent', {}, 2000);
  const sms = await tryStartSmsFallback(db, a.deliveryOperationId, 12000);
  assert.equal(sms.ok, true);
  assert.equal(sms.data.status, 'sms_pending');
  assert.equal(sms.data.saleUuid, 'sale-001');
  const sent = await completeSmsFallbackFromDevice(db, a.deliveryOperationId, 'sent', {}, 12500);
  assert.equal(sent.ok, true);
  assert.equal(sent.data.status, 'sms_sent');
  const again = await tryStartSmsFallback(db, a.deliveryOperationId, 13000);
  assert.equal(again.ok, false);
});

test('dispatch rejects missing secret and client saleUuid', async () => {
  const db = createFakeFirestore();
  const res = createRes();
  await whatsappDispatchHandler(
    { method: 'POST', body: { saleUuid: 'evil' }, headers: {} },
    res,
    {
      db,
      ensureFirebaseAdmin: ensureOk,
      getDispatchServiceSecret: async () => ({ ok: true, value: DISPATCH_SECRET }),
    },
  );
  assert.equal(res.statusCode, 403);

  const res2 = createRes();
  await whatsappDispatchHandler(
    { method: 'POST', body: { saleUuid: 'evil' }, headers: { 'x-dispatch-service-secret': DISPATCH_SECRET } },
    res2,
    {
      db,
      ensureFirebaseAdmin: ensureOk,
      getDispatchServiceSecret: async () => ({ ok: true, value: DISPATCH_SECRET }),
    },
  );
  assert.equal(res2.statusCode, 400);
  assert.equal(res2.body.error, 'client_payload_forbidden');
});

test('resolveNetworkIdByPhoneNumberId uses network field', async () => {
  const db = createFakeFirestore({
    'networks/NET-10002': { whatsappPhoneNumberId: '555' },
  });
  assert.equal(await resolveNetworkIdByPhoneNumberId(db, '555'), 'NET-10002');
  assert.equal(await resolveNetworkIdByPhoneNumberId(db, '999'), null);
});
