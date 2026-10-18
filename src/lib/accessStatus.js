export const ACCESS_STATUSES = Object.freeze([
  'TRIAL',
  'ACTIVE_PAID',
  'SUSPENDED_GRACE',
  'LOCKED_EXPIRED',
]);

const KNOWN_ACCESS_STATUSES = new Set(ACCESS_STATUSES);

/**
 * Normalize the legacy fields consumed by existing admin screens.
 * The server-owned accessStatus wins whenever it is explicitly present;
 * legacy booleans remain a compatibility fallback for pre-migration records.
 */
function timestampMillis(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function sameTimestamp(left, right) {
  const leftMillis = timestampMillis(left);
  const rightMillis = timestampMillis(right);
  return leftMillis !== null && rightMillis !== null && leftMillis === rightMillis;
}

export function isUserPhoneVerified(user) {
  if (!user) return false;
  return Boolean(
    user.phone_verified === true ||
    user.phoneVerified === true ||
    user.is_phone_verified === true ||
    user.phone_verified_manual === true
  );
}

export function normalizeUserAccess(user) {
  if (!user) return user;
  const raw = user?.accessStatus;
  const status = raw == null ? '' : String(raw).trim().toUpperCase();
  if (!status) return user;

  const isActive = KNOWN_ACCESS_STATUSES.has(status)
    && (status === 'TRIAL' || status === 'ACTIVE_PAID');
  const isTrial = status === 'TRIAL';
  const endAt = user.subscriptionEndsAt ?? user.subscription_end_date ?? null;
  const expiryNeedsSync = endAt != null && (
    !sameTimestamp(user.subscriptionEndsAt, endAt)
    || !sameTimestamp(user.subscription_end_date, endAt)
  );
  const accessNeedsRepair = raw !== status
    || user.is_active !== isActive
    || user.is_trial !== isTrial
    || expiryNeedsSync;

  return {
    ...user,
    is_active: isActive,
    is_trial: isTrial,
    accessNeedsRepair,
  };
}
