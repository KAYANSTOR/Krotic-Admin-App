/**
 * العمولة في اللوحة تُقرأ من الخادم فقط (قرار المالك ي3): لا حساب مالي محلي.
 * القيم الخادمية: commissionMinor / commissionAmount / commission.
 * تُرجع null للسجلات القديمة غير المتحقق منها خادمياً.
 */
export function saleCommission(sale) {
  const raw = sale?.commissionMinor ?? sale?.commissionAmount ?? sale?.commission;
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function sumCommission(sales = []) {
  return sales.reduce((sum, sale) => sum + (saleCommission(sale) ?? 0), 0);
}

export function hasUnverifiedCommission(sales = []) {
  return sales.some((sale) => saleCommission(sale) === null);
}

/** المتبقي غير المسوّى على بيع واحد = عمولته − ما سُدّد منه. */
export function saleOutstanding(sale) {
  const commission = saleCommission(sale);
  if (commission === null) return 0;
  const paid = Number(sale?.paidMinor) || 0;
  return Math.max(0, commission - paid);
}

/** إجمالي العمولة غير المسوّاة (المتبقية) عبر قائمة مبيعات. */
export function sumOutstanding(sales = []) {
  return sales.reduce((sum, sale) => sum + saleOutstanding(sale), 0);
}
