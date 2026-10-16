import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowRight, DollarSign, CalendarPlus, Edit, KeyRound, Ban,
  UserCheck, CheckCircle, RefreshCw, Inbox, Wallet, Users,
  Trash2, ChevronDown, ChevronUp, Calendar, Receipt, Send, Sparkles,
} from 'lucide-react';
import toast from 'react-hot-toast';
import PageHero from '../components/ui/PageHero';
import Section from '../components/ui/Section';
import { Card } from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import StatCard from '../components/ui/StatCard';
import DataFreshness from '../components/ui/DataFreshness';
import { SkeletonPageHeader, SkeletonTable } from '../components/ui/Skeleton';
import UserEditModal from '../components/UserEditModal';
import UserBillingModal from '../components/UserBillingModal';
import UserAuthModal from '../components/UserAuthModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { formatNumber, formatDate, isExpired } from '../lib/format';
import { saleCommission, saleOutstanding, sumOutstanding } from '../lib/commission';
import { getCurrentMonthKey, monthKeyFromDate } from '../lib/billingHelpers';
import {
  fetchUsersWithBilling, fetchUserBillingHistory, invalidateAdminUserData, subscribeNetworkSalesRealtime,
} from '../lib/adminData';
import { renewNetwork, updateNetworkAccess, deleteNetworkAccount, adminApiError } from '../lib/adminApi';
import { logAdminAction, AUDIT_ACTIONS } from '../lib/auditLog';

const accessLabel = {
  TRIAL: { text: 'تجريبي', tone: 'warning' },
  ACTIVE_PAID: { text: 'رسمي', tone: 'success' },
  SUSPENDED_GRACE: { text: 'موقوف', tone: 'danger' },
  LOCKED_EXPIRED: { text: 'منتهي', tone: 'danger' },
};

function formatMonthArabic(monthKey) {
  if (!monthKey || !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) return monthKey || '';
  const [year, month] = monthKey.split('-').map(Number);
  const monthNames = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];
  return `${monthNames[month - 1]} ${year}`;
}

