import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import handler from '../server/_lib/whatsapp/gatewayStatusCallbackHandler.js';
import { createFakeFirestore, createRes } from './helpers/fakeFirestore.js';

const networkId = 'network-qr-test-01';
const secret = 'gateway-service-token-for-tests-0123456789';
const now = 1_800_000_000_000;

function canonical(payload) {
  return JSON.stringify(Object.fromEntries(Object.keys(payload).sort().map((key) => [key, payload[key]])));
}

function makeRequest(payload, { signatureSecret = secret, timestamp = now, signatureOverride = null } = {}) {
  const timestampText = String(timestamp);
  const signature = signatureOverride || `sha256=${createHmac('sha256', signatureSecret).update(`${timestampText}.${canonical(payload)}`).digest('hex')}`;
  return {
    method: 'POST',
    headers: {
      'x-gateway-timestamp': timestampText,
      'x-gateway-signature': signature,
      'x-network-id': networkId,
    },
    body: payload,
  };
}

function payload(updatedAtMs = now, overrides = {}) {
  return {
    networkId,
    status: 'linked',
    lastSeenAtMs: updatedAtMs,
    reasonCode: null,
    deviceName: 'WhatsApp Web',
    linkedAtMs: updatedAtMs - 1_000,
    updatedAtMs,
    engineVersion: 'baileys-6.7.24',
    ...overrides,
  };
}

const dependencies = (db, extra = {}) => ({
  db,
  now,
  getGatewayServiceToken: () => secret,
  ensureFirebaseAdmin: () => ({ ok: true }),
  ...extra,
});

test('valid HMAC callback transactionally writes only approved session metadata', async () => {
  const db = createFakeFirestore();
  const res = createRes();
  await handler(makeRequest(payload()), res, dependencies(db));

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.deepEqual(db._store.get(`whatsapp_gateway_sessions/${networkId}`), {
    networkId,
    status: 'linked',
    lastSeenAtMs: now,
    reasonCode: null,
    deviceName: 'WhatsApp Web',
    linkedAtMs: now - 1_000,
    updatedAtMs: now,
    engineVersion: 'baileys-6.7.24',
  });
});

test('forged or clock-expired callback cannot write status', async () => {
  const db = createFakeFirestore();
  const forged = createRes();
  await handler(makeRequest(payload(), { signatureSecret: 'another-secret-not-the-service-token-0000' }), forged, dependencies(db));
  assert.equal(forged.statusCode, 401);
  assert.equal(db._store.size, 0);

  const expired = createRes();
  await handler(makeRequest(payload(now - 600_000), { timestamp: now - 600_000 }), expired, dependencies(db));
  assert.equal(expired.statusCode, 401);
  assert.equal(db._store.size, 0);
});

test('callback rejects QR/secret fields and a mismatched network header', async () => {
  const db = createFakeFirestore();
  const withQr = createRes();
  const qrPayload = payload(now, { qrImageBase64: 'should-never-persist' });
  await handler(makeRequest(qrPayload), withQr, dependencies(db));
  assert.equal(withQr.statusCode, 400);
  assert.equal(db._store.size, 0);

  const mismatch = createRes();
  const request = makeRequest(payload());
  request.headers['x-network-id'] = 'network-qr-other-99';
  await handler(request, mismatch, dependencies(db));
  assert.equal(mismatch.statusCode, 400);
  assert.equal(db._store.size, 0);
});

test('older callback is rejected and cannot roll session state backwards', async () => {
  const db = createFakeFirestore({
    [`whatsapp_gateway_sessions/${networkId}`]: {
      networkId,
      status: 'linked',
      updatedAtMs: now + 100,
    },
  });
  const res = createRes();
  const oldTime = now - 100;
  await handler(makeRequest(payload(oldTime, { status: 'disconnected' }), { timestamp: oldTime }), res, dependencies(db));
  assert.equal(res.statusCode, 409);
  assert.equal(db._store.get(`whatsapp_gateway_sessions/${networkId}`).status, 'linked');
});

test('callback rejects unsupported method and missing server secret', async () => {
  const wrongMethod = createRes();
  await handler({ method: 'GET', headers: {} }, wrongMethod, dependencies(createFakeFirestore()));
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(wrongMethod.headers.Allow, 'POST');

  const noSecret = createRes();
  await handler(makeRequest(payload()), noSecret, dependencies(createFakeFirestore(), { getGatewayServiceToken: () => '' }));
  assert.equal(noSecret.statusCode, 401);
});
