import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ScrollText, Download, Inbox, ShieldCheck, KeyRound,
  UserCheck, DollarSign, Bell, Settings, ShieldAlert,
  Calendar, Clock, User,
} from 'lucide-react';
import toast from 'react-hot-toast';

import SearchHeader from '../components/ui/SearchHeader';
import HeroMetric from '../components/ui/HeroMetric';
import StatPills from '../components/ui/StatPills';
import DataCard from '../components/ui/DataCard';
import FilterSheet from '../components/ui/FilterSheet';
import useInfiniteScroll from '../hooks/useInfiniteScroll';

import { formatDate } from '../lib/format';
import { downloadCsv, csvStamp } from '../lib/csv';
import { AUDIT_ACTION_META, auditActionLabel, auditActionTone, normalizeAuditAction } from '../lib/auditLog';
import { useLocalQuery } from '../lib/localDb/useLocalQuery';
import { useLocalDb } from '../lib/localDb/LocalDbContext';
import { loadLocalAuditLogs } from '../lib/localDb/localData';
import useAppRefresh from '../lib/useAppRefresh';

const PAGE_SIZE = 30;
const AUDIT_LOCAL_LIMIT = 200;
const FILTER_STORAGE_KEY = 'krotak:audit-filter';

const DETAIL_LABELS = {
  amount: 'المبلغ', month: 'الشهر', title: 'العنوان', sent: 'الأجهزة',
  affected_users: 'الحسابات', new_date: 'التاريخ الجديد',
  commission_rate: 'العمولة', has_custom_warning: 'تحذير مخصص',
  subscription_end_date: 'الانتهاء', default_commission_rate: 'العمولة العامة',
  default_trial_days: 'أيام تجريبية', warning_days_before_expiry: 'أيام التحذير',
  is_app_active: 'حالة التطبيق', saleUuid: 'معرّف البيع', reason: 'السبب',
  previousHash: 'الهاش السابق', incomingHash: 'الهاش الجديد',
  locked: 'الاشتراكات المقفلة', networksUpdated: 'الشبكات المحدثة',
  scanned: 'المفحوصة', extensionDays: 'أيام التمديد',
  settlementId: 'معرّف التسوية', settledSalesCount: 'عدد المبيعات',
  unallocated: 'المتبقي', version: 'الإصدار', scope: 'النطاق',
};

const ACTION_ICONS = {
  USER_ACTIVATE: UserCheck, USER_BLOCK: ShieldAlert, USER_MAKE_OFFICIAL: ShieldCheck,
  USER_RENEW: Calendar, USER_EDIT: Settings, PAYMENT_ADD: DollarSign,
  NOTIFICATION_SEND: Bell, NOTIFICATION_DELETE: Bell, NOTIFICATION_SCHEDULE: Bell,
  SETTINGS_SAVE: Settings, APP_STATUS_CHANGE: ShieldAlert, SUBSCRIPTION_BATCH: Calendar,
  USER_PASSWORD_SET: KeyRound, USER_RESET_LINK: KeyRound, ADMIN_CREATE: ShieldCheck,
  ADMIN_DELETE: ShieldAlert, DEVICE_DELETE: Settings, USER_DELETE: ShieldAlert,
  ADMIN_PASSWORD_CHANGE: KeyRound, SETTLEMENT_RECORD: DollarSign,
  NETWORK_REGISTER: ShieldCheck, NETWORK_RENEW: Calendar,
  NETWORK_ACCESS_UPDATE: Settings, NETWORK_DELETE: ShieldAlert,
  SUBSCRIPTION_EXPIRY_CRON: Clock, TEMPLATE_DRAFT_CREATE: ScrollText,
  TEMPLATE_DRAFT_UPDATE: Settings, TEMPLATE_DRAFT_DELETE: ShieldAlert,
  TEMPLATE_RELEASE_PUBLISH: ShieldCheck, TEMPLATE_RELEASE_ROLLBACK: Calendar,
  SALE_CONFLICT_DETECTED: ShieldAlert,
};

