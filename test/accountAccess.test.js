import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAccountAccess, saleAllowedByAccess, ACCESS_REASONS } from '../server/_lib/accountAccess.js';
import { chooseLatestAccessState } from '../server/_lib/accessReconciliation.js';
import { planDeviceTransfer, MAX_TRANSFERS_PER_WINDOW, DEVICE_TRANSFER_WINDOW_MS } from '../server/_lib/deviceTransferPolicy.js';
import { isSaleAllowedForAccount } from '../server/apiHandlers/sales-ingest.js';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

test('active account with future end is eligible', () => {
  const access = resolveAccountAccess({ user: { accessStatus: 'ACTIVE_PAID', subscriptionEndsAt: NOW + DAY }, nowMs: NOW });
  assert.equal(access.eligible, true);
  assert.equal(access.reason, ACCESS_REASONS.ACTIVE);
});

test('end date reached is expired even before the daily job runs', () => {
  const access = resolveAccountAccess({ user: { accessStatus: 'TRIAL', subscriptionEndsAt: NOW - 1 }, nowMs: NOW });
  assert.equal(access.eligible, false);
  assert.equal(access.reason, ACCESS_REASONS.SUBSCRIPTION_EXPIRED);
});

test('explicit suspension is reported as suspension, not expiry', () => {
  const access = resolveAccountAccess({ user: { accessStatus: 'SUSPENDED_GRACE', subscriptionEndsAt: NOW + DAY }, nowMs: NOW });
  assert.equal(access.reason, ACCESS_REASONS.ACCOUNT_SUSPENDED);
});

test('a fresh admin renewal wins over a stale network record that sales keep touching', () => {
  // The network document is bumped by every sale (updatedAtMs), but its access
  // fields are old. The user record carries the newer access stamp.
  const user = { accessStatus: 'ACTIVE_PAID', subscriptionEndsAt: NOW + 20 * DAY, accessUpdatedAtMs: NOW - DAY, updatedAtMs: NOW - DAY };
  const network = { accessStatus: 'SUSPENDED_GRACE', subscriptionEndsAt: NOW - DAY, updatedAtMs: NOW };
  assert.equal(chooseLatestAccessState(user, network).accessStatus, 'ACTIVE_PAID');
  assert.equal(resolveAccountAccess({ user, network, nowMs: NOW }).eligible, true);
});

test('the newest access stamp wins between user and network', () => {
  const user = { accessStatus: 'LOCKED_EXPIRED', subscriptionEndsAt: NOW - DAY, accessUpdatedAtMs: NOW - 2 * DAY };
  const network = { accessStatus: 'ACTIVE_PAID', subscriptionEndsAt: NOW + DAY, accessUpdatedAtMs: NOW - DAY };
  assert.equal(chooseLatestAccessState(user, network).accessStatus, 'ACTIVE_PAID');
});

test('sales made before expiry stay uploadable; later sales are locked; suspension blocks', () => {
  const expired = resolveAccountAccess({ user: { accessStatus: 'LOCKED_EXPIRED', subscriptionEndsAt: NOW - DAY }, nowMs: NOW });
  assert.equal(saleAllowedByAccess(expired, NOW - 2 * DAY).ok, true);
  assert.equal(saleAllowedByAccess(expired, NOW - DAY + 1).error, 'subscription_expired_new_sales_locked');
  const suspended = resolveAccountAccess({ user: { accessStatus: 'SUSPENDED_GRACE', subscriptionEndsAt: NOW + DAY }, nowMs: NOW });
  assert.equal(saleAllowedByAccess(suspended, NOW - DAY).error, 'account_suspended');
});

test('sales ingest uses the reconciled network state', () => {
  const user = { accessStatus: 'SUSPENDED_GRACE', subscriptionEndsAt: NOW + DAY, accessUpdatedAtMs: NOW - 2 * DAY };
  const network = { accessStatus: 'ACTIVE_PAID', subscriptionEndsAt: NOW + DAY, accessUpdatedAtMs: NOW - DAY };
  assert.equal(isSaleAllowedForAccount(user, NOW - 1000, NOW, network).ok, true);
  assert.equal(isSaleAllowedForAccount(user, NOW - 1000, NOW).error, 'account_suspended');
});

test('device transfer: new installation allowed, replaced one refused, limit enforced', () => {
  const user = { entitlementInstallationId: 'inst-a', entitlementVersion: 4 };
  const first = planDeviceTransfer({ user, installationId: 'inst-b', nowMs: NOW });
  assert.equal(first.allowed, true);
  assert.equal(first.nextVersion, 5);
  assert.deepEqual(first.history, ['inst-a', 'inst-b']);

  const back = planDeviceTransfer({
    user: { entitlementInstallationId: 'inst-b', entitlementInstallationHistory: first.history },
    installationId: 'inst-a',
    nowMs: NOW,
  });
  assert.equal(back.reason, 'installation_replaced');

  const transfers = Array.from({ length: MAX_TRANSFERS_PER_WINDOW }, (_, i) => NOW - i - 1);
  const limited = planDeviceTransfer({ user: { ...user, entitlementAutoTransfersMs: transfers }, installationId: 'inst-z', nowMs: NOW });
  assert.equal(limited.reason, 'device_transfer_limit_reached');

  const old = [NOW - DEVICE_TRANSFER_WINDOW_MS - 1, NOW - DEVICE_TRANSFER_WINDOW_MS - 2, NOW - DEVICE_TRANSFER_WINDOW_MS - 3];
  assert.equal(planDeviceTransfer({ user: { ...user, entitlementAutoTransfersMs: old }, installationId: 'inst-z', nowMs: NOW }).allowed, true);
});
