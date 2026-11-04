import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeFirestore, createRes } from './helpers/fakeFirestore.js';
import metaExchangeHandler from '../server/_lib/whatsapp/metaExchangeHandler.js';
import { whatsappSessionStartHandler, whatsappSessionStatusHandler } from '../server/_lib/whatsapp/gatewaySessionApi.js';
import unifiedMessageHandler from '../server/_lib/whatsapp/unifiedMessageHandler.js';
import { sealNetworkAccessToken, openNetworkAccessToken } from '../server/_lib/whatsapp/secrets.js';
import { processMetaStatusUpdate } from '../server/_lib/whatsapp/statusEvents.js';

const networkId = 'NET-10001';
const ownerUid = 'owner-1';
const ID_TOKEN = 'valid-test-id-token';

function authDeps(db) {
  return {
    db,
    ensureFirebaseAdmin: () => ({ ok: true }),
    getAuth: () => ({ verifyIdToken: async (token) => {
      assert.equal(token, ID_TOKEN);
      return { uid: ownerUid };
    } }),
    getFirestore: () => db,
    isAdminUid: async () => false,
  };
}

function headers() {
  return { authorization: `Bearer ${ID_TOKEN}` };
}

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

function makeDb(network = {}) {
  return createFakeFirestore({
    [`networks/${networkId}`]: { owner_uid: ownerUid, networkId, ...network },
    [`users/${ownerUid}`]: { account_features: { whatsapp_card_delivery: true }, accessStatus: 'ACTIVE_PAID' },
  });
}

test('Meta Embedded Signup exchanges code server-side and stores only encrypted token material', async () => {
  process.env.WHATSAPP_SECRETS_KEK = Buffer.alloc(32, 4).toString('base64');
  const db = makeDb();
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/oauth/access_token')) {
      assert.match(String(url), /client_secret=/);
      return response(200, { access_token: 'business-token-test-0123456789', expires_in: 3600 });
    }
    if (String(url).includes('/phone_numbers')) return response(200, { data: [{ id: '12345678901' }] });
    if (String(url).endsWith('/subscribed_apps')) return response(200, { success: true });
    throw new Error('unexpected Meta request');
  };
  const res = createRes();
  await metaExchangeHandler({
    method: 'POST',
    headers: headers(),
    body: { networkId, code: 'short-lived-one-time-code', wabaId: '12345678900', phoneNumberId: '12345678901' },
  }, res, {
    ...authDeps(db),
    now: 10_000,
    getMetaAppId: async () => ({ ok: true, value: 'meta-app-id' }),
    getMetaAppSecret: async () => ({ ok: true, value: 'server-only-meta-app-secret' }),
    getMetaGraphVersion: () => 'v26.0',
    fetch,
    serverTimestamp: () => 10_000,
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.tokenExpiresAtMs, 3_610_000);
  assert.equal(res.body.webhookSubscribed, true);
  assert.equal(JSON.stringify(res.body).includes('business-token-test'), false);
  assert.equal(JSON.stringify(res.body).includes('server-only-meta-app-secret'), false);
  assert.equal(calls.length, 3);
  assert.equal(db._store.get(`networks/${networkId}`).whatsappPrimaryProvider, 'cloud_api');
  assert.equal(db._store.get(`networks/${networkId}`).whatsappWabaId, '12345678900');
  const stored = db._store.get(`whatsapp_network_secrets/${networkId}`);
  assert.notEqual(stored.whatsappAccessTokenEnc, 'business-token-test-0123456789');
  assert.equal(stored.tokenExpiresAtMs, 3_610_000);
  assert.equal(stored.tokenType, 'embedded_signup_access_token');
  assert.equal(openNetworkAccessToken(networkId, stored).plaintext, 'business-token-test-0123456789');
});

