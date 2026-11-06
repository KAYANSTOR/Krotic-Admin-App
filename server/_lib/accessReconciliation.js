import { ACCESS_STATUSES } from './accessStatus.js';

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
  const status = typeof record.accessStatus === 'string'
    ? record.accessStatus.trim().toUpperCase()
    : '';
  if (!ACCESS_STATUSES.includes(status)) return null;
  const end = record.subscriptionEndsAt ?? record.subscription_end_date ?? null;
  const endMs = timestampMillis(end);
  if (!end || !endMs) return null;
  return {
    accessStatus: status,
    is_active: ACTIVE_STATUSES.has(status),
    is_trial: status === 'TRIAL',
    subscriptionEndsAt: record.subscriptionEndsAt ?? end,
    subscription_end_date: record.subscription_end_date ?? end,
    ...(record.trialStartedAt != null ? { trialStartedAt: record.trialStartedAt } : {}),
    updatedAtMs: timestampMillis(record.updatedAtMs) || timestampMillis(record.updatedAt),
  };
}

/**
 * Pick the server-owned access snapshot written most recently. If timestamps
 * are unavailable, keep the user record as the conservative source of truth.
 */
export function chooseLatestAccessState(user, network) {
  const userState = accessStateOf(user);
  const networkState = accessStateOf(network);
  if (!userState) return networkState;
  if (!networkState) return userState;
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
