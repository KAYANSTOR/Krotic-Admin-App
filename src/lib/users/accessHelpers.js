import { toDate } from '../format';

/**
 * كشف عدم تطابق بين حقل الاشتراك الحديث والقديم.
 * يُستخدم لتحديد ما إذا كانت بيانات تاريخ الانتهاء تحتاج إلى إصلاح.
 */
export function hasExpiryCompatibilityGap(user) {
  const modernValue = user?.subscriptionEndsAt;
  const legacyValue = user?.subscription_end_date;
  if (modernValue == null && legacyValue == null) return false;

  const modernDate = toDate(modernValue);
  const legacyDate = toDate(legacyValue);
  return !modernDate || !legacyDate || modernDate.getTime() !== legacyDate.getTime();
}
