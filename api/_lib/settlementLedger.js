// ============================================================
// Krotak Pro — دفتر التسوية التراكمي (قرار المالك هـ2)
// رصيد تراكمي مستمر خادمياً، وتسوية المبيعات غير المسوّاة بنظام
// الأقدم فالأحدث (FIFO) تلقائياً. منطق نقي قابل للاختبار.
// ============================================================

function whole(value) {
  const number = Math.trunc(Number(value) || 0);
  return number > 0 ? number : 0;
}

/** المتبقي على بيع واحد = عمولته − ما سُدّد منه. */
export function saleOutstanding(sale) {
  const commission = whole(sale?.commissionMinor);
  const paid = whole(sale?.paidMinor);
  return Math.max(0, commission - paid);
}

/** إجمالي الرصيد المستحق عبر قائمة مبيعات. */
export function outstandingBalance(sales = []) {
  return sales.reduce((sum, sale) => sum + saleOutstanding(sale), 0);
}

/**
 * يوزّع مبلغ دفعة على المبيعات غير المسوّاة من الأقدم إلى الأحدث.
 * المتوقع أن تكون القائمة مرتبة تصاعدياً حسب createdAt (الأقدم أولاً).
 * يُرجع التخصيصات والمبلغ المتبقي غير المخصَّص.
 */
export function allocateFifo(sales = [], amountMinor) {
  let remaining = whole(amountMinor);
  const allocations = [];
  for (const sale of sales) {
    if (remaining <= 0) break;
    const outstanding = saleOutstanding(sale);
    if (outstanding <= 0) continue;
    const appliedMinor = Math.min(outstanding, remaining);
    allocations.push({
      id: sale.id,
      appliedMinor,
      fullySettled: appliedMinor >= outstanding,
      paidAfterMinor: whole(sale?.paidMinor) + appliedMinor,
    });
    remaining -= appliedMinor;
  }
  return { allocations, remainingMinor: remaining };
}
