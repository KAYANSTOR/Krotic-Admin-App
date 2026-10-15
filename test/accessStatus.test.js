import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUserAccess } from '../src/lib/accessStatus.js';

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
});

test('legacy-only records preserve their existing status fields', () => {
  const legacy = { uid: 'user-5', is_active: true, is_trial: true };
  assert.equal(normalizeUserAccess(legacy), legacy);
});
