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
