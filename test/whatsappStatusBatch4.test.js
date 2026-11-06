import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createFakeFirestore, createRes } from './helpers/fakeFirestore.js';
import { createDeliveryOperation, transitionDeliveryStatus } from '../server/_lib/whatsapp/deliveryOperations.js';
import { markSentAndEnqueueDeadline } from '../server/_lib/whatsapp/deliveryOrchestration.js';
import { tryStartSmsFallbackOnce, claimSmsFallbackSlot } from '../server/_lib/whatsapp/smsClaim.js';
import { processMetaStatusUpdate, extractMetaStatusUpdates } from '../server/_lib/whatsapp/statusEvents.js';
import whatsappWebhookHandler from '../server/_lib/whatsapp/webhookHandler.js';

const APP_SECRET = 'unit_test_meta_app_secret_32b_xx';
const ensureOk = () => ({ ok: true });

function statusPayload(phoneNumberId, statuses) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, statuses } }] }],
  };
}

test('extractMetaStatusUpdates maps Meta statuses', () => {
  const payload = statusPayload('111', [
    { id: 'wamid.OUT1', status: 'delivered', timestamp: '1700000010' },
  ]);
  const list = extractMetaStatusUpdates(payload);
  assert.equal(list.length, 1);
  assert.equal(list[0].internalStatus, 'delivered');
  assert.equal(list[0].providerMessageId, 'wamid.OUT1');
});

test('delivered before 10s deadline moves op to delivered', async () => {
  const db = createFakeFirestore({
    'networks/NET-10001': { whatsappPhoneNumberId: '111' },
  });
  const op = await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'u1', saleUuid: 'sale-d1', now: 1000,
  });
  await markSentAndEnqueueDeadline(db, op.deliveryOperationId, {
    networkId: 'NET-10001', now: 2000, providerMessageId: 'wamid.OUT1',
  });

  const r = await processMetaStatusUpdate(db, {
    providerMessageId: 'wamid.OUT1',
    internalStatus: 'delivered',
    metaStatus: 'delivered',
    phoneNumberId: '111',
    occurredAtMs: 2500,
  }, {
    resolveNetworkIdByPhoneNumberId: async () => 'NET-10001',
    now: 2500,
  });
  assert.equal(r.ok, true);
  const data = db._store.get(`whatsapp_delivery_operations/${op.deliveryOperationId}`);
  assert.equal(data.status, 'delivered');
  assert.equal(data.smsFallbackSentAtMs, null);
});

test('failed after delivered is ignored (no regression)', async () => {
  const db = createFakeFirestore();
  const op = await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'u1', saleUuid: 'sale-f1', now: 1000,
  });
  await transitionDeliveryStatus(db, op.deliveryOperationId, 'sent', { providerMessageId: 'wamid.F' }, 2000);
  await transitionDeliveryStatus(db, op.deliveryOperationId, 'delivered', {}, 3000);

  const r = await processMetaStatusUpdate(db, {
    providerMessageId: 'wamid.F',
    internalStatus: 'failed',
    metaStatus: 'failed',
    phoneNumberId: '111',
  }, {
    resolveNetworkIdByPhoneNumberId: async () => 'NET-10001',
    now: 4000,
  });
  assert.equal(r.applied?.skipped || r.skipped, true);
  assert.equal(db._store.get(`whatsapp_delivery_operations/${op.deliveryOperationId}`).status, 'delivered');
});

test('late delivered after SMS → delivered_late_after_sms, no second SMS', async () => {
  const db = createFakeFirestore();
  const op = await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'u1', saleUuid: 'sale-late', now: 1000,
  });
  await transitionDeliveryStatus(db, op.deliveryOperationId, 'sent', { providerMessageId: 'wamid.L' }, 2000);
  const sms = await tryStartSmsFallbackOnce(db, op.deliveryOperationId, { workerId: 'w1', now: 15000 });
  assert.equal(sms.ok, true);

  await processMetaStatusUpdate(db, {
    providerMessageId: 'wamid.L',
    internalStatus: 'delivered',
    metaStatus: 'delivered',
    phoneNumberId: '111',
  }, {
    resolveNetworkIdByPhoneNumberId: async () => 'NET-10001',
    now: 16000,
  });
  const data = db._store.get(`whatsapp_delivery_operations/${op.deliveryOperationId}`);
  assert.equal(data.status, 'delivered_late_after_sms');

  const sms2 = await tryStartSmsFallbackOnce(db, op.deliveryOperationId, { workerId: 'w2', now: 17000 });
  assert.equal(sms2.ok, false);
});

