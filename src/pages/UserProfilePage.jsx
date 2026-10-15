import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowRight, DollarSign, CalendarPlus, Edit, KeyRound, Ban, UserCheck, CheckCircle, RefreshCw, Inbox, Wallet, Users, Calculator, Trash2 } from 'lucide-react';
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
import { renewNetwork, updateNetworkAccess, reconcileLegacyCommissions, deleteCustomer, adminApiError } from '../lib/adminApi';
import { logAdminAction, AUDIT_ACTIONS } from '../lib/auditLog';

const accessLabel = {
  TRIAL: { text: 'تجريبي', tone: 'warning' },
  ACTIVE_PAID: { text: 'رسمي', tone: 'success' },
  SUSPENDED_GRACE: { text: 'موقوف', tone: 'danger' },
  LOCKED_EXPIRED: { text: 'منتهي', tone: 'danger' },
};

export default function UserProfilePage() {
  const { uid } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [history, setHistory] = useState({ sales: [], payments: [] });
  const [historyMonth, setHistoryMonth] = useState(() => getCurrentMonthKey());
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

  const handleReconcileLegacyCommissions = () => {
    setConfirmAction({
      title: 'إعادة احتساب عمولات المبيعات القديمة',
      message: 'سيكتب الخادم العمولة الحالية على سجلات Android القديمة المكتملة التي لا تحمل عمولة خادمية، ثم يعيد بناء إجماليات الشبكة. ستُستخدم نسبة العميل الحالية، أو النسبة العامة الحالية إن لم توجد. لا تُعدّل المبيعات الحديثة أو السجلات التي سبق اعتماد عمولتها. اكتب UID العميل لتأكيد التنفيذ.',
      confirmText: 'إعادة الاحتساب الآن',
      requireText: uid,
      variant: 'danger',
      action: async () => {
        const result = await reconcileLegacyCommissions(uid);
        if (!result.ok) {
          toast.error(adminApiError(result.error, 'تعذر إعادة احتساب العمولة القديمة'));
          return false;
        }
        if (result.data.status === 'no_legacy_sales') {
          toast.success('لم توجد مبيعات قديمة مطابقة؛ لم تُغيّر أي سجلات.');
          return true;
        }
        invalidateAdminUserData(uid);
        const count = Number(result.data.updatedCount) || 0;
        const rate = formatNumber(result.data.commissionRatePercent);
        toast.success(count > 0
          ? `تم احتساب العمولة على ${formatNumber(count)} مبيعة قديمة بنسبة ${rate}%.`
          : `تمت إعادة بناء الإجماليات؛ لا توجد مبيعات جديدة للاحتساب (${rate}%).`);
        await load({ force: true });
        return true;
      },
    });
  };

  const handleDeleteCustomer = () => {
    setConfirmAction({
      title: 'حذف العميل نهائيًا',
      message: 'سيُحذف حساب تسجيل الدخول وملف العميل والشبكة ومبيعاتها ودفعاتها وأجهزتها وبيانات التجميع والإشعارات وسجلات التدقيق المرتبطة. سيبقى فقط حدث تدقيق مجهول يثبت تنفيذ الحذف دون اسم العميل أو UID أو بياناته المالية. لا يمكن التراجع عن هذا الإجراء. اكتب UID العميل للتأكيد.',
      confirmText: 'حذف العميل وكل بياناته',
      requireText: uid,
      variant: 'danger',
      action: async () => {
        const result = await deleteCustomer(uid, user.networkId || uid);
        if (!result.ok) {
          toast.error(adminApiError(result.error, 'تعذر حذف العميل'));
          return false;
        }
        invalidateAdminUserData(uid);
        toast.success('تم حذف حساب العميل وبياناته ومبيعاته نهائيًا.');
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
    <div className="users-page">
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

      <div className="mb-4 max-w-xs">
        <label htmlFor="financial-month-filter" className="label-field">الشهر المالي</label>
        <select id="financial-month-filter" className="input-field" value={historyMonth} onChange={(event) => setHistoryMonth(event.target.value)}>
          <option value="all">كل الأشهر</option>
          {monthOptions.map((month) => <option key={month} value={month}>{month}</option>)}
        </select>
      </div>

      <Card className="mb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-ink">عمولات المبيعات القديمة</h2>
            <p className="mt-1 text-sm text-ink-soft">إجراء فعلي يضيف العمولة الخادمية للمبيعات القديمة المطابقة ويحدّث إجماليات العميل، باستخدام النسبة الحالية.</p>
          </div>
          <Button variant="primary" icon={Calculator} onClick={handleReconcileLegacyCommissions} className="shrink-0">
            إعادة احتساب العمولات القديمة
          </Button>
        </div>
      </Card>

      <div className="grid-kpi">
        <StatCard title="إجمالي المبيعات" value={formatNumber(totalSales)} icon={DollarSign} tone="brand" subtitle={historyMonth === "all" ? "كل الأشهر • ريال يمني" : historyMonth} />
        <StatCard title="العمولة المستحقة" value={formatNumber(commissionDue)} icon={Wallet} tone="warning" subtitle={historyMonth === "all" ? "كل العمولات" : "عمولة الشهر المحدد"} />
        <StatCard title="غير المسوّاة" value={formatNumber(outstanding)} icon={Wallet} tone="success" subtitle={historyMonth === "all" ? "المتبقي على العميل" : "المتبقي في الشهر المحدد"} />
        <StatCard title="المسدّد" value={formatNumber(totalPaid)} icon={DollarSign} tone="neutral" subtitle={historyMonth === "all" ? "إجمالي الدفعات" : "دفعات الشهر المحدد"} />
      </div>

      <Section
        eyebrow="الحساب"
        title="تفاصيل وإجراءات"
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
              <dd><span className="num">{user.commission_rate != null && user.commission_rate !== '' ? `${user.commission_rate}% (خاصة)` : 'عامة'}</span></dd>
            </div>
            <div className="user-card__meta-item">
              <dt>تاريخ التصفية</dt>
              <dd className={expired ? 'text-danger-ink font-semibold' : ''}>{formatDate(user.subscription_end_date)}</dd>
            </div>
            <div className="user-card__meta-item">
              <dt>معرّف الشبكة</dt>
              <dd dir="ltr">{user.networkId || uid}</dd>
            </div>
            <div className="user-card__meta-item">
              <dt>معرّف الحساب (UID)</dt>
              <dd dir="ltr">{uid}</dd>
            </div>
          </dl>

          <div className="user-card__actions" style={{ marginTop: '1rem' }}>
            <button type="button" onClick={() => setBilling(true)} className="row-action row-action--success" aria-label="الفوترة والدفعات">
              <DollarSign className="w-4 h-4" /><span className="text-xs font-medium">الفوترة والدفعات</span>
            </button>
            <button type="button" onClick={handleRenew} className="row-action row-action--brand" title="تجديد" aria-label="تجديد الاشتراك"><CalendarPlus className="w-4 h-4" /><span>تجديد</span></button>
            <button type="button" onClick={() => setEditing(true)} className="row-action row-action--neutral" title="تعديل" aria-label="تعديل إعدادات المستخدم"><Edit className="w-4 h-4" /><span>تعديل</span></button>
            <button type="button" onClick={() => setAuthModal(true)} className="row-action row-action--neutral" title="بيانات الدخول" aria-label="بيانات الدخول"><KeyRound className="w-4 h-4" /><span>الدخول</span></button>
            {user.is_trial && (
              <button
                onClick={() => applyAccess({ accessStatus: 'ACTIVE_PAID' }, { successMessage: 'تم تحويل المستخدم إلى رسمي', auditAction: AUDIT_ACTIONS.USER_MAKE_OFFICIAL })}
                type="button"
                className="row-action row-action--brand-soft"
                title="تحويل لرسمي"
                aria-label="تحويل المستخدم إلى رسمي"
              >
                <CheckCircle className="w-4 h-4" /><span>رسمي</span>
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
            <button type="button" onClick={handleDeleteCustomer} className="row-action row-action--danger" title="حذف العميل نهائيًا" aria-label="حذف العميل وكل بياناته">
              <Trash2 className="w-4 h-4" /><span>حذف العميل</span>
            </button>
          </div>
        </Card>
      </Section>


      <Section eyebrow="السجل" title="المبيعات" description="مبيعات العميل مع حالة التسوية. المسوّاة تظهر هنا في سجل العميل.">
        {sales.length === 0 ? (
          <Card>
            <div className="empty-state">
              <span className="empty-state__icon icon-tile icon-tile--neutral icon-tile--lg"><Inbox className="w-6 h-6" /></span>
              <p className="empty-state__title">لا توجد مبيعات مسجّلة</p>
            </div>
          </Card>
        ) : (
          <Card flush>
            <div className="overflow-x-auto">
              <table className="responsive-data-table w-full">
                <thead>
                  <tr className="table-header">
                    <th className="text-right px-6 py-4">التاريخ</th>
                    <th className="text-right px-6 py-4">الزبون</th>
                    <th className="text-right px-6 py-4">قيمة البيع</th>
                    <th className="text-right px-6 py-4">العمولة</th>
                    <th className="text-right px-6 py-4">حالة التسوية</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {sales.slice().reverse().map((sale) => {
                    const commission = saleCommission(sale);
                    const settled = commission !== null && saleOutstanding(sale) === 0;
                    return (
                      <tr key={sale.id}>
                        <td className="px-6 py-3 text-sm text-ink-soft" data-label="التاريخ">{formatDate(sale.createdAt, { withTime: true })}</td>
                        <td className="px-6 py-3 text-sm" data-label="الزبون" dir="ltr">{sale.customerId || '—'}</td>
                        <td className="px-6 py-3 text-sm font-medium" data-label="قيمة البيع">{formatNumber(sale.faceValue)}</td>
                        <td className="px-6 py-3 text-sm font-medium" data-label="العمولة">{commission === null ? 'غير متحقق' : formatNumber(commission)}</td>
                        <td className="px-6 py-3" data-label="حالة التسوية">
                          {commission === null
                            ? <Badge tone="neutral">غير متحقق</Badge>
                            : settled ? <Badge tone="success">مسوّاة</Badge> : <Badge tone="warning">غير مسوّاة</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </Section>

      <Section eyebrow="السجل" title="الدفعات والتسويات" description="الدفعات المسجّلة على هذا الحساب.">
        {payments.length === 0 ? (
          <Card><p className="text-sm text-ink-secondary">لا توجد دفعات مسجّلة.</p></Card>
        ) : (
          <Card flush>
            <div className="overflow-x-auto">
              <table className="responsive-data-table w-full">
                <thead>
                  <tr className="table-header">
                    <th className="text-right px-6 py-4">التاريخ</th>
                    <th className="text-right px-6 py-4">المبلغ</th>
                    <th className="text-right px-6 py-4">الشهر</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {payments.slice().reverse().map((payment) => (
                    <tr key={payment.id}>
                      <td className="px-6 py-3 text-sm text-ink-soft" data-label="التاريخ">{formatDate(payment.timestamp ?? payment.createdAt, { withTime: true })}</td>
                      <td className="px-6 py-3 text-sm font-medium" data-label="المبلغ">{formatNumber(payment.amount)}</td>
                      <td className="px-6 py-3 text-sm" data-label="الشهر" dir="ltr">{payment.month || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </Section>

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
        />
      )}
      {billing && <UserBillingModal isOpen={billing} onClose={() => { setBilling(false); load({ force: true }); }} user={user} />}
      {authModal && <UserAuthModal isOpen={authModal} onClose={() => setAuthModal(false)} user={user} />}
      <ConfirmDialog
        isOpen={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={async () => { if (!confirmAction?.action) return false; const result = await confirmAction.action(); if (result === false) return false; setConfirmAction(null); return true; }}
        title={confirmAction?.title || ''}
        message={confirmAction?.message || ''}
        variant={confirmAction?.variant || 'danger'}
        confirmText={confirmAction?.confirmText || 'تأكيد'}
        requireText={confirmAction?.requireText || null}
      />
    </div>
  );
}
