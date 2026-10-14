// ============================================================
// Krotak Pro — العملة والمال (قرار المالك ج)
// الريال اليمني (YER) عملة صحيحة بالكامل: لا كسور فلسية.
// كل المبالغ أعداد صحيحة من الريال، والعمولة تُقرَّب لأقرب ريال.
// ============================================================

export const CURRENCY = 'YER';
export const MAX_AMOUNT_MINOR = 1_000_000_000_000;

/** مبلغ صحيح من الريال ضمن الحدود المسموحة. */
export function isWholeRiyal(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_AMOUNT_MINOR;
}

/** مبلغ موجب صحيح من الريال (للبيع/التسوية). */
export function isPositiveRiyal(value) {
  return isWholeRiyal(value) && value > 0;
}

/** نسبة مئوية صالحة (0–100). */
export function isValidRatePercent(value) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0 && rate <= 100;
}

/**
 * عمولة المنصة بالريال الصحيح. التقريب لأقرب ريال (Math.round) وفق قرار ج4.
 * ratePercent نسبة مئوية (مثال: 5 تعني 5%).
 */
export function commissionFor(amountMinor, ratePercent) {
  const amount = Math.trunc(Number(amountMinor) || 0);
  const rate = Number(ratePercent);
  if (!Number.isFinite(rate) || rate < 0) return 0;
  return Math.round(amount * rate / 100);
}

/** أجزاء المئة (basis points): 100 bps = 1%. */
export function percentToBps(percent) {
  const rate = Number(percent);
  if (!Number.isFinite(rate) || rate < 0) return 0;
  return Math.round(rate * 100);
}

export function bpsToPercent(bps) {
  return Number(bps) / 100;
}

/** العمولة من أجزاء المئة، بالريال الصحيح. */
export function commissionFromBps(amountMinor, rateBps) {
  const amount = Math.trunc(Number(amountMinor) || 0);
  const bps = Number(rateBps);
  if (!Number.isFinite(bps) || bps < 0) return 0;
  return Math.round(amount * bps / 10000);
}
