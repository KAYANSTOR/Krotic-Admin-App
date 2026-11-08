// ============================================================
// Krotak Pro — دفتر التسوية التراكمي (قرار المالك هـ2)
// رصيد تراكمي مستمر خادمياً، وتسوية المبيعات غير المسوّاة بنظام
// الأقدم فالأحدث (FIFO) تلقائياً. منطق نقي قابل للاختبار.
// ============================================================

function whole(value) {
  const number = Math.trunc(Number(value) || 0);
  return number > 0 ? number : 0;
}

/**
 * المُسند المالي الخادمي الوحيد (قرار المالك O-07 القاعدة 3): لا يُحتسب في
 * العمولة أو المستحق أو التسوية إلا البيع المكتمل أو القديم بلا حالة.
 * البيع الملغى (status أو settlement_status = CANCELLED) مستبعد دائماً.
 */
export function isCountableSale(sale) {
  if (!sale || typeof sale !== 'object') return false;
  if (sale.status === 'CANCELLED' || sale.settlement_status === 'CANCELLED') return false;
  return !sale.status || sale.status === 'COMPLETED';
}

/** المتبقي على بيع واحد = عمولته − ما سُدّد منه (صفر للبيع غير المكتمل أو الملغى). */
export function saleOutstanding(sale) {
  // دفاع إضافي: حتى لو مرّ بيع ملغى من مسار ما فلن يُخصَّص له أي مبلغ.
  if (!isCountableSale(sale)) return 0;
  // V2 has explicit whole-Riyal values; legacy aliases remain the fallback.
  const commission = whole(sale?.commissionRiyal ?? sale?.commissionMinor);
  const paid = whole(sale?.paidRiyal ?? sale?.paidMinor);
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
    if (!isCountableSale(sale)) continue;
    const outstanding = saleOutstanding(sale);
    if (outstanding <= 0) continue;
    const appliedMinor = Math.min(outstanding, remaining);
    const paidAfterRiyal = whole(sale?.paidRiyal ?? sale?.paidMinor) + appliedMinor;
    const isMoneyPolicyV2 = Number(sale?.moneyPolicyVersion) === 2
      || sale?.commissionRiyal !== undefined;
    allocations.push({
      id: sale.id,
      appliedMinor,
      fullySettled: appliedMinor >= outstanding,
      paidAfterMinor: isMoneyPolicyV2 ? paidAfterRiyal * 100 : paidAfterRiyal,
      paidAfterRiyal,
    });
    remaining -= appliedMinor;
  }
  return { allocations, remainingMinor: remaining };
}
