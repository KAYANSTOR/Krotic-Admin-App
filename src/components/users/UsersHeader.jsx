import { LayoutGrid, List, Download, Users } from 'lucide-react';
import PageHero from '../ui/PageHero';
import Button from '../ui/Button';
import DataFreshness from '../ui/DataFreshness';
import { VIEW_MODES } from '../../lib/users/constants';
import { formatNumber } from '../../lib/format';

export default function UsersHeader({
  totalUsers,
  activeUsers,
  viewMode,
  onViewModeChange,
  onExport,
  lastSyncAt,
  refreshing,
  onRefresh,
}) {
  return (
    <PageHero
      icon={Users}
      kicker="إدارة المستخدمين"
      title="دليل المشتركين والشبكات"
      subtitle="إدارة الحسابات، الفوترة، وتجديد الاشتراكات"
      meta={`${formatNumber(totalUsers)} حساب مسجّل • ${formatNumber(activeUsers)} نشط`}
      actions={
        <div className="flex items-center gap-2 flex-wrap">
          <div
            className="inline-flex items-center rounded-xl bg-surface border border-line p-0.5 shadow-xs"
            role="group"
            aria-label="نمط العرض"
          >
            <button
              type="button"
              onClick={() => onViewModeChange(VIEW_MODES.CARDS)}
              aria-pressed={viewMode === VIEW_MODES.CARDS}
              className={`flex items-center gap-1 min-h-[40px] px-3 rounded-lg text-xs font-bold transition-colors ${
                viewMode === VIEW_MODES.CARDS
                  ? 'bg-brand text-white'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">بطاقات</span>
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange(VIEW_MODES.TABLE)}
              aria-pressed={viewMode === VIEW_MODES.TABLE}
              className={`flex items-center gap-1 min-h-[40px] px-3 rounded-lg text-xs font-bold transition-colors ${
                viewMode === VIEW_MODES.TABLE
                  ? 'bg-brand text-white'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <List className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">جدول</span>
            </button>
          </div>
          <Button variant="secondary" size="sm" icon={Download} onClick={onExport}>
            تصدير CSV
          </Button>
          <DataFreshness
            lastSyncedAt={lastSyncAt}
            refreshing={refreshing}
            onRefresh={onRefresh}
          />
        </div>
      }
    />
  );
}
