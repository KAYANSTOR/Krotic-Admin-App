import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeFirestore } from './helpers/fakeFirestore.js';
import { createDeliveryOperation, transitionDeliveryStatus } from '../server/_lib/whatsapp/deliveryOperations.js';
import { processMetaStatusUpdate } from '../server/_lib/whatsapp/statusEvents.js';
import { sendWhatsappForDeliveryOperation } from '../server/_lib/whatsapp/sendOrchestration.js';
import { sendCloudTextMessage, classifyMetaSendError } from '../server/_lib/whatsapp/metaCloudSend.js';
import { sealNetworkAccessToken } from '../server/_lib/whatsapp/secrets.js';
import { enqueueSmsDeviceTask, ANDROID_SMS_INTEGRATION_NOTES } from '../server/_lib/whatsapp/smsDeviceTaskContract.js';
import { collectNetworkWhatsappStatus } from '../server/_lib/whatsapp/networkStatusMetrics.js';

function setupNetwork(db, networkId, tokenPlain) {
  process.env.WHATSAPP_SECRETS_KEK = Buffer.alloc(32, 7).toString('base64');
  const sealed = sealNetworkAccessToken(networkId, tokenPlain);
  db._store.set(`networks/${networkId}`, {
    whatsappPhoneNumberId: networkId === 'NET-10001' ? '111' : '222',
    whatsappCloudLinkStatus: 'linked',
    whatsappPrimaryProvider: 'cloud_api',
  });
  db._store.set(`whatsapp_network_secrets/${networkId}`, {
    networkId,
    whatsappAccessTokenEnc: sealed.envelope,
  });
  db._store.set('users/u1', { account_features: { whatsapp_card_delivery: true } });
}

test('cycle: sent → delivered → read', async () => {
  const db = createFakeFirestore();
  const op = await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'u1', saleUuid: 'cycle-1', now: 1,
  });
  await transitionDeliveryStatus(db, op.deliveryOperationId, 'sent', { providerMessageId: 'wamid.C1' }, 2);
  const resolve = async () => 'NET-10001';
  await processMetaStatusUpdate(db, {
    providerMessageId: 'wamid.C1', internalStatus: 'delivered', metaStatus: 'delivered', phoneNumberId: '1',
  }, { resolveNetworkIdByPhoneNumberId: resolve, now: 3 });
  await processMetaStatusUpdate(db, {
    providerMessageId: 'wamid.C1', internalStatus: 'read', metaStatus: 'read', phoneNumberId: '1',
  }, { resolveNetworkIdByPhoneNumberId: resolve, now: 4 });
  assert.equal(db._store.get(`whatsapp_delivery_operations/${op.deliveryOperationId}`).status, 'read');
});

test('cycle: failed after sent is recorded', async () => {
  const db = createFakeFirestore();
  const op = await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'u1', saleUuid: 'cycle-f', now: 1,
  });
  await transitionDeliveryStatus(db, op.deliveryOperationId, 'sent', { providerMessageId: 'wamid.F1' }, 2);
  await processMetaStatusUpdate(db, {
    providerMessageId: 'wamid.F1', internalStatus: 'failed', metaStatus: 'failed', phoneNumberId: '1',
  }, { resolveNetworkIdByPhoneNumberId: async () => 'NET-10001', now: 3 });
  assert.equal(db._store.get(`whatsapp_delivery_operations/${op.deliveryOperationId}`).status, 'failed');
});

test('retry does not create second delivery op', async () => {
  process.env.WHATSAPP_SECRETS_KEK = Buffer.alloc(32, 7).toString('base64');
  const db = createFakeFirestore();
  setupNetwork(db, 'NET-10001', 'EAABtokenAAAA111111111111');
  const a = await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'u1', saleUuid: 'retry-1', now: 1,
  });
  const b = await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'u1', saleUuid: 'retry-1', now: 2,
  });
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  assert.equal(a.deliveryOperationId, b.deliveryOperationId);

  let calls = 0;
  const sendDeps = {
    fetch: async () => {
      calls += 1;
      return { ok: true, status: 200, text: async () => JSON.stringify({ messages: [{ id: 'wamid.R1' }] }) };
    },
  };
  await sendWhatsappForDeliveryOperation(db, a.deliveryOperationId, {
    toE164: '967770000001', text: 'x', now: 10, sendDeps,
  });
  await sendWhatsappForDeliveryOperation(db, a.deliveryOperationId, {
    toE164: '967770000001', text: 'x', now: 20, sendDeps,
  });
  assert.equal(calls, 1);
});

test('token isolation: network A token not used for B', async () => {
  process.env.WHATSAPP_SECRETS_KEK = Buffer.alloc(32, 7).toString('base64');
  const db = createFakeFirestore();
  setupNetwork(db, 'NET-10001', 'EAABtoken_NETWORK_A_ONLY_xxxxx');
  setupNetwork(db, 'NET-10002', 'EAABtoken_NETWORK_B_ONLY_yyyyy');
  let usedAuth = null;
  await sendCloudTextMessage(db, {
    networkId: 'NET-10002',
    toE164: '967770000002',
    text: 'hi',
  }, {
    fetch: async (_url, init) => {
      usedAuth = init.headers.Authorization;
      return { ok: true, status: 200, text: async () => JSON.stringify({ messages: [{ id: 'wamid.B' }] }) };
    },
  });
  assert.ok(usedAuth.includes('NETWORK_B'));
  assert.ok(!usedAuth.includes('NETWORK_A'));
});

test('expired token classified final', () => {
  const c = classifyMetaSendError({ status: 401, code: 190 });
  assert.equal(c.retryable, false);
  assert.equal(c.class, 'final');
});

test('sms device task once-only', async () => {
  const db = createFakeFirestore();
  const args = {
    deliveryOperationId: 'NET-10001__sale-sms-task',
    networkId: 'NET-10001',
    ownerUid: 'u1',
    toLocalPhone: '0777000001',
    body: 'card pin 1234',
    now: 1,
  };
  const a = await enqueueSmsDeviceTask(db, args);
  const b = await enqueueSmsDeviceTask(db, args);
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  assert.equal(ANDROID_SMS_INTEGRATION_NOTES.outOfScopeInAdminRepo, true);
});

test('network status metrics no secrets', async () => {
  process.env.WHATSAPP_SECRETS_KEK = Buffer.alloc(32, 7).toString('base64');
  const db = createFakeFirestore();
  setupNetwork(db, 'NET-10001', 'EAABsecretSHOULDNOTLEAK');
  await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'u1', saleUuid: 'met-1', now: 1,
  });
  const status = await collectNetworkWhatsappStatus(db, 'NET-10001');
  assert.equal(status.ok, true);
  assert.equal(status.cloud.hasAccessToken, true);
  assert.equal(status.cloud.tokenPresence, 'sealed_present');
  assert.ok(!JSON.stringify(status).includes('SHOULDNOTLEAK'));
  assert.equal(status.counts.deliveryTotal, 1);
});