test('QR session start matches the Android session allowlist and does not persist the QR', async () => {
  const db = makeDb();
  const sentRequests = [];
  const fetch = async (url, init = {}) => {
    sentRequests.push({ url: String(url), init });
    if (String(url).endsWith('/v1/session/link')) return response(200, { ok: true });
    if (String(url).endsWith('/v1/session/qr')) {
      return response(200, { ok: true, qrImageBase64: 'aGVsbG8=', qrExpiresAtMs: 90_000 });
    }
    throw new Error('unexpected gateway request');
  };
  const res = createRes();
  await whatsappSessionStartHandler({ method: 'POST', headers: headers(), body: { networkId } }, res, {
    ...authDeps(db),
    now: 1_000,
    gatewayReadiness: () => ({ configured: true }),
    getGatewayConfig: () => ({ configured: true, enabled: true, baseUrl: 'https://gateway.example', serviceToken: 's'.repeat(40) }),
    fetch,
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.session, { status: 'qr_pending', qrImageBase64: 'aGVsbG8=', qrExpiresAtMs: 90_000 });
  assert.equal(sentRequests.length, 2);
  assert.equal(sentRequests[0].init.headers.Authorization, `Bearer ${'s'.repeat(40)}`);
  assert.equal(db._store.has(`whatsapp_gateway_sessions/${networkId}`), false);
});

test('session status returns only approved non-secret fields from server state', async () => {
  const db = createFakeFirestore({
    [`networks/${networkId}`]: { owner_uid: ownerUid },
    [`users/${ownerUid}`]: { account_features: { whatsapp_card_delivery: true }, accessStatus: 'ACTIVE_PAID' },
    [`whatsapp_gateway_sessions/${networkId}`]: {
      networkId,
      status: 'linked',
      deviceName: 'Krotak phone',
      linkedAtMs: 100,
      lastSeenAtMs: 200,
      updatedAtMs: 200,
      engineVersion: '1.0',
    },
  });
  const res = createRes();
  await whatsappSessionStatusHandler({ method: 'GET', headers: headers(), query: { networkId } }, res, authDeps(db));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.session, {
    status: 'linked',
    deviceName: 'Krotak phone',
    linkedAtMs: 100,
    lastSeenAtMs: 200,
    engineVersion: '1.0',
  });
  assert.equal('networkId' in res.body.session, false);
  assert.equal('qrImageBase64' in res.body.session, false);
});

test('unified Cloud send requires provider id and duplicate deliveryId never sends twice', async () => {
  process.env.WHATSAPP_SECRETS_KEK = Buffer.alloc(32, 5).toString('base64');
  const sealed = sealNetworkAccessToken(networkId, 'cloud-token-for-test-0123456789');
  const db = createFakeFirestore({
    [`networks/${networkId}`]: {
      owner_uid: ownerUid,
      whatsappPrimaryProvider: 'cloud_api',
      whatsappCloudLinkStatus: 'linked',
      whatsappPhoneNumberId: '12345678901',
    },
    [`users/${ownerUid}`]: { account_features: { whatsapp_card_delivery: true }, accessStatus: 'ACTIVE_PAID' },
    [`whatsapp_network_secrets/${networkId}`]: {
      networkId,
      whatsappAccessTokenEnc: sealed.envelope,
    },
  });
  let sends = 0;
  const fetch = async (url, init) => {
    sends += 1;
    assert.match(String(url), /v26\.0\/12345678901\/messages$/);
    assert.equal(init.headers.Authorization, 'Bearer cloud-token-for-test-0123456789');
    return response(200, { messages: [{ id: 'wamid.outbound-001' }] });
  };
  const req = {
    method: 'POST',
    headers: headers(),
    body: { networkId, deliveryId: 'wa-unique-delivery-1', destination: '+967700000000', body: 'Your code is ready', templateKey: 'sale-card' },
  };
  const deps = { ...authDeps(db), fetch, now: 10_000 };
  const first = createRes();
  await unifiedMessageHandler(req, first, deps);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body, { ok: true, providerMessageId: 'wamid.outbound-001' });

  const second = createRes();
  await unifiedMessageHandler(req, second, deps);
  assert.equal(second.statusCode, 200);
  assert.deepEqual(second.body, { ok: true, providerMessageId: 'wamid.outbound-001', duplicate: true });
  assert.equal(sends, 1);
  const operation = [...db._store.entries()].find(([path]) => path.startsWith('whatsapp_message_requests/'))[1];
  assert.equal(operation.status, 'sent');
  assert.equal('body' in operation, false);
  assert.equal('destination' in operation, false);
  assert.equal('deliveryId' in operation, false);
});

