import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeFirestore, createRes } from './helpers/fakeFirestore.js';
import { createDeliveryOperation, transitionDeliveryStatus } from '../server/_lib/whatsapp/deliveryOperations.js';
import {
  tryStartSmsFallbackOnce,
  claimSmsFallbackSlot,
  reconcileSmsAfterCrash,
} from '../server/_lib/whatsapp/smsClaim.js';
import {
  buildSmsIdempotencyKey,
  executeSmsFallbackPipeline,
} from '../server/_lib/whatsapp/smsProvider.js';
import { processMetaStatusUpdate } from '../server/_lib/whatsapp/statusEvents.js';
import whatsappNetworkConfigHandler from '../server/_lib/whatsapp/networkConfigApi.js';
import { enqueueDeliveryJob, QUEUE_COLLECTION } from '../server/_lib/whatsapp/deliveryQueue.js';

const ensureOk = () => ({ ok: true });

test('idempotency key is stable per deliveryOperationId', () => {
  const a = buildSmsIdempotencyKey('NET-10001__sale-xyz');
  const b = buildSmsIdempotencyKey('NET-10001__sale-xyz');
  assert.equal(a.ok, true);
  assert.equal(a.key, b.key);
  assert.ok(a.key.includes('NET-10001__sale-xyz'));
});

test('crash before request: retry_send allowed', async () => {
  const db = createFakeFirestore();
  const op = await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'u1', saleUuid: 'c1', now: 1000,
  });
  await transitionDeliveryStatus(db, op.deliveryOperationId, 'sent', {}, 2000);
  try {
    await tryStartSmsFallbackOnce(db, op.deliveryOperationId, {
      workerId: 'w1', now: 15000, throwAfter: 'claim', simulateAccept: true,
    });
    assert.fail('expected throw');
  } catch (e) {
    assert.equal(e.phase, 'claim');
  }
  const plan = reconcileSmsAfterCrash(db._store.get(`whatsapp_delivery_operations/${op.deliveryOperationId}`));
  assert.equal(plan.action, 'retry_send');
});

test('crash after request_started: outcome unknown blocks auto resend', async () => {
  const db = createFakeFirestore();
  const op = await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'u1', saleUuid: 'c2', now: 1000,
  });
  await transitionDeliveryStatus(db, op.deliveryOperationId, 'sent', {}, 2000);
  try {
    await tryStartSmsFallbackOnce(db, op.deliveryOperationId, {
      workerId: 'w1', now: 15000, throwAfter: 'request_started', simulateAccept: true,
    });
    assert.fail('expected throw');
  } catch (e) {
    assert.equal(e.phase, 'request_started');
  }
  const data = db._store.get(`whatsapp_delivery_operations/${op.deliveryOperationId}`);
  assert.equal(data.smsOutcomeUnknown, true);
  const again = await tryStartSmsFallbackOnce(db, op.deliveryOperationId, {
    workerId: 'w2', now: 16000, simulateAccept: true,
  });
  assert.equal(again.ok, false);
  assert.equal(again.error, 'sms_outcome_unknown');
});

test('crash after provider accepted: complete_only without second provider call', async () => {
  const db = createFakeFirestore();
  const op = await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'u1', saleUuid: 'c3', now: 1000,
  });
  await transitionDeliveryStatus(db, op.deliveryOperationId, 'sent', {}, 2000);
  let providerCalls = 0;
  try {
    await executeSmsFallbackPipeline(db, op.deliveryOperationId, {
      workerId: 'w1',
      now: 15000,
      claimSmsFallbackSlot,
      markSmsProviderAccepted: async (d, id, n) => {
        const { markSmsProviderAccepted } = await import('../server/_lib/whatsapp/smsClaim.js');
        return markSmsProviderAccepted(d, id, n);
      },
      completeSmsFallback: async (d, id, n) => {
        const { completeSmsFallback } = await import('../server/_lib/whatsapp/smsClaim.js');
        return completeSmsFallback(d, id, n);
      },
      callProvider: async () => {
        providerCalls += 1;
        return { ok: true };
      },
      throwAfter: 'provider_accepted',
    });
    assert.fail('expected throw');
  } catch (e) {
    assert.equal(e.phase, 'provider_accepted');
  }
  assert.equal(providerCalls, 1);
  const recovered = await tryStartSmsFallbackOnce(db, op.deliveryOperationId, {
    workerId: 'w2', now: 20000, simulateAccept: true,
  });
  assert.equal(recovered.ok, true);
  assert.equal(db._store.get(`whatsapp_delivery_operations/${op.deliveryOperationId}`).status, 'sms_sent');
});

