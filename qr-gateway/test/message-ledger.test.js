import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { MessageLedger } from '../src/message-ledger.js';

test('ledger deduplicates exact sends and rejects delivery keys with changed content', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'krotak-ledger-'));
  try {
    const key = randomBytes(32);
    const ledger = new MessageLedger(dir, key);
    await ledger.init(1000);
    const request = { networkId: 'network-qr-test-01', deliveryId: 'wa-delivery-001', destination: '+967700000000', body: 'Test text', now: 1000 };
    const first = await ledger.claim(request);
    assert.equal(first.ok, true);
    assert.equal(first.duplicate, false);
    await ledger.update({ networkId: request.networkId, deliveryId: request.deliveryId, status: 'sent', providerMessageId: 'wamid-test-001', now: 1100 });

    const retry = await ledger.claim(request);
    assert.equal(retry.ok, true);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.record.providerMessageId, 'wamid-test-001');
    assert.equal((await ledger.claim({ ...request, body: 'Modified text' })).error, 'delivery_id_conflict');

    const files = await readdir(dir);
    const raw = (await Promise.all(files.map((name) => readFile(path.join(dir, name), 'utf8')))).join('\n');
    for (const sensitive of [request.networkId, request.deliveryId, request.destination, request.body]) assert.equal(raw.includes(sensitive), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an accepted in-flight send becomes unknown after restart and is never automatically repeated', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'krotak-ledger-'));
  try {
    const key = randomBytes(32);
    const first = new MessageLedger(dir, key);
    await first.init(2_000);
    const request = { networkId: 'network-qr-test-01', deliveryId: 'wa-delivery-002', destination: '+967700000001', body: 'Pending', now: 2_000 };
    await first.claim(request);

    const afterRestart = new MessageLedger(dir, key);
    await afterRestart.init(3_000);
    const duplicate = await afterRestart.claim({ ...request, now: 4_000 });
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.record.status, 'unknown');
    assert.equal(duplicate.record.reasonCode, 'gateway_restarted_during_send');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
