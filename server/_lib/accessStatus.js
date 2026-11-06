/** Shared compatibility mapping for installed Android versions and admin reports. */
export const ACCESS_STATUSES = ['TRIAL', 'ACTIVE_PAID', 'SUSPENDED_GRACE', 'LOCKED_EXPIRED'];

/**
 * Resolve the server-side state used by lease issuance.
 * Explicit modern status always wins (including unknown values, which callers
 * must reject). Only pre-migration records with an explicit active legacy flag
 * may fall back to the old trial/paid distinction used by the admin UI.
 */
export function resolveLeaseAccessStatus(record) {
  const raw = record?.accessStatus;
  if (typeof raw === 'string' && raw.trim()) return raw.trim().toUpperCase();
  if (record?.is_active !== true) return '';
  return record?.is_trial === true ? 'TRIAL' : 'ACTIVE_PAID';
}

/** Keep legacy booleans and expiry date consistent with the server-owned access status. */
export function legacyAccessFields(accessStatus, endAt) {
  const fields = {
    is_active: accessStatus === 'TRIAL' || accessStatus === 'ACTIVE_PAID',
    is_trial: accessStatus === 'TRIAL',
  };
  if (endAt !== undefined) fields.subscription_end_date = endAt;
  return fields;
}
