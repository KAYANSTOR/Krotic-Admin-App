import { ChevronDown, ChevronUp } from 'lucide-react';
import { SALE_STATUS } from '../../lib/sales/constants';
import { formatDate, formatNumber } from '../../lib/format';
import { saleCommission, saleFaceValue } from '../../lib/commission';
import SaleVerificationBadge from './SaleVerificationBadge';

export default function SalesNetworkCard({
  network,
  stats,
  isExpanded,
  onToggle,
  onShowMore,
  showAllSales,
  saleRowLimit,
}) {
  const displayName = network.networkName || ('شبكة ' + String(network.uid || '').substring(0, 10));
  const shownSales = showAllSales
    ? stats.filteredSales
    : stats.filteredSales.slice(0, saleRowLimit);
  const hiddenSales = stats.filteredSales.length - shownSales.length;

  const statusMeta = (status) => SALE_STATUS[status] || {
    text: status || 'غير محدد',
    class: 'bg-slate-100 text-slate-800 border-slate-300',
  };

  return (
    <article className="p-3.5 sm:p-4 rounded-2xl bg-surface border border-line shadow-xs space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-brand/10 text-brand-deep flex items-center justify-center font-black text-sm flex-shrink-0">
            {displayName.charAt(0)}
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-extrabold text-[var(--ui-ink)] leading-tight truncate">
              {displayName}
            </h4>
            <p className="text-xs text-[var(--ui-muted)] mt-0.5" dir="ltr">
              {network.phoneNumber || 'بدون هاتف'}
            </p>
          </div>
        </div>
        <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-[var(--ui-sunken)] text-[var(--ui-ink-soft)] flex-shrink-0">
          {stats.completedCount} عملية
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-[var(--ui-sunken)]/60 border border-line/60">
        <div>
          <span className="text-[10px] text-[var(--ui-muted)] block font-semibold">المبيعات المكتملة</span>
          <span className="text-sm font-black text-[var(--ui-ink)] font-mono">
            {formatNumber(stats.totalFaceValue)} ر.ي
          </span>
        </div>
        <div className="text-left">
          <span className="text-[10px] text-[var(--ui-muted)] block font-semibold">العمولة غير المسوّاة</span>
          <span className="text-sm font-black text-emerald-600 font-mono">
            {formatNumber(stats.totalCommission)} ر.ي
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="w-full flex items-center justify-between py-1.5 px-2 text-xs font-bold text-[var(--ui-ink-soft)] hover:text-brand transition-colors min-h-[40px]"
      >
        <span>
          {isExpanded
            ? 'إخفاء السجل'
            : network.fullHistoryLoaded
              ? 'عرض العمليات (' + stats.filteredSales.length + ')'
              : 'عرض آخر ' + stats.filteredSales.length + ' من ' + stats.completedCount + ' عملية'}
        </span>
        {isExpanded
          ? <ChevronUp className="w-4 h-4" aria-hidden="true" />
          : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
      </button>

      {isExpanded && (
        <div className="pt-2 border-t border-line/80 space-y-2">
          {stats.filteredSales.length === 0 ? (
            <p className="text-xs text-center text-[var(--ui-muted)] py-3">
              لا توجد عمليات تطابق الفلاتر
            </p>
          ) : (
            shownSales.map((sale) => {
              const status = statusMeta(sale.status || 'COMPLETED');
              const commission = saleCommission(sale);
              return (
                <div
                  key={sale.id}
                  className="p-2.5 rounded-xl bg-surface border border-line/60 space-y-1.5 hover:border-brand/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-black text-[var(--ui-ink)] font-mono">
                      {formatNumber(saleFaceValue(sale))} ر.ي
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      <span className={'text-[10px] font-bold px-2 py-0.5 rounded-full border ' + status.class}>
                        {status.text}
                      </span>
                      <SaleVerificationBadge sale={sale} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--ui-muted)]">
                    <span>
                      الزبون:{' '}
                      <strong className="text-[var(--ui-ink-soft)]" dir="ltr">
                        {sale.customerId || '—'}
                      </strong>
                    </span>
                    <span dir="rtl">{formatDate(sale.createdAt, { withTime: true })}</span>
                  </div>
                  <div className="text-[11px] text-[var(--ui-ink-soft)] pt-1 border-t border-line/40 flex justify-between gap-2">
                    <span>العمولة المسجلة:</span>
                    <strong className="text-brand-deep font-mono">
                      {commission === null ? 'غير متحقق' : formatNumber(commission) + ' ر.ي'}
                    </strong>
                  </div>
                </div>
              );
            })
          )}

          {hiddenSales > 0 && (
            <button
              type="button"
              onClick={onShowMore}
              className="w-full min-h-[40px] py-2 text-xs text-brand font-bold bg-brand/10 rounded-xl hover:bg-brand/20 transition-colors"
            >
              عرض باقي العمليات ({hiddenSales} إضافية)
            </button>
          )}
        </div>
      )}
    </article>
  );
}
