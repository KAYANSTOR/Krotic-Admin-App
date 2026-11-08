import {
  Calendar, ChevronUp, ChevronDown, AlertCircle, Receipt, DollarSign, Ban,
} from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import SaleVerificationBadge from './SaleVerificationBadge';
import { formatDate, formatNumber } from '../../lib/format';
import {
  saleCommission, saleOutstanding, isServerVerifiedSale, isCancelledSale, isCompletedSale, cancelledSaleCommission,
} from '../../lib/commission';
import { formatMonthArabic } from '../../lib/users/profileHelpers';

export default function MonthCard({ month: m, isExpanded, onToggle, onSettle }) {
  // The server-backed per-sale outstanding amount is the authoritative balance.
  // Do not subtract the month's total payment ledger again: that can double-count
  // payments which already appear on verified sale records.
  const remaining = Math.max(0, Number(m.verifiedOutstanding) || 0);
  const cancelledCount = Number(m.cancelledCount) || 0;
  const isFullySettled = m.commissionDue > 0 && remaining === 0;
  const isPartiallySettled = remaining > 0 && remaining < m.commissionDue;

  const headerTone = isFullySettled
    ? 'bg-emerald-500/10 text-emerald-600'
    : isPartiallySettled
      ? 'bg-amber-500/10 text-amber-600'
      : 'bg-brand/10 text-brand';

  return (
    <article className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
      isExpanded
        ? 'bg-surface border-brand shadow-sm ring-1 ring-brand/20'
        : 'bg-surface border-line hover:border-brand/40 hover:shadow-xs'
    }`}>
      <button
        type="button"
        onClick={() => onToggle(m.month)}
        aria-expanded={isExpanded}
        className="w-full p-4 text-right select-none"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${headerTone}`}>
              <Calendar className="w-4 h-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-black text-sm text-ink">{formatMonthArabic(m.month)}</h3>
                <span className="text-[10px] text-muted font-mono" dir="ltr">({m.month})</span>
              </div>
              <p className="text-[11px] text-muted mt-0.5">
                {m.sales.length} عملية بيع • {m.payments.length} دفعات مسجلة
                {cancelledCount > 0 ? ` • ${cancelledCount} ملغاة` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Badge tone={
              isFullySettled ? 'success'
                : isPartiallySettled ? 'warning'
                  : m.commissionDue > 0 ? 'danger'
                    : m.legacyCount > 0 ? 'warning' : 'neutral'
            }>
              {isFullySettled ? 'مسواة بالكامل (معتمدة)'
                : isPartiallySettled ? 'مسواة جزئياً'
                  : m.commissionDue > 0 ? 'بانتظار التسوية'
                    : m.legacyCount > 0 ? 'سجلات قديمة للمراجعة' : 'لا توجد عمولة معتمدة'}
            </Badge>
            <span className="p-1 text-muted" aria-hidden="true">
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-3 border-t border-line/60">
          <div className="bg-surface-sunken p-2.5 rounded-xl border border-line/40 text-right">
            <span className="text-[10px] text-muted block font-medium">مبيعات الشهر</span>
            <span className="text-xs sm:text-sm font-black font-mono text-ink">
              {formatNumber(m.totalSales)} <small className="text-[10px] font-normal text-muted">ر.ي</small>
            </span>
            <span className="text-[9px] text-muted block mt-0.5">
              {m.verifiedCount} معتمدة{m.legacyCount > 0 ? ` • ${m.legacyCount} قديمة` : ''}{cancelledCount > 0 ? ` • ${cancelledCount} ملغاة` : ''}
            </span>
          </div>
          <div className="bg-amber-500/5 p-2.5 rounded-xl border border-amber-500/20 text-right">
            <span className="text-[10px] text-amber-700 block font-bold">العمولة المعتمدة</span>
            <span className="text-xs sm:text-sm font-black font-mono text-amber-600">
              {formatNumber(m.commissionDue)} <small className="text-[10px] font-normal text-muted">ر.ي</small>
            </span>
            {m.legacyEstimatedCommission > 0 && (
              <span className="text-[9px] text-amber-800 font-semibold block mt-0.5 truncate" title="عمولات سجلات قديمة تتطلب مراجعة إدارية">
                + {formatNumber(m.legacyEstimatedCommission)} ر.ي قديمة
              </span>
            )}
          </div>
          <div className="bg-emerald-500/5 p-2.5 rounded-xl border border-emerald-500/20 text-right">
            <span className="text-[10px] text-emerald-700 block font-bold">الدفعات المسجلة</span>
            <span className="text-xs sm:text-sm font-black font-mono text-emerald-600">
              {formatNumber(m.totalPaid)} <small className="text-[10px] font-normal text-muted">ر.ي</small>
            </span>
          </div>
          <div className="bg-rose-500/5 p-2.5 rounded-xl border border-rose-500/20 text-right">
            <span className="text-[10px] text-rose-700 block font-bold">المتبقي المعتمد</span>
            <span className="text-xs sm:text-sm font-black font-mono text-rose-600">
              {formatNumber(remaining)} <small className="text-[10px] font-normal text-muted">ر.ي</small>
            </span>
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="p-4 bg-surface-sunken/60 border-t border-line space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-surface p-3 rounded-xl border border-line">
            <div>
              <p className="font-extrabold text-xs text-ink">تسوية عمولة {formatMonthArabic(m.month)}</p>
              <p className="text-[11px] text-muted">
                المتبقي المعتمد وفق سجلات البيع: <strong className="text-rose-600">{formatNumber(remaining)} ر.ي</strong>
              </p>
            </div>
            <Button variant="primary" size="sm" icon={DollarSign} onClick={() => onSettle(m.month)} className="font-black">
              إنشاء تسوية لهذا الشهر
            </Button>
          </div>

          <p className="text-[11px] leading-5 text-muted" role="note">
            إجمالي الدفعات المسجلة يظهر للمراجعة منفصلاً. المتبقي المعتمد مصدره مبالغ العمولات المسددة المسجلة على عمليات البيع نفسها، كي لا تُطرح الدفعة مرتين أو تُنسب إلى عمولة قديمة بلا تخصيص واضح.
          </p>

          {cancelledCount > 0 && (
            <div className="p-3 rounded-xl bg-surface border border-line text-xs flex items-start gap-2" role="note">
              <Ban className="w-4 h-4 text-muted mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-bold text-ink">
                  مبيعات ملغاة هذا الشهر: {cancelledCount} ({formatNumber(Number(m.cancelledSalesTotal) || 0)} ر.ي)
                </p>
                <p className="text-[11px] text-muted mt-0.5">
                  أُلغيت من جهاز مالك الشبكة قبل أي تسديد. عمولتها ({formatNumber(Number(m.cancelledCommission) || 0)} ر.ي) لا تدخل في المستحق ولا في التسوية، وتبقى ظاهرة هنا للشفافية.
                </p>
              </div>
            </div>
          )}

          {m.legacyCount > 0 && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-900 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-bold">
                  تنبيه تدقيق: يتضمن هذا الشهر {m.legacyCount} سجلات بيع قديمة غير موثقة خادمياً ({formatNumber(m.legacySalesTotal)} ر.ي).
                </p>
                <p className="text-[11px] text-amber-800 mt-0.5">
                  العمولة التقديرية المحتملة: {formatNumber(m.legacyEstimatedCommission)} ر.ي. لا تدخل هذه القيمة في المستحقات المعتمدة تلقائياً، وتتطلب مراجعة إدارية منفصلة.
                </p>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <h4 className="text-xs font-black text-ink flex items-center gap-1.5">
                <Receipt className="w-3.5 h-3.5 text-muted" aria-hidden="true" />
                <span>عمليات المبيعات الخاصة بهذا الشهر ({m.sales.length})</span>
              </h4>
              <span className="text-[10px] text-muted">مرتبة من الأحدث للأقدم</span>
            </div>

            {m.sales.length === 0 ? (
              <div className="p-3 text-center text-xs text-muted bg-surface rounded-xl border border-dashed border-line">
                لا توجد عمليات بيع مسجلة في هذا الشهر
              </div>
            ) : (
              <div className="space-y-2">
                {m.sales.slice().reverse().map((sale, index) => {
                  const commission = saleCommission(sale);
                  const verified = isServerVerifiedSale(sale);
                  const cancelled = isCancelledSale(sale);
                  const counted = isCompletedSale(sale);
                  const isSaleSettled = verified && saleOutstanding(sale) === 0;
                  const badgeTone = cancelled ? 'danger' : !counted ? 'neutral' : !verified ? 'warning' : isSaleSettled ? 'success' : 'warning';
                  const badgeLabel = cancelled ? 'ملغى' : !counted ? 'غير محتسب' : !verified ? 'للمراجعة' : isSaleSettled ? 'مسواة' : 'غير مسواة';
                  return (
                    <div
                      key={sale.id || sale.saleId || `${m.month}-sale-${index}`}
                      className="p-3 rounded-xl bg-surface border border-line flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-ink truncate" dir="ltr">
                            {sale.customerId || sale.voucherCode || 'كرت مبيعات'}
                          </span>
                          <SaleVerificationBadge sale={sale} />
                          <Badge tone={badgeTone}>{badgeLabel}</Badge>
                        </div>
                        <span className="text-[10px] text-muted block mt-0.5">
                          {formatDate(sale.createdAt, { withTime: true })}
                        </span>
                      </div>
                      <div className="text-left shrink-0">
                        <div className={`font-mono font-black ${cancelled ? 'text-muted line-through' : 'text-ink'}`}>
                          {formatNumber(Number(sale.faceValue) || 0)} <small className="text-[9px] text-muted">ر.ي</small>
                        </div>
                        {cancelled ? (
                          <div className="text-[10px] font-bold text-muted mt-0.5">
                            عمولة ملغاة: <span className="line-through">{formatNumber(cancelledSaleCommission(sale))} ر.ي</span>
                          </div>
                        ) : (
                          <div className="text-[10px] font-bold text-brand mt-0.5">
                            عمولة: {commission === null ? 'غير محتسب' : `${formatNumber(commission)} ر.ي`}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {m.payments.length > 0 && (
            <div className="pt-2 border-t border-line/60">
              <h4 className="text-xs font-black text-ink mb-2">الدفعات المسجلة لهذا الشهر ({m.payments.length})</h4>
              <div className="space-y-1.5">
                {m.payments.map((payment, index) => (
                  <div
                    key={payment.id || `${m.month}-payment-${index}`}
                    className="p-2.5 rounded-lg bg-surface border border-line flex items-center justify-between text-xs"
                  >
                    <span className="text-muted text-[11px]">
                      {formatDate(payment.timestamp ?? payment.createdAt, { withTime: true })}
                    </span>
                    <span className="font-mono font-black text-emerald-600">
                      {formatNumber(Number(payment.amount) || 0)} ر.ي
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
