// ============================================================
// Krotak Pro — دفتر الرصيد التراكمي للشبكة (ملحق المالك: توحيد Ledger)
// ------------------------------------------------------------
// المرجع المالي الوحيد على مستند networks/{networkId}:
//   totalSalesAmount, totalCommissionDue, totalPaidAmount, outstandingBalance
// عند أي دفعة: تُخصم من الرصيد، تُضاف للمسدّد، وتُسوّى المبيعات المعلقة
// بنظام الأقدم فالأحدث (FIFO). مشترك بين /api/record-payment و/api/settlement.
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
 * يطبّق مبلغ دفعة داخل معاملة: يسوّي المبيعات غير المسوّاة (FIFO) ويحدّث
 * الرصيد التراكمي على مستند الشبكة. يُرجع ملخص التخصيص والرصيد المتبقي.
 */
export async function settleNetworkPayment(transaction, {
  networkRef,
  salesQuery,
  amountMinor,
  settlementId,
  networkAccessPatch = {},
}) {
  const networkSnap = await transaction.get(networkRef);
  const network = networkSnap.exists ? networkSnap.data() : {};

  const salesSnap = await transaction.get(salesQuery);
  const sales = salesSnap.docs.map((saleDoc) => ({ id: saleDoc.id, ref: saleDoc.ref, ...saleDoc.data() }));
  const unsettled = sales.filter((sale) => saleOutstanding(sale) > 0);
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