export default function UserProfilePage() {
  const { uid } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [history, setHistory] = useState({ sales: [], payments: [] });
  const [historyMonth, setHistoryMonth] = useState(() => getCurrentMonthKey());
  const [selectedMonthForBilling, setSelectedMonthForBilling] = useState(null);
  const [expandedMonths, setExpandedMonths] = useState(() => new Set([getCurrentMonthKey()]));
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [editing, setEditing] = useState(false);
  const [billing, setBilling] = useState(false);
  const [authModal, setAuthModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [liveSalesError, setLiveSalesError] = useState('');
  const liveSalesSnapshotVersion = useRef(0);

  const load = useCallback(async ({ force = false } = {}) => {
    const salesVersionAtStart = liveSalesSnapshotVersion.current;
    setLoading(true);
    try {
      const { users = [] } = await fetchUsersWithBilling({ force });
      setUser(users.find((item) => item.uid === uid) || null);
      const billingHistory = await fetchUserBillingHistory(uid, { force });
      setHistory((previous) => ({
        sales: liveSalesSnapshotVersion.current !== salesVersionAtStart
          ? previous.sales
          : (billingHistory.sales || []),
        payments: billingHistory.payments || [],
      }));
      setUpdatedAt(Date.now());
    } catch (error) {
      console.error('profile load failed', error);
      toast.error('تعذر تحميل ملف العميل');
    }
    setLoading(false);
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const unsubscribe = subscribeNetworkSalesRealtime(
      (networks) => {
        const network = networks.find((item) => item.uid === uid);
        if (!network) return;
        liveSalesSnapshotVersion.current += 1;
        setHistory((previous) => ({
          ...previous,
          sales: (network.sales || []).filter((sale) => sale.status === 'COMPLETED'),
        }));
        setUpdatedAt(Date.now());
        setLiveSalesError('');
      },
      (error, failedUid) => {
        if (failedUid === uid || !failedUid) setLiveSalesError(error?.message || String(error));
      },
      () => {},
    );
    return unsubscribe;
  }, [uid]);

  const allSales = history.sales || [];
  const allPayments = history.payments || [];
  const monthOptions = [...new Set([
    getCurrentMonthKey(),
    ...allSales.map((sale) => monthKeyFromDate(sale.createdAt)),
    ...allPayments.map((payment) => (
      /^\d{4}-(0[1-9]|1[0-2])$/.test(payment.month || '')
        ? payment.month
        : monthKeyFromDate(payment.timestamp ?? payment.createdAt)
    )),
  ].filter(Boolean))].sort((a, b) => b.localeCompare(a));

  const sales = historyMonth === 'all'
    ? allSales
    : allSales.filter((sale) => monthKeyFromDate(sale.createdAt) === historyMonth);
  const payments = historyMonth === 'all'
    ? allPayments
    : allPayments.filter((payment) => (
      /^\d{4}-(0[1-9]|1[0-2])$/.test(payment.month || '')
        ? payment.month
        : monthKeyFromDate(payment.timestamp ?? payment.createdAt)
    ) === historyMonth);

  const commissionDue = sales.reduce((sum, sale) => sum + (saleCommission(sale) || 0), 0);
  const totalPaid = payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  const outstanding = sumOutstanding(sales);
  const totalSales = sales.reduce((sum, sale) => sum + (Number(sale.faceValue) || 0), 0);

  // تفصيل الأشهر والعمولات لكل شهر مع إمكانية التوسيع وعرض العمليات
  const monthlyBreakdown = useMemo(() => {
    const buckets = {};
    monthOptions.forEach((mKey) => {
      if (mKey === 'all') return;
      buckets[mKey] = {
        month: mKey,
        sales: [],
        payments: [],
        totalSales: 0,
        commissionDue: 0,
        totalPaid: 0,
        outstanding: 0,
      };
    });

    allSales.forEach((sale) => {
      const mKey = monthKeyFromDate(sale.createdAt);
      if (!mKey) return;
      if (!buckets[mKey]) {
        buckets[mKey] = {
          month: mKey,
          sales: [],
          payments: [],
          totalSales: 0,
          commissionDue: 0,
          totalPaid: 0,
          outstanding: 0,
        };
      }
      buckets[mKey].sales.push(sale);
      buckets[mKey].totalSales += Number(sale.faceValue) || 0;
      const comm = saleCommission(sale) || 0;
      buckets[mKey].commissionDue += comm;
      buckets[mKey].outstanding += (saleOutstanding(sale) ?? comm);
    });

    allPayments.forEach((pmt) => {
      const mKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(pmt.month || '')
        ? pmt.month
        : monthKeyFromDate(pmt.timestamp ?? pmt.createdAt);
      if (!mKey) return;
      if (!buckets[mKey]) {
        buckets[mKey] = {
          month: mKey,
          sales: [],
          payments: [],
          totalSales: 0,
          commissionDue: 0,
          totalPaid: 0,
          outstanding: 0,
        };
      }
      buckets[mKey].payments.push(pmt);
      buckets[mKey].totalPaid += Number(pmt.amount) || 0;
    });

    return Object.values(buckets).sort((a, b) => b.month.localeCompare(a.month));
  }, [allSales, allPayments, monthOptions]);

  const toggleMonthExpand = (mKey) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(mKey)) next.delete(mKey);
      else next.add(mKey);
      return next;
    });
  };

  const handleOpenBillingForMonth = (mKey) => {
    setSelectedMonthForBilling(mKey);
    setBilling(true);
  };

  const applyAccess = (patch, { successMessage, auditAction, details }) => {
    setConfirmAction({
      title: 'تأكيد الإجراء',
      message: 'سيُنفَّذ هذا الإجراء على الخادم ويُسجَّل في سجل العمليات. هل أنت متأكد؟',
      variant: 'danger',
      action: async () => {
        const result = await updateNetworkAccess({ uid, ...patch });
        if (!result.ok) { toast.error(adminApiError(result.error, 'تعذر تنفيذ الإجراء')); return false; }
        invalidateAdminUserData(uid);
        await logAdminAction({ action: auditAction, targetType: 'user', targetId: uid, targetLabel: user?.networkName || uid, details });
        toast.success(successMessage);
        load({ force: true });
      },
    });
  };

  const handleRenew = () => {
    setConfirmAction({
      title: 'تجديد سريع',
      message: 'سيتم تمديد الوصول 30 يوماً عبر الخادم. هل أنت متأكد؟',
      variant: 'success',
      action: async () => {
        const result = await renewNetwork(uid, 30);
        if (!result.ok) { toast.error(adminApiError(result.error, 'تعذر التجديد')); return false; }
        invalidateAdminUserData(uid);
        await logAdminAction({ action: AUDIT_ACTIONS.USER_RENEW, targetType: 'user', targetId: uid, targetLabel: user?.networkName || uid });
        toast.success('تم التجديد بنجاح');
        load({ force: true });
      },
    });
  };

  const handleDelete = () => {
    const targetName = user?.networkName || user?.network_name || user?.phone || uid;
    setConfirmAction({
      title: 'حذف حساب المشترك والشبكة',
      message: `هل أنت متأكد من حذف الحساب «${targetName}»؟ سيتم حذف جميع بيانات المشترك والشبكة وسجلاتها نهائياً ولا يمكن التراجع عن هذا الإجراء.`,
      variant: 'danger',
      action: async () => {
        const result = await deleteNetworkAccount(uid);
        if (!result.ok) {
          toast.error(adminApiError(result.error, 'تعذر حذف الحساب'));
          return false;
        }
        await logAdminAction({
          action: AUDIT_ACTIONS.USER_DELETE,
          targetType: 'user',
          targetId: uid,
          targetLabel: targetName,
          details: { networkId: user?.networkId || null },
        }).catch(() => {});
        toast.success(`تم حذف الحساب «${targetName}» بنجاح`);
        invalidateAdminUserData(uid);
        navigate('/users');
        return true;
      },
    });
  };

  if (loading) {
    return (
      <div className="users-page">
        <SkeletonPageHeader />
        <Card flush><SkeletonTable rows={6} /></Card>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="users-page">
        <PageHero icon={Users} title="ملف العميل" subtitle="لم يتم العثور على هذا الحساب." />
        <Card><Link to="/users" className="btn btn--secondary">رجوع إلى المستخدمين</Link></Card>
      </div>
    );
  }

  const status = accessLabel[user.accessStatus] || (user.is_trial ? accessLabel.TRIAL : accessLabel.ACTIVE_PAID);
  const expired = isExpired(user.subscription_end_date);

  return (
    <div className="users-page pb-12">
      <PageHero
        icon={Users}
        kicker="ملف العميل"
        title={user.networkName || uid}
        subtitle={`${user.phoneNumber || '—'} • ${user.networkId || uid}`}
        meta={`${sales.length} عملية بيع • ${payments.length} دفعة • ${historyMonth === 'all' ? 'كل الأشهر' : historyMonth}`}
        actions={
          <>
            <DataFreshness updatedAt={updatedAt} refreshing={loading} onRefresh={() => load({ force: true })} />
            <Button variant="secondary" icon={ArrowRight} onClick={() => navigate('/users')}>رجوع</Button>
          </>
        }
      />

      {liveSalesError && (
        <div className="users-error users-error--warning mb-4" role="status" aria-live="polite">
          تعذّر تحديث سجل المبيعات مباشرة؛ يُعرض آخر سجل متاح. حدّث الصفحة بعد التحقق من الاتصال.
        </div>
      )}

      {/* بطاقة الحساب والإجراءات السريعة */}
      <Section
        eyebrow="الحساب"
        title="تفاصيل وإجراءات سريعة"
        action={
          <div className="flex items-center gap-2">
            <Badge tone={status.tone}>{status.text}</Badge>
            {user.is_active === false && <Badge tone="danger">محظور</Badge>}
          </div>
        }
      >
        <Card>
          <dl className="user-card__meta" style={{ background: 'transparent', border: 0, padding: 0 }}>
            <div className="user-card__meta-item">
              <dt>النسبة المضبوطة حالياً</dt>
              <dd><span className="num font-bold">{user.commission_rate != null && user.commission_rate !== '' ? `${user.commission_rate}% (خاصة)` : 'عامة'}</span></dd>
            </div>
            <div className="user-card__meta-item">
              <dt>تاريخ التصفية</dt>
              <dd className={expired ? 'text-danger font-bold' : 'font-semibold'}>{formatDate(user.subscription_end_date)}</dd>
            </div>
            <div className="user-card__meta-item">
              <dt>معرّف الشبكة</dt>
              <dd dir="ltr" className="font-mono">{user.networkId || uid}</dd>
            </div>
            <div className="user-card__meta-item">
              <dt>رقم الهاتف</dt>
              <dd dir="ltr" className="font-mono font-bold text-brand">{user.phoneNumber || '—'}</dd>
            </div>
          </dl>

          <div className="user-card__actions" style={{ marginTop: '1rem' }}>
            <button
              type="button"
              onClick={() => { setSelectedMonthForBilling(getCurrentMonthKey()); setBilling(true); }}
              className="row-action row-action--success"
              aria-label="الفوترة والتسويات"
            >
              <DollarSign className="w-4 h-4 text-emerald-600" />
              <span className="text-xs font-bold">تسوية وعمولة</span>
            </button>
            <button type="button" onClick={handleRenew} className="row-action row-action--brand" title="تجديد" aria-label="تجديد الاشتراك">
              <CalendarPlus className="w-4 h-4 text-brand" />
              <span>تجديد</span>
            </button>
            <button type="button" onClick={() => setEditing(true)} className="row-action row-action--neutral" title="تعديل" aria-label="تعديل إعدادات المستخدم">
              <Edit className="w-4 h-4" />
              <span>تعديل</span>
            </button>
            <button type="button" onClick={() => setAuthModal(true)} className="row-action row-action--neutral" title="بيانات الدخول" aria-label="بيانات الدخول">
              <KeyRound className="w-4 h-4" />
              <span>الدخول</span>
            </button>
            {user.is_trial && (
              <button
                onClick={() => applyAccess({ accessStatus: 'ACTIVE_PAID' }, { successMessage: 'تم تحويل المستخدم إلى رسمي', auditAction: AUDIT_ACTIONS.USER_MAKE_OFFICIAL })}
                type="button"
                className="row-action row-action--brand-soft"
                title="تحويل لرسمي"
                aria-label="تحويل المستخدم إلى رسمي"
              >
                <CheckCircle className="w-4 h-4 text-brand" />
                <span>رسمي</span>
              </button>
            )}
            <button
              onClick={() => applyAccess(
                { accessStatus: user.is_active === false ? 'ACTIVE_PAID' : 'SUSPENDED_GRACE' },
                { successMessage: user.is_active === false ? 'تم إلغاء الحظر' : 'تم الحظر', auditAction: user.is_active === false ? AUDIT_ACTIONS.USER_ACTIVATE : AUDIT_ACTIONS.USER_BLOCK },
              )}
              type="button"
              className={`row-action ${user.is_active === false ? 'row-action--success' : 'row-action--danger'}`}
              title={user.is_active === false ? 'إلغاء الحظر' : 'حظر'}
              aria-label={user.is_active === false ? 'إلغاء حظر المستخدم' : 'حظر المستخدم'}
            >
              {user.is_active === false ? <UserCheck className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
              <span>{user.is_active === false ? "رفع الحظر" : "حظر"}</span>
            </button>
            <button
              onClick={handleDelete}
              type="button"
              className="row-action row-action--danger"
              title="حذف الحساب نهائياً"
              aria-label="حذف الحساب نهائياً"
            >
              <Trash2 className="w-4 h-4 text-danger" />
              <span>حذف الحساب</span>
            </button>
          </div>
        </Card>
      </Section>

      {/* المؤشرات المالية العامة للعميل */}
      <div className="grid-kpi my-4">
        <StatCard title="إجمالي المبيعات" value={formatNumber(totalSales)} icon={DollarSign} tone="brand" subtitle={historyMonth === "all" ? "كل الأشهر • ريال يمني" : historyMonth} />
        <StatCard title="العمولة المستحقة" value={formatNumber(commissionDue)} icon={Wallet} tone="warning" subtitle={historyMonth === "all" ? "كل العمولات" : "عمولة الشهر المحدد"} />
        <StatCard title="غير المسوّاة" value={formatNumber(outstanding)} icon={Wallet} tone="success" subtitle={historyMonth === "all" ? "المتبقي على العميل" : "المتبقي في الشهر المحدد"} />
        <StatCard title="المسدّد" value={formatNumber(totalPaid)} icon={DollarSign} tone="neutral" subtitle={historyMonth === "all" ? "إجمالي الدفعات" : "دفعات الشهر المحدد"} />
      </div>

      {/* تفصيل الشهور والعمولات مع التوسيع وعرض عمليات كل شهر (ميزة مطلوبة خصيصاً) */}
      <Section
        eyebrow="الشهور والتسويات"
        title="تفاصيل الشهور والعمولات والمبيعات"
        description="اضغط على كرت أي شهر لعرض عملياته وتفاصيل مبيعاته وعمولته وإمكانية تسويته فوراً."
      >
        {monthlyBreakdown.length === 0 ? (
          <Card>
            <div className="empty-state">
              <span className="empty-state__icon icon-tile icon-tile--neutral icon-tile--lg"><Inbox className="w-6 h-6" /></span>
              <p className="empty-state__title">لا توجد حركات مسجلة</p>
              <p className="empty-state__desc">ستظهر الشهور والعمولات هنا بمجرد وصول أول عملية بيع من الشبكة.</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {monthlyBreakdown.map((m) => {
              const isExpanded = expandedMonths.has(m.month);
              const remaining = Math.max(0, m.commissionDue - m.totalPaid);
              const isFullySettled = m.commissionDue > 0 && m.totalPaid >= m.commissionDue;
              const isPartiallySettled = m.totalPaid > 0 && m.totalPaid < m.commissionDue;

              return (
                <div
                  key={m.month}
                  className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
                    isExpanded
                      ? 'bg-surface border-brand shadow-sm ring-1 ring-brand/20'
                      : 'bg-surface border-line hover:border-brand/40 hover:shadow-xs'
                  }`}
                >
                  {/* شريط رأس كرت الشهر القابل للنقر للتوسيع */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleMonthExpand(m.month)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleMonthExpand(m.month);
                      }
                    }}
                    className="p-4 cursor-pointer select-none"
                    aria-expanded={isExpanded}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                          isFullySettled
                            ? 'bg-emerald-500/10 text-emerald-600'
                            : isPartiallySettled
                            ? 'bg-amber-500/10 text-amber-600'
                            : 'bg-brand/10 text-brand'
                        }`}>
                          <Calendar className="w-4 h-4" />
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-black text-sm text-ink">{formatMonthArabic(m.month)}</h3>
                            <span className="text-[10px] text-muted font-mono" dir="ltr">({m.month})</span>
                          </div>
                          <p className="text-[11px] text-muted mt-0.5">
                            {m.sales.length} عملية بيع • {m.payments.length} دفعات مسجلة
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Badge
                          tone={
                            isFullySettled
                              ? 'success'
                              : isPartiallySettled
                              ? 'warning'
                              : m.commissionDue > 0
                              ? 'danger'
                              : 'neutral'
                          }
                        >
                          {isFullySettled
                            ? 'مسواة بالكامل'
                            : isPartiallySettled
                            ? 'مسواة جزئياً'
                            : m.commissionDue > 0
                            ? 'بانتظار التسوية'
                            : 'لا توجد عمولة'}
                        </Badge>
                        <span className="p-1 text-muted hover:text-ink">
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </span>
                      </div>
                    </div>

                    {/* شبكة الأرقام السريعة الخاصة بهذا الشهر */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-3 border-t border-line/60">
                      <div className="bg-surface-sunken p-2.5 rounded-xl border border-line/40">
                        <span className="text-[10px] text-muted block font-medium">مبيعات الشهر</span>
                        <span className="text-xs sm:text-sm font-black font-mono text-ink">
                          {formatNumber(m.totalSales)} <small className="text-[10px] font-normal text-muted">ر.ي</small>
                        </span>
                      </div>
                      <div className="bg-amber-500/5 p-2.5 rounded-xl border border-amber-500/20">
                        <span className="text-[10px] text-amber-700 dark:text-amber-300 block font-bold">العمولة المستحقة</span>
                        <span className="text-xs sm:text-sm font-black font-mono text-amber-600 dark:text-amber-400">
                          {formatNumber(m.commissionDue)} <small className="text-[10px] font-normal text-muted">ر.ي</small>
                        </span>
                      </div>
                      <div className="bg-emerald-500/5 p-2.5 rounded-xl border border-emerald-500/20">
                        <span className="text-[10px] text-emerald-700 dark:text-emerald-300 block font-bold">المسدد</span>
                        <span className="text-xs sm:text-sm font-black font-mono text-emerald-600 dark:text-emerald-400">
                          {formatNumber(m.totalPaid)} <small className="text-[10px] font-normal text-muted">ر.ي</small>
                        </span>
                      </div>
                      <div className="bg-rose-500/5 p-2.5 rounded-xl border border-rose-500/20">
                        <span className="text-[10px] text-rose-700 dark:text-rose-300 block font-bold">المتبقي</span>
                        <span className="text-xs sm:text-sm font-black font-mono text-rose-600 dark:text-rose-400">
                          {formatNumber(remaining)} <small className="text-[10px] font-normal text-muted">ر.ي</small>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* الجزء الموسّع الذي يعرض عمليات المبيعات بالتفصيل لهذا الشهر وزر التسوية */}
                  {isExpanded && (
                    <div className="p-4 bg-surface-sunken/60 border-t border-line space-y-4">
                      {/* زر تسوية هذا الشهر مباشرة */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-surface p-3 rounded-xl border border-line">
                        <div>
                          <p className="font-extrabold text-xs text-ink">
                            تسوية عمولة {formatMonthArabic(m.month)}
                          </p>
                          <p className="text-[11px] text-muted">
                            المتبقي غير المسوى: <strong className="text-rose-600">{formatNumber(remaining)} ر.ي</strong>
                          </p>
                        </div>
                        <Button
                          variant="primary"
                          size="sm"
                          icon={DollarSign}
                          onClick={() => handleOpenBillingForMonth(m.month)}
                          className="font-black"
                        >
                          إنشاء تسوية لهذا الشهر
                        </Button>
                      </div>

                      {/* عمليات مبيعات هذا الشهر */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-xs font-black text-ink flex items-center gap-1.5">
                            <Receipt className="w-3.5 h-3.5 text-muted" />
                            <span>عمليات المبيعات الخاصة بهذا الشهر ({m.sales.length})</span>
                          </h4>
                          <span className="text-[10px] text-muted">مرتبة من الأحدث للأقدم</span>
                        </div>

                        {m.sales.length === 0 ? (
                          <div className="p-3 text-center text-xs text-muted bg-surface rounded-xl border border-dashed border-line">
                            لا توجد عمليات بيع مسجلة في هذا الشهر
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {m.sales.slice().reverse().map((sale) => {
                              const saleComm = saleCommission(sale);
                              const isSaleSettled = saleComm !== null && saleOutstanding(sale) === 0;

                              return (
                                <div
                                  key={sale.id || sale.saleId}
                                  className="p-3 rounded-xl bg-surface border border-line flex items-center justify-between gap-3 text-xs"
                                >
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono font-bold text-ink truncate" dir="ltr">
                                        {sale.customerId || sale.voucherCode || 'كرت مبيعات'}
                                      </span>
                                      <Badge tone={isSaleSettled ? 'success' : 'warning'}>
                                        {isSaleSettled ? 'مسواة' : 'غير مسواة'}
                                      </Badge>
                                    </div>
                                    <span className="text-[10px] text-muted block mt-0.5">
                                      {formatDate(sale.createdAt, { withTime: true })}
                                    </span>
                                  </div>

                                  <div className="text-left shrink-0">
                                    <div className="font-mono font-black text-ink">
                                      {formatNumber(sale.faceValue)} <small className="text-[9px] text-muted">ر.ي</small>
                                    </div>
                                    <div className="text-[10px] font-bold text-brand mt-0.5">
                                      عمولة: {saleComm === null ? 'غير محتسب' : `${formatNumber(saleComm)} ر.ي`}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* دفعات هذا الشهر */}
                      {m.payments.length > 0 && (
                        <div className="pt-2 border-t border-line/60">
                          <h4 className="text-xs font-black text-ink mb-2">الدفعات المسجلة لهذا الشهر ({m.payments.length})</h4>
                          <div className="space-y-1.5">
                            {m.payments.map((p) => (
                              <div key={p.id} className="p-2.5 rounded-lg bg-surface border border-line flex items-center justify-between text-xs">
                                <span className="text-muted text-[11px]">{formatDate(p.timestamp ?? p.createdAt, { withTime: true })}</span>
                                <span className="font-mono font-black text-emerald-600">{formatNumber(p.amount)} ر.ي</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* المودالات */}
      {editing && (
        <UserEditModal
          isOpen={editing}
          onClose={() => setEditing(false)}
          user={user}
          onSave={async (targetUid, updates) => {
            const result = await updateNetworkAccess({ uid: targetUid, ...updates });
            if (!result.ok) { toast.error(adminApiError(result.error, 'تعذر الحفظ')); return; }
            invalidateAdminUserData(targetUid);
            toast.success('تم حفظ التعديلات');
            setEditing(false);
            load({ force: true });
          }}
          onDelete={() => {
            setEditing(false);
            handleDelete();
          }}
        />
      )}

      {billing && (
        <UserBillingModal
          isOpen={billing}
          onClose={() => { setBilling(false); setSelectedMonthForBilling(null); load({ force: true }); }}
          user={user}
          initialMonth={selectedMonthForBilling}
        />
      )}

      {authModal && (
        <UserAuthModal
          isOpen={authModal}
          onClose={() => setAuthModal(false)}
          user={user}
        />
      )}

      <ConfirmDialog
        isOpen={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={async () => {
          if (!confirmAction?.action) return false;
          const result = await confirmAction.action();
          if (result === false) return false;
          setConfirmAction(null);
          return true;
        }}
        title={confirmAction?.title || ''}
        message={confirmAction?.message || ''}
        variant={confirmAction?.variant || 'danger'}
      />
    </div>
  );
}
