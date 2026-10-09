import { useState, useEffect, useCallback, useMemo } from 'react';
import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { ScrollText, Search, Download, Inbox, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import PageHeader from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Section from '../components/ui/Section';
import DataFreshness from '../components/ui/DataFreshness';
import { SkeletonPageHeader, SkeletonTable } from '../components/ui/Skeleton';
import { formatDate } from '../lib/format';
import { downloadCsv, csvStamp } from '../lib/csv';
import { AUDIT_ACTIONS, auditActionLabel, auditActionTone } from '../lib/auditLog';

const FETCH_LIMIT = 200;
const PAGE_SIZE = 30;
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

export default function AuditPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [actionFilter, setActionFilter] = useState(loadSavedFilter);
  const [searchTerm, setSearchTerm] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snapshot = await getDocs(
        query(collection(db, 'admin_audit_logs'), orderBy('createdAtMs', 'desc'), limit(FETCH_LIMIT))
      );
      setLogs(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
      setUpdatedAt(Date.now());
    } catch (err) {
      console.error('Error fetching audit log:', err);
      setError('تعذر تحميل سجل العمليات. تحقق من قواعد Firestore ثم أعد المحاولة.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [actionFilter, searchTerm]);

  useEffect(() => {
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, actionFilter);
    } catch {
      // التخزين المحلي قد يكون معطّلاً.
    }
  }, [actionFilter]);

  const filteredLogs = useMemo(() => {
    const term = searchTerm.trim();
    return logs.filter((entry) => {
      if (actionFilter !== 'all' && entry.action !== actionFilter) return false;
      if (!term) return true;
      return [entry.targetLabel, entry.targetId, entry.actorEmail, auditActionLabel(entry.action)]
        .filter(Boolean)
        .some((value) => String(value).includes(term));
    });
  }, [logs, actionFilter, searchTerm]);

  const visibleLogs = useMemo(
    () => filteredLogs.slice(0, visibleCount),
    [filteredLogs, visibleCount]
  );
  const hasMore = filteredLogs.length > visibleLogs.length;

  const handleExport = useCallback(() => {
    if (!filteredLogs.length) {
      toast.error('لا توجد بيانات للتصدير');
      return;
    }
    downloadCsv(`audit-log-${csvStamp()}`, filteredLogs, [
      { label: 'الوقت', value: (row) => formatDate(row.createdAtMs, { withTime: true }) },
      { label: 'المدير', value: (row) => row.actorEmail || row.actorUid || '' },
      { label: 'الإجراء', value: (row) => auditActionLabel(row.action) },
      { label: 'الهدف', value: (row) => row.targetLabel || row.targetId || '' },
      { label: 'التفاصيل', value: (row) => formatDetails(row.details) },
    ]);
    toast.success('تم تصدير سجل العمليات');
  }, [filteredLogs]);

  if (loading) {
    return (
      <div className="audit-page">
        <SkeletonPageHeader />
        <Card flush><SkeletonTable rows={8} /></Card>
      </div>
    );
  }

  return (
    <div className="audit-page">
      <PageHeader
        icon={ScrollText}
        title="سجل العمليات"
        description="توثيق كامل لكل إجراء إداري مؤثر: من قام به، على أي حساب، ومتى."
        meta={`${filteredLogs.length} من ${logs.length} عملية`}
        actions={
          <DataFreshness updatedAt={updatedAt} refreshing={loading} onRefresh={load} />
        }
      />

      {error && (
        <div className="users-error" role="alert">
          <span className="users-error__icon"><ShieldCheck className="w-5 h-5" /></span>
          <div className="users-error__body">
            <p className="users-error__title">تعذر تحميل السجل</p>
            <p className="users-error__msg">{error}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={load}>إعادة المحاولة</Button>
        </div>
      )}

      <Section
        eyebrow="التدقيق"
        title="العمليات الإدارية"
        description={`أحدث ${FETCH_LIMIT} عملية مسجّلة`}
        action={
          <Button variant="secondary" size="sm" icon={Download} onClick={handleExport}>
            تصدير CSV
          </Button>
        }
      >
        <Card className="audit-toolbar-card">
          <div className="users-toolbar">
            <div className="users-search">
              <Search className="field-affix field-affix--lead w-5 h-5" aria-hidden="true" />
              <input
                type="text"
                placeholder="بحث بالهدف أو المدير أو الإجراء..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input-field input-field--lead"
                aria-label="بحث في سجل العمليات"
              />
            </div>
            <div className="audit-filter">
              <label className="label-field" htmlFor="audit-action-filter">نوع الإجراء</label>
              <select
                id="audit-action-filter"
                className="input-field"
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
              >
                <option value="all">كل الإجراءات</option>
                {Object.entries(AUDIT_ACTIONS).map(([key, meta]) => (
                  <option key={key} value={key}>{meta.label}</option>
                ))}
              </select>
            </div>
          </div>
        </Card>

        {filteredLogs.length === 0 ? (
          <Card>
            <div className="empty-state">
              <span className="empty-state__icon icon-tile icon-tile--neutral icon-tile--lg">
                <Inbox className="w-6 h-6" />
              </span>
              <p className="empty-state__title">لا توجد عمليات مطابقة</p>
              <p className="empty-state__desc">
                ستظهر هنا كل إجراء إداري (حظر، تعديل، دفعة، إشعار، كلمة مرور...) بعد تنفيذه.
              </p>
            </div>
          </Card>
        ) : (
          <Card flush>
            <div className="overflow-x-auto">
              <table className="responsive-data-table w-full">
                <thead>
                  <tr className="table-header">
                    <th className="text-right px-6 py-4">الوقت</th>
                    <th className="text-right px-6 py-4">المدير</th>
                    <th className="text-right px-6 py-4">الإجراء</th>
                    <th className="text-right px-6 py-4">الهدف</th>
                    <th className="text-right px-6 py-4">التفاصيل</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {visibleLogs.map((entry) => (
                    <tr key={entry.id} className="hover:bg-surface-sunken transition-colors">
                      <td className="px-6 py-3 text-sm text-ink-soft" data-label="الوقت">
                        {formatDate(entry.createdAtMs || entry.createdAt, { withTime: true })}
                      </td>
                      <td className="px-6 py-3 text-sm" data-label="المدير">
                        <span dir="ltr">{entry.actorEmail || entry.actorUid || '—'}</span>
                      </td>
                      <td className="px-6 py-3" data-label="الإجراء">
                        <Badge tone={auditActionTone(entry.action)}>{auditActionLabel(entry.action)}</Badge>
                      </td>
                      <td className="px-6 py-3 text-sm font-semibold" data-label="الهدف">
                        {entry.targetLabel || entry.targetId || '—'}
                      </td>
                      <td className="px-6 py-3 text-xs text-ink-secondary" data-label="التفاصيل">
                        {formatDetails(entry.details)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {filteredLogs.length > 0 && (
          <div className="list-footer">
            <p className="list-footer__count">
              يُعرض {visibleLogs.length} من {filteredLogs.length} عملية
            </p>
            {hasMore && (
              <Button variant="secondary" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
                عرض المزيد
              </Button>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
