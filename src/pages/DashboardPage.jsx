import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  AlertTriangle, Archive, ArrowDownToLine, Bell, ChevronDown, CreditCard, Eye, EyeOff,
  Layers3, ListChecks, RefreshCw, Send, Settings, TrendingUp, UserPlus, Users,
  Wallet, Wrench,
} from 'lucide-react';
import IconTile from '../components/ui/IconTile';
import Button from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PageSkeleton } from '../components/ui/Skeleton';
import useAppRefresh from '../lib/useAppRefresh';
import useOnlineStatus from '../lib/useOnlineStatus';
import Section from '../components/ui/Section';
import DataFreshness from '../components/ui/DataFreshness';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import toast from 'react-hot-toast';
import { callAdminApi, adminApiError } from '../lib/adminApi';
import { formatDate, formatNumber, toDate } from '../lib/format';
import { summarizeCompletedSales } from '../lib/commission';
import { useLocalQuery } from '../lib/localDb/useLocalQuery';
import { useLocalDb } from '../lib/localDb/LocalDbContext';
import { loadLocalDashboard, loadLocalNetworkSales } from '../lib/localDb/localData';

const MONTH_LABELS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const AGGREGATE_REPAIR_PROGRESS_KEY = 'krotak:aggregate-repair-progress:v1';

/** تسميات حالات البيع الفعلية المستخدمة في شاشة المبيعات. */
const SALE_STATUS = {
  COMPLETED: { label: 'مكتمل', tone: 'success' },
  ROLLED_BACK: { label: 'مسترجع', tone: 'warning' },
  SMS_PENDING: { label: 'بانتظار SMS', tone: 'info' },
};

function saleStatusMeta(status) {
  return SALE_STATUS[status] || { label: 'غير محدد', tone: 'neutral' };
}

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
      networkName: network.networkName || network.network_name || network.name
        || network.networkTitle || `شبكة ${network.networkId || network.uid}`,
      commissionRate: network.commissionRate,
    })))
    .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0))
    .slice(0, 8);
}

