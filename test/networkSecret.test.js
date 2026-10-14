import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptNetworkSecret,
  encryptNetworkSecret,
  generateNetworkSecret,
  hasNetworkSecretMaster,
} from '../api/_lib/networkSecret.js';

const master = 'test-master-secret-with-more-than-32-bytes-0123456789';

test('network secrets are high-entropy random values', () => {
  const first = generateNetworkSecret();
  const second = generateNetworkSecret();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test('network secret encryption is authenticated and round-trips', () => {
  const secret = generateNetworkSecret();
  const envelope = encryptNetworkSecret(secret, master);
  assert.match(envelope, /^v1\./);
  assert.equal(envelope.includes(secret), false);
  assert.equal(decryptNetworkSecret(envelope, master), secret);
  assert.notEqual(encryptNetworkSecret(secret, master), envelope);
});

test('tampered envelopes and a different master key are rejected', () => {
  const envelope = encryptNetworkSecret(generateNetworkSecret(), master);
  const parts = envelope.split('.');
  parts[3] = `${parts[3][0] === 'A' ? 'B' : 'A'}${parts[3].slice(1)}`;
  assert.throws(() => decryptNetworkSecret(parts.join('.'), master), /network_secret_decryption_failed/);
  assert.throws(() => decryptNetworkSecret(envelope, `${master}-wrong`), /network_secret_decryption_failed/);
});

test('master secret must contain at least 32 bytes', () => {
  assert.equal(hasNetworkSecretMaster('short'), false);
  assert.equal(hasNetworkSecretMaster(master), true);
  assert.throws(() => encryptNetworkSecret('network-key', 'short'), /network_secret_master_not_configured/);
});
