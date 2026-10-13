import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  Activity, AlertTriangle, ArrowUpLeft, Bell, Clock, CreditCard,
  LayoutDashboard, RefreshCw, Settings, ShieldCheck, Sparkles,
  TrendingUp, UserCheck, UserPlus, Users, Wallet,
} from 'lucide-react';
import StatCard from '../components/ui/StatCard';
import IconTile from '../components/ui/IconTile';
import Button from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PageSkeleton } from '../components/ui/Skeleton';
import useAppRefresh from '../lib/useAppRefresh';
import Section from '../components/ui/Section';
import DataFreshness from '../components/ui/DataFreshness';
import BarChart from '../components/ui/BarChart';
import { formatNumber, toDate } from '../lib/format';
import { fetchDashboardStats, getAdminDataCacheState, subscribeAdminDataCache, subscribeNetworkSalesRealtime } from '../lib/adminData';

const MONTH_LABELS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

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

  const totals = networks.reduce((summary, network) => {
    const rate = Number(network.commissionRate) || 0;
    (network.sales || []).forEach((sale) => {
      const faceValue = Number(sale.faceValue) || 0;
      summary.totalSales += faceValue;
      summary.totalTransactions += 1;
      summary.totalCommission += faceValue * rate / 100;

      const date = toDate(sale.createdAt);
      if (!date || Number.isNaN(date.getTime())) return;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const bucket = monthBuckets.get(key);
      if (bucket) {
        bucket.face += faceValue;
        bucket.count += 1;
      }
    });
    return summary;
  }, { totalSales: 0, totalTransactions: 0, totalCommission: 0 });

  return { stats: totals, monthlySales: months };
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
  const [monthlyDataWarning, setMonthlyDataWarning] = useState(false);
  const [partialErrors, setPartialErrors] = useState([]);
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

  useEffect(() => subscribeNetworkSalesRealtime(
    (networks, freshness) => {
      const summary = summarizeRealtimeSales(networks);
      realtimeSummary.current = summary;
      setStats((current) => current ? { ...current, ...summary.stats } : current);
      setMonthlySales(summary.monthlySales);
      setUpdatedAt(Date.now());
      setCacheState((current) => ({
        ...current,
        fromCache: freshness?.fromCache ?? false,
        lastSyncedAt: freshness?.fromCache ? current?.lastSyncedAt : Date.now(),
      }));
    },
    (listenerError, uid) => {
      console.error('Dashboard live sales listener error:', uid, listenerError);
      const message = uid
        ? `تعذر استقبال مبيعات الشبكة ${uid}: ${listenerError.message || listenerError}`
        : `تعذر استقبال تحديثات المبيعات: ${listenerError.message || listenerError}`;
      setPartialErrors((current) => current.includes(message) ? current : [...current, message]);
      setMonthlyDataWarning(true);
    },
    () => {
      salesRealtimeReady.current = true;
      if (dashboardDataReady.current) setLoading(false);
    },
  ), []);

  // السحب للأسفل على الجوال يعيد جلب بيانات اللوحة (force).
  useAppRefresh(() => load({ force: true }));

  if (loading) return <PageSkeleton />;

  const maintenance = appStatus && !appStatus.is_app_active;
  const adminName = (adminData?.name || 'المدير').trim();

  return (
    <div className="dashboard-page">
      <section className="dash-hello" aria-label="ترحيب">
        <div className="dash-hello__main">
          <span className="dash-hello__kicker">
            <Sparkles className="w-4 h-4" aria-hidden="true" />
            لوحة الإدارة
          </span>
          <h1 className="dash-hello__title">أهلاً، {adminName}</h1>
          <p className="dash-hello__sub">
            نظرة سريعة على نشاط الشبكة والمؤشرات الرئيسية.
          </p>
        </div>
        <DataFreshness
          updatedAt={updatedAt}
          lastSyncedAt={cacheState?.lastSyncedAt}
          refreshing={loading}
          fromCache={cacheState?.fromCache}
          onRefresh={() => load({ force: true })}
        />
      </section>


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

      {monthlyDataWarning && (
        <div className="dash-error" role="status" aria-live="polite">
          <span className="dash-error__icon" aria-hidden="true"><AlertTriangle className="w-5 h-5" /></span>
          <div className="dash-error__body">
            <p className="dash-error__title">تفصيل الأشهر غير مكتمل</p>
            <p className="dash-error__msg">الإجماليات الكلية متاحة، لكن تعذر تحميل بيانات الأشهر لبعض الشبكات. تحقّق من اتصال Firestore وفهرس المبيعات المركّب.</p>
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
          <section className="grid-kpi" aria-label="المؤشرات الرئيسية">
            <StatCard title="إجمالي المستخدمين" value={formatNumber(stats.totalUsers)} icon={Users} tone="brand" iconStart />
            <StatCard title="المستخدمون النشطون" value={formatNumber(stats.activeUsers)} icon={UserCheck} tone="success" iconStart />
            <StatCard title="حسابات تجريبية" value={formatNumber(stats.trialUsers)} icon={Activity} tone="warning" iconStart />
            <StatCard title="حسابات محظورة" value={formatNumber(stats.blockedUsers)} icon={AlertTriangle} tone="danger" iconStart />
          </section>

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
                يشمل جميع حالات البيع، وتتحدث الأرقام تلقائياً عند وصول عمليات جديدة.
              </p>
            </article>

            <div className="dash-finance__side">
              <article className="dash-finance__tile dash-finance__tile--brand">
                <span className="dash-finance__tile-icon" aria-hidden="true">
                  <Wallet className="w-5 h-5" />
                </span>
                <div>
                  <p className="dash-finance__tile-label">عدد عمليات البيع</p>
                  <p className="dash-finance__tile-value">
                    {formatNumber(stats.totalTransactions)}
                    <small> عملية</small>
                  </p>
                </div>
              </article>
              <article className="dash-finance__tile dash-finance__tile--gold">
                <span className="dash-finance__tile-icon" aria-hidden="true">
                  <CreditCard className="w-5 h-5" />
                </span>
                <div>
                  <p className="dash-finance__tile-label">إجمالي العمولة</p>
                  <p className="dash-finance__tile-value">
                    {formatNumber(stats.totalCommission)}
                    <small> ريال يمني</small>
                  </p>
                </div>
              </article>
            </div>
          </section>

          <Section
            eyebrow="الاتجاه"
            title="إجمالي المبيعات في آخر 6 أشهر"
            description="إجمالي القيم وعدد العمليات لجميع حالات البيع، مع تحديث مباشر."
            aria-label="مخطط المبيعات"
          >
            <Card>
              <BarChart
                data={monthlySales.map((month) => ({
                  label: month.label,
                  value: Math.round(month.face),
                  hint: `${month.label}: ${formatNumber(month.face)} ريال • ${formatNumber(month.count)} عملية`,
                }))}
                valueFormatter={formatNumber}
              />
            </Card>
          </Section>

          {alerts && (alerts.expiredUsers > 0 || alerts.expiringSoonUsers > 0) && (
            <Section
              eyebrow="تحتاج انتباهك"
              title="تنبيهات ذكية"
              description={`مبنية على تواريخ الاشتراك ونافذة التحذير (${alerts.warningDays} أيام).`}
              aria-label="تنبيهات"
            >
              <div className="alert-grid">
                {alerts.expiredUsers > 0 && (
                  <Link to="/users?filter=expired" className="alert-card alert-card--danger">
                    <span className="alert-card__icon" aria-hidden="true"><AlertTriangle className="w-5 h-5" /></span>
                    <span className="alert-card__body">
                      <span className="alert-card__value">{formatNumber(alerts.expiredUsers)}</span>
                      <span className="alert-card__label">اشتراك منتهي</span>
                    </span>
                    <ArrowUpLeft className="alert-card__arrow" aria-hidden="true" />
                  </Link>
                )}
                {alerts.expiringSoonUsers > 0 && (
                  <Link to="/users?filter=expiring" className="alert-card alert-card--warning">
                    <span className="alert-card__icon" aria-hidden="true"><Clock className="w-5 h-5" /></span>
                    <span className="alert-card__body">
                      <span className="alert-card__value">{formatNumber(alerts.expiringSoonUsers)}</span>
                      <span className="alert-card__label">ينتهي خلال {alerts.warningDays} أيام</span>
                    </span>
                    <ArrowUpLeft className="alert-card__arrow" aria-hidden="true" />
                  </Link>
                )}
                {alerts.trialExpiringSoonUsers > 0 && (
                  <Link to="/users?filter=expiring" className="alert-card alert-card--brand">
                    <span className="alert-card__icon" aria-hidden="true"><Activity className="w-5 h-5" /></span>
                    <span className="alert-card__body">
                      <span className="alert-card__value">{formatNumber(alerts.trialExpiringSoonUsers)}</span>
                      <span className="alert-card__label">تجريبي ينتهي قريباً</span>
                    </span>
                    <ArrowUpLeft className="alert-card__arrow" aria-hidden="true" />
                  </Link>
                )}
              </div>
            </Section>
          )}

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
              <Link to="/settings" className="dash-action">
                <IconTile icon={Settings} tone="neutral" />
                <span className="dash-action__label">الإعدادات العامة</span>
                <ArrowUpLeft className="dash-action__arrow" aria-hidden="true" />
              </Link>
              <Link to="/admins" className="dash-action">
                <IconTile icon={ShieldCheck} tone="success" />
                <span className="dash-action__label">إدارة المدراء</span>
                <ArrowUpLeft className="dash-action__arrow" aria-hidden="true" />
              </Link>
            </div>
          </Section>

          <Section title="حالة النظام" aria-label="حالة النظام">
            <article className="dash-status">
              <div className="dash-status__main">
                <span
                  className={`dash-status__dot ${maintenance ? 'is-warning' : 'is-ok'}`}
                  aria-hidden="true"
                />
                <div>
                  <p className="dash-status__title">
                    {maintenance ? 'وضع الصيانة مفعّل' : 'التطبيق يعمل بشكل طبيعي'}
                  </p>
                  <p className="dash-status__sub">
                    {maintenance
                      ? 'المستخدمون يرون رسالة الصيانة عند فتح التطبيق.'
                      : 'لا توجد أعطال معلنة، وجميع الخدمات متاحة.'}
                  </p>
                </div>
              </div>
              <Link to="/settings" className="dash-status__link">
                <LayoutDashboard className="w-4 h-4" aria-hidden="true" />
                إدارة الحالة
              </Link>
            </article>
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
