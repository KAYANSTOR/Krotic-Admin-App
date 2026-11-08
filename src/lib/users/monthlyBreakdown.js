import { monthKeyFromDate } from '../billingHelpers.js';
import {
  saleCommission,
  saleFaceValue,
  saleOutstanding,
  isServerVerifiedSale,
  isCompletedSale,
  isCancelledSale,
  cancelledSaleAmount,
  cancelledSaleCommission,
} from '../commission.js';
import { isValidMonthKey } from './profileHelpers.js';

export function paymentMonthKey(payment) {
  if (isValidMonthKey(payment?.month)) return payment.month;
  return monthKeyFromDate(payment?.timestamp ?? payment?.createdAt);
}

export function createEmptyMonthBucket(month) {
  return {
    month,
    sales: [],
    payments: [],
    totalSales: 0,
    verifiedSalesTotal: 0,
    legacySalesTotal: 0,
    verifiedCount: 0,
    legacyCount: 0,
    verifiedCommissionDue: 0,
    legacyEstimatedCommission: 0,
    commissionDue: 0,
    totalPaid: 0,
    verifiedOutstanding: 0,
    outstanding: 0,
    // المبيعات الملغاة (O-07): تُعرض بشفافية ولا تدخل في العمولة أو المستحق.
    cancelledCount: 0,
    cancelledSalesTotal: 0,
    cancelledCommission: 0,
    // حالات غير مكتملة أخرى (مسترجع، بانتظار SMS...) تُعرض ولا تُحتسب.
    excludedCount: 0,
  };
}

export function buildMonthlyBreakdown(allSales = [], allPayments = [], monthOptions = []) {
  const buckets = Object.create(null);
  const ensure = (month) => {
    if (!buckets[month]) buckets[month] = createEmptyMonthBucket(month);
    return buckets[month];
  };

  for (const month of monthOptions) {
    if (month && month !== 'all') ensure(month);
  }

  for (const sale of Array.isArray(allSales) ? allSales : []) {
    const month = monthKeyFromDate(sale?.createdAt);
    if (!month) continue;

    const bucket = ensure(month);
    bucket.sales.push(sale);

    // المُسند المالي المشترك: لا يدخل في المجاميع المالية إلا البيع المكتمل.
    if (!isCompletedSale(sale)) {
      if (isCancelledSale(sale)) {
        bucket.cancelledCount += 1;
        bucket.cancelledSalesTotal += cancelledSaleAmount(sale);
        bucket.cancelledCommission += cancelledSaleCommission(sale);
      } else {
        bucket.excludedCount += 1;
      }
      continue;
    }

    const faceValue = saleFaceValue(sale);
    bucket.totalSales += faceValue;
    const commission = saleCommission(sale) ?? 0;

    if (isServerVerifiedSale(sale)) {
      bucket.verifiedCount += 1;
      bucket.verifiedSalesTotal += faceValue;
      bucket.verifiedCommissionDue += commission;
      bucket.verifiedOutstanding += saleOutstanding(sale);
    } else {
      bucket.legacyCount += 1;
      bucket.legacySalesTotal += faceValue;
      bucket.legacyEstimatedCommission += commission;
    }
  }

  for (const payment of Array.isArray(allPayments) ? allPayments : []) {
    const month = paymentMonthKey(payment);
    if (!month) continue;
    const bucket = ensure(month);
    bucket.payments.push(payment);
    bucket.totalPaid += Number(payment?.amount) || 0;
  }

  // Finalize derived values once, after sales and payment loops have completed.
  for (const bucket of Object.values(buckets)) {
    bucket.commissionDue = bucket.verifiedCommissionDue;
    bucket.outstanding = bucket.verifiedOutstanding;
  }

  return Object.values(buckets).sort((left, right) => right.month.localeCompare(left.month));
}
