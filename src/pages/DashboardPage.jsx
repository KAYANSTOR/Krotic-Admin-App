import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  Activity, AlertTriangle, ArrowUpLeft, Bell, Coins, CreditCard,
  LayoutDashboard, RefreshCw, Settings, ShieldCheck, Sparkles,
  TrendingUp, UserCheck, UserPlus, Users, Wallet,
} from 'lucide-react';
import StatCard from '../components/ui/StatCard';
import IconTile from '../components/ui/IconTile';
import Button from '../components/ui/Button';
import { PageSkeleton } from '../components/ui/Skeleton';
import { formatNumber, formatToday } from '../lib/format';

export default function DashboardPage() {
  const { adminData } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [appStatus, setAppStatus] = useState(null);

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1) إعدادات عامة — نفس الاستعلام الأصلي
      const configDoc = await getDoc(doc(db, 'app_settings', 'global_config'));
      let globalCommission = 5;
      if (configDoc.exists()) {
        const configData = configDoc.data();
        setAppStatus(configData);
        globalCommission = configData.default_commission_rate || 5;
      }

      // 2) المستخدمون — نفس الاستعلام الأصلي
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

      // 3) مبيعات كل شبكة — نفس الاستعلام الأصلي
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
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      setError('تعذر تحميل بيانات لوحة التحكم. تحقق من الاتصال ثم أعد المحاولة.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  if (loading) return <PageSkeleton />;

  const maintenance = appStatus && !appStatus.is_app_active;
  const adminName = (adminData?.name || 'المدير').trim();

  return (
    <div className="dashboard-page">
      {/* ===== ترحيب ===== */}
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
        <div className="dash-hello__date" aria-label="تاريخ اليوم">
          <span>اليوم</span>
          <strong>{formatToday()}</strong>
        </div>
      </section>

      {/* ===== تنبيه الصيانة ===== */}
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

      {/* ===== خطأ ===== */}
      {error && (
        <div className="dash-error" role="alert">
          <span className="dash-error__icon" aria-hidden="true">
            <AlertTriangle className="w-5 h-5" />
          </span>
          <div className="dash-error__body">
            <p className="dash-error__title">حدث خطأ</p>
            <p className="dash-error__msg">{error}</p>
          </div>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={fetchDashboardData}>
            إعادة المحاولة
          </Button>
        </div>
      )}

      {/* ===== KPI ===== */}
      {stats && (
        <>
          <section className="dash-kpi" aria-label="المؤشرات الرئيسية">
            <StatCard
              title="إجمالي المستخدمين"
              value={formatNumber(stats.totalUsers)}
              icon={Users}
              tone="brand"
              iconStart
            />
            <StatCard
              title="المستخدمون النشطون"
              value={formatNumber(stats.activeUsers)}
              icon={UserCheck}
              tone="success"
              iconStart
            />
            <StatCard
              title="حسابات تجريبية"
              value={formatNumber(stats.trialUsers)}
              icon={Activity}
              tone="warning"
              iconStart
            />
            <StatCard
              title="حسابات محظورة"
              value={formatNumber(stats.blockedUsers)}
              icon={AlertTriangle}
              tone="danger"
              iconStart
            />
          </section>

          {/* ===== المالية ===== */}
          <section className="dash-finance" aria-label="الملخص المالي">
            <article className="dash-finance__primary">
              <header className="dash-finance__head">
                <span className="dash-finance__eyebrow">إجمالي المبيعات المكتملة</span>
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
                مجموع قيمة عمليات البيع بحالة «مكتمل» عبر جميع الشبكات.
              </p>
            </article>

            <div className="dash-finance__side">
              <article className="dash-finance__tile dash-finance__tile--gold">
                <span className="dash-finance__tile-icon" aria-hidden="true">
                  <Coins className="w-5 h-5" />
                </span>
                <div>
                  <p className="dash-finance__tile-label">أرباح الإدارة</p>
                  <p className="dash-finance__tile-value">
                    {formatNumber(stats.totalAdminEarnings)}
                    <small> ريال يمني</small>
                  </p>
                </div>
              </article>

              <article className="dash-finance__tile dash-finance__tile--brand">
                <span className="dash-finance__tile-icon" aria-hidden="true">
                  <Wallet className="w-5 h-5" />
                </span>
                <div>
                  <p className="dash-finance__tile-label">عمليات بيع مكتملة</p>
                  <p className="dash-finance__tile-value">
                    {formatNumber(stats.totalTransactions)}
                    <small> عملية</small>
                  </p>
                </div>
              </article>
            </div>
          </section>

          {/* ===== إجراءات سريعة ===== */}
          <section className="dash-section" aria-label="إجراءات سريعة">
            <header className="dash-section__head">
              <div>
                <span className="dash-section__eyebrow">تنقل سريع</span>
                <h2 className="dash-section__title">إجراءات سريعة</h2>
              </div>
            </header>
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
          </section>

          {/* ===== حالة النظام ===== */}
          <section className="dash-section" aria-label="حالة النظام">
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
          </section>
        </>
      )}

      {/* ===== حالة فارغة ===== */}
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
