import { useState, useEffect, useMemo } from 'react';
import {
  ScrollText, Search, Download, Inbox, ShieldCheck, KeyRound,
  UserCheck, DollarSign, Bell, Settings, ShieldAlert,
  Calendar, Clock, X, ChevronDown, ChevronUp, User,
} from 'lucide-react';
import toast from 'react-hot-toast';
import PageHero from '../components/ui/PageHero';
import { Card } from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Section from '../components/ui/Section';
import DataFreshness from '../components/ui/DataFreshness';
import { SkeletonPageHeader, SkeletonCard } from '../components/ui/Skeleton';
import { formatDate } from '../lib/format';
import { downloadCsv, csvStamp } from '../lib/csv';
import { AUDIT_ACTIONS, auditActionLabel, auditActionTone } from '../lib/auditLog';
import { useLocalQuery } from '../lib/localDb/useLocalQuery';
import { useLocalDb } from '../lib/localDb/LocalDbContext';
import { loadLocalAuditLogs } from '../lib/localDb/localData';
import useAppRefresh from '../lib/useAppRefresh';

const PAGE_SIZE = 30;
/** سقف السجلات المحفوظة محلياً للعرض (يأتي من مزامنة admin_audit_logs). */
const AUDIT_LOCAL_LIMIT = 200;
const FILTER_STORAGE_KEY = 'krotak:audit-filter';

const DETAIL_LABELS = {
  amount: 'المبلغ',
  month: 'الشهر',
  title: 'العنوان',
  sent: 'عدد الأجهزة',
  affected_users: 'عدد الحسابات',
  new_date: 'التاريخ الجديد',
  commission_rate: 'العمولة',
  has_custom_warning: 'تحذير مخصص',
  subscription_end_date: 'تاريخ الانتهاء',
  default_commission_rate: 'العمولة العامة',
  default_trial_days: 'الأيام التجريبية',
  warning_days_before_expiry: 'أيام التحذير',
  is_app_active: 'حالة التطبيق',
  saleUuid: 'معرّف البيع',
  reason: 'سبب التعارض',
  previousHash: 'الهاش السابق',
  incomingHash: 'الهاش الوارد',
  locked: 'الاشتراكات المقفلة',
  networksUpdated: 'الشبكات المحدثة',
  scanned: 'الحسابات المفحوصة',
  extensionDays: 'أيام التمديد',
  settlementId: 'معرّف التسوية',
  settledSalesCount: 'عدد المبيعات المسوّاة',
  unallocated: 'المبلغ المتبقي',
  version: 'الإصدار',
  scope: 'النطاق',
};

const ACTION_ICONS = {
  USER_ACTIVATE: UserCheck,
  USER_BLOCK: ShieldAlert,
  USER_MAKE_OFFICIAL: ShieldCheck,
  USER_RENEW: Calendar,
  USER_EDIT: Settings,
  PAYMENT_ADD: DollarSign,
  NOTIFICATION_SEND: Bell,
  NOTIFICATION_DELETE: Bell,
  NOTIFICATION_SCHEDULE: Bell,
  SETTINGS_SAVE: Settings,
  APP_STATUS_CHANGE: ShieldAlert,
  SUBSCRIPTION_BATCH: Calendar,
  USER_PASSWORD_SET: KeyRound,
  USER_RESET_LINK: KeyRound,
  ADMIN_CREATE: ShieldCheck,
  ADMIN_DELETE: ShieldAlert,
  DEVICE_DELETE: Settings,
  USER_DELETE: ShieldAlert,
  ADMIN_PASSWORD_CHANGE: KeyRound,
  SETTLEMENT_RECORD: DollarSign,
  NETWORK_REGISTER: ShieldCheck,
  NETWORK_RENEW: Calendar,
  NETWORK_ACCESS_UPDATE: Settings,
  NETWORK_DELETE: ShieldAlert,
  SUBSCRIPTION_EXPIRY_CRON: Clock,
  TEMPLATE_DRAFT_CREATE: ScrollText,
  TEMPLATE_DRAFT_UPDATE: Settings,
  TEMPLATE_DRAFT_DELETE: ShieldAlert,
  TEMPLATE_RELEASE_PUBLISH: ShieldCheck,
  TEMPLATE_RELEASE_ROLLBACK: Calendar,
  SALE_CONFLICT_DETECTED: ShieldAlert,
};

