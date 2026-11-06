import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUserAccess } from '../src/lib/accessStatus.js';
import { resolveAccountAccess } from '../server/_lib/accountAccess.js';

test('modern suspension state overrides stale legacy active flags', () => {
  assert.deepEqual(normalizeUserAccess({
    uid: 'user-1',
    accessStatus: 'SUSPENDED_GRACE',
    is_active: true,
    is_trial: true,
  }), {
    uid: 'user-1',
    accessStatus: 'SUSPENDED_GRACE',
    is_active: false,
    is_trial: false,
    accessNeedsRepair: true,
  });
});

test('modern active paid state overrides stale legacy inactive flags', () => {
  const normalized = normalizeUserAccess({
    uid: 'user-2',
    accessStatus: 'ACTIVE_PAID',
    is_active: false,
    is_trial: true,
  });
  assert.equal(normalized.is_active, true);
  assert.equal(normalized.is_trial, false);
  assert.equal(normalized.accessNeedsRepair, true);
});

test('trial status derives both legacy compatibility flags', () => {
  const normalized = normalizeUserAccess({
    uid: 'user-3',
    accessStatus: 'TRIAL',
    is_active: false,
    is_trial: false,
  });
  assert.equal(normalized.is_active, true);
  assert.equal(normalized.is_trial, true);
  assert.equal(normalized.accessNeedsRepair, true);
});

test('unknown explicit access status fails closed for administration UI', () => {
  const normalized = normalizeUserAccess({
    uid: 'user-4',
    accessStatus: 'UNKNOWN',
    is_active: true,
    is_trial: true,
  });
  assert.equal(normalized.is_active, false);
  assert.equal(normalized.is_trial, false);
  assert.equal(normalized.accessNeedsRepair, true);
});

test('legacy-only records preserve their existing status fields', () => {
  const legacy = { uid: 'user-5', is_active: true, is_trial: true };
  assert.equal(normalizeUserAccess(legacy), legacy);
});

test('lease access uses the legacy flags only when the modern status is absent', () => {
  const nowMs = Date.UTC(2026, 10, 1);
  const end = new Date(nowMs + 86_400_000).toISOString();
  const reason = (user) => resolveAccountAccess({ user, nowMs }).reason;
  assert.equal(reason({ is_active: true, is_trial: true, subscription_end_date: end }), 'active');
  assert.equal(reason({ is_active: true, is_trial: false, subscription_end_date: end }), 'active');
  assert.equal(reason({ is_active: false, is_trial: false, subscription_end_date: end }), 'account_suspended');
  assert.equal(reason({ is_active: true, accessStatus: 'SUSPENDED_GRACE', subscription_end_date: end }), 'account_suspended');
  assert.equal(reason({ is_active: true, accessStatus: 'UNKNOWN', subscription_end_date: end }), 'access_state_missing');
});


test('consistent modern access fields do not request repair', () => {
  const normalized = normalizeUserAccess({
    uid: 'user-7',
    accessStatus: 'ACTIVE_PAID',
    is_active: true,
    is_trial: false,
    subscriptionEndsAt: new Date('2026-10-30T00:00:00.000Z'),
    subscription_end_date: new Date('2026-10-30T00:00:00.000Z'),
  });
  assert.equal(normalized.accessNeedsRepair, false);
});
