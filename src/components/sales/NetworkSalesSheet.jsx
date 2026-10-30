import { useEffect } from 'react';
import { X, Inbox, Download } from 'lucide-react';
import SaleRow from './SaleRow';
import { formatNumber } from '../../lib/format';

export default function NetworkSalesSheet({
  isOpen, onClose, network, stats, onShowMore, showAllSales, saleRowLimit = 50,
}) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [isOpen, onClose]);

  if (!isOpen || !network || !stats) return null;

  const displayName = network.networkName || `شبكة ${network.uid.substring(0, 10)}`;
  const shownSales = showAllSales
    ? stats.filteredSales
    : stats.filteredSales.slice(0, saleRowLimit);
  const hiddenCount = stats.filteredSales.length - shownSales.length;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-lg bg-[var(--ui-surface)] rounded-t-3xl shadow-2xl flex flex-col max-h-[88dvh] animate-[sheet-up_250ms_cubic-bezier(.2,.75,.25,1)]">
        <div className="w-9 h-1 rounded-full bg-[var(--ui-line-strong)] mx-auto mt-2 mb-1" />

        {/* رأس */}
        <header className="px-5 py-2.5 border-b border-line">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-black text-[var(--ui-ink)] truncate">
                {displayName}
              </h3>
              <p className="text-[11px] text-[var(--ui-muted)] font-semibold mt-0.5" dir="ltr">
                {network.phoneNumber || 'بدون هاتف'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-full text-[var(--ui-muted)] hover:bg-[var(--ui-sunken)] flex-shrink-0"
              aria-label="إغلاق"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* مقاييس */}
          <dl className="grid grid-cols-3 gap-2 mt-3">
            <div className="p-2 rounded-xl bg-[var(--ui-sunken)]/60">
              <dt className="text-[10px] text-[var(--ui-muted)] font-bold">المبيعات</dt>
              <dd className="text-sm font-black text-[var(--ui-ink)] font-mono mt-0.5">
                {formatNumber(stats.totalFaceValue)}
              </dd>
            </div>
            <div className="p-2 rounded-xl bg-brand/10">
              <dt className="text-[10px] text-brand-deep font-bold">العمولة</dt>
              <dd className="text-sm font-black text-brand-deep font-mono mt-0.5">
                {formatNumber(stats.totalCommission)}
              </dd>
            </div>
            <div className="p-2 rounded-xl bg-[var(--ui-sunken)]/60">
              <dt className="text-[10px] text-[var(--ui-muted)] font-bold">العمليات</dt>
              <dd className="text-sm font-black text-[var(--ui-ink)] font-mono mt-0.5">
                {stats.completedCount}
              </dd>
            </div>
          </dl>
        </header>

        {/* قائمة العمليات */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {stats.filteredSales.length === 0 ? (
            <div className="p-8 text-center">
              <Inbox className="w-6 h-6 mx-auto mb-2 text-[var(--ui-muted)]" />
              <p className="text-xs font-bold text-[var(--ui-ink)]">لا توجد عمليات</p>
              <p className="text-[11px] text-[var(--ui-muted)] mt-1">لا توجد مبيعات تطابق الفلاتر الحالية.</p>
            </div>
          ) : (
            <>
              {shownSales.map((sale) => (
                <SaleRow key={sale.id} sale={sale} />
              ))}
              {hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={onShowMore}
                  className="w-full min-h-[44px] py-2.5 text-xs font-bold text-brand bg-brand/10 rounded-xl hover:bg-brand/20"
                >
                  عرض باقي {hiddenCount} عملية
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
