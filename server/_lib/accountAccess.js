import { chooseLatestAccessState, timestampMillis } from './accessReconciliation.js';

/**
 * Single source of truth for "may this account use the app right now?".
 *
 * Every client-facing endpoint (entitlement lease, sales ingest, device
 * heartbeat) resolves access through this module so a customer never gets a
 * lease from one endpoint and a rejection from another for the same account.
 *
 * Reasons are stable contract values returned to the Android app:
 * - `active`                 TRIAL or ACTIVE_PAID with a future end date.
 * - `subscription_expired`   end date reached (even before the daily expiry
 *                            job flips the status to LOCKED_EXPIRED).
 * - `account_suspended`      explicit admin suspension (SUSPENDED_*) or a
 *                            legacy record with is_active === false.
 * - `access_state_missing`   no recognizable server-owned access state.
 */
export const ACCESS_REASONS = Object.freeze({
  ACTIVE: 'active',
  SUBSCRIPTION_EXPIRED: 'subscription_expired',
  ACCOUNT_SUSPENDED: 'account_suspended',
  ACCESS_STATE_MISSING: 'access_state_missing',
});

const ACTIVE_STATUSES = new Set(['TRIAL', 'ACTIVE_PAID']);
const EXPIRED_STATUSES = new Set(['LOCKED_EXPIRED', 'EXPIRED']);
const NETWORK_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function networkIdForUser(uid, user) {
  const candidate = typeof user?.networkId === 'string' ? user.networkId.trim() : '';
  return candidate && NETWORK_ID_PATTERN.test(candidate) ? candidate : uid;
}

export function networkBelongsToUser(uid, networkId, network) {
  return Boolean(network)
    && (network.owner_uid === uid || (!network.owner_uid && networkId === uid));
}

function isSuspendedStatus(status) {
  return status.startsWith('SUSPENDED') || status === 'LEGACY_INACTIVE' || status === 'BLOCKED';
}

/**
 * Pure resolution from the already-loaded user and network documents.
 * `network` must be the network document only when it belongs to the user.
 */
export function resolveAccountAccess({ user, network = null, nowMs = Date.now() }) {
  const state = chooseLatestAccessState(user, network);
  if (!state) {
    return { eligible: false, reason: ACCESS_REASONS.ACCESS_STATE_MISSING, state: null, endMs: 0 };
  }
  const status = state.accessStatus;
  const endMs = timestampMillis(state.subscriptionEndsAt ?? state.subscription_end_date);
  if (user?.blocked === true || isSuspendedStatus(status)) {
    return { eligible: false, reason: ACCESS_REASONS.ACCOUNT_SUSPENDED, state, endMs };
  }
  if (EXPIRED_STATUSES.has(status)) {
    return { eligible: false, reason: ACCESS_REASONS.SUBSCRIPTION_EXPIRED, state, endMs };
  }
  if (!ACTIVE_STATUSES.has(status)) {
    return { eligible: false, reason: ACCESS_REASONS.ACCESS_STATE_MISSING, state, endMs };
  }
  if (!Number.isFinite(endMs) || endMs <= nowMs) {
    return { eligible: false, reason: ACCESS_REASONS.SUBSCRIPTION_EXPIRED, state, endMs };
  }
  return { eligible: true, reason: ACCESS_REASONS.ACTIVE, state, endMs };
}

/**
 * Whether a sale created at `createdMs` may be recorded for this account.
 * Sales are real money already collected offline, so only two cases block
 * an upload:
 * - explicit suspension (`account_suspended`);
 * - a sale created after the subscription end
 *   (`subscription_expired_new_sales_locked`).
 * Sales made while the subscription was valid stay uploadable after expiry,
 * so an expired customer can always drain the offline queue.
 */
export function saleAllowedByAccess(access, createdMs) {
  if (access.reason === ACCESS_REASONS.ACCOUNT_SUSPENDED) {
    return { ok: false, status: 403, error: 'account_suspended' };
  }
  if (access.reason === ACCESS_REASONS.SUBSCRIPTION_EXPIRED
    && Number.isFinite(access.endMs) && access.endMs > 0
    && typeof createdMs === 'number' && createdMs > access.endMs) {
    return {
      ok: false,
      status: 403,
      error: 'subscription_expired_new_sales_locked',
      subscriptionEndsAtMs: access.endMs,
      saleCreatedMs: createdMs,
    };
  }
  return { ok: true };
}

/**
 * Loads users/{uid} and the network that belongs to it with the provided
 * reader (`transaction.get` inside a transaction, or `ref => ref.get()`).
 */
export async function loadAccountAccess(db, uid, { read = (ref) => ref.get(), nowMs = Date.now() } = {}) {
  const userRef = db.collection('users').doc(uid);
  const userSnapshot = await read(userRef);
  if (!userSnapshot.exists) {
    return { exists: false, userRef, user: null, networkId: uid, networkRef: null, network: null, access: null };
  }
  const user = userSnapshot.data() || {};
  const networkId = networkIdForUser(uid, user);
  const networkRef = db.collection('networks').doc(networkId);
  const networkSnapshot = await read(networkRef);
  const rawNetwork = networkSnapshot.exists ? networkSnapshot.data() || {} : null;
  const ownsNetwork = networkBelongsToUser(uid, networkId, rawNetwork);
  const network = ownsNetwork ? rawNetwork : null;
  const access = resolveAccountAccess({ user, network, nowMs });
  return { exists: true, userRef, user, networkId, networkRef, network, rawNetwork, ownsNetwork, access };
}
