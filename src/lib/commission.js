/**
 * العمولة في اللوحة تُقرأ من الخادم فقط (قرار المالك ي3): لا حساب مالي محلي.
 * القيم الخادمية: commissionMinor / commissionAmount / commission.
 * تُرجع null للسجلات القديمة غير المتحقق منها خادمياً.
 */
export const CANCELLED_SALE_STATUS = 'CANCELLED';

/**
 * البيع الملغى من جهاز مالك الشبكة (قرار المالك O-07): يبقى السجل للشفافية
 * لكنه لا يدخل في أي عمولة أو مستحق أو إجمالي أو تسوية.
 */
export function isCancelledSale(sale) {
  return sale?.status === CANCELLED_SALE_STATUS || sale?.settlement_status === CANCELLED_SALE_STATUS;
}

/**
 * المُسند المالي الوحيد للواجهة (O-07 القاعدة 3): يُحتسب فقط البيع المكتمل
 * أو القديم بلا حالة. أي حالة أخرى (CANCELLED، ROLLED_BACK، SMS_PENDING...)
 * تُستبعد من العمولة والمستحق والإجماليات.
 */
export function isCompletedSale(sale) {
  if (isCancelledSale(sale)) return false;
  return !sale?.status || sale.status === 'COMPLETED';
}

