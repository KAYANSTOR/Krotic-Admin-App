import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPLICATION_LIFECYCLE_STATES,
  computeTemplatePayloadHash,
  validateTemplateAckPayload,
  resolveDeviceReleaseStatus,
  validateFeatureEntitlements,
  FEATURE_ENTITLEMENT_TIERS,
  SYNTHETIC_CONTRACT_FIXTURES,
} from '../server/_lib/templateAckContract.js';

test('CONTRACT: Android ACK payload validation succeeds for valid applied receipt', () => {
  const validAck = {
    schemaVersion: 1,
    uid: 'user-valid-01',
    installationId: 'inst-valid-01',
    releaseId: 'rel-global-v1',
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    status: 'applied',
    appliedAt: 1_700_000_000_000,
    walletsCount: 6,
    transferTemplatesCount: 12,
    outboundTemplatesCount: 8,
    conflictsCount: 0,
    parserRefreshed: true,
    appVersion: '1.0.15',
    appBuild: 15,
  };

  const result = validateTemplateAckPayload(validAck);
  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'applied');
  assert.equal(result.value.parserRefreshed, true);
  assert.equal(result.value.appliedAtMs, 1_700_000_000_000);
});

test('CONTRACT: Rejects ACK with invalid payload hash or missing failure reason', () => {
  // Invalid hash length / characters
  const badHashAck = {
    schemaVersion: 1,
    uid: 'user-01',
    installationId: 'inst-01',
    releaseId: 'rel-01',
    payloadHash: 'invalid-not-64-hex',
    status: 'applied',
    appliedAt: 1_700_000_000_000,
    parserRefreshed: true,
  };
  const badHashResult = validateTemplateAckPayload(badHashAck);
  assert.equal(badHashResult.ok, false);
  assert.equal(badHashResult.error, 'payload_hash_invalid');

  // Failed status without failure reason
  const missingReasonAck = {
    schemaVersion: 1,
    uid: 'user-01',
    installationId: 'inst-01',
    releaseId: 'rel-01',
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    status: 'failed',
    appliedAt: 1_700_000_000_000,
    parserRefreshed: false,
  };
  const missingReasonResult = validateTemplateAckPayload(missingReasonAck);
  assert.equal(missingReasonResult.ok, false);
  assert.equal(missingReasonResult.error, 'failure_reason_required_for_error_status');
});

