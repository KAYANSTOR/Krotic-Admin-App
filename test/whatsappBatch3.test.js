import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeFirestore, createRes } from './helpers/fakeFirestore.js';
import { createDeliveryOperation } from '../server/_lib/whatsapp/deliveryOperations.js';
import { markSentAndEnqueueDeadline } from '../server/_lib/whatsapp/deliveryOrchestration.js';
import { QUEUE_COLLECTION } from '../server/_lib/whatsapp/deliveryQueue.js';
import whatsappDispatchHandler from '../server/_lib/whatsapp/dispatchHandler.js';
import whatsappNetworkConfigHandler from '../server/_lib/whatsapp/networkConfigApi.js';
import { NETWORK_SECRETS_COLLECTION } from '../server/_lib/whatsapp/networkTokenStore.js';
import { openNetworkAccessToken } from '../server/_lib/whatsapp/secrets.js';

const DISPATCH_SECRET = 'unit_dispatch_secret_value_xx';
const ensureOk = () => ({ ok: true });

function setKek() {
  process.env.WHATSAPP_SECRETS_KEK = Buffer.alloc(32, 11).toString('base64');
  process.env.WHATSAPP_SECRETS_KEY_VERSION = '1';
}

test('markSentAndEnqueueDeadline creates op deadline + single queue job', async () => {
  const db = createFakeFirestore();
  const created = await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'u1', saleUuid: 'sale-b3', now: 1000,
  });
  const r = await markSentAndEnqueueDeadline(db, created.deliveryOperationId, {
    networkId: 'NET-10001', now: 2000, providerMessageId: 'wamid.out.1',
  });
  assert.equal(r.ok, true);
  assert.equal(r.delivery.status, 'sent');
  assert.ok(r.deadlineAtMs >= 2000 + 9000);
  assert.equal(r.queue.duplicate, false);

  const again = await markSentAndEnqueueDeadline(db, created.deliveryOperationId, {
    networkId: 'NET-10001', now: 2001,
  });
  // transition sent→sent not allowed; job already exists
  assert.equal(again.ok, false);

  // re-enqueue same job id is duplicate
  assert.equal(
    [...db._store.keys()].filter((k) => k.startsWith(`${QUEUE_COLLECTION}/`)).length,
    1,
  );
});

test('dispatch drains queue and starts SMS once after deadline', async () => {
  const db = createFakeFirestore({
    'users/u1': { account_features: { whatsapp_card_delivery: true } },
  });
  const created = await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'u1', saleUuid: 'sale-sms', now: 1000,
  });
  const marked = await markSentAndEnqueueDeadline(db, created.deliveryOperationId, {
    networkId: 'NET-10001', now: 2000,
  });
  const deadline = marked.deadlineAtMs;

  const res = createRes();
  await whatsappDispatchHandler(
    { method: 'POST', body: { limit: 10 }, headers: { 'x-dispatch-service-secret': DISPATCH_SECRET } },
    res,
    {
      db,
      ensureFirebaseAdmin: ensureOk,
      getDispatchServiceSecret: async () => ({ ok: true, value: DISPATCH_SECRET }),
      now: deadline + 1,
    },
  );
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.smsStarted >= 1);

  const op = db._store.get(`whatsapp_delivery_operations/${created.deliveryOperationId}`);
  assert.equal(op.status, 'sms_sent');
  assert.ok(op.smsFallbackSentAtMs);

  // Second dispatch must not double-SMS
  const res2 = createRes();
  await whatsappDispatchHandler(
    { method: 'POST', body: {}, headers: { 'x-dispatch-service-secret': DISPATCH_SECRET } },
    res2,
    {
      db,
      ensureFirebaseAdmin: ensureOk,
      getDispatchServiceSecret: async () => ({ ok: true, value: DISPATCH_SECRET }),
      now: deadline + 100,
    },
  );
  assert.equal(res2.body.smsStarted, 0);
});

test('set_token seals ciphertext; response has no plaintext; open works', async () => {
  setKek();
  const db = createFakeFirestore({
    'networks/NET-10001': { owner_uid: 'u1' },
  });
  const res = createRes();
  await whatsappNetworkConfigHandler(
    {
      method: 'POST',
      body: {
        action: 'set_token',
        networkId: 'NET-10001',
        accessToken: 'EAABtesttokenvalue1234567890',
      },
    },
    res,
    {
      db,
      ensureFirebaseAdmin: ensureOk,
      authenticateAdmin: async () => ({ ok: true, callerUid: 'admin-1' }),
    },
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.tokenStored, true);
  assert.ok(!JSON.stringify(res.body).includes('EAABtesttokenvalue'));

  const secretDoc = db._store.get(`${NETWORK_SECRETS_COLLECTION}/NET-10001`);
  assert.ok(secretDoc.whatsappAccessTokenEnc);
  assert.ok(!JSON.stringify(secretDoc).includes('EAABtesttokenvalue'));

  const opened = openNetworkAccessToken('NET-10001', secretDoc);
  assert.equal(opened.ok, true);
  assert.equal(opened.plaintext, 'EAABtesttokenvalue1234567890');
});

test('set config path rejects embedding accessToken on network doc', async () => {
  const db = createFakeFirestore({ 'networks/NET-10001': { owner_uid: 'u1' } });
  const res = createRes();
  await whatsappNetworkConfigHandler(
    {
      method: 'POST',
      body: {
        action: 'set',
        networkId: 'NET-10001',
        config: {
          whatsappPrimaryProvider: 'cloud_api',
          whatsappPhoneNumberId: '12345',
          accessToken: 'should-not-land',
        },
      },
    },
    res,
    {
      db,
      ensureFirebaseAdmin: ensureOk,
      authenticateAdmin: async () => ({ ok: true, callerUid: 'admin-1' }),
      serverTimestamp: () => 'TS',
    },
  );
  assert.equal(res.statusCode, 200);
  const net = db._store.get('networks/NET-10001');
  assert.equal(net.accessToken, undefined);
  assert.equal(net.whatsappAccessTokenEnc, undefined);
});