function formatDetails(details) {
  if (!details || typeof details !== 'object') return '—';
  const parts = Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => {
      const label = DETAIL_LABELS[k] || k;
      const shown = typeof v === 'boolean' ? (v ? 'نعم' : 'لا') : String(v);
      return `${label}: ${shown}`;
    });
  return parts.length ? parts.join(' • ') : '—';
}

function loadSavedFilter() {
  try { return window.localStorage.getItem(FILTER_STORAGE_KEY) || 'all'; }
  catch { return 'all'; }
}

const CATEGORY_CHIPS = [
  { key: 'all', label: 'الكل' },
  {
    key: 'users', label: 'المستخدمون',
    actions: ['USER_ACTIVATE', 'USER_BLOCK', 'USER_MAKE_OFFICIAL', 'USER_RENEW', 'USER_EDIT', 'USER_DELETE', 'NETWORK_ACCESS_UPDATE', 'NETWORK_RENEW', 'NETWORK_DELETE', 'NETWORK_REGISTER'],
  },
  { key: 'financial', label: 'مالية', actions: ['PAYMENT_ADD', 'SETTLEMENT_RECORD', 'SUBSCRIPTION_BATCH'] },
  { key: 'security', label: 'أمان', actions: ['USER_PASSWORD_SET', 'USER_RESET_LINK', 'ADMIN_PASSWORD_CHANGE', 'ADMIN_CREATE', 'ADMIN_DELETE', 'SALE_CONFLICT_DETECTED'] },
  { key: 'templates', label: 'القوالب', actions: ['TEMPLATE_DRAFT_CREATE', 'TEMPLATE_DRAFT_UPDATE', 'TEMPLATE_DRAFT_DELETE', 'TEMPLATE_RELEASE_PUBLISH', 'TEMPLATE_RELEASE_ROLLBACK'] },
  { key: 'system', label: 'نظام', actions: ['SETTINGS_SAVE', 'APP_STATUS_CHANGE', 'DEVICE_DELETE', 'SUBSCRIPTION_EXPIRY_CRON'] },
];

const TONE_MAP = {
  success: 'success', danger: 'danger', warning: 'warning', brand: 'brand', neutral: 'neutral',
};

