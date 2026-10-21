import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ackIdempotencyKey,
  latestVerifiedAck,
  validateAckInput,
  verifyAck,
} from '../server/_lib/templateCenterAck.js';

const hash = 'a'.repeat(64);

function validAck(overrides = {}) {
  return {
    ackVersion: 1,
    installationId: 'install-1',
    releaseId: 'release-1',
    payloadHash: hash,
    scopeKey: 'global',
    outcome: 'applied',
    appliedAt: '2026-01-01T00:00:00.000Z',
    insertedCount: 3,
    conflictCount: 0,
    ...overrides,
  };
}

const publishedRelease = {
  id: 'release-1',
  status: 'published',
  scopeKey: 'global',
  scope: { type: 'global', networkId: null },
  payloadHashSha256: hash,
};

test('ACK input validation pins version and required identity fields', () => {
  assert.equal(validateAckInput(validAck()).ok, true);
  assert.equal(validateAckInput(validAck({ scopeKey: 'network:net-1' })).ok, true);
  assert.equal(validateAckInput(validAck({ scopeKey: 'network:bad id' })).error, 'scope_key_invalid');
  assert.equal(validateAckInput({ ...validAck(), ackVersion: 2 }).error, 'ack_version_unsupported');
  assert.equal(validateAckInput({ ...validAck(), payloadHash: 'short' }).error, 'payload_hash_invalid');
  assert.equal(validateAckInput({ ...validAck(), outcome: 'ok' }).error, 'outcome_invalid');
  assert.equal(validateAckInput({ ...validAck(), installationId: 'bad id!' }).error, 'installation_id_invalid');
  assert.equal(validateAckInput({ ...validAck(), appliedAt: 'nope' }).error, 'applied_at_invalid');
  assert.equal(validateAckInput({ ...validAck(), insertedCount: -1 }).error, 'ack_counts_invalid');
  const { installationId, ...withoutInstall } = validAck();
  assert.equal(validateAckInput(withoutInstall).error, 'installation_id_invalid');
});

test('ACK verification accepts a matching network-scoped release', () => {
  const ack = validateAckInput(validAck({ scopeKey: 'network:net-1' })).value;
  const release = {
    ...publishedRelease,
    scopeKey: 'network:net-1',
    scope: { type: 'network', networkId: 'net-1' },
  };
  const verified = verifyAck({ ack, uid: 'u1', release });
  assert.equal(verified.ok, true);
  assert.equal(verified.record.scopeKey, 'network:net-1');
});

test('ACK verification rejects unknown, unpublished, hash-mismatch and scope-mismatch', () => {
  const ack = validateAckInput(validAck()).value;
  assert.equal(verifyAck({ ack, uid: 'u1', release: null }).error, 'release_not_found');
  assert.equal(verifyAck({ ack, uid: 'u1', release: { ...publishedRelease, status: 'draft' } }).error, 'release_not_published');
  assert.equal(verifyAck({ ack, uid: 'u1', release: { ...publishedRelease, payloadHashSha256: 'b'.repeat(64) } }).error, 'payload_hash_mismatch');
  assert.equal(verifyAck({ ack, uid: 'u1', release: { ...publishedRelease, scopeKey: 'network:n1' } }).error, 'scope_mismatch');
});

test('ACK verification enforces the bound installation when the account has one', () => {
  const ack = validateAckInput(validAck()).value;
  const mismatched = verifyAck({ ack, uid: 'u1', release: publishedRelease, boundInstallationId: 'other-install' });
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.error, 'installation_mismatch');
  assert.equal(mismatched.status, 403);

  const matched = verifyAck({ ack, uid: 'u1', release: publishedRelease, boundInstallationId: 'install-1' });
  assert.equal(matched.ok, true);
  assert.equal(matched.record.verified, true);
  assert.equal(matched.record.deviceBound, true);
  assert.equal(matched.record.uid, 'u1');
});

test('a verified ACK record carries no secret or message content', () => {
  const ack = validateAckInput(validAck({ failureReason: 'payload_sections_missing' })).value;
  const { record } = verifyAck({ ack, uid: 'u1', release: publishedRelease });
  const serialized = JSON.stringify(record);
  for (const forbidden of ['secret', 'token', 'signature', 'body', 'message', 'privateKey']) {
    assert.equal(serialized.includes(forbidden), false, `record must not include ${forbidden}`);
  }
  assert.equal(record.verified, true);
});

test('idempotency key is stable for the same identity and outcome', () => {
  const base = { uid: 'u1', installationId: 'i1', releaseId: 'r1', payloadHash: hash, outcome: 'applied' };
  assert.equal(ackIdempotencyKey(base), ackIdempotencyKey({ ...base }));
  assert.notEqual(ackIdempotencyKey(base), ackIdempotencyKey({ ...base, outcome: 'failed' }));
  assert.notEqual(ackIdempotencyKey(base), ackIdempotencyKey({ ...base, installationId: 'i2' }));
  assert.equal(ackIdempotencyKey(base).length, 64);
});

test('latestVerifiedAck only considers verified records within the scope', () => {
  const records = [
    { verified: true, scopeKey: 'global', appliedAt: '2026-01-01T00:00:00.000Z', uid: 'old' },
    { verified: true, scopeKey: 'global', appliedAt: '2026-01-02T00:00:00.000Z', uid: 'new' },
    { verified: false, scopeKey: 'global', appliedAt: '2026-01-03T00:00:00.000Z', uid: 'unverified' },
    { verified: true, scopeKey: 'network:n1', appliedAt: '2026-01-04T00:00:00.000Z', uid: 'other-scope' },
  ];
  const latest = latestVerifiedAck(records, 'global');
  assert.equal(latest.uid, 'new');
  assert.equal(latestVerifiedAck([], 'global'), null);
});
