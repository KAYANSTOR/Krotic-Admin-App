// ============================================================
// Krotak Pro — دفتر الرصيد التراكمي للشبكة (ملحق المالك: توحيد Ledger)
// ------------------------------------------------------------
// المرجع المالي الوحيد على مستند networks/{networkId}:
//   totalSalesAmount, totalCommissionDue, totalPaidAmount, outstandingBalance
// عند أي دفعة: تُخصّص للمبيعات داخل الشهر المحدد فقط (FIFO داخل الشهر)،
// ولا تُنقل لتغطية عمولات شهر آخر. مشترك بين /api/record-payment و/api/settlement.
// ============================================================

import { FieldValue } from 'firebase-admin/firestore';
import { allocateFifo, saleOutstanding } from './settlementLedger.js';

export const PENDING_SETTLEMENT = 'PENDING_SETTLEMENT';
export const SETTLED = 'SETTLED';
export const PARTIAL = 'PARTIAL';

export function computeOutstanding(totalCommissionDue, totalPaidAmount) {
  return Math.max(0, (Number(totalCommissionDue) || 0) - (Number(totalPaidAmount) || 0));
}

/**
 * حدود الشهر الميلادي بتوقيت اليمن (Asia/Aden، UTC+03:00).
 * إرجاع حد نهاية حصري يمنع خلط مبيعات آخر يوم مع الشهر التالي.
 */
export function monthBounds(month) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(month ?? ''));
  if (!match) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const start = new Date(`${match[1]}-${match[2]}-01T00:00:00+03:00`);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  const end = new Date(`${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+03:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { start, end };
}

/** Query محدود بالشهر المختار، لا بدورة الاشتراك ولا بكل سجل الشبكة. */
export function monthlySalesQuery(networkRef, month, limit = 400) {
  const bounds = monthBounds(month);
  if (!bounds) throw new TypeError('month_invalid');
  return networkRef.collection('sales')
    .where('createdAt', '>=', bounds.start)
    .where('createdAt', '<', bounds.end)
    .orderBy('createdAt', 'asc')
    .limit(limit);
}

/**
 * يطبّق مبلغ دفعة داخل معاملة: يسوّي المبيعات غير المسوّاة (FIFO) ويحدّث
 * الرصيد التراكمي على مستند الشبكة. يُرجع ملخص التخصيص والرصيد المتبقي.
 */
export async function settleNetworkPayment(transaction, {
  networkRef,
  salesQuery,
  amountMinor,
  settlementId,
  month,
  networkAccessPatch = {},
}) {
  const networkSnap = await transaction.get(networkRef);
  const network = networkSnap.exists ? networkSnap.data() : {};

  const salesSnap = await transaction.get(salesQuery);
  const sales = salesSnap.docs.map((saleDoc) => ({ id: saleDoc.id, ref: saleDoc.ref, ...saleDoc.data() }));
  const unsettled = sales.filter((sale) => (!sale.status || sale.status === 'COMPLETED') && saleOutstanding(sale) > 0);
  const monthlyOutstanding = unsettled.reduce((sum, sale) => sum + saleOutstanding(sale), 0);

  // لا نقبل رصيداً مقدماً لشهر آخر، ولا نسمح للدفعة الشهرية بتسوية مبيعات
  // خارج الشهر المختار؛ هذا يمنع تحويل الحساب إلى دورات تراكمية.
  if (amountMinor > monthlyOutstanding) {
    return {
      status: 'month_balance_exceeded',
      month,
      monthlyOutstanding,
      requestedAmount: amountMinor,
      outstandingBalance: computeOutstanding(network.totalCommissionDue, network.totalPaidAmount),
      settledSales: 0,
      allocatedMinor: 0,
      unallocatedMinor: amountMinor,
      allocations: [],
    };
  }

  const allocation = allocateFifo(unsettled, amountMinor);

  allocation.allocations.forEach((entry) => {
    const sale = unsettled.find((item) => item.id === entry.id);
    transaction.update(sale.ref, {
      settlement_status: entry.fullySettled ? SETTLED : PARTIAL,
      paidMinor: entry.paidAfterMinor,
      paidRiyal: entry.paidAfterRiyal,
      settlementId,
      settledAt: FieldValue.serverTimestamp(),
    });
  });

  const totalCommissionDue = Number(network.totalCommissionDue) || 0;
  const totalPaidAmount = (Number(network.totalPaidAmount) || 0) + amountMinor;
  const outstandingBalance = computeOutstanding(totalCommissionDue, totalPaidAmount);

  transaction.set(networkRef, {
    totalPaidAmount,
    outstandingBalance,
    lastPaymentMinor: amountMinor,
    lastPaymentAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...networkAccessPatch,
  }, { merge: true });

  return {
    allocatedMinor: amountMinor - allocation.remainingMinor,
    unallocatedMinor: allocation.remainingMinor,
    outstandingBalance,
    settledSales: allocation.allocations.length,
    allocations: allocation.allocations,
  };
}
