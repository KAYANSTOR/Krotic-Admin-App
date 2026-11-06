/** Shared compatibility mapping for installed Android versions and admin reports. */
export const ACCESS_STATUSES = ['TRIAL', 'ACTIVE_PAID', 'SUSPENDED_GRACE', 'LOCKED_EXPIRED'];

/** Keep legacy booleans and expiry date consistent with the server-owned access status. */
export function legacyAccessFields(accessStatus, endAt) {
  const fields = {
    is_active: accessStatus === 'TRIAL' || accessStatus === 'ACTIVE_PAID',
    is_trial: accessStatus === 'TRIAL',
  };
  if (endAt !== undefined) fields.subscription_end_date = endAt;
  return fields;
}

/**
 * Stamp written with every server-side access change (status or end date).
 * Reconciliation between users/{uid} and networks/{networkId} compares this
 * field instead of the generic updatedAtMs, which unrelated writes (sales
 * totals, heartbeats, settings) bump constantly.
 */
export function accessStamp(nowMs = Date.now()) {
  return { accessUpdatedAtMs: nowMs };
}