function formatDetails(details) {
  if (!details || typeof details !== 'object') return '—';
  const parts = Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => {
      const label = DETAIL_LABELS[key] || key;
      const shown = typeof value === 'boolean' ? (value ? 'نعم' : 'لا') : String(value);
      return `${label}: ${shown}`;
    });
  return parts.length ? parts.join(' • ') : '—';
}

function loadSavedFilter() {
  try {
    return window.localStorage.getItem(FILTER_STORAGE_KEY) || 'all';
  } catch {
    return 'all';
  }
}

const CATEGORY_CHIPS = [
  { key: 'all', label: 'كل العمليات' },
  { key: 'users', label: 'المستخدمين والاشتراكات', actions: ['USER_ACTIVATE', 'USER_BLOCK', 'USER_MAKE_OFFICIAL', 'USER_RENEW', 'USER_EDIT', 'USER_DELETE', 'NETWORK_ACCESS_UPDATE', 'NETWORK_RENEW', 'NETWORK_DELETE', 'NETWORK_REGISTER'] },
  { key: 'financial', label: 'الدفعات والتسويات', actions: ['PAYMENT_ADD', 'SETTLEMENT_RECORD', 'SUBSCRIPTION_BATCH'] },
  { key: 'security', label: 'الأمان والتعارضات', actions: ['USER_PASSWORD_SET', 'USER_RESET_LINK', 'ADMIN_PASSWORD_CHANGE', 'ADMIN_CREATE', 'ADMIN_DELETE', 'SALE_CONFLICT_DETECTED'] },
  { key: 'templates', label: 'مركز القوالب', actions: ['TEMPLATE_DRAFT_CREATE', 'TEMPLATE_DRAFT_UPDATE', 'TEMPLATE_DRAFT_DELETE', 'TEMPLATE_RELEASE_PUBLISH', 'TEMPLATE_RELEASE_ROLLBACK'] },
  { key: 'system', label: 'إعدادات النظام والكرون', actions: ['SETTINGS_SAVE', 'APP_STATUS_CHANGE', 'DEVICE_DELETE', 'SUBSCRIPTION_EXPIRY_CRON'] },
];

