// ============================================================
// Krotak Pro — مكتبة المهاجرة (قرار المالك ي1/ي2)
// منطق نقي لإعادة تصنيف الحسابات القديمة وإعادة بناء الأرصدة والمجاميع
// الخادمية بشكل قابل للاستئناف (restartable) وآمن التكرار.
// ============================================================

import { commissionFor } from './money.js';
import { ACCESS_STATUSES } from './accessStatus.js';

const KNOWN_ACCESS_STATUSES = new Set(ACCESS_STATUSES);

/** حالات الوصول الخادمية بعد التصنيف؛ الحالة الحديثة تسبق أي حقل قديم متعارض. */
export function classifyAccessStatus({ accessStatus, is_trial, is_active, subscriptionEndMs }, now = Date.now()) {
  const currentStatus = typeof accessStatus === 'string' ? accessStatus.trim().toUpperCase() : '';
  if (KNOWN_ACCESS_STATUSES.has(currentStatus)) return currentStatus;
  // لا تحوّل حالة حديثة غير معروفة إلى حساب نشط اعتماداً على علم قديم.
  if (currentStatus) return 'SUSPENDED_GRACE';
  if (is_active === false) return 'SUSPENDED_GRACE';
  const end = Number(subscriptionEndMs) || 0;
  if (end > 0 && end < now) return 'LOCKED_EXPIRED';
  if (is_trial === true) return 'TRIAL';
  return 'ACTIVE_PAID';
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

/**
 * عمولة البيع: تُؤخذ من الحقول الخادمية إن وُجدت، وإلا تُحتسب من نسبة الشبكة
 * (قرار د3: إعادة احتساب العمولة خادمياً على المبيعات التاريخية غير المسوّاة).
 */
export function saleCommissionMinor(sale, commissionRatePercent = 5) {
  if (sale?.commissionRiyal !== null && sale?.commissionRiyal !== undefined) {
    const riyal = Number(sale.commissionRiyal);
    return Number.isFinite(riyal) && riyal >= 0 ? Math.round(riyal) : 0;
  }
  const explicit = sale?.commissionMinor ?? sale?.commissionAmount ?? sale?.commission;
  const value = Number(explicit);
  if (Number.isFinite(value) && value > 0) return Math.round(value);
  return commissionFor(saleFaceValue(sale), commissionRatePercent);
}

function isCompleted(sale) {
  return !sale?.status || sale.status === 'COMPLETED';
}

function monthKeyOf(value) {
  if (!value) return null;
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** الرصيد التراكمي للشبكة من المبيعات والدفعات (قرار هـ2). */
export function computeNetworkTotals(sales = [], payments = [], commissionRatePercent = 5) {
  let totalSalesAmount = 0;
  let totalCommissionDue = 0;
  for (const sale of sales) {
    if (!isCompleted(sale)) continue;
    totalSalesAmount += saleFaceValue(sale);
    totalCommissionDue += saleCommissionMinor(sale, commissionRatePercent);
  }
  const totalPaidAmount = payments.reduce((sum, payment) => sum + (Number(payment?.amount) || 0), 0);
  return {
    totalSalesAmount,
    totalCommissionDue,
    totalPaidAmount,
    outstandingBalance: Math.max(0, totalCommissionDue - totalPaidAmount),
  };
}

/** مجاميع اللوحة الخادمية لشبكة واحدة (قرار ي3). */
export function computeAggregate(sales = [], commissionRatePercent = 5) {
  const monthly = {};
  let totalFaceValue = 0;
  let totalTransactions = 0;
  let totalCommissionDue = 0;
  for (const sale of sales) {
    if (!isCompleted(sale)) continue;
    const face = saleFaceValue(sale);
    const commission = saleCommissionMinor(sale, commissionRatePercent);
    totalFaceValue += face;
    totalTransactions += 1;
    totalCommissionDue += commission;
    const key = monthKeyOf(sale?.createdAt);
    if (!key) continue;
    const bucket = monthly[key] || { face: 0, count: 0 };
    bucket.face += face;
    bucket.count += 1;
    monthly[key] = bucket;
  }
  return { totalFaceValue, totalTransactions, totalCommissionDue, monthly };
}

/** التصنيف الكامل لمستخدم قديم (حقول خادمية + ربط الشبكة). */
export function planUserMigration(user, { now = Date.now(), defaultTrialDays = 30, globalRate = 5 } = {}) {
  const endMs = Number(user?.subscriptionEndMs) || 0;
  const accessStatus = classifyAccessStatus({
    accessStatus: user?.accessStatus,
    is_trial: user?.is_trial,
    is_active: user?.is_active,
    subscriptionEndMs: endMs,
  }, now);
  const trialStartedAt = Number(user?.trialStartedAt) || now;
  const subscriptionEndsAt = endMs > 0 ? endMs : trialStartedAt + defaultTrialDays * 86_400_000;
  const commissionRate = Number.isFinite(Number(user?.commission_rate)) && user?.commission_rate !== '' && user?.commission_rate != null
    ? Number(user.commission_rate)
    : globalRate;
  const networkId = typeof user?.networkId === 'string' && user.networkId ? user.networkId : (user?.uid || null);
  return {
    accessStatus,
    trialStartedAt,
    subscriptionEndsAt,
    commissionRate,
    networkId,
    ownerUid: user?.uid || null,
  };
}