export default function DashboardPage() {
  const { adminData } = useAuth();
  const { runSync, syncing, lastSyncAt } = useLocalDb();
  const online = useOnlineStatus();
  const [balanceVisible, setBalanceVisible] = useState(true);
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

  // التقرير كامل من القاعدة المحلية: لا قراءة Firestore عند فتح الشاشة أو التنقل.
  const dashboardQuery = useLocalQuery((localDb) => loadLocalDashboard(localDb), []);
  const salesQuery = useLocalQuery((localDb) => loadLocalNetworkSales(localDb), []);

  const report = dashboardQuery.data;
  const stats = report?.stats || null;
  const appStatus = report?.appStatus || null;
  const alerts = report?.alerts || null;
  const monthlySales = report?.monthlySales || [];
  const monthlyDataWarning = Boolean(report?.monthlyDataWarning);
  const recentOperations = useMemo(
    () => recentOperationsFromNetworks(salesQuery.data || []),
    [salesQuery.data],
  );
  const loading = dashboardQuery.loading && !report;
  const error = dashboardQuery.error
    ? 'تعذر قراءة بيانات لوحة التحكم من القاعدة المحلية. أعد المحاولة.'
    : null;
  const partialErrors = [];
  const salesSnapshotsReady = !dashboardQuery.loading;
  const realtimeDataWarning = Boolean(salesQuery.error);

  const refresh = async () => {
    await runSync({ reason: 'manual' });
    dashboardQuery.refresh();
    salesQuery.refresh();
  };

  // السحب للأسفل على الجوال يزامن التغييرات فقط (لا قراءة كاملة).
  useAppRefresh(refresh);

  const repairFinancialAggregates = async () => {
    if (rebuildingAggregates || aggregateRepairProgress.done) return;
    const resume = Boolean(aggregateRepairProgress.cursor);
    const accepted = window.confirm(
      (resume ? 'متابعة' : 'بدء') + ' إعادة بناء المجاميع المالية لشبكة واحدة من سجلات المبيعات والمدفوعات؟ قد تستهلك آلاف قراءات Firestore للشبكة الواحدة. بما أن الحصة المجانية قد تكون مستنفدة، شغّلها بعد تجدد الحصة اليومية. لن تُعالج شبكة أخرى حتى تضغط المتابعة مرة أخرى.'
    );
    if (!accepted) return;
    setRebuildingAggregates(true);
    let cursor = aggregateRepairProgress.cursor || null;
    let processed = Number(aggregateRepairProgress.processed) || 0;
    try {
      const response = await callAdminApi('/api/migrate', {
        action: 'rebuild-all',
        limit: 1,
        ...(cursor ? { cursor } : {}),
      });
      if (!response.ok) throw new Error(adminApiError(response.error, 'تعذر إعادة بناء المجاميع المالية'));
      const result = response.data || {};
      processed += Number(result.processed) || 0;
      cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : null;
      const done = result.done === true || !cursor;
      const nextProgress = { processed, cursor: done ? null : cursor, done };
      setAggregateRepairProgress(nextProgress);
      try {
        window.localStorage.setItem(AGGREGATE_REPAIR_PROGRESS_KEY, JSON.stringify(nextProgress));
      } catch { /* progress persistence is best-effort */ }
      await refresh();
      if (done) {
        toast.success(`اكتملت إعادة بناء مجاميع ${formatNumber(processed)} شبكة. حدّث شاشة المستخدمين إذا كانت مفتوحة.`);
      } else {
        toast.success(`أُصلحت شبكة واحدة. الإجمالي ${formatNumber(processed)} شبكة؛ اضغط «متابعة الإصلاح» عند استعدادك للدفعة التالية.`);
      }
    } catch (repairError) {
      const nextProgress = { processed, cursor, done: false };
      setAggregateRepairProgress(nextProgress);
      try {
        window.localStorage.setItem(AGGREGATE_REPAIR_PROGRESS_KEY, JSON.stringify(nextProgress));
      } catch { /* progress persistence is best-effort */ }
      toast.error(repairError instanceof Error ? repairError.message : 'توقفت إعادة بناء المجاميع. يمكنك الاستئناف بعد تجدد حصة Firestore.');
    } finally {
      setRebuildingAggregates(false);
    }
  };

  if (loading && !stats) return <PageSkeleton />;

  const maintenance = appStatus && !appStatus.is_app_active;
  const adminName = (adminData?.name || 'المدير').trim();
  const adminInitial = adminName.charAt(0) || 'م';

  // نسبة تسوية عمولة الإدارة من بيانات حقيقية (المسوّى = المستحق − غير المسوّى).
  const commissionDue = Math.max(0, Number(stats?.totalCommissionDue) || 0);
  const commissionOutstanding = Math.max(0, Number(stats?.totalCommissionOutstanding) || 0);
  const commissionSettled = Math.max(0, commissionDue - commissionOutstanding);
  const settlementPercent = commissionDue > 0
    ? Math.min(100, Math.round((commissionSettled / commissionDue) * 100))
    : 0;

  return (
    <div className="dashboard-page">
      <header className="dash-welcome" aria-label="ترحيب">
        <span className="dash-welcome__avatar" aria-hidden="true">{adminInitial}</span>
        <div className="dash-welcome__identity">
          <p className="dash-welcome__eyebrow">لوحة الإدارة</p>
          <h1 className="dash-welcome__title">أهلاً، {adminName}</h1>
          <p className={`dash-welcome__status ${online ? 'is-online' : 'is-offline'}`} role="status">
            <span className="dash-welcome__dot" aria-hidden="true" />
            {online ? 'النظام متصل' : 'غير متصل — تُعرض بيانات محلية'}
          </p>
        </div>
        <DataFreshness
          className="dash-welcome__freshness"
          lastSyncedAt={lastSyncAt}
          refreshing={loading || syncing}
          onRefresh={refresh}
        />
      </header>

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
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refresh}>
            إعادة المحاولة
          </Button>
        </div>
      )}

      {stats && (
        <>
          {/* 1) البطاقة الرئيسية: أهم مؤشر + مؤشران ثانويان + أربعة إجراءات */}
          <section className="dash-summary" aria-label="الملخص المالي">
            <article className="dash-summary__hero">
              <header className="dash-summary__head">
                <span className="dash-summary__label">إجمالي المبيعات</span>
                <span className="dash-summary__badge">
                  <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />
                  كل الوقت
                </span>
              </header>
              <p className="dash-summary__value">
                <strong>{balanceVisible ? formatNumber(stats.totalSales) : '••••••'}</strong>
                <button
                  type="button"
                  className="dash-summary__visibility"
                  onClick={() => setBalanceVisible((visible) => !visible)}
                  aria-label={balanceVisible ? 'إخفاء إجمالي المبيعات' : 'إظهار إجمالي المبيعات'}
                  aria-pressed={!balanceVisible}
                  title={balanceVisible ? 'إخفاء المبلغ' : 'إظهار المبلغ'}
                >
                  {balanceVisible
                    ? <Eye className="w-5 h-5" aria-hidden="true" />
                    : <EyeOff className="w-5 h-5" aria-hidden="true" />}
                </button>
                <span>ريال يمني</span>
              </p>
              <p className="dash-summary__hint">
                يحتسب المبيعات المكتملة فقط، وتتحدث المبيعات والعمولة المتبقية مع سجل البيع نفسه.
              </p>

              <dl className="dash-summary__meta">
                <div className="dash-summary__meta-item">
                  <dt><Wallet className="w-4 h-4" aria-hidden="true" /> عمولة الإدارة غير المسوّاة</dt>
                  <dd>{formatNumber(stats.totalCommissionOutstanding || 0)} <small>ريال يمني</small></dd>
                </div>
                <div className="dash-summary__meta-item">
                  <dt><Users className="w-4 h-4" aria-hidden="true" /> عدد الشبكات</dt>
                  <dd>{formatNumber(stats.totalUsers || 0)} <small>شبكة</small></dd>
                </div>
              </dl>

              <nav className="dash-quick" aria-label="إجراءات سريعة">
                <Link to="/users" className="dash-quick__item dash-quick__item--primary">
                  <span className="dash-quick__icon"><UserPlus aria-hidden="true" /></span>
                  <span className="dash-quick__label">إدارة المستخدمين</span>
                </Link>
                <Link to="/sales" className="dash-quick__item">
                  <span className="dash-quick__icon"><CreditCard aria-hidden="true" /></span>
                  <span className="dash-quick__label">المبيعات والعمولات</span>
                </Link>
                <Link to="/notifications" className="dash-quick__item">
                  <span className="dash-quick__icon"><Bell aria-hidden="true" /></span>
                  <span className="dash-quick__label">إرسال إشعار</span>
                </Link>
                <Link to="/template-center" className="dash-quick__item">
                  <span className="dash-quick__icon"><Layers3 aria-hidden="true" /></span>
                  <span className="dash-quick__label">مركز القوالب</span>
                </Link>
              </nav>
            </article>
          </section>

          {/* 2) الخدمات والأقسام: بطاقات موحّدة الحجم */}
          <Section
            className="dash-services-section"
            eyebrow="الوصول السريع"
            title="الخدمات والأقسام"
            aria-label="الخدمات والأقسام"
          >
            <div className="dash-services">
              <Link to="/template-center/inbound" className="dash-service">
                <IconTile icon={ArrowDownToLine} tone="brand" />
                <span className="dash-service__label">قوالب الرسائل الواردة</span>
              </Link>
              <Link to="/template-center/outbound" className="dash-service">
                <IconTile icon={Send} tone="brand" />
                <span className="dash-service__label">الرسائل الصادرة (SMS)</span>
              </Link>
              <Link to="/template-center/wallets" className="dash-service">
                <IconTile icon={Wallet} tone="gold" />
                <span className="dash-service__label">مصادر الرسائل</span>
              </Link>
              <Link to="/template-center/releases" className="dash-service">
                <IconTile icon={Archive} tone="neutral" />
                <span className="dash-service__label">الإصدارات والنشر</span>
              </Link>
              <Link to="/template-center/reconciliation" className="dash-service">
                <IconTile icon={ListChecks} tone="neutral" />
                <span className="dash-service__label">التسوية والعناصر القديمة</span>
              </Link>
              <Link to="/settings" className="dash-service">
                <IconTile icon={Settings} tone="neutral" />
                <span className="dash-service__label">الإعدادات العامة</span>
              </Link>
            </div>
          </Section>

          {/* 3) ملخص ثانوي من بيانات حقيقية: نسبة تسوية عمولة الإدارة */}
          <section className="dash-progress" aria-labelledby="settlement-title">
            <div className="dash-progress__head">
              <div className="dash-progress__heading">
                <p className="dash-progress__eyebrow">الملخص الثانوي</p>
                <h2 className="dash-progress__title" id="settlement-title">تسوية عمولة الإدارة</h2>
              </div>
              {commissionDue > 0 && (
                <span className="dash-progress__percent" aria-hidden="true">{settlementPercent}%</span>
              )}
            </div>
            {commissionDue > 0 ? (
              <>
                <div
                  className="dash-progress__track"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={settlementPercent}
                  aria-valuetext={`${settlementPercent}%`}
                  aria-label="نسبة تسوية عمولة الإدارة"
                >
                  <span className="dash-progress__fill" style={{ width: `${settlementPercent}%` }} />
                </div>
                <p className="dash-progress__caption">
                  المسوّى {formatNumber(commissionSettled)} من {formatNumber(commissionDue)} ريال يمني
                </p>
                <p className="dash-progress__note">
                  المتبقي غير المسوّى {formatNumber(commissionOutstanding)} ريال يمني.
                </p>
              </>
            ) : (
              <p className="dash-progress__caption">لا توجد عمولات مستحقة مسجّلة حتى الآن.</p>
            )}
          </section>

          {/* 4) آخر العمليات: صفوف قابلة للقراءة مع الحالة */}
          <Section
            eyebrow="آخر العمليات"
            title="آخر مبيعات الشبكات"
            action={<Link to="/sales" className="section__link">عرض الكل</Link>}
            aria-label="آخر العمليات"
          >
            {recentOperations.length === 0 ? (
              <Card>
                <EmptyState
                  icon={CreditCard}
                  title="لا توجد عمليات حديثة"
                  description="ستظهر أحدث مبيعات الشبكات هنا تلقائياً بعد مزامنتها."
                />
              </Card>
            ) : (
              <ul className="recent-operations">
                {recentOperations.map((operation, index) => {
                  const status = saleStatusMeta(operation.status);
                  return (
                    <li key={`${operation.networkName}-${operation.id || index}`}>
                      <Link
                        to="/sales"
                        className="recent-operation"
                        aria-label={`${operation.networkName}، ${formatNumber(operation.faceValue)} ريال، ${status.label}`}
                      >
                        <span className="recent-operation__icon"><CreditCard className="w-4 h-4" aria-hidden="true" /></span>
                        <span className="recent-operation__body">
                          <strong>{operation.networkName}</strong>
                          <span>{formatDate(operation.createdAt, { withTime: true })} • {operation.customerId || 'عميل غير محدد'}</span>
                        </span>
                        <span className="recent-operation__end">
                          <span className="recent-operation__amount">{formatNumber(operation.faceValue)} <small>ريال</small></span>
                          <Badge tone={status.tone} dot>{status.label}</Badge>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

        </>
      )}

      {/* أدوات متقدمة: كانت تسبق المحتوى وتدفعه للأسفل؛ أصبحت في نهاية الشاشة وقابلة للطي. */}
      {!aggregateRepairProgress.done && (
        <Card className="dash-maintenance">
          <details open={aggregateRepairProgress.cursor || aggregateRepairProgress.processed > 0 ? true : undefined}>
            <summary className="dash-maintenance__summary">
              <span className="dash-maintenance__summary-main">
                <span className="dash-maintenance__icon" aria-hidden="true"><Wrench className="w-4 h-4" /></span>
                <span>
                  <span className="dash-maintenance__title">أدوات صيانة الملخصات المالية</span>
                  <span className="dash-maintenance__sub">إجراء متقدم يعيد بناء المجاميع من السجلات المخزنة.</span>
                </span>
              </span>
              <ChevronDown className="dash-maintenance__chevron" aria-hidden="true" />
            </summary>
            <div className="dash-maintenance__body">
              <p className="text-sm font-extrabold text-ink">صيانة الملخصات المالية القديمة</p>
              <p className="mt-1 text-xs leading-5 text-muted">تعيد حساب إجمالي المبيعات والعمولات والدفعات من السجلات المخزنة، ثم تحفظ الملخصات في Firestore لتستخدمها الشاشات سريعًا. لا تعدّل سجل البيع نفسه.</p>
              <p className="mt-1 text-xs leading-5 text-warning-ink">قد تستهلك آلاف القراءات حسب حجم الشبكة. انتظر تجدد الحصة اليومية قبل تشغيلها. تتم قراءة السجل التاريخي على صفحات حتى آخر عملية، دون إسقاط السجلات القديمة بصمت.</p>
              {(aggregateRepairProgress.cursor || aggregateRepairProgress.processed > 0) && (
                <p className="mt-1 text-xs font-semibold text-ink-soft">تمت معالجة {formatNumber(aggregateRepairProgress.processed)} شبكة. {aggregateRepairProgress.done ? 'الإصلاح مكتمل.' : 'التقدم محفوظ محليًا؛ اضغط المتابعة لمعالجة شبكة واحدة أخرى.'}</p>
              )}
              <div className="dash-maintenance__actions">
                <Button variant="secondary" size="sm" icon={RefreshCw} loading={rebuildingAggregates} disabled={rebuildingAggregates} onClick={repairFinancialAggregates}>
                  {rebuildingAggregates ? 'جارٍ إصلاح شبكة واحدة…' : aggregateRepairProgress.cursor ? 'متابعة الإصلاح (شبكة واحدة)' : 'إصلاح الملخصات (شبكة واحدة)'}
                </Button>
              </div>
            </div>
          </details>
        </Card>
      )}
      {aggregateRepairProgress.done && (
        <Card className="dash-maintenance dash-maintenance--done">
          <p className="text-sm font-extrabold text-success-ink">اكتملت إعادة بناء المجاميع المالية ({formatNumber(aggregateRepairProgress.processed)} شبكة).</p>
          <p className="mt-1 text-xs text-muted">تم حفظ النتيجة لهذا المتصفح. لا تعِد تشغيل الإجراء إلا إذا كنت تحتاج إلى إعادة بناء جديدة.</p>
        </Card>
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
