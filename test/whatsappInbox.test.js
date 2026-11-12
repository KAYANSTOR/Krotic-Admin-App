import test from 'node:test';
import assert from 'node:assert/strict';
import whatsappGatewayHandler from '../server/apiHandlers/whatsapp-gateway.js';
import { createFakeFirestore, createRes } from './helpers/fakeFirestore.js';

function fixtures(options = {}) {
  return createFakeFirestore({
    'users/owner-1': {
      uid: 'owner-1',
      networkId: 'NET-1',
      account_features: { whatsapp_card_delivery: true },
    },
    'networks/NET-1': { networkId: 'NET-1', owner_uid: 'owner-1' },
    'networks/NET-1/wa_inbox/msg-1': {
      networkId: 'NET-1',
      messageId: 'msg-1',
      text: 'سلفني 500',
      fromPhone: '967777123456',
      timestamp: 1794000000,
      receivedAtMs: 1794000000000,
      status: 'pending',
      attempts: 0,
    },
  }, options);
}

function dependencies(db, uid = 'owner-1') {
  return {
    ensureFirebaseAdmin: () => ({ ok: true }),
    getAuth: () => ({ verifyIdToken: async () => ({ uid }) }),
    getFirestore: () => db,
    isAdminUid: async () => false,
  };
}

function request(route, body = {}, uid = 'owner-1') {
  return {
    method: 'POST',
    query: { __apiRoute: route },
    headers: { authorization: 'Bearer test-id-token' },
    body,
    uid,
  };
}

async function invoke(db, route, body = {}, uid = 'owner-1') {
  const response = createRes();
  await whatsappGatewayHandler(request(route, body, uid), response, dependencies(db, uid));
  return response;
}

test('inbox claim is authenticated, leases the message, and completion is token-bound', async () => {
  const db = fixtures();
  const claim = await invoke(db, 'inbox-claim', { limit: 10 });
  assert.equal(claim.statusCode, 200);
  assert.equal(claim.body.messages.length, 1);
  const item = claim.body.messages[0];
  assert.equal(item.id, 'msg-1');
  assert.equal(item.text, 'سلفني 500');
  assert.ok(item.claimToken);
  assert.equal(db._store.get('networks/NET-1/wa_inbox/msg-1').status, 'processing');

  const wrong = await invoke(db, 'inbox-complete', {
    id: item.id, claimToken: 'wrong-token', processResult: 'recorded',
  });
  assert.equal(wrong.statusCode, 409);
  assert.equal(wrong.body.error, 'claim_lost');

  const complete = await invoke(db, 'inbox-complete', {
    id: item.id, claimToken: item.claimToken, processResult: 'recorded',
  });
  assert.equal(complete.statusCode, 200);
  assert.equal(db._store.get('networks/NET-1/wa_inbox/msg-1').status, 'processed');
  assert.equal(db._store.get('networks/NET-1/wa_inbox/msg-1').processResult, 'recorded');

  const again = await invoke(db, 'inbox-claim');
  assert.equal(again.body.messages.length, 0);
});

test('concurrent devices cannot claim the same message', async () => {
  const db = fixtures({ strictTransactions: true });
  const [a, b] = await Promise.all([
    invoke(db, 'inbox-claim', { limit: 1 }),
    invoke(db, 'inbox-claim', { limit: 1 }),
  ]);
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.equal(a.body.messages.length + b.body.messages.length, 1);
});

test('retryable failure retains the message under a bounded lease', async () => {
  const db = fixtures();
  const claim = await invoke(db, 'inbox-claim', { limit: 1 });
  const item = claim.body.messages[0];
  const before = Date.now();
  const retry = await invoke(db, 'inbox-complete', {
    id: item.id, claimToken: item.claimToken, retry: true, reasonCode: 'temporary_network_failure',
  });
  assert.equal(retry.statusCode, 200);
  const stored = db._store.get('networks/NET-1/wa_inbox/msg-1');
  assert.equal(stored.status, 'processing');
  assert.equal(stored.lastErrorCode, 'temporary_network_failure');
  assert.ok(stored.leaseUntilMs > before);
});

test('another account cannot claim the owner network inbox', async () => {
  const db = fixtures();
  db._store.set('users/stranger', {
    uid: 'stranger', networkId: 'NET-OTHER', account_features: { whatsapp_card_delivery: true },
  });
  db._store.set('networks/NET-OTHER', { networkId: 'NET-OTHER', owner_uid: 'stranger' });
  const response = await invoke(db, 'inbox-claim', {}, 'stranger');
  assert.notEqual(response.statusCode, 200);
});
