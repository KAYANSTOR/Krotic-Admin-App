import { Activity, Download } from 'lucide-react';
import Button from '../ui/Button';
import { formatNumber } from '../../lib/format';

export default function SalesSummaryTab({ totals, networksCount, onExport }) {
  return (
    <div className="p-4 rounded-2xl bg-surface border border-line space-y-4">
      <h3 className="text-sm font-extrabold text-[var(--ui-ink)] flex items-center gap-2">
        <Activity className="w-4 h-4 text-brand" aria-hidden="true" />
        التقرير المالي وحالة التسويات
      </h3>
      <div className="space-y-2 text-xs">
        <div className="flex justify-between py-2 border-b border-line gap-3">
          <span className="text-[var(--ui-muted)]">إجمالي المبيعات المكتملة</span>
          <strong className="font-mono text-[var(--ui-ink)] text-sm">
            {formatNumber(totals.totalSales)} ريال
          </strong>
        </div>
        <div className="flex justify-between py-2 border-b border-line gap-3">
          <span className="text-[var(--ui-muted)]">إجمالي العمولات غير المسوّاة</span>
          <strong className="font-mono text-emerald-600 text-sm">
            {formatNumber(totals.totalCommission)} ريال
          </strong>
        </div>
        <div className="flex justify-between py-2 border-b border-line gap-3">
          <span className="text-[var(--ui-muted)]">عدد الشبكات ذات المبيعات</span>
          <strong className="text-[var(--ui-ink)]">{networksCount} شبكة</strong>
        </div>
        <div className="flex justify-between py-2 gap-3">
          <span className="text-[var(--ui-muted)]">إجمالي العمليات المنجزة</span>
          <strong className="font-mono text-[var(--ui-ink)]">
            {formatNumber(totals.totalCount)} عملية
          </strong>
        </div>
      </div>
      <Button
        variant="primary"
        size="lg"
        block
        icon={Download}
        onClick={onExport}
        className="font-bold"
      >
        تصدير التقرير المالي (CSV)
      </Button>
    </div>
  );
}