test('Meta order: sent → delivered → read', async () => {
  const db = createFakeFirestore();
  const op = await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'u1', saleUuid: 'm1', now: 1000,
  });
  await transitionDeliveryStatus(db, op.deliveryOperationId, 'sent', { providerMessageId: 'wamid.M1' }, 2000);
  const resolve = async () => 'NET-10001';
  await processMetaStatusUpdate(db, {
    providerMessageId: 'wamid.M1', internalStatus: 'delivered', metaStatus: 'delivered', phoneNumberId: '1',
  }, { resolveNetworkIdByPhoneNumberId: resolve, now: 3000 });
  await processMetaStatusUpdate(db, {
    providerMessageId: 'wamid.M1', internalStatus: 'read', metaStatus: 'read', phoneNumberId: '1',
  }, { resolveNetworkIdByPhoneNumberId: resolve, now: 4000 });
  assert.equal(db._store.get(`whatsapp_delivery_operations/${op.deliveryOperationId}`).status, 'read');
});

test('Meta: read before delivered still ends progressive', async () => {
  const db = createFakeFirestore();
  const op = await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'u1', saleUuid: 'm2', now: 1000,
  });
  await transitionDeliveryStatus(db, op.deliveryOperationId, 'sent', { providerMessageId: 'wamid.M2' }, 2000);
  const resolve = async () => 'NET-10001';
  await processMetaStatusUpdate(db, {
    providerMessageId: 'wamid.M2', internalStatus: 'read', metaStatus: 'read', phoneNumberId: '1',
  }, { resolveNetworkIdByPhoneNumberId: resolve, now: 3000 });
  const st = db._store.get(`whatsapp_delivery_operations/${op.deliveryOperationId}`).status;
  assert.ok(st === 'read' || st === 'delivered');
});

test('Meta: event for other network does not mutate op', async () => {
  const db = createFakeFirestore();
  const op = await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'u1', saleUuid: 'm3', now: 1000,
  });
  await transitionDeliveryStatus(db, op.deliveryOperationId, 'sent', { providerMessageId: 'wamid.M3' }, 2000);
  await processMetaStatusUpdate(db, {
    providerMessageId: 'wamid.M3', internalStatus: 'delivered', metaStatus: 'delivered', phoneNumberId: 'x',
  }, {
    resolveNetworkIdByPhoneNumberId: async () => 'NET-99999',
    now: 3000,
  });
  assert.equal(db._store.get(`whatsapp_delivery_operations/${op.deliveryOperationId}`).status, 'sent');
});

test('queue enqueue once per deliveryOperationId', async () => {
  const db = createFakeFirestore();
  const id = 'NET-10001__sale-q';
  const a = await enqueueDeliveryJob(db, { jobId: id, deliveryOperationId: id, networkId: 'NET-10001', now: 1, runAfterMs: 1 });
  const b = await enqueueDeliveryJob(db, { jobId: id, deliveryOperationId: id, networkId: 'NET-10001', now: 2, runAfterMs: 2 });
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  assert.equal([...db._store.keys()].filter((k) => k.startsWith(`${QUEUE_COLLECTION}/`)).length, 1);
});

test('network isolation: two networks independent ops', async () => {
  const db = createFakeFirestore();
  const a = await createDeliveryOperation(db, { networkId: 'NET-10001', ownerUid: 'u1', saleUuid: 'same-sale', now: 1 });
  const b = await createDeliveryOperation(db, { networkId: 'NET-10002', ownerUid: 'u2', saleUuid: 'same-sale', now: 1 });
  assert.notEqual(a.deliveryOperationId, b.deliveryOperationId);
});

test('admin API rejects missing token and non-admin', async () => {
  const db = createFakeFirestore({ 'networks/NET-10001': { owner_uid: 'u1' } });
  const res1 = createRes();
  await whatsappNetworkConfigHandler(
    { method: 'POST', body: { action: 'get', networkId: 'NET-10001' }, headers: {} },
    res1,
    {
      db,
      ensureFirebaseAdmin: ensureOk,
      authenticateAdmin: async () => ({ ok: false, status: 401, error: 'missing_token' }),
    },
  );
  assert.equal(res1.statusCode, 401);

  const res2 = createRes();
  await whatsappNetworkConfigHandler(
    { method: 'POST', body: { action: 'set_token', networkId: 'NET-10001', accessToken: 'x'.repeat(24) }, headers: {} },
    res2,
    {
      db,
      ensureFirebaseAdmin: ensureOk,
      authenticateAdmin: async () => ({ ok: false, status: 403, error: 'not_admin' }),
    },
  );
  assert.equal(res2.statusCode, 403);
});

test('set_token response never contains plaintext token', async () => {
  process.env.WHATSAPP_SECRETS_KEK = Buffer.alloc(32, 5).toString('base64');
  const db = createFakeFirestore({ 'networks/NET-10001': { owner_uid: 'u1' } });
  const secret = 'EAABsupersecret-token-value-xyz';
  const res = createRes();
  await whatsappNetworkConfigHandler(
    { method: 'POST', body: { action: 'set_token', networkId: 'NET-10001', accessToken: secret }, headers: {} },
    res,
    {
      db,
      ensureFirebaseAdmin: ensureOk,
      authenticateAdmin: async () => ({ ok: true, callerUid: 'admin-1' }),
    },
  );
  assert.equal(res.statusCode, 200);
  assert.ok(!JSON.stringify(res.body).includes(secret));
  assert.equal(res.body.tokenStored, true);
});
