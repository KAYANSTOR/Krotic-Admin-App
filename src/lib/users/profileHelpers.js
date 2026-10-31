const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const MONTH_NAMES = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

export function isValidMonthKey(monthKey) {
  return typeof monthKey === 'string' && MONTH_KEY_RE.test(monthKey);
}

export function formatMonthArabic(monthKey) {
  if (!isValidMonthKey(monthKey)) return monthKey || '';
  const [year, month] = monthKey.split('-').map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function hasCustomCommission(user) {
  return user?.commission_rate != null
    && user.commission_rate !== ''
    && Number.isFinite(Number(user.commission_rate));
}

export function getUserDisplayName(user, fallbackUid = '') {
  return user?.networkName
    || user?.network_name
    || user?.name
    || user?.networkTitle
    || user?.phone
    || String(fallbackUid || 'المشترك');
}

/** يعرض 0 كرقم إصدار صحيحاً ولا يحوّله إلى "غير مُبلّغ". */
export function formatAppVersion(code) {
  if (code == null || code === '') return 'غير مُبلّغ';
  if (typeof code === 'number' && !Number.isFinite(code)) return 'غير مُبلّغ';
  const normalized = String(code).trim();
  return normalized || 'غير مُبلّغ';
}

export const ACCESS_LABEL = Object.freeze({
  TRIAL: Object.freeze({ text: 'تجريبي', tone: 'warning' }),
  ACTIVE_PAID: Object.freeze({ text: 'رسمي', tone: 'success' }),
  SUSPENDED_GRACE: Object.freeze({ text: 'موقوف', tone: 'danger' }),
  LOCKED_EXPIRED: Object.freeze({ text: 'منتهي', tone: 'danger' }),
});

export function getAccessStatusMeta(user) {
  if (user?.accessStatus && ACCESS_LABEL[user.accessStatus]) return ACCESS_LABEL[user.accessStatus];
  return user?.is_trial ? ACCESS_LABEL.TRIAL : ACCESS_LABEL.ACTIVE_PAID;
}