export default function AuditPage() {
  const [actionFilter, setActionFilter] = useState(loadSavedFilter);
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const { runSync, syncing, lastSyncAt } = useLocalDb();

  const logsQuery = useLocalQuery((localDb) => loadLocalAuditLogs(localDb, AUDIT_LOCAL_LIMIT), []);
  const allLogs = useMemo(
    () => (logsQuery.data || []).map((log) => ({ ...log, action: normalizeAuditAction(log.action) })),
    [logsQuery.data],
  );
  const logs = useMemo(() => allLogs.slice(0, visibleCount), [allLogs, visibleCount]);
  const loading = logsQuery.loading;
  const error = logsQuery.error ? 'تعذر قراءة سجل العمليات.' : null;
  const hasMore = allLogs.length > visibleCount;

  const refresh = async () => {
    await runSync({ reason: 'manual' });
    logsQuery.refresh();
  };
  useAppRefresh(refresh);

  useEffect(() => {
    try { window.localStorage.setItem(FILTER_STORAGE_KEY, actionFilter); } catch { /* noop */ }
  }, [actionFilter]);

  const categoryCounts = useMemo(() => {
    const counts = {};
    CATEGORY_CHIPS.forEach((c) => {
      if (c.key === 'all') counts[c.key] = allLogs.length;
      else if (c.actions) counts[c.key] = allLogs.filter((log) => c.actions.includes(log.action)).length;
      else counts[c.key] = 0;
    });
    return counts;
  }, [allLogs]);

  const filteredLogs = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const cat = CATEGORY_CHIPS.find((c) => c.key === activeCategory);
    return logs.filter((entry) => {
      if (cat?.actions && !cat.actions.includes(entry.action)) return false;
      if (actionFilter !== 'all' && entry.action !== actionFilter) return false;
      if (!term) return true;
      return [
        entry.targetLabel, entry.targetId, entry.actorEmail, entry.actorUid,
        auditActionLabel(entry.action), JSON.stringify(entry.details || {}),
      ].filter(Boolean).some((v) => String(v).toLowerCase().includes(term));
    });
  }, [logs, actionFilter, activeCategory, searchTerm]);

  const handleExport = useCallback(() => {
    if (!filteredLogs.length) { toast.error('لا توجد بيانات للتصدير'); return; }
    downloadCsv(`audit-log-${csvStamp()}`, filteredLogs, [
      { label: 'الوقت', value: (r) => formatDate(r.createdAtMs || r.createdAt, { withTime: true }) },
      { label: 'المدير', value: (r) => r.actorEmail || r.actorUid || '' },
      { label: 'الإجراء', value: (r) => auditActionLabel(r.action) },
      { label: 'الهدف', value: (r) => r.targetLabel || r.targetId || '' },
      { label: 'التفاصيل', value: (r) => formatDetails(r.details) },
    ]);
    toast.success('تم التصدير');
  }, [filteredLogs]);

  const activeFiltersCount = (actionFilter !== 'all' ? 1 : 0) + (activeCategory !== 'all' ? 1 : 0);

  const sentinelRef = useInfiniteScroll({
    onLoadMore: () => setVisibleCount((v) => v + PAGE_SIZE),
    hasMore,
  });

  if (loading && logs.length === 0) {
    return (
      <div className="space-y-4 pb-24">
        <div className="h-16 rounded-2xl bg-[var(--ui-sunken)]/60 animate-pulse" />
        <div className="h-32 rounded-3xl bg-[var(--ui-sunken)]/60 animate-pulse" />
        <div className="h-20 rounded-2xl bg-[var(--ui-sunken)]/60 animate-pulse" />
        <div className="h-20 rounded-2xl bg-[var(--ui-sunken)]/60 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="pb-24">
      <SearchHeader
        title="سجل العمليات"
        subtitle={lastSyncAt
          ? `آخر مزامنة: ${formatDate(lastSyncAt, { withTime: true })}`
          : `${filteredLogs.length} من ${allLogs.length}`}
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="ابحث في السجل..."
        onFilterClick={() => setFilterSheetOpen(true)}
        filterCount={activeFiltersCount}
        actions={
          <button
            type="button"
            onClick={handleExport}
            className="p-2.5 rounded-full text-[var(--ui-muted)] hover:bg-[var(--ui-sunken)] hover:text-[var(--ui-ink)]"
            aria-label="تصدير CSV"
          >
            <Download className="w-4 h-4" />
          </button>
        }
      />

      {error && (
        <div className="mt-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
          <p className="flex-1">{error}</p>
          <button type="button" onClick={refresh} className="font-bold underline">إعادة المحاولة</button>
        </div>
      )}

      <div className="mt-3">
        <HeroMetric
          label="إجمالي العمليات"
          value={allLogs.length}
          unit="عملية"
          icon={ScrollText}
          trend="flat"
          hint={filteredLogs.length !== allLogs.length
            ? `مُصفّى: ${filteredLogs.length} من ${allLogs.length}`
            : 'كل العمليات المعروضة'}
          tone="brand"
        />
      </div>

      <div className="mt-3">
        <StatPills
          items={CATEGORY_CHIPS.map((c) => ({
            key: c.key,
            label: c.label,
            value: categoryCounts[c.key] ?? 0,
            tone: activeCategory === c.key ? 'brand' : 'neutral',
          }))}
          onItemClick={(item) => setActiveCategory(item.key)}
        />
      </div>

      <div className="mt-3 space-y-2.5">
        {filteredLogs.length === 0 ? (
          <div className="p-10 text-center rounded-2xl bg-[var(--ui-surface)] border border-line">
            <Inbox className="w-6 h-6 mx-auto mb-2 text-[var(--ui-muted)]" />
            <p className="font-bold text-[var(--ui-ink)]">لا نتائج</p>
            <p className="text-xs text-[var(--ui-muted)] mt-1">
              {searchTerm ? 'لا توجد عمليات مطابقة للبحث.' : 'لم تُسجّل عمليات بعد.'}
            </p>
          </div>
        ) : (
          <>
            {filteredLogs.map((entry) => {
              const Icon = ACTION_ICONS[entry.action] || ScrollText;
              const tone = auditActionTone(entry.action);
              const hasDetails = entry.details && typeof entry.details === 'object' && Object.keys(entry.details).length > 0;
              const isExpanded = expandedId === entry.id;

              return (
                <div key={entry.id}>
                  <DataCard
                    avatar={{ node: <Icon className="w-4 h-4" />, tone: TONE_MAP[tone] || 'neutral' }}
                    title={auditActionLabel(entry.action)}
                    subtitle={entry.targetLabel || entry.targetId || '—'}
                    facts={[
                      { icon: User, label: 'المدير', value: entry.actorEmail || entry.actorUid || '—' },
                      { icon: Clock, value: formatDate(entry.createdAtMs || entry.createdAt, { withTime: true }) },
                    ]}
                    onClick={hasDetails ? () => setExpandedId(isExpanded ? null : entry.id) : undefined}
                  />
                  {isExpanded && hasDetails && (
                    <div className="mt-1.5 p-3 rounded-xl bg-[var(--ui-sunken)]/60 border border-line text-[11px] text-[var(--ui-ink-soft)] leading-relaxed font-mono break-words">
                      {formatDetails(entry.details)}
                    </div>
                  )}
                </div>
              );
            })}

            {hasMore && (
              <div ref={sentinelRef} className="py-6 flex justify-center" role="status" aria-live="polite">
                <div className="flex items-center gap-2 text-xs text-[var(--ui-muted)] font-bold">
                  <Clock className="w-4 h-4 animate-spin" />
                  جارٍ التحميل...
                </div>
              </div>
            )}

            {!hasMore && filteredLogs.length > 0 && (
              <p className="text-center text-[11px] text-[var(--ui-faint)] py-4">
                وصلت للنهاية — {filteredLogs.length} عملية
              </p>
            )}
          </>
        )}
      </div>

      <FilterSheet
        isOpen={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        title="فلترة السجل"
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setActionFilter('all'); setActiveCategory('all'); }}
              className="flex-1 min-h-[48px] rounded-xl border border-line font-bold text-sm text-[var(--ui-ink-soft)] hover:bg-[var(--ui-sunken)]"
            >
              إعادة تعيين
            </button>
            <button
              type="button"
              onClick={() => setFilterSheetOpen(false)}
              className="flex-1 min-h-[48px] rounded-xl bg-[var(--ui-brand)] text-white font-bold text-sm"
            >
              تطبيق
            </button>
          </div>
        }
      >
        <div>
          <label className="text-xs font-black text-[var(--ui-ink)] block mb-2">إجراء محدد</label>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="w-full min-h-[48px] px-4 rounded-xl border border-line bg-[var(--ui-surface)] text-sm"
          >
            <option value="all">كل الإجراءات</option>
            {Object.entries(AUDIT_ACTION_META).map(([key, meta]) => (
              <option key={key} value={key}>{meta.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-black text-[var(--ui-ink)] block mb-2">الفئة</label>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORY_CHIPS.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setActiveCategory(c.key)}
                className={`min-h-[44px] rounded-xl border font-bold text-xs ${
                  activeCategory === c.key
                    ? 'bg-[var(--ui-brand)] text-white border-[var(--ui-brand)]'
                    : 'bg-[var(--ui-surface)] text-[var(--ui-ink-soft)] border-line'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </FilterSheet>
    </div>
  );
}
