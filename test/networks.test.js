import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateNetworkInput,
  computeRenewalEnd,
  ACCESS_STATUSES,
  TRIAL_DAYS,
  RENEWAL_DAYS,
} from '../api/networks.js';

const DAY_MS = 24 * 60 * 60 * 1000;

test('access statuses and durations match the owner policy', () => {
  assert.deepEqual(ACCESS_STATUSES, ['TRIAL', 'ACTIVE_PAID', 'SUSPENDED_GRACE', 'LOCKED_EXPIRED']);
  assert.equal(TRIAL_DAYS, 30);
  assert.equal(RENEWAL_DAYS, 30);
});

test('provision requires a valid owner uid', () => {
  assert.equal(validateNetworkInput({ action: 'provision', ownerUid: 'user_1' }).ok, true);
  assert.equal(validateNetworkInput({ action: 'provision', ownerUid: 'bad uid!' }).error, 'owner_uid_invalid');
  assert.equal(validateNetworkInput({ action: 'nope' }).error, 'unknown_action');
});

test('update-access validates each server-owned field', () => {
  assert.equal(validateNetworkInput({ action: 'update-access', uid: 'user_1', accessStatus: 'ACTIVE_PAID' }).ok, true);
  assert.equal(validateNetworkInput({ action: 'update-access', uid: 'user_1', accessStatus: 'NOPE' }).error, 'access_status_invalid');
  assert.equal(validateNetworkInput({ action: 'update-access', uid: 'user_1', commission_rate: 150 }).error, 'commission_rate_invalid');
  assert.equal(validateNetworkInput({ action: 'update-access', uid: 'user_1', subscriptionEndsAt: -1 }).error, 'subscription_end_invalid');
  assert.equal(validateNetworkInput({ action: 'update-access', uid: 'user_1' }).error, 'no_fields');
});

test('renew is manual and only 30 days', () => {
  assert.equal(validateNetworkInput({ action: 'renew', uid: 'user_1', extensionDays: 30 }).ok, true);
  assert.equal(validateNetworkInput({ action: 'renew', uid: 'user_1', extensionDays: 7 }).error, 'extension_days_invalid');
  assert.equal(validateNetworkInput({ action: 'renew', uid: 'user_1' }).value.extensionDays, 30);
});

test('batch-expiry requires a positive timestamp', () => {
  assert.equal(validateNetworkInput({ action: 'batch-expiry', subscriptionEndsAt: 1_800_000_000_000 }).ok, true);
  assert.equal(validateNetworkInput({ action: 'batch-expiry', subscriptionEndsAt: 0 }).error, 'subscription_end_invalid');
});

test('renewal adds 30 days to the later of the current end and now', () => {
  const now = 1_700_000_000_000;
  // لاشتراك منتهٍ: يبدأ من الآن.
  assert.equal(computeRenewalEnd(now - 5 * DAY_MS, now), now + 30 * DAY_MS);
  // لاشتراك سارٍ: يُضاف إلى تاريخ الانتهاء الحالي.
  assert.equal(computeRenewalEnd(now + 10 * DAY_MS, now), now + 40 * DAY_MS);
  assert.equal(computeRenewalEnd(0, now), now + 30 * DAY_MS);
});
