import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createGatewayApp } from '../src/app.js';
import { signGatewayStatus } from '../src/status-signature.js';

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function withServer(app, callback) {
  const server = app.listen(await freePort(), '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try { await callback(baseUrl); } finally { await new Promise((resolve) => server.close(resolve)); }
}

const token = 'gateway-token-for-app-tests-0123456789';

test('health is public but session and send APIs require the service bearer token', async () => {
  const manager = {
    getStatus: () => ({ ok: true, session: { status: 'linked' } }),
    sendText: async () => ({ httpStatus: 200, data: { ok: true, providerMessageId: 'wamid-1' } }),
  };
  const app = createGatewayApp({ manager, serviceToken: token, statusSecret: token, now: () => 1_800_000_000_000 });
  await withServer(app, async (base) => {
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);

    const denied = await fetch(`${base}/v1/session`, { headers: { 'X-Network-Id': 'network-qr-test-01' } });
    assert.equal(denied.status, 401);

    const status = await fetch(`${base}/v1/session`, { headers: { Authorization: `Bearer ${token}`, 'X-Network-Id': 'network-qr-test-01' } });
    assert.equal(status.status, 200);
    assert.equal((await status.json()).session.status, 'linked');

    const sent = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-Network-Id': 'network-qr-test-01', 'Idempotency-Key': 'wa-app-test-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ deliveryId: 'wa-app-test-1', destination: '+967700000000', body: 'Safe test' }),
    });
    assert.equal(sent.status, 200);
    assert.equal((await sent.json()).providerMessageId, 'wamid-1');

    const mismatch = await fetch(`${base}/v1/session`, { headers: { Authorization: `Bearer ${token}`, 'X-Network-Id': 'bad' } });
    assert.equal(mismatch.status, 400);
  });
});

test('status callback requires valid HMAC and forwards only authenticated status', async () => {
  let forwarded = 0;
  const manager = { getStatus: () => ({ ok: true, session: { status: 'unlinked' } }) };
  const statusReporter = { async report(networkId, status, fields) { forwarded += 1; assert.equal(networkId, 'network-qr-test-01'); assert.equal(status, 'linked'); assert.equal(fields.qrImageBase64, undefined); return { ok: true }; } };
  const now = 1_800_000_000_000;
  const app = createGatewayApp({ manager, serviceToken: token, statusSecret: token, statusReporter, now: () => now });
  await withServer(app, async (base) => {
    const payload = { networkId: 'network-qr-test-01', status: 'linked', updatedAtMs: now, engineVersion: 'baileys-6.7.24' };
    const headers = { 'Content-Type': 'application/json', 'X-Network-Id': payload.networkId, 'X-Gateway-Timestamp': String(now), 'X-Gateway-Signature': signGatewayStatus(token, String(now), payload) };
    const ok = await fetch(`${base}/v1/engine/status-callback`, { method: 'POST', headers, body: JSON.stringify(payload) });
    assert.equal(ok.status, 200);
    assert.equal(forwarded, 1);

    const bad = await fetch(`${base}/v1/engine/status-callback`, { method: 'POST', headers: { ...headers, 'X-Gateway-Signature': 'sha256=bad' }, body: JSON.stringify(payload) });
    assert.equal(bad.status, 401);
    assert.equal(forwarded, 1);
  });
});
