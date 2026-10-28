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

  const commissionDue = Math.max(0, Number(stats?.totalCommissionDue) || 0);
  const commissionOutstanding = Math.max(0, Number(stats?.totalCommissionOutstanding) || 0);
  const commissionSettled = Math.max(0, commissionDue - commissionOutstanding);
  const settlementPercent = commissionDue > 0
    ? Math.min(100, Math.round((commissionSettled / commissionDue) * 100))
    : 0;

  const statusNotices = [];
  if (maintenance) {
    statusNotices.push({
      key: 'maintenance',
      tone: 'warning',
      title: 'التطبيق في وضع الصيانة',
      msg: appStatus?.maintenance_message || null,
    });
  }
  if (!salesSnapshotsReady && stats) {
    statusNotices.push({
      key: 'syncing',
      tone: 'info',
      title: 'جارٍ مزامنة المؤشرات المالية',
      msg: null,
    });
  }
  if (realtimeDataWarning) {
    statusNotices.push({
      key: 'sales-warn',
      tone: 'warning',
      title: 'تعذر مزامنة بعض تحديثات المبيعات',
      msg: partialErrors.length ? null : 'تحقق من الاتصال قبل أي تسوية مالية.',
      details: partialErrors,
    });
  }
  if (monthlyDataWarning) {
    statusNotices.push({
      key: 'monthly',
      tone: 'warning',
      title: 'تفصيل الأشهر غير مكتمل',
      msg: 'الإجماليات محفوظة؛ التفصيل الشهري يُستعاد من السجلات.',
      details: partialErrors,
    });
  }

  void alerts;
  void monthlySales;
  void summarizeRealtimeSales;

  return (
    <div className="dashboard-page">
      <header className="dash-welcome" aria-label="ترحيب">
        <span className="dash-welcome__avatar" aria-hidden="true">{adminInitial}</span>
        <div className="dash-welcome__identity">
          <h1 className="dash-welcome__title">أهلاً، {adminName}</h1>
          <p className={`dash-welcome__status ${online ? 'is-online' : 'is-offline'}`} role="status">
            <span className="dash-welcome__dot" aria-hidden="true" />
            {online ? 'متصل' : 'عرض محلي — بدون اتصال'}
          </p>
        </div>
        <DataFreshness
          className="dash-welcome__freshness"
          lastSyncedAt={lastSyncAt}
          refreshing={loading || syncing}
          onRefresh={refresh}
        />
      </header>

      {statusNotices.length > 0 && (
        <div className="dash-notices" role="status" aria-live="polite">
          {statusNotices.map((notice) => (
            <div key={notice.key} className={`dash-notice dash-notice--${notice.tone}`}>
              <AlertTriangle className="dash-notice__icon" aria-hidden="true" />
              <div className="dash-notice__body">
                <p className="dash-notice__title">{notice.title}</p>
                {notice.msg && <p className="dash-notice__msg">{notice.msg}</p>}
                {notice.details?.length > 0 && (
                  <details className="dash-error__details">
                    <summary>التفاصيل ({notice.details.length})</summary>
                    <ul>
                      {notice.details.map((message, index) => (
                        <li key={index} dir="ltr">{message}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          ))}
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

              <dl className="dash-summary__meta">
                <div className="dash-summary__meta-item">
                  <dt><Wallet className="w-4 h-4" aria-hidden="true" /> عمولة غير مسوّاة</dt>
                  <dd>{formatNumber(stats.totalCommissionOutstanding || 0)} <small>ريال</small></dd>
                </div>
                <div className="dash-summary__meta-item">
                  <dt><Users className="w-4 h-4" aria-hidden="true" /> الشبكات</dt>
                  <dd>{formatNumber(stats.totalUsers || 0)}</dd>
                </div>
              </dl>

              <nav className="dash-quick" aria-label="إجراءات سريعة">
                <Link to="/users" className="dash-quick__item dash-quick__item--primary">
                  <span className="dash-quick__icon"><UserPlus aria-hidden="true" /></span>
                  <span className="dash-quick__label">المستخدمون</span>
                </Link>
                <Link to="/sales" className="dash-quick__item">
                  <span className="dash-quick__icon"><CreditCard aria-hidden="true" /></span>
                  <span className="dash-quick__label">المبيعات</span>
                </Link>
                <Link to="/notifications" className="dash-quick__item">
                  <span className="dash-quick__icon"><Bell aria-hidden="true" /></span>
                  <span className="dash-quick__label">إشعار</span>
                </Link>
                <Link to="/template-center" className="dash-quick__item">
                  <span className="dash-quick__icon"><Layers3 aria-hidden="true" /></span>
                  <span className="dash-quick__label">القوالب</span>
                </Link>
              </nav>
            </article>
          </section>

          <Section
            className="dash-services-section"
            title="مركز القوالب"
            aria-label="مركز القوالب"
          >
            <div className="dash-services">
              <Link to="/template-center/inbound" className="dash-service">
                <IconTile icon={ArrowDownToLine} tone="brand" />
                <span className="dash-service__label">الواردة</span>
              </Link>
              <Link to="/template-center/outbound" className="dash-service">
                <IconTile icon={Send} tone="brand" />
                <span className="dash-service__label">الصادرة</span>
              </Link>
              <Link to="/template-center/wallets" className="dash-service">
                <IconTile icon={Wallet} tone="gold" />
                <span className="dash-service__label">المصادر</span>
              </Link>
              <Link to="/template-center/releases" className="dash-service">
                <IconTile icon={Archive} tone="neutral" />
                <span className="dash-service__label">الإصدارات</span>
              </Link>
              <Link to="/template-center/reconciliation" className="dash-service">
                <IconTile icon={ListChecks} tone="neutral" />
                <span className="dash-service__label">التسوية</span>
              </Link>
              <Link to="/settings" className="dash-service">
                <IconTile icon={Settings} tone="neutral" />
                <span className="dash-service__label">الإعدادات</span>
              </Link>
            </div>
          </Section>

          <section className="dash-progress" aria-labelledby="settlement-title">
            <div className="dash-progress__head">
              <h2 className="dash-progress__title" id="settlement-title">تسوية عمولة الإدارة</h2>
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
                  المسوّى {formatNumber(commissionSettled)} من {formatNumber(commissionDue)} ريال
                  {commissionOutstanding > 0 && (
                    <> · متبقي {formatNumber(commissionOutstanding)}</>
                  )}
                </p>
              </>
            ) : (
              <p className="dash-progress__caption">لا توجد عمولات مستحقة مسجّلة حتى الآن.</p>
            )}
          </section>

          <Section
            title="آخر المبيعات"
            action={<Link to="/sales" className="section__link">عرض الكل</Link>}
            aria-label="آخر العمليات"
          >
            {recentOperations.length === 0 ? (
              <Card>
                <EmptyState
                  icon={CreditCard}
                  title="لا توجد عمليات حديثة"
                  description="ستظهر هنا بعد مزامنة المبيعات."
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
                          <span>{formatDate(operation.createdAt, { withTime: true })}</span>
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

      {!aggregateRepairProgress.done && (
        <Card className="dash-maintenance">
          <details open={aggregateRepairProgress.cursor || aggregateRepairProgress.processed > 0 ? true : undefined}>
            <summary className="dash-maintenance__summary">
              <span className="dash-maintenance__summary-main">
                <span className="dash-maintenance__icon" aria-hidden="true"><Wrench className="w-4 h-4" /></span>
                <span>
                  <span className="dash-maintenance__title">صيانة الملخصات المالية</span>
                  <span className="dash-maintenance__sub">إعادة بناء المجاميع من السجلات — استهلاك قراءات عالٍ</span>
                </span>
              </span>
              <ChevronDown className="dash-maintenance__chevron" aria-hidden="true" />
            </summary>
            <div className="dash-maintenance__body">
              {(aggregateRepairProgress.cursor || aggregateRepairProgress.processed > 0) && (
                <p className="text-xs font-semibold text-ink-soft mb-2">
                  تمت معالجة {formatNumber(aggregateRepairProgress.processed)} شبكة
                  {aggregateRepairProgress.done ? ' — مكتمل.' : ' — اضغط للمتابعة.'}
                </p>
              )}
              <div className="dash-maintenance__actions">
                <Button variant="secondary" size="sm" icon={RefreshCw} loading={rebuildingAggregates} disabled={rebuildingAggregates} onClick={repairFinancialAggregates}>
                  {rebuildingAggregates ? 'جارٍ الإصلاح…' : aggregateRepairProgress.cursor ? 'متابعة (شبكة واحدة)' : 'إصلاح شبكة واحدة'}
                </Button>
              </div>
            </div>
          </details>
        </Card>
      )}
      {aggregateRepairProgress.done && (
        <Card className="dash-maintenance dash-maintenance--done">
          <p className="text-sm font-extrabold text-success-ink">
            اكتملت إعادة بناء المجاميع ({formatNumber(aggregateRepairProgress.processed)} شبكة).
          </p>
        </Card>
      )}

      {!stats && !error && (
        <div className="dash-empty" role="status">
          <span className="dash-empty__icon" aria-hidden="true">
            <Users className="w-6 h-6" />
          </span>
          <p className="dash-empty__title">لا توجد بيانات بعد</p>
          <p className="dash-empty__desc">لم يُسجَّل مستخدمون أو مبيعات حتى الآن.</p>
        </div>
      )}
    </div>
  );
}
