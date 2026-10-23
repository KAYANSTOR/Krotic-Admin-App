import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACK_SUBCOLLECTION,
  ackIdempotencyKey,
  latestVerifiedAck,
  mapAckForAdmin,
  validateAckInput,
  verifyAck,
} from '../server/_lib/templateCenterAck.js';

const hash = 'a'.repeat(64);

function validAck(overrides = {}) {
  return {
    action: 'ack',
    ackVersion: 1,
    installationId: 'device-12345678',
    releaseId: 'release-1',
    payloadHash: hash,
    scopeKey: 'global',
    outcome: 'applied',
    appliedAt: '2026-01-01T00:00:00.000Z',
    insertedCount: 3,
    conflictCount: 0,
    parserRefreshed: true,
    appVersion: '1.2.3',
    appBuild: 12,
    ...overrides,
  };
}

const publishedRelease = {
  id: 'release-1',
  status: 'published',
  scopeKey: 'global',
  scope: { type: 'global', networkId: null },
  version: '1.0.3',
  versionCode: 3,
  payloadHashSha256: hash,
};

test('ACK request matches Android contract and pins required fields', () => {
  assert.equal(validateAckInput(validAck()).ok, true);
  assert.equal(validateAckInput(validAck({ scopeKey: 'network:net-1' })).ok, true);
  assert.equal(validateAckInput(validAck({ scopeKey: 'network:bad id' })).error, 'scope_key_invalid');
  assert.equal(validateAckInput({ ...validAck(), ackVersion: 2 }).error, 'ack_version_unsupported');
  assert.equal(validateAckInput({ ...validAck(), payloadHash: 'short' }).error, 'payload_hash_invalid');
  assert.equal(validateAckInput({ ...validAck(), outcome: 'rejected' }).error, 'outcome_invalid');
  assert.equal(validateAckInput({ ...validAck(), installationId: 'bad id!' }).error, 'installation_id_invalid');
  assert.equal(validateAckInput({ ...validAck(), appliedAt: 'nope' }).error, 'applied_at_invalid');
  assert.equal(validateAckInput({ ...validAck(), insertedCount: -1 }).error, 'ack_counts_invalid');
  assert.equal(validateAckInput({ ...validAck(), parserRefreshed: undefined }).error, 'parser_refreshed_invalid');
  assert.equal(validateAckInput({ ...validAck(), appVersion: 'v1' }).error, 'app_version_invalid');
  assert.equal(validateAckInput({ ...validAck(), uid: 'untrusted' }).error, 'ack_body_invalid');
  assert.equal(validateAckInput({ ...validAck(), appliedAt: '2035-01-01T00:00:00.000Z' }, { now: Date.parse('2026-01-01T00:00:00Z') }).error, 'applied_at_invalid');
  const { installationId, ...withoutInstall } = validAck();
  assert.equal(validateAckInput(withoutInstall).error, 'installation_id_invalid');
  assert.equal(ACK_SUBCOLLECTION, 'template_acks');
});

test('ACK verification accepts a matching network-scoped release and bound device', () => {
  const ack = validateAckInput(validAck({ scopeKey: 'network:net-1' })).value;
  const release = { ...publishedRelease, scopeKey: 'network:net-1', scope: { type: 'network', networkId: 'net-1' } };
  const verified = verifyAck({ ack, uid: 'u1', release, boundInstallationId: ack.installationId });
  assert.equal(verified.ok, true);
  assert.equal(verified.record.scopeKey, 'network:net-1');
  assert.equal(verified.record.deviceBound, true);
});

test('ACK verification rejects missing, unpublished, hash/scope mismatch and wrong device', () => {
  const ack = validateAckInput(validAck()).value;
  assert.equal(verifyAck({ ack, uid: 'u1', release: null }).error, 'release_not_found');
  assert.equal(verifyAck({ ack, uid: 'u1', release: { ...publishedRelease, status: 'draft' } }).error, 'release_not_published');
  assert.equal(verifyAck({ ack, uid: 'u1', release: { ...publishedRelease, payloadHashSha256: 'b'.repeat(64) } }).error, 'payload_hash_mismatch');
  assert.equal(verifyAck({ ack, uid: 'u1', release: { ...publishedRelease, scopeKey: 'network:n1' } }).error, 'scope_mismatch');
  const mismatched = verifyAck({ ack, uid: 'u1', release: publishedRelease, boundInstallationId: 'device-87654321' });
  assert.equal(mismatched.status, 403);
  assert.equal(mismatched.error, 'installation_mismatch');
});

test('verified ACK view contains only bounded metadata, never raw messages or secrets', () => {
  const ack = validateAckInput(validAck()).value;
  const { record } = verifyAck({ ack, uid: 'u1', release: publishedRelease, boundInstallationId: ack.installationId });
  const serialized = JSON.stringify(record);
  for (const forbidden of ['secret', 'token', 'signature', 'body', 'message', 'privateKey']) {
    assert.equal(serialized.includes(forbidden), false, `record must not include ${forbidden}`);
  }
  assert.equal(record.verified, true);
  const adminView = mapAckForAdmin('device-12345678', {
    writer: 'server', uid: 'u1', device_id: 'device-12345678', network_id: 'net-1',
    applied_version_id: 'release-1', payload_hash_sha256: hash, scope_key: 'global',
    outcome: 'applied', inserted_count: 3, conflict_count: 0, parser_refreshed: true,
    app_version: '1.2.3', app_build: 12, applied_at: new Date('2026-01-01T00:00:00.000Z'),
  });
  assert.equal(adminView.verified, true);
  assert.equal(adminView.uid, 'u1');
  assert.equal(adminView.releaseId, 'release-1');
  assert.equal(adminView.networkId, 'net-1');
});

test('idempotency key is stable for the same identity and outcome', () => {
  const base = { uid: 'u1', installationId: 'device-12345678', releaseId: 'r1', payloadHash: hash, outcome: 'applied' };
  assert.equal(ackIdempotencyKey(base), ackIdempotencyKey({ ...base }));
  assert.notEqual(ackIdempotencyKey(base), ackIdempotencyKey({ ...base, outcome: 'failed' }));
  assert.notEqual(ackIdempotencyKey(base), ackIdempotencyKey({ ...base, installationId: 'device-87654321' }));
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
