import { DollarSign, TrendingUp, Wallet } from 'lucide-react';
import { formatNumber } from '../../lib/format';

export default function SalesStats({ totals }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
      <div className="p-3.5 rounded-2xl bg-surface border border-line shadow-xs">
        <div className="flex items-center justify-between text-[var(--ui-muted)] mb-1">
          <span className="text-[11px] font-bold">المبيعات المكتملة</span>
          <DollarSign className="w-4 h-4 text-brand" aria-hidden="true" />
        </div>
        <p className="text-lg font-black text-[var(--ui-ink)] font-mono">
          {formatNumber(totals.totalSales)}
        </p>
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--ui-muted)] mt-0.5 flex-wrap">
          <span className="text-emerald-700 font-bold">{formatNumber(totals.verifiedCount)} معتمدة</span>
          <span>•</span>
          <span className="text-amber-800 font-semibold">{formatNumber(totals.legacyCount)} قديمة</span>
        </div>
      </div>

      <div className="p-3.5 rounded-2xl bg-surface border border-line shadow-xs">
        <div className="flex items-center justify-between text-[var(--ui-muted)] mb-1">
          <span className="text-[11px] font-bold">العمولة المعتمدة</span>
          <Wallet className="w-4 h-4 text-emerald-600" aria-hidden="true" />
        </div>
        <p className="text-lg font-black text-emerald-600 font-mono">
          {formatNumber(totals.verifiedCommission)}
        </p>
        <span className="text-[10px] text-[var(--ui-muted)] block truncate">
          {totals.legacyEstimatedCommission > 0
            ? '+ ' + formatNumber(totals.legacyEstimatedCommission) + ' ر.ي قديمة'
            : 'غير مسوّاة'}
        </span>
      </div>

      <div className="p-3.5 rounded-2xl bg-surface border border-line shadow-xs col-span-2 sm:col-span-1">
        <div className="flex items-center justify-between text-[var(--ui-muted)] mb-1">
          <span className="text-[11px] font-bold">العمليات الناجحة</span>
          <TrendingUp className="w-4 h-4 text-amber-600" aria-hidden="true" />
        </div>
        <p className="text-lg font-black text-[var(--ui-ink)] font-mono">
          {formatNumber(totals.totalCount)}
        </p>
        <span className="text-[10px] text-[var(--ui-muted)]">عملية مكتملة</span>
      </div>
    </div>
  );
}
