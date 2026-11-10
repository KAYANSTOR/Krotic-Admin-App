import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import whatsappGatewayHandler from '../server/apiHandlers/whatsapp-gateway.js';
import whatsappInboundHandler, {
  parseInboundBody,
  verifyInboundSignature,
} from '../server/_lib/whatsappInbound.js';
import { createFakeFirestore, createRes } from './helpers/fakeFirestore.js';

const SECRET = 'whatsapp-inbound-test-secret-0123456789-abcdef';
const NOW = 1_800_000_000_000;

function signedBody(body, secret = SECRET, timestamp = NOW) {
  const text = JSON.stringify(body);
  const signature = createHmac('sha256', secret).update(`${timestamp}.${text}`).digest('hex');
  return { text, signature, timestamp: String(timestamp) };
}

test('inbound signature accepts the exact body and rejects stale or altered requests', () => {
  const payload = { networkId: 'NET-1', messageId: 'wamid.abc-1', text: 'hello', timestamp: NOW };
  const signed = signedBody(payload);
  const accepted = verifyInboundSignature({
    signature: signed.signature,
    timestampHeader: signed.timestamp,
    bodyText: signed.text,
    secret: SECRET,
    now: NOW,
  });
  assert.deepEqual(accepted, { ok: true, timestamp: NOW });

  const stale = verifyInboundSignature({
    signature: signed.signature,
    timestampHeader: signed.timestamp,
    bodyText: signed.text,
    secret: SECRET,
    now: NOW + 6 * 60 * 1000,
  });
  assert.equal(stale.error, 'timestamp_expired_or_invalid');

  const altered = verifyInboundSignature({
    signature: signed.signature,
    timestampHeader: signed.timestamp,
    bodyText: `${signed.text} `,
    secret: SECRET,
    now: NOW,
  });
  assert.equal(altered.error, 'signature_mismatch');
});

test('inbound body validation enforces identifiers and text bounds', () => {
  const valid = parseInboundBody({
    networkId: 'NET-1',
    messageId: 'wamid.abc-1',
    text: 'hello',
    fromJid: '967123456789@s.whatsapp.net',
    fromPhone: '967123456789',
    timestamp: NOW,
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.value.networkId, 'NET-1');

  assert.equal(parseInboundBody({ networkId: '../bad', messageId: 'm1', text: 'x', timestamp: NOW }).error, 'invalid_network_id');
  assert.equal(parseInboundBody({ networkId: 'NET-1', messageId: 'm1', text: '', timestamp: NOW }).error, 'invalid_text');
  assert.equal(parseInboundBody({ networkId: 'NET-1', messageId: 'm1', text: 'x', timestamp: 'bad' }).error, 'invalid_timestamp');
});

test('inbound handler verifies Buffer rawBody, writes once, and acknowledges duplicates', async () => {
  const db = createFakeFirestore();
  const payload = {
    networkId: 'NET-1',
    messageId: 'wamid.abc-1',
    text: 'hello',
    fromJid: '967123456789@s.whatsapp.net',
    fromPhone: '967123456789',
    timestamp: NOW,
  };
  const signed = signedBody(payload);
  const dependencies = {
    ensureFirebaseAdmin: () => ({ ok: true }),
    getFirestore: () => db,
    inboundSecret: SECRET,
    now: NOW,
  };
  const request = {
    method: 'POST',
    headers: {
      'x-gateway-signature': signed.signature,
      'x-gateway-timestamp': signed.timestamp,
    },
    body: payload,
    rawBody: Buffer.from(signed.text),
  };

  const created = createRes();
  await whatsappInboundHandler(request, created, dependencies);
  assert.equal(created.statusCode, 200);
  assert.equal(created.body.status, 'created');
  const path = 'networks/NET-1/wa_inbox/wamid.abc-1';
  assert.equal(db._store.get(path).text, 'hello');
  assert.equal(db._store.get(path).status, 'pending');

  const duplicate = createRes();
  await whatsappInboundHandler(request, duplicate, dependencies);
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.body.status, 'duplicate');
  assert.equal(db._store.size, 1);

  const tampered = createRes();
  const tamperedPayload = { ...payload, text: 'tampered' };
  await whatsappInboundHandler({
    ...request,
    body: tamperedPayload,
    rawBody: Buffer.from(JSON.stringify(tamperedPayload)),
  }, tampered, dependencies);
  assert.equal(tampered.statusCode, 401);
  assert.equal(tampered.body.error, 'signature_mismatch');
  assert.equal(db._store.size, 1);
});

test('control plane uses the Firestore-owned network and server-only Gateway token', async () => {
  const previousUrl = process.env.WHATSAPP_GATEWAY_URL;
  const previousToken = process.env.WHATSAPP_GATEWAY_SERVICE_TOKEN;
  const previousFetch = globalThis.fetch;
  process.env.WHATSAPP_GATEWAY_URL = 'https://gateway.example.test/';
  process.env.WHATSAPP_GATEWAY_SERVICE_TOKEN = 'gateway-service-test-token-0123456789-abcdef';
  const db = createFakeFirestore({
    'users/user-1': {
      uid: 'user-1',
      networkId: 'NET-OWNED',
      account_features: { whatsapp_card_delivery: true },
    },
    'networks/NET-OWNED': { networkId: 'NET-OWNED', owner_uid: 'user-1' },
  });
  let outbound;
  globalThis.fetch = async (url, options) => {
    outbound = { url: String(url), options };
    return new Response(JSON.stringify({ status: 'awaiting_scan', linkUrl: 'https://gateway.example.test/link/token' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const request = {
      method: 'POST',
      query: { __apiRoute: 'start' },
      headers: { authorization: 'Bearer valid-id-token' },
      body: { force: true, networkId: 'ATTACKER-CONTROLLED' },
    };
    const response = createRes();
    await whatsappGatewayHandler(request, response, {
      ensureFirebaseAdmin: () => ({ ok: true }),
      getAuth: () => ({ verifyIdToken: async (token) => {
        assert.equal(token, 'valid-id-token');
        return { uid: 'user-1' };
      } }),
      getFirestore: () => db,
      isAdminUid: async () => false,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.status, 'awaiting_scan');
    assert.equal(outbound.url, 'https://gateway.example.test/sessions/start');
    assert.equal(outbound.options.headers.authorization, `Bearer ${process.env.WHATSAPP_GATEWAY_SERVICE_TOKEN}`);
    assert.deepEqual(JSON.parse(outbound.options.body), { networkId: 'NET-OWNED', force: true });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.WHATSAPP_GATEWAY_URL;
    else process.env.WHATSAPP_GATEWAY_URL = previousUrl;
    if (previousToken === undefined) delete process.env.WHATSAPP_GATEWAY_SERVICE_TOKEN;
    else process.env.WHATSAPP_GATEWAY_SERVICE_TOKEN = previousToken;
  }
});
