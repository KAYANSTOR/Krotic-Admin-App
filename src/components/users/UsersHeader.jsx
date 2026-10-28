import { Users, Download, LayoutGrid, List } from 'lucide-react';
import PageHero from '../ui/PageHero.jsx';
import Button from '../ui/Button.jsx';
import DataFreshness from '../ui/DataFreshness.jsx';
import { formatNumber } from '../../lib/format.js';
import { VIEW_MODES } from '../../lib/users/constants.js';

export default function UsersHeader({
  usersCount,
  activeCount,
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
      title="المشتركون"
      meta={`${formatNumber(usersCount)} شبكة • ${formatNumber(activeCount)} نشط`}
      actions={
        <div className="flex items-center gap-2 flex-wrap">
          <div
            className="inline-flex items-center rounded-xl bg-surface border border-line p-0.5 shadow-xs"
            role="tablist"
            aria-label="نمط العرض"
          >
            <button
              type="button"
              role="tab"
              onClick={() => onViewModeChange(VIEW_MODES.CARDS)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                viewMode === VIEW_MODES.CARDS ? 'bg-brand text-white shadow-xs' : 'text-muted hover:text-ink'
              }`}
              title="عرض بطاقات"
              aria-label="عرض البطاقات"
              aria-selected={viewMode === VIEW_MODES.CARDS}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">بطاقات</span>
            </button>
            <button
              type="button"
              role="tab"
              onClick={() => onViewModeChange(VIEW_MODES.TABLE)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                viewMode === VIEW_MODES.TABLE ? 'bg-brand text-white shadow-xs' : 'text-muted hover:text-ink'
              }`}
              title="عرض جدول"
              aria-label="عرض جدول البيانات"
              aria-selected={viewMode === VIEW_MODES.TABLE}
            >
              <List className="w-3.5 h-3.5" />
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
