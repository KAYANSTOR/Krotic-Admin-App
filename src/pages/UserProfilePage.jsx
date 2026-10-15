import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowRight, DollarSign, CalendarPlus, Edit, KeyRound, Ban, UserCheck, CheckCircle, RefreshCw, Inbox, Wallet, Users } from 'lucide-react';
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
import { saleCommission } from '../lib/commission';
import { getCurrentMonthKey, monthKeyFromDate } from '../lib/billingHelpers';
import {
  fetchUsersWithBilling, fetchUserBillingHistory, invalidateAdminUserData,
} from '../lib/adminData';
import { renewNetwork, updateNetworkAccess, adminApiError } from '../lib/adminApi';
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

  const load = useCallback(async ({ force = false } = {}) => {
    setLoading(true);
    try {
      const { users = [] } = await fetchUsersWithBilling({ force });
      setUser(users.find((item) => item.uid === uid) || null);
      const billingHistory = await fetchUserBillingHistory(uid, { force });
      setHistory({ sales: billingHistory.sales || [], payments: billingHistory.payments || [] });
      setUpdatedAt(Date.now());
    } catch (error) {
      console.error('profile load failed', error);
      toast.error('تعذر تحميل ملف العميل');
    }
    setLoading(false);
  }, [uid]);

  useEffect(() => { load(); }, [load]);

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
  const outstanding = Math.max(0, commissionDue - totalPaid);
  const totalSales = sales.reduce((sum, sale) => sum + (Number(sale.faceValue) || 0), 0);

  const applyAccess = (patch, { successMessage, auditAction, details }) => {
    setConfirmAction({
      title: 'تأكيد الإجراء',
      message: 'سيُنفَّذ هذا الإجراء على الخادم ويُسجَّل في سجل العمليات. هل أنت متأكد؟',
      variant: 'danger',
      action: async () => {
        const result = await updateNetworkAccess({ uid, ...patch });
        if (!result.ok) { toast.error(adminApiError(result.error, 'تعذر تنفيذ الإجراء')); return; }
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
        if (!result.ok) { toast.error(adminApiError(result.error, 'تعذر التجديد')); return; }
        invalidateAdminUserData(uid);
        await logAdminAction({ action: AUDIT_ACTIONS.USER_RENEW, targetType: 'user', targetId: uid, targetLabel: user?.networkName || uid });
        toast.success('تم التجديد بنجاح');
        load({ force: true });
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

      <div className="grid-kpi">
        <StatCard title="إجمالي المبيعات" value={formatNumber(totalSales)} icon={DollarSign} tone="brand" subtitle="ريال يمني" />
        <StatCard title="العمولة المستحقة" value={formatNumber(commissionDue)} icon={Wallet} tone="warning" subtitle="كل العمولات" />
        <StatCard title="غير المسوّاة" value={formatNumber(outstanding)} icon={Wallet} tone="success" subtitle="المتبقي على العميل" />
        <StatCard title="المسدّد" value={formatNumber(totalPaid)} icon={DollarSign} tone="neutral" subtitle="إجمالي الدفعات" />
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
            <button onClick={() => setBilling(true)} className="row-action row-action--success">
              <DollarSign className="w-4 h-4" /><span className="text-xs font-medium">الفوترة والدفعات</span>
            </button>
            <button onClick={handleRenew} className="row-action row-action--brand" title="تجديد"><CalendarPlus className="w-4 h-4" /></button>
            <button onClick={() => setEditing(true)} className="row-action row-action--neutral" title="تعديل"><Edit className="w-4 h-4" /></button>
            <button onClick={() => setAuthModal(true)} className="row-action row-action--neutral" title="بيانات الدخول"><KeyRound className="w-4 h-4" /></button>
            {user.is_trial && (
              <button
                onClick={() => applyAccess({ accessStatus: 'ACTIVE_PAID' }, { successMessage: 'تم تحويل المستخدم إلى رسمي', auditAction: AUDIT_ACTIONS.USER_MAKE_OFFICIAL })}
                className="row-action row-action--brand-soft"
                title="تحويل لرسمي"
              >
                <CheckCircle className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => applyAccess(
                { accessStatus: user.is_active === false ? 'ACTIVE_PAID' : 'SUSPENDED_GRACE' },
                { successMessage: user.is_active === false ? 'تم إلغاء الحظر' : 'تم الحظر', auditAction: user.is_active === false ? AUDIT_ACTIONS.USER_ACTIVATE : AUDIT_ACTIONS.USER_BLOCK },
              )}
              className={`row-action ${user.is_active === false ? 'row-action--success' : 'row-action--danger'}`}
              title={user.is_active === false ? 'إلغاء الحظر' : 'حظر'}
            >
              {user.is_active === false ? <UserCheck className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
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
                    const paid = Number(sale.paidMinor) || 0;
                    const settled = commission !== null && paid >= commission;
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
        onConfirm={() => { confirmAction?.action(); setConfirmAction(null); }}
        title={confirmAction?.title || ''}
        message={confirmAction?.message || ''}
        variant={confirmAction?.variant || 'danger'}
      />
    </div>
  );
}
