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
export function normalizeUserAccess(user) {
  const raw = user?.accessStatus;
  const status = raw == null ? '' : String(raw).trim().toUpperCase();
  if (!status) return user;

  return {
    ...user,
    is_active: KNOWN_ACCESS_STATUSES.has(status)
      && (status === 'TRIAL' || status === 'ACTIVE_PAID'),
    is_trial: status === 'TRIAL',
  };
}
