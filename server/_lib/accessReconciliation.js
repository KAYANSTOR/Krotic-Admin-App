const ACTIVE_STATUSES = new Set(['TRIAL', 'ACTIVE_PAID']);

function timestampMillis(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function accessStateOf(record) {
  if (!record || typeof record !== 'object') return null;
  const explicitStatus = typeof record.accessStatus === 'string'
    ? record.accessStatus.trim().toUpperCase()
    : '';
  const status = explicitStatus || (record.is_active === true
    ? (record.is_trial === true ? 'TRIAL' : 'ACTIVE_PAID')
    : record.is_active === false ? 'LEGACY_INACTIVE' : '');
  // Preserve explicit unknown and legacy inactive states for timestamp
  // comparison; the issuer's active-status allowlist will fail them closed.
  if (!status) return null;
  const end = record.subscriptionEndsAt ?? record.subscription_end_date ?? null;
  return {
    accessStatus: status,
    is_active: ACTIVE_STATUSES.has(status),
    is_trial: status === 'TRIAL',
    subscriptionEndsAt: record.subscriptionEndsAt ?? end,
    subscription_end_date: record.subscription_end_date ?? end,
    ...(record.trialStartedAt != null ? { trialStartedAt: record.trialStartedAt } : {}),
    updatedAtMs: timestampMillis(record.updatedAtMs) || timestampMillis(record.updatedAt),
    accessUpdatedAtMs: timestampMillis(record.accessUpdatedAtMs),
  };
}

/**
 * Pick the access snapshot whose *access fields* were written most recently.
 *
 * `accessUpdatedAtMs` is stamped only by access writers (provision, renew,
 * suspend, expiry, settlement). A record carrying it is always newer than a
 * legacy record without it. The generic `updatedAtMs` is a legacy fallback
 * only, because sales totals and settings bump it on the network document and
 * would otherwise let a stale network status override a fresh user status.
 * With no usable timestamps the user record stays the source of truth.
 */
export function chooseLatestAccessState(user, network) {
  const userState = accessStateOf(user);
  const networkState = accessStateOf(network);
  if (!userState) return networkState;
  if (!networkState) return userState;
  if (userState.accessUpdatedAtMs || networkState.accessUpdatedAtMs) {
    return networkState.accessUpdatedAtMs > userState.accessUpdatedAtMs ? networkState : userState;
  }
  return networkState.updatedAtMs > userState.updatedAtMs ? networkState : userState;
}

export function accessStateMatches(record, state) {
  if (!record || !state) return false;
  return record.accessStatus === state.accessStatus
    && Boolean(record.is_active) === state.is_active
    && Boolean(record.is_trial) === state.is_trial
    && timestampMillis(record.subscriptionEndsAt ?? record.subscription_end_date)
      === timestampMillis(state.subscriptionEndsAt)
    && timestampMillis(record.subscription_end_date ?? record.subscriptionEndsAt)
      === timestampMillis(state.subscription_end_date);
}

export { timestampMillis };