test('CONTRACT: Expected release matching verifies hash integrity and detects tampering', () => {
  const publishedRelease = {
    releaseId: 'rel-global-v1',
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    payload: { wallets: [], transferTemplates: [], outboundTemplates: [] },
  };

  const matchingAck = {
    schemaVersion: 1,
    uid: 'user-01',
    installationId: 'inst-01',
    releaseId: 'rel-global-v1',
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    status: 'applied',
    appliedAt: 1_700_000_000_000,
    parserRefreshed: true,
  };

  const validMatch = validateTemplateAckPayload(matchingAck, publishedRelease);
  assert.equal(validMatch.ok, true);

  // Mismatched releaseId
  const wrongReleaseAck = { ...matchingAck, releaseId: 'rel-global-v2' };
  const mismatchResult = validateTemplateAckPayload(wrongReleaseAck, publishedRelease);
  assert.equal(mismatchResult.ok, false);
  assert.equal(mismatchResult.error, 'release_id_mismatch');

  // Tampered payload hash
  const tamperedAck = { ...matchingAck, payloadHash: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' };
  const tamperedResult = validateTemplateAckPayload(tamperedAck, publishedRelease);
  assert.equal(tamperedResult.ok, false);
  assert.equal(tamperedResult.error, 'payload_hash_mismatch');
});

test('CONTRACT: resolveDeviceReleaseStatus strictly differentiates lifecycle states', () => {
  const published = {
    releaseId: 'rel-global-v5',
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  };

  // 1. No ACK yet received -> Published centrally, NOT applied
  const stateNoAck = resolveDeviceReleaseStatus(null, published);
  assert.equal(stateNoAck.state, APPLICATION_LIFECYCLE_STATES.PUBLISHED_CENTRALLY);
  assert.equal(stateNoAck.verifiedOnDevice, false);

  // 2. ACK with status applied and parserRefreshed -> Full success
  const appliedAck = {
    installationId: 'inst-1',
    releaseId: 'rel-global-v5',
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    status: 'applied',
    parserRefreshed: true,
    appliedAtIso: '2026-10-19T12:00:00.000Z',
    walletsCount: 4,
    transferTemplatesCount: 8,
    outboundTemplatesCount: 5,
  };
  const stateApplied = resolveDeviceReleaseStatus(appliedAck, published);
  assert.equal(stateApplied.state, APPLICATION_LIFECYCLE_STATES.PARSER_REFRESHED);
  assert.equal(stateApplied.verifiedOnDevice, true);

  // 3. ACK with status applied but parser not yet refreshed -> APPLIED_LOCALLY
  const appliedOnlyDrift = { ...appliedAck, parserRefreshed: false };
  const stateAppliedOnly = resolveDeviceReleaseStatus(appliedOnlyDrift, published);
  assert.equal(stateAppliedOnly.state, APPLICATION_LIFECYCLE_STATES.APPLIED_LOCALLY);
  assert.equal(stateAppliedOnly.verifiedOnDevice, true);

  // 4. Failed ACK
  const failedAck = {
    installationId: 'inst-1',
    releaseId: 'rel-global-v5',
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    status: 'failed',
    failureReason: 'schema_drift_mismatch',
  };
  const stateFailed = resolveDeviceReleaseStatus(failedAck, published);
  assert.equal(stateFailed.state, APPLICATION_LIFECYCLE_STATES.FAILED);
  assert.equal(stateFailed.verifiedOnDevice, false);
  assert.equal(stateFailed.reason, 'schema_drift_mismatch');

  // 5. Conflict (Hash mismatch)
  const conflictAck = {
    ...appliedAck,
    payloadHash: '0000000000000000000000000000000000000000000000000000000000000000',
  };
  const stateConflict = resolveDeviceReleaseStatus(conflictAck, published);
  assert.equal(stateConflict.state, APPLICATION_LIFECYCLE_STATES.CONFLICT);
  assert.equal(stateConflict.verifiedOnDevice, false);

  // 6. Outdated release applied
  const outdatedAck = { ...appliedAck, releaseId: 'rel-global-v4' };
  const stateOutdated = resolveDeviceReleaseStatus(outdatedAck, published);
  assert.equal(stateOutdated.state, APPLICATION_LIFECYCLE_STATES.UNKNOWN);
  assert.equal(stateOutdated.code, 'device_release_outdated');

  // 7. Cached locally but not yet applied
  const cachedAck = { ...appliedAck, status: 'cached' };
  const stateCached = resolveDeviceReleaseStatus(cachedAck, published);
  assert.equal(stateCached.state, APPLICATION_LIFECYCLE_STATES.CACHED);
  assert.equal(stateCached.verifiedOnDevice, false);
});

test('CONTRACT: Wallets are strictly message sources without financial balances', () => {
  const wallets = SYNTHETIC_CONTRACT_FIXTURES.wallets;
  assert.ok(wallets.length >= 2);

  for (const wallet of wallets) {
    assert.equal(wallet._nonProduction, true);
    assert.ok(wallet.id);
    assert.ok(wallet.name);
    assert.ok(['sms', 'notification'].includes(wallet.sourceMode));
    assert.ok(['active', 'suspended', 'archived'].includes(wallet.status));

    // Strict boundary: NO balance or ledger or commission fields
    assert.equal('balance' in wallet, false, 'Wallets must NOT have financial balance');
    assert.equal('balanceRiyal' in wallet, false);
    assert.equal('ledger' in wallet, false);
    assert.equal('commission' in wallet, false);
  }
});

test('CONTRACT: Feature Entitlements map cleanly and are separated from Ed25519 Lease', () => {
  const fixture = SYNTHETIC_CONTRACT_FIXTURES.featureEntitlements;
  const validation = validateFeatureEntitlements(fixture);
  assert.equal(validation.ok, true);
  assert.equal(validation.value.tierId, 'PRO');
  assert.equal(validation.value.maxPosCount, 5);
  assert.equal(validation.value.allowNotificationSource, true);

  // Rejects invalid tier
  const badTier = validateFeatureEntitlements({ tierId: 'SUPER_VIP' });
  assert.equal(badTier.ok, false);
  assert.equal(badTier.error, 'invalid_entitlement_tier');

  // Signed Lease fixture is distinct and has cryptographic signature fields
  const mockLease = SYNTHETIC_CONTRACT_FIXTURES.mockSignedLease;
  assert.ok(mockLease.signature);
  assert.equal(mockLease.signatureAlgorithm, 'Ed25519');
  assert.equal('maxPosCount' in mockLease, false, 'Signed lease must not confuse feature entitlements with authorization lease');
});