export default function AuditPage() {
  const [actionFilter, setActionFilter] = useState(loadSavedFilter);
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const { runSync, syncing, lastSyncAt } = useLocalDb();

  // السجل يُقرأ من القاعدة المحلية (آخر 200 سجل)؛ لا استعلام Firestore في الشاشة.
  const logsQuery = useLocalQuery((localDb) => loadLocalAuditLogs(localDb, AUDIT_LOCAL_LIMIT), []);
  const allLogs = useMemo(() => logsQuery.data || [], [logsQuery.data]);
  const logs = useMemo(() => allLogs.slice(0, visibleCount), [allLogs, visibleCount]);
  const loading = logsQuery.loading;
  const error = logsQuery.error
    ? 'تعذر قراءة سجل العمليات من القاعدة المحلية. أعد المحاولة.'
    : null;
  const hasMore = allLogs.length > visibleCount;
  const loadingMore = false;

  const loadMore = () => setVisibleCount((count) => count + PAGE_SIZE);

  const refresh = async () => {
    await runSync({ reason: 'manual' });
    logsQuery.refresh();
  };

  useAppRefresh(refresh);

  useEffect(() => {
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, actionFilter);
    } catch {
      // Ignored
    }
  }, [actionFilter]);

  const filteredLogs = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const categoryDef = CATEGORY_CHIPS.find((c) => c.key === activeCategory);

    return logs.filter((entry) => {
      // Category filter
      if (categoryDef && categoryDef.actions && !categoryDef.actions.includes(entry.action)) {
        return false;
      }
      // Specific action dropdown filter
      if (actionFilter !== 'all' && entry.action !== actionFilter) return false;
      // Search term
      if (!term) return true;
      return [
        entry.targetLabel,
        entry.targetId,
        entry.actorEmail,
        entry.actorUid,
        auditActionLabel(entry.action),
        JSON.stringify(entry.details || {}),
      ]
        .filter(Boolean)
        .some((val) => String(val).toLowerCase().includes(term));
    });
  }, [logs, actionFilter, activeCategory, searchTerm]);

  const handleExport = useCallback(() => {
    if (!filteredLogs.length) {
      toast.error('لا توجد بيانات للتصدير');
      return;
    }
    downloadCsv(`audit-log-${csvStamp()}`, filteredLogs, [
      { label: 'الوقت', value: (row) => formatDate(row.createdAtMs || row.createdAt, { withTime: true }) },
      { label: 'المدير', value: (row) => row.actorEmail || row.actorUid || '' },
      { label: 'الإجراء', value: (row) => auditActionLabel(row.action) },
      { label: 'الهدف', value: (row) => row.targetLabel || row.targetId || '' },
      { label: 'التفاصيل', value: (row) => formatDetails(row.details) },
    ]);
    toast.success('تم تصدير سجل العمليات');
  }, [filteredLogs]);

  if (loading && logs.length === 0) {
    return (
      <div className="audit-page pb-16">
        <SkeletonPageHeader />
        <div className="space-y-3 mt-4">
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </div>
      </div>
    );
  }

  return (
    <div className="audit-page pb-16">
      <PageHero
        icon={ScrollText}
        title="سجل العمليات"
        subtitle="توثيق زمني فوري لكل إجراء إداري: الوقت، المنفّذ، والهدف."
        meta={`${filteredLogs.length} من ${logs.length} عملية مسجلة`}
        actions={
          <div className="flex items-center gap-2">
            <DataFreshness lastSyncedAt={lastSyncAt} refreshing={loading || syncing} onRefresh={refresh} />
            <Button variant="secondary" size="sm" icon={Download} onClick={handleExport} className="font-bold">
              تصدير CSV
            </Button>
          </div>
        }
      />

      {error && (
        <div className="users-error mb-4" role="alert">
          <span className="users-error__icon"><ShieldCheck className="w-5 h-5" /></span>
          <div className="users-error__body">
            <p className="users-error__title">تعذر تحميل السجل</p>
            <p className="users-error__msg">{error}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={load}>إعادة المحاولة</Button>
        </div>
      )}

      {/* شريط البحث وفلاتر الأندرويد المحمولة */}
      <div className="space-y-3 mb-4">
        {/* حقل البحث الأندرويد السلس */}
        <div className="relative flex items-center bg-surface border border-line rounded-2xl px-3.5 py-1.5 shadow-xs focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20 transition-all">
          <Search className="w-4 h-4 text-muted shrink-0 ml-2" />
          <input
            type="text"
            placeholder="ابحث بالهدف، المدير، الإجراء أو التفاصيل..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-transparent border-0 text-sm text-ink placeholder:text-muted focus:outline-none"
            aria-label="بحث في سجل العمليات"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="p-1 rounded-full text-muted hover:text-ink shrink-0"
              aria-label="مسح البحث"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* أشرطة التصنيف الأفقية (Android Filter Chips) */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          {CATEGORY_CHIPS.map((cat) => {
            const isActive = activeCategory === cat.key;
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => {
                  setActiveCategory(cat.key);
                  setActionFilter('all');
                }}
                className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all border shrink-0 ${
                  isActive
                    ? 'bg-brand text-white border-brand shadow-xs shadow-brand/20'
                    : 'bg-surface text-ink-soft border-line hover:border-brand/40'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* قائمة بطاقات العمليات بنمط أندرويد الحديث والمريح */}
      {filteredLogs.length === 0 ? (
        <Card>
          <div className="empty-state py-10">
            <span className="empty-state__icon icon-tile icon-tile--neutral icon-tile--lg">
              <Inbox className="w-6 h-6" />
            </span>
            <p className="empty-state__title font-extrabold text-ink mt-2">لا توجد عمليات مطابقة</p>
            <p className="empty-state__desc text-muted text-xs max-w-sm mx-auto mt-1">
              {searchTerm
                ? 'لم يتم العثور على أي عملية تطابق معايير البحث الحالية.'
                : 'ستظهر هنا كل العمليات الإدارية فور تنفيذها.'}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {filteredLogs.map((entry) => {
            const Icon = ACTION_ICONS[entry.action] || ScrollText;
            const tone = auditActionTone(entry.action);
            const isExpanded = expandedId === entry.id;
            const detailsText = formatDetails(entry.details);

            return (
              <div
                key={entry.id}
                className="p-3.5 rounded-2xl bg-surface border border-line hover:border-brand/30 transition-all shadow-xs"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                      tone === 'success'
                        ? 'bg-emerald-500/10 text-emerald-600'
                        : tone === 'danger'
                        ? 'bg-rose-500/10 text-rose-600'
                        : tone === 'warning'
                        ? 'bg-amber-500/10 text-amber-600'
                        : 'bg-brand/10 text-brand'
                    }`}>
                      <Icon className="w-4 h-4" />
                    </span>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-xs text-ink">
                          {auditActionLabel(entry.action)}
                        </span>
                        <Badge tone={tone}>{auditActionLabel(entry.action)}</Badge>
                      </div>

                      <p className="text-xs text-ink-secondary mt-1 font-medium truncate">
                        الهدف: <strong className="text-ink font-bold">{entry.targetLabel || entry.targetId || '—'}</strong>
                      </p>

                      <div className="flex items-center gap-3 text-[11px] text-muted mt-1.5 flex-wrap">
                        <span className="flex items-center gap-1 font-mono text-[10px]" dir="ltr">
                          <User className="w-3 h-3 text-muted" />
                          {entry.actorEmail || entry.actorUid || 'مدير'}
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1 text-[10px]">
                          <Clock className="w-3 h-3 text-muted" />
                          {formatDate(entry.createdAtMs || entry.createdAt, { withTime: true })}
                        </span>
                      </div>
                    </div>
                  </div>

                  {entry.details && typeof entry.details === 'object' && Object.keys(entry.details).length > 0 && (
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                      className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface-sunken shrink-0 transition-colors"
                      aria-label="عرض التفاصيل"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  )}
                </div>

                {/* تفاصيل موسعة عند الطلب */}
                {isExpanded && entry.details && (
                  <div className="mt-3 pt-3 border-t border-line/60 bg-surface-sunken/60 p-2.5 rounded-xl text-xs space-y-1">
                    <p className="font-bold text-[10px] text-muted mb-1">تفاصيل العملية:</p>
                    <p className="text-ink text-[11px] font-medium leading-relaxed font-mono" dir="rtl">
                      {detailsText}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* زر تحميل المزيد في نهاية القائمة */}
      {logs.length > 0 && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <p className="text-xs text-muted">
            يُعرض {filteredLogs.length} من {logs.length} سجل محمّل
          </p>
          {hasMore && (
            <Button
              variant="secondary"
              loading={loadingMore}
              disabled={loadingMore || !hasMore}
              onClick={loadMore}
              className="font-bold min-w-[160px]"
            >
              {loadingMore ? 'جارٍ تحميل السجلات...' : 'عرض المزيد'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
