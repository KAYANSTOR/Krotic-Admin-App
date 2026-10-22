import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  AlertTriangle, Archive, ArrowDownToLine, ArrowUpLeft, Bell, CreditCard,
  ListChecks, RefreshCw, Send, Settings, Sparkles,
  TrendingUp, UserPlus, Users, Wallet,
} from 'lucide-react';
import IconTile from '../components/ui/IconTile';
import Button from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PageSkeleton } from '../components/ui/Skeleton';
import useAppRefresh from '../lib/useAppRefresh';
import Section from '../components/ui/Section';
import DataFreshness from '../components/ui/DataFreshness';
import toast from 'react-hot-toast';
import { callAdminApi, adminApiError } from '../lib/adminApi';
import { formatDate, formatNumber, toDate } from '../lib/format';
import { summarizeCompletedSales } from '../lib/commission';
import { fetchDashboardStats, getAdminDataCacheState, invalidateAdminDataCache, subscribeAdminDataCache } from '../lib/adminData';

const MONTH_LABELS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const AGGREGATE_REPAIR_PROGRESS_KEY = 'krotak:aggregate-repair-progress:v1';

function summarizeRealtimeSales(networks) {
  const now = new Date();
  const months = [];
  const monthBuckets = new Map();
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const bucket = { month, label: MONTH_LABELS[date.getMonth()], face: 0, count: 0 };
    months.push(bucket);
    monthBuckets.set(month, bucket);
  }

  const totals = {
    totalSales: 0,
    totalTransactions: 0,
    totalCommission: 0,
    totalCommissionOutstanding: 0,
  };

  networks.forEach((network) => {
    const sales = (network.sales || []).filter((sale) => sale.status === 'COMPLETED');
    const summary = summarizeCompletedSales(sales);
    totals.totalSales += summary.reportedSalesValue;
    totals.totalTransactions += summary.reportedTransactions;
    totals.totalCommission += summary.commissionDue;
    totals.totalCommissionOutstanding += summary.outstandingCommission;

    sales.forEach((sale) => {
      const date = toDate(sale.createdAt);
      if (!date || Number.isNaN(date.getTime())) return;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const bucket = monthBuckets.get(key);
      if (bucket) {
        bucket.face += Number(sale.faceValue) || 0;
        bucket.count += 1;
      }
    });
  });

  return { stats: totals, monthlySales: months };
}
function recentOperationsFromNetworks(networks) {
  return networks
    .flatMap((network) => (network.sales || []).map((sale) => ({
      ...sale,
      networkName: network.networkName || network.uid,
      commissionRate: network.commissionRate,
    })))
    .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0))
    .slice(0, 8);
}

