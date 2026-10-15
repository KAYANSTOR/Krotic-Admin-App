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
