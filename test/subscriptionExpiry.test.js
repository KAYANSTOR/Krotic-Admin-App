import test from 'node:test';
import assert from 'node:assert/strict';
import { expiryMillis, shouldLockExpiredAccount } from '../api/_lib/subscriptionExpiry.js';

const NOW = 1_800_000_000_000;

test('locks TRIAL and ACTIVE_PAID accounts at or before the server time', () => {
  assert.equal(shouldLockExpiredAccount({ accessStatus: 'TRIAL', subscriptionEndsAt: NOW - 1 }, NOW), true);
  assert.equal(shouldLockExpiredAccount({ accessStatus: 'ACTIVE_PAID', subscriptionEndsAt: NOW }, NOW), true);
  assert.equal(shouldLockExpiredAccount({ accessStatus: 'ACTIVE_PAID', subscriptionEndsAt: NOW + 1 }, NOW), false);
});

test('supports legacy expiry dates without reclassifying manually suspended accounts', () => {
  assert.equal(shouldLockExpiredAccount({ is_active: true, is_trial: true, subscription_end_date: new Date(NOW - 1) }, NOW), true);
  assert.equal(shouldLockExpiredAccount({ is_active: false, subscription_end_date: NOW - 1 }, NOW), false);
  assert.equal(shouldLockExpiredAccount({ accessStatus: 'SUSPENDED_GRACE', subscriptionEndsAt: NOW - 1 }, NOW), false);
});

test('does not lock records with missing, invalid, or unknown status/expiry data', () => {
  assert.equal(shouldLockExpiredAccount({ accessStatus: 'PENDING', subscriptionEndsAt: NOW - 1 }, NOW), false);
  assert.equal(shouldLockExpiredAccount({ accessStatus: 'ACTIVE_PAID' }, NOW), false);
  assert.equal(shouldLockExpiredAccount(null, NOW), false);
  assert.equal(expiryMillis('not-a-date'), 0);
  assert.equal(expiryMillis({ toMillis: () => NOW }), NOW);
});


test('modern active status overrides a stale false legacy flag during expiry checks', () => {
  assert.equal(shouldLockExpiredAccount({
    accessStatus: 'ACTIVE_PAID',
    is_active: false,
    subscriptionEndsAt: NOW - 1,
  }, NOW), true);
  assert.equal(shouldLockExpiredAccount({
    accessStatus: 'ACTIVE_PAID',
    is_active: false,
    subscriptionEndsAt: NOW + 1,
  }, NOW), false);
  assert.equal(shouldLockExpiredAccount({
    accessStatus: 'SUSPENDED_GRACE',
    is_active: true,
    subscription_end_date: new Date(NOW - 1),
  }, NOW), false);
});