export default function DashboardPage() {
  const { adminData } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [appStatus, setAppStatus] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [cacheState, setCacheState] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [monthlySales, setMonthlySales] = useState([]);
  const [recentOperations, setRecentOperations] = useState([]);
  const [monthlyDataWarning, setMonthlyDataWarning] = useState(false);
  const [realtimeDataWarning, setRealtimeDataWarning] = useState(false);
  const [salesSnapshotsReady, setSalesSnapshotsReady] = useState(false);
  const [partialErrors, setPartialErrors] = useState([]);
  const [rebuildingAggregates, setRebuildingAggregates] = useState(false);
  const [aggregateRepairProgress, setAggregateRepairProgress] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(AGGREGATE_REPAIR_PROGRESS_KEY) || 'null');
      return saved && typeof saved === 'object'
        ? { processed: Math.max(0, Number(saved.processed) || 0), cursor: typeof saved.cursor === 'string' ? saved.cursor : null, done: saved.done === true }
        : { processed: 0, cursor: null, done: false };
    } catch {
      return { processed: 0, cursor: null, done: false };
    }
  });
  const latestRequestId = useRef(0);
  const realtimeSummary = useRef(null);
  const dashboardDataReady = useRef(false);
  const salesRealtimeReady = useRef(false);

  const load = useCallback(async ({ force = false } = {}) => {
    const requestId = ++latestRequestId.current;
    setLoading(true);
    setError(null);
    try {
      const {
        appStatus: status,
        stats: nextStats,
        alerts: nextAlerts,
        monthlySales: nextMonthlySales,
        monthlyDataWarning: nextMonthlyDataWarning,
        errors: nextErrors,
      } = await fetchDashboardStats({ force });
      if (requestId !== latestRequestId.current) return;
      setAppStatus(status);
      setStats({ ...nextStats, ...(realtimeSummary.current?.stats || {}) });
      setAlerts(nextAlerts);
      setMonthlySales(realtimeSummary.current?.monthlySales || nextMonthlySales || []);
      setMonthlyDataWarning(Boolean(nextMonthlyDataWarning));
      setPartialErrors(Array.isArray(nextErrors) ? nextErrors : []);
      setUpdatedAt(Date.now());
      setCacheState(getAdminDataCacheState('dashboard-stats'));
      dashboardDataReady.current = true;
    } catch (err) {
      if (requestId !== latestRequestId.current) return;
      console.error('Error fetching dashboard data:', err);
      setError('تعذر تحميل بيانات لوحة التحكم. تحقق من الاتصال ثم أعد المحاولة.');
      dashboardDataReady.current = true;
    } finally {
      if (requestId === latestRequestId.current && dashboardDataReady.current && salesRealtimeReady.current) setLoading(false);
    }
  }, []);

  const repairFinancialAggregates = useCallback(async () => {
    if (rebuildingAggregates || aggregateRepairProgress.done) return;
    const resume = Boolean(aggregateRepairProgress.cursor);
    const accepted = window.confirm(
      (resume ? 'استئناف' : 'بدء') + ' إعادة بناء المجاميع المالية من سجلات المبيعات والمدفوعات؟ هذه العملية قد تستهلك آلاف قراءات Firestore؛ بما أن الحصة المجانية قد تكون مستنفدة، شغّلها بعد تجدد الحصة اليومية. تتم المعالجة على دفعات قابلة للاستئناف، وبحد أقصى 2000 سجل لكل مجموعة في الشبكة.'
    );
    if (!accepted) return;
    setRebuildingAggregates(true);
    let cursor = aggregateRepairProgress.cursor || null;
    let processed = Number(aggregateRepairProgress.processed) || 0;
    try {
      do {
        const response = await callAdminApi('/api/migrate', {
          action: 'rebuild-all',
          limit: 5,
          ...(cursor ? { cursor } : {}),
        });
        if (!response.ok) throw new Error(adminApiError(response.error, 'تعذر إعادة بناء المجاميع المالية'));
        const result = response.data || {};
        processed += Number(result.processed) || 0;
        cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : null;
        const nextProgress = { processed, cursor, done: false };
        setAggregateRepairProgress(nextProgress);
        try {
          if (cursor) window.localStorage.setItem(AGGREGATE_REPAIR_PROGRESS_KEY, JSON.stringify(nextProgress));
          else window.localStorage.removeItem(AGGREGATE_REPAIR_PROGRESS_KEY);
        } catch { /* progress persistence is best-effort */ }
        if (result.done === true || !cursor) break;
      } while (cursor);
      invalidateAdminDataCache([
        'all-users', 'users-with-billing', 'dashboard-stats', 'network-sales', 'network-sales-full',
        'aggregate:*', 'sales:*', 'network-meta:*', 'billing-history:*',
      ]);
      setAggregateRepairProgress({ processed, cursor: null, done: true });
      await load({ force: true });
      toast.success(`اكتملت إعادة بناء مجاميع ${formatNumber(processed)} شبكة. حدّث شاشة المستخدمين إذا كانت مفتوحة.`);
    } catch (repairError) {
      const nextProgress = { processed, cursor, done: false };
      setAggregateRepairProgress(nextProgress);
      try {
        if (cursor) window.localStorage.setItem(AGGREGATE_REPAIR_PROGRESS_KEY, JSON.stringify(nextProgress));
        else window.localStorage.removeItem(AGGREGATE_REPAIR_PROGRESS_KEY);
      } catch { /* progress persistence is best-effort */ }
      toast.error(repairError instanceof Error ? repairError.message : 'توقفت إعادة بناء المجاميع. يمكنك الاستئناف بعد تجدد حصة Firestore.');
    } finally {
      setRebuildingAggregates(false);
    }
  }, [aggregateRepairProgress, rebuildingAggregates, load]);

  useEffect(() => subscribeAdminDataCache('dashboard-stats', (data, state) => {
    dashboardDataReady.current = true;
    setAppStatus(data.appStatus);
    setStats({ ...data.stats, ...(realtimeSummary.current?.stats || {}) });
    setAlerts(data.alerts);
    setMonthlySales(realtimeSummary.current?.monthlySales || data.monthlySales || []);
    setMonthlyDataWarning(Boolean(data.monthlyDataWarning));
    setPartialErrors(Array.isArray(data.errors) ? data.errors : []);
    setUpdatedAt(Date.now());
    setCacheState(state);
    setError(null);
  }), []);

  useEffect(() => {
    load();
    return () => { latestRequestId.current += 1; };
  }, [load]);

  useEffect(() => {
    salesRealtimeReady.current = true;
    setSalesSnapshotsReady(true);
    if (dashboardDataReady.current) setLoading(false);
  }, []);

  // السحب للأسفل على الجوال يعيد جلب بيانات اللوحة (force).
  useAppRefresh(() => load({ force: true }));

  if (loading && !stats) return <PageSkeleton />;

  const maintenance = appStatus && !appStatus.is_app_active;
  const adminName = (adminData?.name || 'المدير').trim();

  return (
    <div className="dashboard-page">
      <section className="flex items-center justify-between gap-2 px-1 py-1.5 mb-2.5" aria-label="ترحيب">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" title="النظام متصل" />
          <h1 className="text-base sm:text-lg font-black text-ink truncate">
            أهلاً، {adminName}
          </h1>
          <span className="text-[11px] font-bold text-muted hidden sm:inline">• الإدارة</span>
        </div>
        <DataFreshness
          updatedAt={updatedAt}
          lastSyncedAt={cacheState?.lastSyncedAt}
          refreshing={loading}
          fromCache={cacheState?.fromCache}
          onRefresh={() => load({ force: true })}
        />
      </section>


      {!aggregateRepairProgress.done && (
        <Card className="mb-3 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-ink">صيانة الملخصات المالية القديمة</p>
              <p className="mt-1 text-xs leading-5 text-muted">تعيد حساب إجمالي المبيعات والعمولات والدفعات من السجلات المخزنة، ثم تحفظ الملخصات في Firestore لتستخدمها الشاشات سريعًا. لا تعدّل سجل البيع نفسه.</p>
              <p className="mt-1 text-xs leading-5 text-amber-700">قد تستهلك آلاف القراءات. انتظر تجدد الحصة اليومية قبل تشغيلها؛ كل شبكة محدودة حاليًا بـ 2000 سجل في كل مجموعة.</p>
              {aggregateRepairProgress.cursor && (
                <p className="mt-1 text-xs font-semibold text-ink-soft">تمت معالجة {formatNumber(aggregateRepairProgress.processed)} شبكة. يمكنك استئناف الإصلاح من آخر نقطة محفوظة.</p>
              )}
            </div>
            <Button variant="secondary" size="sm" icon={RefreshCw} loading={rebuildingAggregates} disabled={rebuildingAggregates} onClick={repairFinancialAggregates}>
              {rebuildingAggregates ? `جارٍ الإصلاح (${formatNumber(aggregateRepairProgress.processed)} شبكة)` : aggregateRepairProgress.cursor ? 'استئناف الإصلاح' : 'إصلاح الملخصات'}
            </Button>
          </div>
        </Card>
      )}
      {aggregateRepairProgress.done && (
        <Card className="mb-3 p-4">
          <p className="text-sm font-extrabold text-emerald-700">اكتملت إعادة بناء المجاميع المالية ({formatNumber(aggregateRepairProgress.processed)} شبكة).</p>
          <p className="mt-1 text-xs text-muted">تم حفظ النتيجة لهذا المتصفح. لا تعِد تشغيل الإجراء إلا إذا كنت تحتاج إلى إعادة بناء جديدة.</p>
        </Card>
      )}

      {maintenance && (
        <div className="dash-alert" role="status" aria-live="polite">
          <span className="dash-alert__icon" aria-hidden="true">
            <AlertTriangle className="w-5 h-5" />
          </span>
          <div className="dash-alert__body">
            <p className="dash-alert__title">التطبيق في وضع الصيانة</p>
            {appStatus.maintenance_message && (
              <p className="dash-alert__msg">{appStatus.maintenance_message}</p>
            )}
          </div>
        </div>
      )}

      {!salesSnapshotsReady && stats && (
        <div className="dash-alert" role="status" aria-live="polite">
          <span className="dash-alert__icon" aria-hidden="true"><RefreshCw className="w-5 h-5" /></span>
          <div className="dash-alert__body">
            <p className="dash-alert__title">جارٍ مزامنة المؤشرات المالية</p>
            <p className="dash-alert__msg">تتحدّث المجاميع مع وصول سجلات الشبكات؛ قد تتغير الأرقام لحظياً حتى اكتمال المزامنة.</p>
          </div>
        </div>
      )}

      {realtimeDataWarning && (
        <div className="dash-alert" role="status" aria-live="polite">
          <span className="dash-alert__icon" aria-hidden="true"><AlertTriangle className="w-5 h-5" /></span>
          <div className="dash-alert__body">
            <p className="dash-alert__title">تعذر مزامنة بعض تحديثات المبيعات</p>
            <p className="dash-alert__msg">قد تكون بيانات الشبكات غير مكتملة بسبب تعذر الاتصال بقاعدة البيانات. تحقق من تفاصيل الفشل، ولا تكرر التسوية المالية حتى تتأكد من نتيجتها.</p>
            {partialErrors.length > 0 && (
              <details className="dash-error__details">
                <summary>عرض تفاصيل الفشل ({partialErrors.length})</summary>
                <ul>
                  {partialErrors.map((message, index) => (
                    <li key={index} dir="ltr">{message}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      )}

      {monthlyDataWarning && (
        <div className="dash-error" role="status" aria-live="polite">
          <span className="dash-error__icon" aria-hidden="true"><AlertTriangle className="w-5 h-5" /></span>
          <div className="dash-error__body">
            <p className="dash-error__title">تفصيل الأشهر غير مكتمل</p>
            <p className="dash-error__msg">الإجماليات المالية محفوظة. يجري استعادة التفصيل الشهري من سجلات المبيعات عند غياب بيانات التجميع؛ إذا استمر التحذير، افتح تفاصيل الفشل لمعرفة الشبكة وسبب الخطأ بدقة.</p>
            {partialErrors.length > 0 && (
              <details className="dash-error__details">
                <summary>عرض تفاصيل الفشل ({partialErrors.length})</summary>
                <ul>
                  {partialErrors.map((message, index) => (
                    <li key={index} dir="ltr">{message}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="dash-error" role="alert">
          <span className="dash-error__icon" aria-hidden="true">
            <AlertTriangle className="w-5 h-5" />
          </span>
          <div className="dash-error__body">
            <p className="dash-error__title">حدث خطأ</p>
            <p className="dash-error__msg">{error}</p>
          </div>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={load}>
            إعادة المحاولة
          </Button>
        </div>
      )}

      {stats && (
        <>
          <section className="dash-finance" aria-label="الملخص المالي">
            <article className="dash-finance__primary">
              <header className="dash-finance__head">
                <span className="dash-finance__eyebrow">إجمالي المبيعات</span>
                <span className="dash-finance__pill">
                  <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />
                  كل الوقت
                </span>
              </header>
              <div className="dash-finance__value">
                <strong>{formatNumber(stats.totalSales)}</strong>
                <span>ريال يمني</span>
              </div>
              <p className="dash-finance__hint">
                يحتسب المبيعات المكتملة فقط، وتتحدث المبيعات والعمولة المتبقية مع سجل البيع نفسه.
              </p>
            </article>

            <div className="dash-finance__side">
              <article className="dash-finance__tile dash-finance__tile--gold">
                <span className="dash-finance__tile-icon"><Wallet className="w-5 h-5" aria-hidden="true" /></span>
                <div>
                  <p className="dash-finance__tile-label">عمولة الإدارة غير المسوّاة</p>
                  <p className="dash-finance__tile-value">
                    {formatNumber(stats.totalCommissionOutstanding || 0)} <small>ريال يمني</small>
                  </p>
                </div>
              </article>
              <article className="dash-finance__tile dash-finance__tile--brand">
                <span className="dash-finance__tile-icon"><Users className="w-5 h-5" aria-hidden="true" /></span>
                <div>
                  <p className="dash-finance__tile-label">عدد الشبكات</p>
                  <p className="dash-finance__tile-value">
                    {formatNumber(stats.totalUsers || 0)} <small>شبكة</small>
                  </p>
                </div>
              </article>
            </div>
          </section>

          <Section eyebrow="تنقل سريع" title="إجراءات سريعة" aria-label="إجراءات سريعة">
            <div className="dash-actions">
              <Link to="/users" className="dash-action">
                <IconTile icon={UserPlus} tone="brand" />
                <span className="dash-action__label">إدارة المستخدمين</span>
                <ArrowUpLeft className="dash-action__arrow" aria-hidden="true" />
              </Link>
              <Link to="/sales" className="dash-action">
                <IconTile icon={CreditCard} tone="gold" />
                <span className="dash-action__label">المبيعات والعمولات</span>
                <ArrowUpLeft className="dash-action__arrow" aria-hidden="true" />
              </Link>
              <Link to="/notifications" className="dash-action">
                <IconTile icon={Bell} tone="warning" />
                <span className="dash-action__label">إرسال إشعار</span>
                <ArrowUpLeft className="dash-action__arrow" aria-hidden="true" />
              </Link>
              <Link to="/template-center/inbound" className="dash-action">
                <IconTile icon={ArrowDownToLine} tone="brand" />
                <span className="dash-action__label">قوالب التحويل الواردة</span>
                <ArrowUpLeft className="dash-action__arrow" aria-hidden="true" />
              </Link>
              <Link to="/template-center/outbound" className="dash-action">
                <IconTile icon={Send} tone="brand" />
                <span className="dash-action__label">الرسائل الصادرة (SMS)</span>
                <ArrowUpLeft className="dash-action__arrow" aria-hidden="true" />
              </Link>
              <Link to="/template-center/wallets" className="dash-action">
                <IconTile icon={Wallet} tone="gold" />
                <span className="dash-action__label">المحافظ ومصادر الرسائل</span>
                <ArrowUpLeft className="dash-action__arrow" aria-hidden="true" />
              </Link>
              <Link to="/template-center/releases" className="dash-action">
                <IconTile icon={Archive} tone="neutral" />
                <span className="dash-action__label">الإصدارات والنشر</span>
                <ArrowUpLeft className="dash-action__arrow" aria-hidden="true" />
              </Link>
              <Link to="/template-center/reconciliation" className="dash-action">
                <IconTile icon={ListChecks} tone="neutral" />
                <span className="dash-action__label">التسوية والعناصر القديمة</span>
                <ArrowUpLeft className="dash-action__arrow" aria-hidden="true" />
              </Link>
              <Link to="/settings" className="dash-action">
                <IconTile icon={Settings} tone="neutral" />
                <span className="dash-action__label">الإعدادات العامة</span>
                <ArrowUpLeft className="dash-action__arrow" aria-hidden="true" />
              </Link>
            </div>
          </Section>

          <Section eyebrow="آخر العمليات" title="آخر مبيعات الشبكات" description="أحدث العمليات الواردة من الشبكات مرتبة حسب وقت التسجيل." aria-label="آخر العمليات">
            {recentOperations.length === 0 ? (
              <Card><p className="text-sm text-ink-secondary">لا توجد عمليات حديثة لعرضها.</p></Card>
            ) : (
              <div className="recent-operations">
                {recentOperations.map((operation) => (
                  <Link key={`${operation.networkName}-${operation.id}`} to="/sales" className="recent-operation">
                    <span className="recent-operation__icon"><CreditCard className="w-4 h-4" aria-hidden="true" /></span>
                    <span className="recent-operation__body">
                      <strong>{operation.networkName}</strong>
                      <span>{formatDate(operation.createdAt, { withTime: true })} • {operation.customerId || 'عميل غير محدد'}</span>
                    </span>
                    <span className="recent-operation__amount">{formatNumber(operation.faceValue)} ريال</span>
                  </Link>
                ))}
              </div>
            )}
          </Section>

        </>
      )}

      {!stats && !error && (
        <div className="dash-empty" role="status">
          <span className="dash-empty__icon" aria-hidden="true">
            <Users className="w-6 h-6" />
          </span>
          <p className="dash-empty__title">لا توجد بيانات لعرضها بعد</p>
          <p className="dash-empty__desc">
            لم يتم العثور على مستخدمين أو مبيعات مسجّلة حتى الآن.
          </p>
        </div>
      )}
    </div>
  );
}
