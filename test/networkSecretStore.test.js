import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureNetworkSecret,
  networkSecretCandidates,
  rotateNetworkSecret,
} from '../server/_lib/networkSecretStore.js';
import { decryptNetworkSecret, encryptNetworkSecret, generateNetworkSecret } from '../server/_lib/networkSecret.js';

const currentMaster = 'current-network-master-key-longer-than-32-bytes-0123456789';
const oldMaster = 'previous-network-master-key-longer-than-32-bytes-0123456789';

function fakeDatabase(initialData) {
  const data = { ...initialData };
  const ref = { id: 'NET-10001' };
  const db = {
    runTransaction: (callback) => callback({
      get: async (receivedRef) => {
        assert.equal(receivedRef, ref);
        return { exists: true, data: () => ({ ...data }) };
      },
      set: (receivedRef, value, options) => {
        assert.equal(receivedRef, ref);
        assert.deepEqual(options, { merge: true });
        Object.assign(data, value);
      },
    }),
  };
  return { db, ref, data };
}

test('unreadable network keys are not rotated unless recovery is explicitly enabled', async () => {
  const previous = process.env.KROTAK_HMAC_SECRET;
  process.env.KROTAK_HMAC_SECRET = currentMaster;
  try {
    const { db, ref, data } = fakeDatabase({
      networkSecretEncrypted: encryptNetworkSecret('existing-network-secret', oldMaster),
      networkSecretVersion: 3,
    });
    await assert.rejects(ensureNetworkSecret(db, ref), /network_secret_decryption_failed/);
    assert.equal(data.networkSecretVersion, 3);
  } finally {
    if (previous === undefined) delete process.env.KROTAK_HMAC_SECRET;
    else process.env.KROTAK_HMAC_SECRET = previous;
  }
});

test('authenticated recovery rotates an unreadable key atomically and returns the new key', async () => {
  const previous = process.env.KROTAK_HMAC_SECRET;
  process.env.KROTAK_HMAC_SECRET = currentMaster;
  try {
    const oldEnvelope = encryptNetworkSecret('existing-network-secret', oldMaster);
    const { db, ref, data } = fakeDatabase({
      networkSecretEncrypted: oldEnvelope,
      networkSecretVersion: 3,
      otherNetworkField: 'preserved',
    });
    const result = await ensureNetworkSecret(db, ref, { recoverUndecryptable: true });
    assert.equal(result.created, false);
    assert.equal(result.rotated, true);
    assert.notEqual(data.networkSecretEncrypted, oldEnvelope);
    assert.equal(data.networkSecretVersion, 4);
    assert.equal(data.otherNetworkField, 'preserved');
    assert.equal(decryptNetworkSecret(data.networkSecretEncrypted), result.networkSecret);

    const repeated = await ensureNetworkSecret(db, ref, { recoverUndecryptable: true });
    assert.equal(repeated.rotated, false);
    assert.equal(repeated.networkSecret, result.networkSecret);
  } finally {
    if (previous === undefined) delete process.env.KROTAK_HMAC_SECRET;
    else process.env.KROTAK_HMAC_SECRET = previous;
  }
});

test('recovery does not rotate valid existing keys', async () => {
  const previous = process.env.KROTAK_HMAC_SECRET;
  process.env.KROTAK_HMAC_SECRET = currentMaster;
  try {
    const secret = generateNetworkSecret();
    const envelope = encryptNetworkSecret(secret);
    const { db, ref, data } = fakeDatabase({ networkSecretEncrypted: envelope, networkSecretVersion: 2 });
    const result = await ensureNetworkSecret(db, ref, { recoverUndecryptable: true });
    assert.equal(result.networkSecret, secret);
    assert.equal(result.rotated, false);
    assert.equal(data.networkSecretEncrypted, envelope);
    assert.equal(data.networkSecretVersion, 2);
  } finally {
    if (previous === undefined) delete process.env.KROTAK_HMAC_SECRET;
    else process.env.KROTAK_HMAC_SECRET = previous;
  }
});

test('rotation keeps the previous key verifiable only inside the grace window', async () => {
  const previous = process.env.KROTAK_HMAC_SECRET;
  process.env.KROTAK_HMAC_SECRET = currentMaster;
  try {
    const now = 1_800_000_000_000;
    const oldSecret = 'old-network-secret';
    const { db, ref, data } = fakeDatabase({
      networkSecretEncrypted: encryptNetworkSecret(oldSecret, currentMaster),
      networkSecretVersion: 3,
    });
    const result = await rotateNetworkSecret(db, ref, {
      now,
      graceMs: 60_000,
      actorUid: 'admin-1',
      reason: 'scheduled rotation',
    });
    assert.equal(result.rotated, true);
    assert.equal(result.previousVersion, 3);
    assert.equal(result.version, 4);
    assert.equal(data.networkSecretVersion, 4);
    assert.equal(data.previousNetworkSecretVersion, 3);
    assert.equal(data.previousNetworkSecretValidUntilMs, now + 60_000);
    assert.equal(decryptNetworkSecret(data.networkSecretEncrypted), result.networkSecret);
    assert.equal(decryptNetworkSecret(data.previousNetworkSecretEncrypted), oldSecret);

    const duringGrace = networkSecretCandidates(data, { now: now + 1_000 });
    assert.deepEqual(duringGrace.map((entry) => entry.version), [4, 3]);
    assert.equal(duringGrace[0].current, true);
    assert.equal(duringGrace[1].current, false);

    const afterGrace = networkSecretCandidates(data, { now: now + 60_001 });
    assert.deepEqual(afterGrace.map((entry) => entry.version), [4]);
  } finally {
    if (previous === undefined) delete process.env.KROTAK_HMAC_SECRET;
    else process.env.KROTAK_HMAC_SECRET = previous;
  }
});