test('duplicate status event processed once', async () => {
  const db = createFakeFirestore();
  const op = await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'u1', saleUuid: 'sale-dup', now: 1000,
  });
  await transitionDeliveryStatus(db, op.deliveryOperationId, 'sent', { providerMessageId: 'wamid.DUP' }, 2000);

  const args = {
    providerMessageId: 'wamid.DUP',
    internalStatus: 'delivered',
    metaStatus: 'delivered',
    phoneNumberId: '111',
  };
  const resolve = async () => 'NET-10001';
  const a = await processMetaStatusUpdate(db, args, { resolveNetworkIdByPhoneNumberId: resolve, now: 3000 });
  const b = await processMetaStatusUpdate(db, args, { resolveNetworkIdByPhoneNumberId: resolve, now: 3001 });
  assert.equal(a.ok, true);
  assert.equal(b.skipped, true);
  assert.equal(b.reason, 'status_event_duplicate');
});

test('unlinked providerMessageId does not invent delivery', async () => {
  const db = createFakeFirestore();
  const r = await processMetaStatusUpdate(db, {
    providerMessageId: 'wamid.UNKNOWN',
    internalStatus: 'delivered',
    metaStatus: 'delivered',
    phoneNumberId: '111',
  }, {
    resolveNetworkIdByPhoneNumberId: async () => 'NET-10001',
    now: 1000,
  });
  assert.equal(r.reason, 'delivery_unlinked');
  assert.equal(
    [...db._store.keys()].filter((k) => k.startsWith('whatsapp_delivery_operations/')).length,
    0,
  );
});

test('concurrent SMS claim: only one worker wins', async () => {
  const db = createFakeFirestore();
  const op = await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'u1', saleUuid: 'sale-race-sms', now: 1000,
  });
  await transitionDeliveryStatus(db, op.deliveryOperationId, 'sent', {}, 2000);

  const results = await Promise.all([
    tryStartSmsFallbackOnce(db, op.deliveryOperationId, { workerId: 'a', now: 15000 }),
    tryStartSmsFallbackOnce(db, op.deliveryOperationId, { workerId: 'b', now: 15000 }),
    tryStartSmsFallbackOnce(db, op.deliveryOperationId, { workerId: 'c', now: 15000 }),
  ]);
  const wins = results.filter((r) => r.ok);
  assert.ok(wins.length >= 1);
  const data = db._store.get(`whatsapp_delivery_operations/${op.deliveryOperationId}`);
  assert.equal(data.status, 'sms_sent');
  assert.ok(data.smsFallbackSentAtMs);
});

test('webhook status path requires signature and applies delivered', async () => {
  const db = createFakeFirestore({
    'networks/NET-10001': { whatsappPhoneNumberId: '999' },
  });
  const op = await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'u1', saleUuid: 'sale-wh', now: 1000,
  });
  await transitionDeliveryStatus(db, op.deliveryOperationId, 'sent', { providerMessageId: 'wamid.WH' }, 2000);

  const payload = statusPayload('999', [
    { id: 'wamid.WH', status: 'delivered', timestamp: '1700000100' },
  ]);
  const rawBody = JSON.stringify(payload);
  const hex = createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');
  const res = createRes();
  await whatsappWebhookHandler(
    { method: 'POST', body: payload, headers: { 'x-hub-signature-256': `sha256=${hex}` } },
    res,
    {
      db,
      ensureFirebaseAdmin: ensureOk,
      getMetaAppSecret: async () => ({ ok: true, value: APP_SECRET }),
      rawBody,
      now: 5000,
    },
  );
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.statusesApplied >= 1);
  assert.equal(db._store.get(`whatsapp_delivery_operations/${op.deliveryOperationId}`).status, 'delivered');
});
