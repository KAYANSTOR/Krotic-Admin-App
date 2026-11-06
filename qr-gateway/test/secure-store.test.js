import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { SecureJsonStore, parseVaultKey } from '../src/secure-store.js';

test('secure JSON store encrypts values and round-trips them', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'krotak-vault-'));
  try {
    const key = randomBytes(32);
    const store = new SecureJsonStore(dir, key);
    const secret = { creds: 'qr-session-secret', phone: '+967700000000' };
    await store.writeJson('sensitive-record', secret);
    assert.deepEqual(await store.readJson('sensitive-record'), secret);
    const [file] = await readdir(dir);
    const ciphertext = await readFile(path.join(dir, file), 'utf8');
    assert.equal(ciphertext.includes('qr-session-secret'), false);
    assert.equal(ciphertext.includes('+967700000000'), false);
    assert.equal(file.includes('sensitive-record'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('secure JSON store fails closed on tampering and rejects invalid vault keys', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'krotak-vault-'));
  try {
    const store = new SecureJsonStore(dir, randomBytes(32));
    await store.writeJson('ledger', { status: 'sent' });
    const [file] = await readdir(dir);
    const envelope = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
    envelope.ciphertext = Buffer.alloc(Buffer.from(envelope.ciphertext, 'base64').length, 0).toString('base64');
    await (await import('node:fs/promises')).writeFile(path.join(dir, file), JSON.stringify(envelope));
    await assert.rejects(store.readJson('ledger'), /secure_store_integrity_failure/);
    assert.throws(() => parseVaultKey(Buffer.alloc(31).toString('base64')), /vault_key_invalid/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