test('Meta webhook status callback updates a generic message request by opaque delivery reference', async () => {
  const db = makeDb({
    whatsappPhoneNumberId: '12345678901',
    whatsappPrimaryProvider: 'cloud_api',
    whatsappCloudLinkStatus: 'linked',
  });
  const sealed = sealNetworkAccessToken(networkId, 'unused-token-for-status-test-0123');
  assert.ok(sealed.ok);
  const sendRes = createRes();
  const request = {
    method: 'POST',
    headers: headers(),
    body: { networkId, deliveryId: 'delivery-callback-1', destination: '+967700000001', body: 'Ready' },
  };
  await unifiedMessageHandler(request, sendRes, {
    ...authDeps(db),
    sendCloudTextMessage: async () => ({ ok: true, providerMessageId: 'wamid.status-001' }),
    now: 50,
  });
  assert.equal(sendRes.statusCode, 200);

  const result = await processMetaStatusUpdate(db, {
    providerMessageId: 'wamid.status-001',
    clientReferenceId: 'delivery-callback-1',
    phoneNumberId: '12345678901',
    internalStatus: 'delivered',
    metaStatus: 'delivered',
    occurredAtMs: 70,
  }, {
    resolveNetworkIdByPhoneNumberId: async () => networkId,
    now: 80,
  });
  assert.equal(result.messageRequestId != null, true);
  const operation = [...db._store.entries()].find(([path]) => path.startsWith('whatsapp_message_requests/'))[1];
  assert.equal(operation.status, 'delivered');
  assert.equal(operation.providerMessageId, 'wamid.status-001');
  assert.equal('deliveryId' in operation, false);
  const retryRes = createRes();
  await unifiedMessageHandler(request, retryRes, {
    ...authDeps(db),
    sendCloudTextMessage: async () => { assert.fail('delivered duplicate must not be sent again'); },
  });
  assert.equal(retryRes.statusCode, 200);
  assert.deepEqual(retryRes.body, { ok: true, providerMessageId: 'wamid.status-001', duplicate: true });
});

test('unified sender rejects a delivery key reused with different content', async () => {
  const db = makeDb({
    whatsappPrimaryProvider: 'cloud_api',
    whatsappCloudLinkStatus: 'linked',
    whatsappPhoneNumberId: '12345678901',
  });
  const existing = {
    networkId,
    ownerUid,
    deliveryId: 'same-delivery-id',
    destination: '+967700000010',
    body: 'original body',
    provider: 'cloud_api',
    now: 1,
  };
  const { createOutboundMessageRequest } = await import('../server/_lib/whatsapp/messageOperations.js');
  await createOutboundMessageRequest(db, existing);
  const res = createRes();
  await unifiedMessageHandler({
    method: 'POST',
    headers: headers(),
    body: { networkId, deliveryId: 'same-delivery-id', destination: '+967700000011', body: 'tampered body' },
  }, res, {
    ...authDeps(db),
    sendCloudTextMessage: async () => { assert.fail('provider must not be called for id conflict'); },
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.reasonCode, 'delivery_id_conflict');
});

test('unified sender routes to a linked persistent QR provider', async () => {
  const db = createFakeFirestore({
    [`networks/${networkId}`]: {
      owner_uid: ownerUid,
      whatsappPrimaryProvider: 'local_gateway_qr',
    },
    [`users/${ownerUid}`]: {
      account_features: { whatsapp_card_delivery: true },
      accessStatus: 'TRIAL',
    },
    [`whatsapp_gateway_sessions/${networkId}`]: {
      networkId,
      status: 'linked',
      updatedAtMs: 20,
    },
  });
  const gatewayCalls = [];
  const res = createRes();
  await unifiedMessageHandler({
    method: 'POST',
    headers: headers(),
    body: { networkId, deliveryId: 'qr-delivery-1', destination: '+967700000100', body: 'QR delivery' },
  }, res, {
    ...authDeps(db),
    gatewayReadiness: () => ({ configured: true }),
    callGateway: async (path, request) => {
      gatewayCalls.push({ path, request });
      return { ok: true, data: { ok: true, providerMessageId: 'gateway-message-1' } };
    },
    now: 1_000,
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, providerMessageId: 'gateway-message-1' });
  assert.equal(gatewayCalls.length, 1);
  assert.equal(gatewayCalls[0].path, '/v1/messages');
  assert.equal(gatewayCalls[0].request.deliveryId, 'qr-delivery-1');
});

test('expired account access blocks QR session creation before gateway invocation', async () => {
  const db = makeDb();
  await db.collection('users').doc(ownerUid).set({ accessStatus: 'LOCKED_EXPIRED' }, { merge: true });
  let gatewayTouched = false;
  const res = createRes();
  await whatsappSessionStartHandler({
    method: 'POST',
    headers: headers(),
    body: { networkId },
  }, res, {
    ...authDeps(db),
    gatewayReadiness: () => ({ configured: true }),
    callGateway: async () => { gatewayTouched = true; return { ok: true, data: {} }; },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.reasonCode, 'account_access_locked');
  assert.equal(gatewayTouched, false);
});