export function saleFaceValue(sale) {
  const major = sale?.faceValue ?? sale?.amount ?? sale?.amountRiyal;
  if (major !== null && major !== undefined) {
    const value = Number(major);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  const raw = Number(sale?.amountMinor);
  const value = Number(sale?.moneyPolicyVersion) === 2 ? raw / 100 : raw;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function saleCommission(sale) {
  const raw = sale?.commissionRiyal ?? sale?.commissionMinor ?? sale?.commissionAmount ?? sale?.commission;
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * يتحقق من أن سجل البيع موثق خادمياً بأدلة فعلية لا يمكن تزويرها من العميل:
 * 1. المصدر مسار الخادم: source === 'admin_api'
 * 2. حالة التحقق: verified === true
 * 3. بصمة الحمولة الخادمية: payloadHash (64-char hex)
 * 4. إيصال التوقيع المعتمد: verificationReceipt (timestamp.hmac)
 * 5. إصدار السياسة المالية والخادمية: payloadPolicyVersion >= 2 || moneyPolicyVersion >= 2
 */
export function isServerVerifiedSale(sale) {
  if (!sale || typeof sale !== 'object') return false;
  const isSourceServer = sale.source === 'admin_api';
  const isVerifiedFlag = sale.verified === true;
  const hasValidHash = typeof sale.payloadHash === 'string' && /^[0-9a-f]{64}$/i.test(sale.payloadHash);
  const hasReceipt = typeof sale.verificationReceipt === 'string' && /^\d+\.[0-9a-f]{6,64}$/i.test(sale.verificationReceipt);
  const hasModernPolicy = Number(sale.payloadPolicyVersion) >= 2 || Number(sale.moneyPolicyVersion) >= 2;
  const hasValidAmount = (sale.amountRiyal != null && Number.isFinite(Number(sale.amountRiyal)))
    || (sale.faceValue != null && Number.isFinite(Number(sale.faceValue)));

  return Boolean(isSourceServer && isVerifiedFlag && hasValidHash && hasReceipt && hasModernPolicy && hasValidAmount);
}

export function sumCommission(sales = []) {
  return sales.filter(isCompletedSale).reduce((sum, sale) => sum + (saleCommission(sale) ?? 0), 0);
}

/** إجمالي العمولات المعتمدة خادمياً فقط عبر قائمة مبيعات. */
export function sumVerifiedCommission(sales = []) {
  return sales
    .filter((sale) => isCompletedSale(sale) && isServerVerifiedSale(sale))
    .reduce((sum, sale) => sum + (saleCommission(sale) ?? 0), 0);
}

export function hasUnverifiedCommission(sales = []) {
  return sales.some((sale) => isCompletedSale(sale) && saleCommission(sale) === null);
}

/** المتبقي غير المسوّى على بيع واحد = عمولته − ما سُدّد منه (صفر للبيع غير المكتمل أو الملغى). */
export function saleOutstanding(sale) {
  if (!isCompletedSale(sale)) return 0;
  const commission = saleCommission(sale);
  if (commission === null) return 0;
  const paid = Number(sale?.paidRiyal ?? sale?.paidMinor) || 0;
  return Math.max(0, commission - paid);
}

/** إجمالي العمولة غير المسوّاة (المتبقية) عبر قائمة مبيعات. */
export function sumOutstanding(sales = []) {
  return sales.reduce((sum, sale) => sum + saleOutstanding(sale), 0);
}

/** إجمالي العمولة المعتمدة غير المسوّاة (للمبيعات الموثقة خادمياً فقط). */
export function sumVerifiedOutstanding(sales = []) {
  return sales
    .filter((sale) => isCompletedSale(sale) && isServerVerifiedSale(sale))
    .reduce((sum, sale) => sum + saleOutstanding(sale), 0);
}

/** إجمالي مبالغ المبيعات القديمة غير المعتمدة خادمياً (لأغراض المراجعة والتسوية اليدوية). */
export function sumLegacyUnverifiedSales(sales = []) {
  return sales
    .filter((s) => isCompletedSale(s) && !isServerVerifiedSale(s))
    .reduce((sum, s) => sum + saleFaceValue(s), 0);
}

/** العمولة التي أُلغيت مع البيع: اللقطة الخادمية وقت الإلغاء، وإلا عمولة البيع الأصلية. */
export function cancelledSaleCommission(sale) {
  const raw = sale?.cancelledCommissionRiyal;
  if (raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw))) return Number(raw);
  return saleCommission(sale) ?? 0;
}

/** قيمة البيع الملغى: اللقطة الخادمية وقت الإلغاء، وإلا القيمة الاسمية الأصلية. */
export function cancelledSaleAmount(sale) {
  const raw = sale?.cancelledAmountRiyal;
  if (raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0) return Number(raw);
  return saleFaceValue(sale);
}

/** عدّادات المبيعات الملغاة للعرض الشفاف فقط؛ لا تدخل في أي عمولة أو مستحق. */
export function summarizeCancelledSales(sales = []) {
  const cancelled = sales.filter(isCancelledSale);
  return {
    cancelledTransactions: cancelled.length,
    cancelledSalesValue: cancelled.reduce((sum, sale) => sum + cancelledSaleAmount(sale), 0),
    cancelledCommission: cancelled.reduce((sum, sale) => sum + cancelledSaleCommission(sale), 0),
  };
}

/**
 * The shared financial definition used by dashboard, sales and user cards:
 * only completed sales are financially counted; commission is never invented
 * locally, and outstanding uses the same server snapshots as the sales ledger.
 * Separates verified Ingest sales from legacy unverified sales without mutating past records.
 */
export function summarizeCompletedSales(sales = []) {
  const completedSales = sales.filter(isCompletedSale);
  const commissionDue = sumCommission(completedSales);
  const outstandingCommission = sumOutstanding(completedSales);

  return {
    reportedSalesValue: completedSales.reduce((sum, sale) => sum + saleFaceValue(sale), 0),
    reportedTransactions: completedSales.length,
    commissionDue,
    outstandingCommission,
    recordedPayments: Math.max(0, commissionDue - outstandingCommission),
    ...summarizeCancelledSales(sales),
  };
}

export function summarizeSalesWithVerification(sales = []) {
  const base = summarizeCompletedSales(sales);
  const completedSales = sales.filter(isCompletedSale);
  const verifiedSales = completedSales.filter(isServerVerifiedSale);
  const legacySales = completedSales.filter((s) => !isServerVerifiedSale(s));

  return {
    ...base,
    verifiedTransactions: verifiedSales.length,
    legacyTransactions: legacySales.length,
    verifiedSalesValue: verifiedSales.reduce((sum, s) => sum + saleFaceValue(s), 0),
    verifiedCommissionDue: sumVerifiedCommission(verifiedSales),
    verifiedOutstandingCommission: sumVerifiedOutstanding(verifiedSales),
    legacySalesValue: legacySales.reduce((sum, s) => sum + saleFaceValue(s), 0),
    legacyEstimatedCommission: legacySales.reduce((sum, s) => sum + (saleCommission(s) ?? 0), 0),
  };
}
