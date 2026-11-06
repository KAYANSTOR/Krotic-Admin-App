import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { MessageLedger } from '../src/message-ledger.js';
import { SessionManager } from '../src/session-manager.js';

function fakeSocket({ failSend = false } = {}) {
  const ev = new EventEmitter();
  let sends = 0;
  return {
    ev,
    async sendMessage() {
      sends += 1;
      if (failSend) throw new Error('network error');
      return { key: { id: `wamid-test-${sends}` } };
    },
    async logout() {},
    end() {},
    get sendCount() { return sends; },
  };
}

async function makeManager(dataDir, { failSend = false } = {}) {
  const vaultKey = randomBytes(32);
  const ledger = new MessageLedger(dataDir, vaultKey);
  const sockets = [];
  const reports = [];
  const manager = new SessionManager({
    dataDir,
    vaultKey,
    maxSessions: 1,
    ledger,
    now: () => 10_000,
    reconnectBaseMs: 1,
    setTimeoutFn: (callback) => ({ callback }),
    clearTimeoutFn: () => {},
    disconnectReasons: { loggedOut: 401, restartRequired: 515 },
    statusReporter: { async report(...args) { reports.push(args); return { ok: true }; } },
    makeSocket: () => {
      const socket = fakeSocket({ failSend });
      sockets.push(socket);
      return socket;
    },
    encodeQr: async () => Buffer.from('fake-png-bytes'),
  });
  await manager.init();
  return { manager, sockets, reports, vaultKey };
}

test('QR stays in memory, session links, inbound text stays ephemeral, and sends are idempotent', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'krotak-session-'));
  try {
    const { manager, sockets, reports } = await makeManager(dir);
    const networkId = 'network-qr-test-01';
    const started = await manager.start(networkId);
    assert.equal(started.ok, true);
    const socket = sockets[0];
    socket.ev.emit('connection.update', { qr: 'qr-material-never-persist-this' });
    await new Promise((resolve) => setImmediate(resolve));

    const qr = await manager.waitForQr(networkId);
    assert.equal(qr.ok, true);
    assert.equal(Buffer.from(qr.qrImageBase64, 'base64').toString(), 'fake-png-bytes');
    assert.equal(qr.qrExpiresAtMs, 100_000);

    socket.ev.emit('connection.update', { connection: 'open' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(manager.getStatus(networkId).session.status, 'linked');
    assert.equal(reports.every(([, , fields]) => !Object.keys(fields).some((key) => /qr|token|secret/i.test(key))), true);

    socket.ev.emit('messages.upsert', { type: 'notify', messages: [{ key: { id: 'incoming-1', fromMe: false, remoteJid: '967700000009@s.whatsapp.net' }, message: { conversation: 'hello' } }] });
    assert.equal(manager.listInbound(networkId)[0].text, 'hello');

    const request = { networkId, deliveryId: 'wa-session-001', destination: '+967700000002', body: 'Outbound test' };
    const sent = await manager.sendText(request);
    assert.equal(sent.httpStatus, 200);
    assert.equal(sent.data.providerMessageId, 'wamid-test-1');
    const retry = await manager.sendText(request);
    assert.equal(retry.httpStatus, 200);
    assert.equal(retry.data.duplicate, true);
    assert.equal(socket.sendCount, 1);
    assert.equal((await manager.sendText({ ...request, body: 'different' })).httpStatus, 409);

    const allFiles = [];
    async function walk(dirPath) {
      for (const name of await readdir(dirPath, { withFileTypes: true })) {
        const filePath = path.join(dirPath, name.name);
        if (name.isDirectory()) await walk(filePath); else allFiles.push(filePath);
      }
    }
    await walk(dir);
    const disk = (await Promise.all(allFiles.map((file) => readFile(file, 'utf8')))).join('\n');
    for (const sensitive of ['qr-material-never-persist-this', '+967700000002', 'Outbound test', 'hello']) assert.equal(disk.includes(sensitive), false);

    await manager.unlink(networkId);
    assert.equal(manager.getStatus(networkId).session.status, 'unlinked');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('send acknowledgement uncertainty is durable and a retry never sends twice', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'krotak-session-'));
  try {
    const { manager, sockets } = await makeManager(dir, { failSend: true });
    const networkId = 'network-qr-test-01';
    await manager.start(networkId);
    sockets[0].ev.emit('connection.update', { connection: 'open' });
    await new Promise((resolve) => setImmediate(resolve));
    const request = { networkId, deliveryId: 'wa-session-uncertain', destination: '+967700000003', body: 'Uncertain test' };
    const first = await manager.sendText(request);
    assert.equal(first.httpStatus, 502);
    assert.equal(first.data.uncertain, true);
    const second = await manager.sendText(request);
    assert.equal(second.data.error, 'delivery_outcome_unknown');
    assert.equal(sockets[0].sendCount, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
