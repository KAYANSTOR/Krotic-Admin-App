import { formatNumber } from '../../lib/format.js';

export default function UsersStats({ stats }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5" aria-label="ملخص المشتركين">
      <div className="p-3 rounded-2xl bg-surface border border-line shadow-xs">
        <span className="text-[11px] font-bold text-muted block">الشبكات</span>
        <p className="text-xl font-black text-ink font-mono mt-0.5">{formatNumber(stats.total)}</p>
      </div>
      <div className="p-3 rounded-2xl bg-surface border border-line shadow-xs">
        <span className="text-[11px] font-bold text-[var(--ui-success-ink)] block">نشط</span>
        <p className="text-xl font-black text-[var(--ui-success-ink)] font-mono mt-0.5">{formatNumber(stats.active)}</p>
      </div>
      <div className="p-3 rounded-2xl bg-surface border border-line shadow-xs">
        <span className="text-[11px] font-bold text-[var(--ui-warning-ink)] block">تجريبي</span>
        <p className="text-xl font-black text-[var(--ui-warning-ink)] font-mono mt-0.5">{formatNumber(stats.trial)}</p>
      </div>
      <div className="p-3 rounded-2xl bg-surface border border-line shadow-xs">
        <span className="text-[11px] font-bold text-[var(--ui-danger-ink)] block">محظور / منتهي</span>
        <p className="text-xl font-black text-[var(--ui-danger-ink)] font-mono mt-0.5">{formatNumber(stats.blocked + stats.expired)}</p>
      </div>
    </div>
  );
}
