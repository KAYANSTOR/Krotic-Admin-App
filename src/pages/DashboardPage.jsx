import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  Activity, AlertTriangle, ArrowUpRight, ChevronDown, Coins,
  CreditCard, Phone, Sparkles, UserCheck, UserPlus, Users,
} from 'lucide-react';
import StatCard from '../components/ui/StatCard';
import IconTile from '../components/ui/IconTile';
import { PageSkeleton } from '../components/ui/Skeleton';
import { formatNumber, formatToday } from '../lib/format';

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [appStatus, setAppStatus] = useState(null);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const configDoc = await getDoc(doc(db, 'app_settings', 'global_config'));
      let globalCommission = 5;
      if (configDoc.exists()) {
        const configData = configDoc.data();
        setAppStatus(configData);
        globalCommission = configData.default_commission_rate || 5;
      }

      const usersSnap = await getDocs(collection(db, 'users'));
      const users = [];
      usersSnap.forEach((d) => users.push({ uid: d.id, ...d.data() }));

      const totalUsers = users.length;
      const trialUsers = users.filter((u) => u.is_trial === true).length;
      const activeUsers = users.filter((u) => u.is_active !== false).length;
      const blockedUsers = users.filter((u) => u.is_active === false).length;

      let totalSales = 0;
      let totalAdminEarnings = 0;
      let totalTransactions = 0;

      for (const user of users) {
        const activeRate = (user.commission_rate != null && user.commission_rate > 0)
          ? user.commission_rate
          : globalCommission;

        const salesSnap = await getDocs(collection(db, 'networks', user.uid, 'sales'));
        salesSnap.forEach((saleDoc) => {
          const sale = saleDoc.data();
          if (sale.status === 'COMPLETED') {
            totalTransactions++;
            const faceValue = sale.faceValue || 0;
            totalSales += faceValue;
            totalAdminEarnings += faceValue * (activeRate / 100);
          }
        });
      }

      setStats({
        totalUsers, trialUsers, activeUsers, blockedUsers,
        totalSales, totalAdminEarnings, totalTransactions,
      });
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    }
    setLoading(false);
  };

  if (loading) return <PageSkeleton />;

  const maintenance = appStatus && !appStatus.is_app_active;

  return (
    <div className="dashboard-page">
      <section className="dashboard-intro">
        <div>
          <span className="dashboard-kicker"><Sparkles className="w-4 h-4" /> ملخص لوحة الإدارة</span>
          <h1 className="dashboard-heading">مرحبًا بك في لوحة التحكم</h1>
          <p className="dashboard-subheading">نظرة واضحة وسريعة على نشاط الشبكة وأداء الحسابات.</p>
        </div>
        <div className="dashboard-date-card">
          <span>اليوم</span>
          <strong>{formatToday()}</strong>
        </div>
      </section>

      {maintenance && (
        <div className="dashboard-maintenance" role="status">
          <span className="dashboard-maintenance-icon"><AlertTriangle className="w-5 h-5" /></span>
          <div>
            <p className="font-semibold">التطبيق متوقف حالياً (وضع الصيانة)</p>
            {appStatus.maintenance_message && <p className="mt-1 text-sm">{appStatus.maintenance_message}</p>}
          </div>
        </div>
      )}

      {stats && (
        <>
          <section className="dashboard-overview-grid" aria-label="ملخص الأداء">
            <div className="dashboard-hero-card">
              <div className="dashboard-hero-content">
                <div className="dashboard-hero-topline">
                  <span>إجمالي المبيعات</span>
                  <span className="dashboard-period-pill"><ChevronDown className="w-4 h-4" /> كل الوقت</span>
                </div>
                <div className="dashboard-hero-value">
                  <strong>{formatNumber(stats.totalSales)}</strong>
                  <span>ريال يمني</span>
                </div>
                <p>إجمالي قيمة عمليات البيع المكتملة</p>
              </div>
              <div className="dashboard-hero-secondary">
                <span>أرباح الإدارة</span>
                <strong>{formatNumber(stats.totalAdminEarnings)} <small>ريال يمني</small></strong>
              </div>
              <svg className="dashboard-hero-chart" viewBox="0 0 520 180" fill="none" aria-hidden="true">
                <path d="M-20 154C36 150 46 102 102 116C144 126 143 72 190 86C235 100 240 128 274 91C306 57 317 74 347 46C379 15 409 42 434 20C459 -2 489 20 542 -9" stroke="currentColor" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M-20 154C36 150 46 102 102 116C144 126 143 72 190 86C235 100 240 128 274 91C306 57 317 74 347 46C379 15 409 42 434 20C459 -2 489 20 542 -9" stroke="rgba(255,255,255,0.38)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>

            <div className="dashboard-stat-grid">
              <StatCard title="إجمالي المستخدمين" value={formatNumber(stats.totalUsers)} icon={Users} tone="brand" iconStart />
              <StatCard title="المستخدمون النشطون" value={formatNumber(stats.activeUsers)} icon={UserCheck} tone="success" iconStart />
              <StatCard title="مستخدمون تجريبيون" value={formatNumber(stats.trialUsers)} icon={Activity} tone="warning" iconStart />
              <StatCard title="محظورون" value={formatNumber(stats.blockedUsers)} icon={AlertTriangle} tone="danger" iconStart />
              <StatCard title="عمليات البيع الناجحة" value={formatNumber(stats.totalTransactions)} icon={Coins} tone="gold" iconStart />
            </div>
          </section>

          <section className="dashboard-section">
            <div className="dashboard-section-heading">
              <div>
                <span className="dashboard-section-eyebrow">تنقل أسرع</span>
                <h2>الوصول السريع</h2>
              </div>
              <ArrowUpRight className="w-5 h-5 text-slate-300" aria-hidden="true" />
            </div>
            <div className="dashboard-actions-grid">
              <Link to="/users" className="dashboard-action-card">
                <IconTile icon={UserPlus} tone="brand" />
                <span className="dashboard-action-label">إدارة المستخدمين</span>
                <ArrowUpRight className="dashboard-action-arrow" />
              </Link>
              <Link to="/sales" className="dashboard-action-card">
                <IconTile icon={CreditCard} tone="gold" />
                <span className="dashboard-action-label">متابعة المبيعات</span>
                <ArrowUpRight className="dashboard-action-arrow" />
              </Link>
              <Link to="/settings" className="dashboard-action-card">
                <IconTile icon={Phone} tone="neutral" />
                <span className="dashboard-action-label">إعدادات النظام</span>
                <ArrowUpRight className="dashboard-action-arrow" />
              </Link>
              <Link to="/admins" className="dashboard-action-card">
                <IconTile icon={Users} tone="brand" />
                <span className="dashboard-action-label">إدارة المدراء</span>
                <ArrowUpRight className="dashboard-action-arrow" />
              </Link>
            </div>
          </section>

          <section className="dashboard-lower-grid">
            <div className="dashboard-summary-card">
              <div className="dashboard-section-heading">
                <div>
                  <span className="dashboard-section-eyebrow">نظرة مالية</span>
                  <h2>ملخص الإيرادات</h2>
                </div>
                <Coins className="w-5 h-5 text-primary-500" aria-hidden="true" />
              </div>
              <div className="dashboard-finance-row">
                <div>
                  <span>إجمالي المبيعات</span>
                  <strong>{formatNumber(stats.totalSales)} <small>ريال يمني</small></strong>
                </div>
                <div className="dashboard-finance-divider" />
                <div>
                  <span>أرباح الإدارة</span>
                  <strong>{formatNumber(stats.totalAdminEarnings)} <small>ريال يمني</small></strong>
                </div>
              </div>
            </div>

            <div className="dashboard-summary-card dashboard-status-card">
              <div className="dashboard-section-heading">
                <div>
                  <span className="dashboard-section-eyebrow">المؤشر التشغيلي</span>
                  <h2>حالة التطبيق</h2>
                </div>
                <span className={`dashboard-status-dot ${maintenance ? 'is-warning' : ''}`} />
              </div>
              <div className="dashboard-status-copy">
                <strong>{maintenance ? 'وضع الصيانة مفعّل' : 'التطبيق يعمل بشكل طبيعي'}</strong>
                <span>{formatNumber(stats.totalTransactions)} عملية بيع مكتملة حتى الآن</span>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
