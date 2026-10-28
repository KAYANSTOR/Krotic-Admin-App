import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowRight, DollarSign, CalendarPlus, Edit, KeyRound, Ban,
  UserCheck, CheckCircle, RefreshCw, Inbox, Wallet, Users,
  ShieldCheck, ShieldAlert, Trash2, ChevronDown,
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
import UserDevicesPanel from '../components/UserDevicesPanel';
import MonthCard from '../components/userProfile/MonthCard';
import UserInventorySection from '../components/userProfile/UserInventorySection';

import { formatNumber, formatDate, isExpired } from '../lib/format';
import { saleCommission, saleFaceValue, isServerVerifiedSale } from '../lib/commission';
import { getCurrentMonthKey, monthKeyFromDate } from '../lib/billingHelpers';
import { renewNetwork, updateNetworkAccess, deleteNetworkAccount, adminApiError } from '../lib/adminApi';
import { logAdminAction, AUDIT_ACTIONS } from '../lib/auditLog';
import { isUserPhoneVerified } from '../lib/accessStatus';
import { getAppUpdateStatus } from '../lib/appVersion';
import useAppRefresh from '../lib/useAppRefresh';

import {
  hasCustomCommission,
  getUserDisplayName,
  formatAppVersion,
  getAccessStatusMeta,
  formatMonthArabic,
} from '../lib/users/profileHelpers';
import { buildMonthlyBreakdown, paymentMonthKey } from '../lib/users/monthlyBreakdown';
import { useUserProfile } from '../hooks/userProfile/useUserProfile';

export default function UserProfilePage() {
  const { uid } = useParams();
  const navigate = useNavigate();

  const {
    user,
    globalConfig,
    allSales,
    allPayments,
    inventorySnapshot,
    inventoryLoading,
    inventoryError,
    reloadInventory,
    loading,
    userLoadError,
    historyError,
    error,
    refresh,
    syncing,
    lastSyncAt,
    historyLoading,
    historyAvailable,
  } = useUserProfile(uid);

  const [historyMonth, setHistoryMonth] = useState('all');
  const [selectedMonthForBilling, setSelectedMonthForBilling] = useState(null);
  const [expandedMonths, setExpandedMonths] = useState(() => new Set([getCurrentMonthKey()]));
  const [editing, setEditing] = useState(false);
  const [billing, setBilling] = useState(false);
  const [authModal, setAuthModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);

  // One stable pull-to-refresh subscription, using the newest refresh callback.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  const stableRefresh = useCallback(() => refreshRef.current(), []);
  useAppRefresh(stableRefresh);

  useEffect(() => {
    if (error) toast.error('تعذر تحميل جزء من بيانات ملف العميل؛ يمكنك إعادة المحاولة.');
  }, [error]);

  const monthOptions = useMemo(() => {
    const months = new Set([getCurrentMonthKey()]);
    for (const sale of allSales) {
      const month = monthKeyFromDate(sale?.createdAt);
      if (month) months.add(month);
    }
    for (const payment of allPayments) {
      const month = paymentMonthKey(payment);
      if (month) months.add(month);
    }
    return [...months].filter(Boolean).sort((left, right) => right.localeCompare(left));
  }, [allSales, allPayments]);

  // The KPIs default to all history; the month selector changes only the KPI period.
  const sales = useMemo(
    () => historyMonth === 'all'
      ? allSales
      : allSales.filter((sale) => monthKeyFromDate(sale?.createdAt) === historyMonth),
    [allSales, historyMonth],
  );
  const payments = useMemo(
    () => historyMonth === 'all'
      ? allPayments
      : allPayments.filter((payment) => paymentMonthKey(payment) === historyMonth),
    [allPayments, historyMonth],
  );

  const verifiedSales = useMemo(() => sales.filter(isServerVerifiedSale), [sales]);
  const legacySales = useMemo(() => sales.filter((sale) => !isServerVerifiedSale(sale)), [sales]);
  const verifiedCommissionDue = useMemo(
    () => verifiedSales.reduce((sum, sale) => sum + (saleCommission(sale) ?? 0), 0),
    [verifiedSales],
  );
  const legacyEstimatedCommission = useMemo(
    () => legacySales.reduce((sum, sale) => sum + (saleCommission(sale) ?? 0), 0),
    [legacySales],
  );
  const verifiedOutstanding = useMemo(
    () => verifiedSales.reduce((sum, sale) => sum + saleOutstanding(sale), 0),
    [verifiedSales],
  );
  const totalPaid = useMemo(
    () => payments.reduce((sum, payment) => sum + (Number(payment?.amount) || 0), 0),
    [payments],
  );
  const totalSales = useMemo(
    () => sales.reduce((sum, sale) => sum + saleFaceValue(sale), 0),
    [sales],
  );

  const monthlyBreakdown = useMemo(
    () => buildMonthlyBreakdown(allSales, allPayments, monthOptions),
    [allSales, allPayments, monthOptions],
  );

  const toggleMonthExpand = useCallback((monthKey) => {
    setExpandedMonths((previous) => {
      const next = new Set(previous);
      if (next.has(monthKey)) next.delete(monthKey);
      else next.add(monthKey);
      return next;
    });
  }, []);

  const openBillingForMonth = useCallback((monthKey) => {
    setSelectedMonthForBilling(monthKey);
    setBilling(true);
  }, []);

  const runConfirmed = useCallback((action) => {
    setConfirmAction(action);
  }, []);

  const applyAccess = useCallback((patch, {
    title,
    message,
    successMessage,
    auditAction,
    details,
    variant = 'primary',
  }) => {
    runConfirmed({
      title,
      message,
      variant,
      action: async () => {
        const result = await updateNetworkAccess({ uid, ...patch });
        if (!result.ok) {
          toast.error(adminApiError(result.error, 'تعذر تنفيذ الإجراء'));
          return false;
        }
        await logAdminAction({
          action: auditAction,
          targetType: 'user',
          targetId: uid,
          targetLabel: getUserDisplayName(user, uid),
          details,
        }).catch(() => {});
        toast.success(successMessage);
        await refresh();
        return true;
      },
    });
  }, [runConfirmed, uid, user, refresh]);

  const handleMakeOfficial = useCallback(() => {
    const targetName = getUserDisplayName(user, uid);
    applyAccess(
      { accessStatus: 'ACTIVE_PAID' },
      {
        title: 'تحويل الحساب إلى رسمي',
        message: `تحويل الحساب «${targetName}» من تجريبي إلى رسمي دائم؟`,
        successMessage: 'تم تحويل الحساب إلى رسمي',
        auditAction: AUDIT_ACTIONS.USER_MAKE_OFFICIAL,
        variant: 'primary',
      },
    );
  }, [applyAccess, user, uid]);

  const handleToggleAccess = useCallback(() => {
    const targetName = getUserDisplayName(user, uid);
    const block = user?.is_active !== false;
    applyAccess(
      { accessStatus: block ? 'SUSPENDED_GRACE' : 'ACTIVE_PAID' },
      {
        title: block ? 'حظر المشترك' : 'إلغاء حظر المشترك',
        message: block
          ? `هل تريد حظر «${targetName}»؟ سيُمنع من استخدام التطبيق فوراً.`
          : `هل تريد إلغاء حظر «${targetName}» وإعادة تفعيل الوصول؟`,
        successMessage: block ? 'تم حظر الحساب' : 'تم إلغاء الحظر وإعادة التفعيل',
        auditAction: block ? AUDIT_ACTIONS.USER_BLOCK : AUDIT_ACTIONS.USER_ACTIVATE,
        variant: block ? 'danger' : 'success',
      },
    );
  }, [applyAccess, user, uid]);

  const handleRenew = useCallback(() => {
    const targetName = getUserDisplayName(user, uid);
    runConfirmed({
      title: 'تجديد اشتراك سريع',
      message: `سيتم تمديد صلاحية وصول «${targetName}» لمدة 30 يوماً إضافية عبر الخادم. هل تريد المتابعة؟`,
      variant: 'success',
      action: async () => {
        const result = await renewNetwork(uid, 30);
        if (!result.ok) {
          toast.error(adminApiError(result.error, 'تعذر تجديد الاشتراك'));
          return false;
        }
        await logAdminAction({
          action: AUDIT_ACTIONS.USER_RENEW,
          targetType: 'user',
          targetId: uid,
          targetLabel: targetName,
        }).catch(() => {});
        toast.success('تم تجديد الاشتراك بنجاح لمدة 30 يوماً');
        await refresh();
        return true;
      },
    });
  }, [runConfirmed, uid, user, refresh]);

  const handleDelete = useCallback(() => {
    const targetName = getUserDisplayName(user, uid);
    runConfirmed({
      title: 'حذف حساب المشترك والشبكة',
      message: `هل تريد حذف حساب «${targetName}» نهائياً؟ سيُحذف الحساب والشبكة وسجلاتهما، ولا يمكن التراجع عن هذا الإجراء.`,
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
        navigate('/users');
        return true;
      },
    });
  }, [runConfirmed, user, uid, navigate]);

  const handleManualPhoneVerify = useCallback(() => {
    if (!user) return;
    const isVerified = isUserPhoneVerified(user);
    const targetName = getUserDisplayName(user, uid);
    const phoneDisplay = user.phoneNumber || user.phone || 'غير مسجّل';

    if (!isVerified) {
      runConfirmed({
        title: 'توثيق الهاتف يدوياً',
        message: `هل تريد توثيق رقم هاتف «${targetName}» (${phoneDisplay}) يدوياً؟ يُستخدم هذا الإجراء للدعم الفني فقط عند تعذر وصول رمز التحقق.`,
        variant: 'success',
        action: async () => {
          const result = await updateNetworkAccess({ uid, phone_verified: true });
          if (!result.ok) {
            toast.error(adminApiError(result.error, 'تعذر توثيق الهاتف'));
            return false;
          }
          await logAdminAction({
            action: AUDIT_ACTIONS.USER_PHONE_VERIFY_MANUAL,
            targetType: 'user',
            targetId: uid,
            targetLabel: targetName,
            details: { phone: phoneDisplay, manual: true, reason: 'دعم فني - تفعيل يدوي' },
          }).catch(() => {});
          toast.success(`تم توثيق رقم هاتف «${targetName}»`);
          await refresh();
          return true;
        },
      });
    } else {
      runConfirmed({
        title: 'إلغاء توثيق الهاتف',
        message: `رقم هاتف «${targetName}» (${phoneDisplay}) موثّق حالياً. هل تريد إلغاء التوثيق؟`,
        variant: 'danger',
        action: async () => {
          const result = await updateNetworkAccess({ uid, phone_verified: false });
          if (!result.ok) {
            toast.error(adminApiError(result.error, 'تعذر إلغاء توثيق الهاتف'));
            return false;
          }
          await logAdminAction({
            action: AUDIT_ACTIONS.USER_PHONE_UNVERIFY,
            targetType: 'user',
            targetId: uid,
            targetLabel: targetName,
            details: { phone: phoneDisplay },
          }).catch(() => {});
          toast.success('تم إلغاء توثيق الهاتف');
          await refresh();
          return true;
        },
      });
    }
  }, [user, uid, runConfirmed, refresh]);

  const handleSaveEdit = useCallback(async (targetUid, updates) => {
    const result = await updateNetworkAccess({ uid: targetUid, ...updates });
    if (!result.ok) {
      toast.error(adminApiError(result.error, 'تعذر حفظ التعديلات'));
      return false;
    }
    toast.success('تم حفظ التعديلات بنجاح');
    setEditing(false);
    await refresh();
    return true;
  }, [refresh]);

  const handleBillingClose = useCallback(async () => {
    setBilling(false);
    setSelectedMonthForBilling(null);
    await refresh();
  }, [refresh]);

  const status = getAccessStatusMeta(user);
  const expired = isExpired(user?.subscription_end_date);
  const updateStatus = getAppUpdateStatus(user || {}, globalConfig);
  const updateLabel = updateStatus === 'current'
    ? 'محدّث'
    : updateStatus === 'outdated'
      ? 'إصدار قديم'
      : 'لم يرسل بيانات الإصدار';
  const isVerifiedPhone = isUserPhoneVerified(user || {});
  const targetName = getUserDisplayName(user, uid);
  const errorMessage = error?.message || 'تعذر تحميل بيانات هذا الحساب من القاعدة المحلية.';

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
      <div className="users-page space-y-3">
        <PageHero
          icon={Users}
          title="ملف العميل"
          subtitle={userLoadError
            ? 'تعذر تحميل بيانات الحساب.'
            : 'لم يتم العثور على هذا الحساب.'}
          actions={<Button variant="secondary" icon={RefreshCw} onClick={refresh}>إعادة المحاولة</Button>}
        />
        {error && (
          <div className="users-error" role="alert" aria-live="assertive">
            {errorMessage}
            <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refresh} className="ms-2">إعادة المحاولة</Button>
          </div>
        )}
        <Card>
          <Link to="/users" className="btn btn--secondary min-h-[44px] inline-flex items-center">رجوع إلى المستخدمين</Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="users-page pb-12 space-y-3">
      <PageHero
        icon={Users}
        kicker="ملف العميل"
        title={targetName}
        subtitle={`${user.phoneNumber || user.phone || '—'} • ${user.networkId || uid}`}
        meta={`${sales.length} عملية بيع • ${payments.length} دفعة • ${historyMonth === 'all' ? 'كل الأشهر' : formatMonthArabic(historyMonth)}`}
        actions={
          <>
            <DataFreshness lastSyncedAt={lastSyncAt} refreshing={syncing} onRefresh={refresh} />
            <Button variant="secondary" icon={ArrowRight} onClick={() => navigate('/users')}>رجوع</Button>
          </>
        }
      />

      {error && (
        <div className="users-error users-error--warning mb-2" role="alert" aria-live="assertive">
          {historyError
            ? 'تعذر تحميل السجل المالي لهذا العميل. أعد المحاولة؛ ستبقى تفاصيل الحساب متاحة.'
            : errorMessage}
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refresh} className="ms-2" disabled={syncing}>
            إعادة المحاولة
          </Button>
        </div>
      )}

      {historyLoading && !historyAvailable && !historyError && (
        <div className="text-xs text-muted py-2" role="status" aria-live="polite">
          جارٍ تحميل السجل المالي لهذا العميل…
        </div>
      )}

      <Section
        eyebrow="الحساب"
        title="تفاصيل وإجراءات سريعة"
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone={status.tone}>{status.text}</Badge>
            {user.is_active === false && <Badge tone="danger">محظور</Badge>}
          </div>
        }
      >
        <Card>
          <dl className="user-card__meta" style={{ background: 'transparent', border: 0, padding: 0 }}>
            <div className="user-card__meta-item">
              <dt>النسبة المضبوطة حالياً</dt>
              <dd><span className="num font-bold">{hasCustomCommission(user) ? `${user.commission_rate}% (خاصة)` : 'عامة'}</span></dd>
            </div>
            <div className="user-card__meta-item">
              <dt>تاريخ الانتهاء</dt>
              <dd className={expired ? 'text-danger font-bold' : 'font-semibold'}>{formatDate(user.subscription_end_date)}</dd>
            </div>
            <div className="user-card__meta-item">
              <dt>معرّف الشبكة</dt>
              <dd dir="ltr" className="font-mono">{user.networkId || uid}</dd>
            </div>
            <div className="user-card__meta-item">
              <dt>رقم الهاتف</dt>
              <dd dir="ltr" className="font-mono font-bold text-brand">{user.phoneNumber || user.phone || '—'}</dd>
            </div>
            <div className="user-card__meta-item">
              <dt>حالة التحقق بالهاتف</dt>
              <dd>
                {isVerifiedPhone ? (
                  <span className="inline-flex items-center gap-1 font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200 text-xs">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                    <span>موثّق برقم الهاتف</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200 text-xs">
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
                    <span>غير موثّق</span>
                  </span>
                )}
              </dd>
            </div>
          </dl>

          <div className="user-card__actions mt-4">
            <button type="button" onClick={() => openBillingForMonth(getCurrentMonthKey())} className="row-action row-action--success min-h-[44px]" aria-label="الفوترة والتسويات">
              <DollarSign className="w-4 h-4 text-emerald-600" aria-hidden="true" />
              <span className="text-xs font-bold">تسوية وعمولة</span>
            </button>
            <button type="button" onClick={handleRenew} className="row-action row-action--brand min-h-[44px]">
              <CalendarPlus className="w-4 h-4 text-brand" aria-hidden="true" />
              <span>تجديد</span>
            </button>
            <button type="button" onClick={() => setEditing(true)} className="row-action row-action--neutral min-h-[44px]">
              <Edit className="w-4 h-4" aria-hidden="true" />
              <span>تعديل</span>
            </button>
            <button type="button" onClick={() => setAuthModal(true)} className="row-action row-action--neutral min-h-[44px]">
              <KeyRound className="w-4 h-4" aria-hidden="true" />
              <span>الدخول</span>
            </button>
          </div>

          <details className="mt-3 border-t border-line/60 pt-3">
            <summary className="flex items-center justify-between gap-2 cursor-pointer rounded-xl px-3 py-2 min-h-[44px] font-bold text-sm text-ink hover:bg-surface-sunken">
              <span>إجراءات إضافية</span>
              <ChevronDown className="w-4 h-4 text-muted" aria-hidden="true" />
            </summary>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3">
              <button
                type="button"
                onClick={handleManualPhoneVerify}
                className={`row-action min-h-[44px] ${isVerifiedPhone ? 'row-action--success' : 'row-action--brand-soft'}`}
                title={isVerifiedPhone ? 'إلغاء توثيق الهاتف' : 'توثيق الهاتف يدوياً للدعم الفني'}
              >
                {isVerifiedPhone ? <ShieldCheck className="w-4 h-4 text-emerald-600" /> : <ShieldAlert className="w-4 h-4 text-amber-600" />}
                <span>{isVerifiedPhone ? 'إلغاء التوثيق' : 'توثيق الهاتف'}</span>
              </button>

              {user.is_trial && (
                <button type="button" onClick={handleMakeOfficial} className="row-action row-action--brand-soft min-h-[44px]">
                  <CheckCircle className="w-4 h-4 text-brand" aria-hidden="true" />
                  <span>تحويل إلى رسمي</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleToggleAccess}
                className={`row-action min-h-[44px] ${user.is_active === false ? 'row-action--success' : 'row-action--danger'}`}
                aria-label={user.is_active === false ? 'إلغاء حظر المستخدم' : 'حظر المستخدم'}
              >
                {user.is_active === false ? <UserCheck className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                <span>{user.is_active === false ? 'رفع الحظر' : 'حظر'}</span>
              </button>

              <button type="button" onClick={handleDelete} className="row-action row-action--danger min-h-[44px]" title="حذف الحساب نهائياً">
                <Trash2 className="w-4 h-4 text-danger" aria-hidden="true" />
                <span>حذف الحساب</span>
              </button>
            </div>
          </details>
        </Card>
      </Section>

      <Section eyebrow="التطبيق والجهاز" title="الإصدار المثبت وآخر ظهور">
        <Card>
          <dl className="user-card__meta" style={{ background: 'transparent', border: 0, padding: 0 }}>
            <div className="user-card__meta-item">
              <dt>الإصدار المثبّت</dt>
              <dd dir="ltr" className="font-mono">{formatAppVersion(user.app_version ?? user.appVersion)}</dd>
            </div>
            <div className="user-card__meta-item">
              <dt>versionCode المثبّت</dt>
              <dd dir="ltr" className="font-mono">{formatAppVersion(user.app_version_code)}</dd>
            </div>
            <div className="user-card__meta-item">
              <dt>آخر إصدار منشور</dt>
              <dd dir="ltr" className="font-mono">
                {globalConfig?.app_latest_version || 'غير محدد'}
                {globalConfig?.app_latest_version_code != null && globalConfig.app_latest_version_code !== ''
                  ? ` (${formatAppVersion(globalConfig.app_latest_version_code)})`
                  : ''}
              </dd>
            </div>
            <div className="user-card__meta-item">
              <dt>حالة التحديث</dt>
              <dd>
                <Badge tone={updateStatus === 'current' ? 'success' : updateStatus === 'outdated' ? 'warning' : 'neutral'}>
                  {updateLabel}
                </Badge>
              </dd>
            </div>
            <div className="user-card__meta-item">
              <dt>آخر ظهور</dt>
              <dd>{formatDate(user.last_seen_at || user.lastSeenAt, { withTime: true })}</dd>
            </div>
            <div className="user-card__meta-item">
              <dt>المنصة</dt>
              <dd>{user.platform || 'غير مُبلّغ'}</dd>
            </div>
            <div className="user-card__meta-item">
              <dt>حالة الترخيص/الوصول</dt>
              <dd>{status.text}{user.is_active === false ? ' — موقوف' : expired ? ' — منتهي' : ''}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted mt-4">
            تعكس هذه البيانات آخر تقرير ناجح من التطبيق، وليست فحصاً لحظياً للجهاز.
          </p>
        </Card>
        <UserDevicesPanel userId={uid} userLabel={targetName} />
      </Section>

      <Section eyebrow="المؤشرات المالية" title="ملخص المبيعات والعمولات">
        <div className="flex items-center justify-between my-2 flex-wrap gap-2">
          <p className="text-xs text-muted">تُعرض جميع الفترات افتراضياً، ويمكن اختيار شهر محدد.</p>
          <label className="flex items-center gap-2 text-xs font-semibold text-muted">
            الفترة
            <select
              value={historyMonth}
              onChange={(event) => setHistoryMonth(event.target.value)}
              className="input-field py-2 text-xs min-h-[44px]"
              aria-label="فترة المؤشرات المالية"
            >
              <option value="all">كل الأشهر</option>
              {monthOptions.map((month) => (
                <option key={month} value={month}>{formatMonthArabic(month)}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid-kpi">
          <StatCard
            title={historyMonth === 'all' ? 'إجمالي المبيعات' : 'مبيعات الشهر المحدد'}
            value={formatNumber(totalSales)}
            icon={DollarSign}
            tone="brand"
            subtitle={historyMonth === 'all' ? 'كل الأشهر • ريال يمني' : formatMonthArabic(historyMonth)}
          />
          <StatCard
            title="العمولة المعتمدة خادمياً"
            value={formatNumber(verifiedCommissionDue)}
            icon={Wallet}
            tone="warning"
            subtitle={legacyEstimatedCommission > 0
              ? `+ ${formatNumber(legacyEstimatedCommission)} ر.ي قديمة للمراجعة`
              : historyMonth === 'all' ? 'كل العمولات المعتمدة' : 'العمولة المعتمدة لهذا الشهر'}
          />
          <StatCard
            title="المتبقي غير المسوّى"
            value={formatNumber(verifiedOutstanding)}
            icon={Wallet}
            tone="success"
            subtitle="من سجلات المبيعات المعتمدة فقط"
          />
          <StatCard
            title="الدفعات المسجلة"
            value={formatNumber(totalPaid)}
            icon={DollarSign}
            tone="neutral"
            subtitle={historyMonth === 'all' ? 'إجمالي الدفعات في كل الأشهر' : `دفعات ${formatMonthArabic(historyMonth)}`}
          />
        </div>

        {historyMonth === 'all' && legacyEstimatedCommission > 0 && (
          <p className="text-xs leading-5 text-amber-800 mt-2" role="note">
            العمولات التقديرية للسجلات القديمة معروضة للمراجعة فقط ولا تدخل ضمن عمولة الإدارة المعتمدة.
          </p>
        )}
      </Section>

      <UserInventorySection
        snapshot={inventorySnapshot}
        loading={inventoryLoading}
        error={inventoryError}
        onRetry={reloadInventory}
        salesCount={allSales.length}
      />

      <Section
        eyebrow="الشهور والتسويات"
        title="تفاصيل الشهور والعمولات والمبيعات"
        description="افتح الشهر لعرض عمليات البيع والدفعات، ثم انتقل إلى إنشاء تسوية لذلك الشهر."
      >
        {historyError ? (
          <Card>
            <div className="p-4 text-sm text-danger-ink" role="alert">
              تعذر تحميل تفاصيل الشهور. أعد المحاولة لاستعادة سجل المبيعات والدفعات.
              <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refresh} className="mt-3" disabled={syncing}>
                إعادة المحاولة
              </Button>
            </div>
          </Card>
        ) : historyLoading && !historyAvailable ? (
          <Card>
            <div className="p-5 text-sm text-muted" role="status" aria-live="polite">جارٍ تحميل السجل المالي…</div>
          </Card>
        ) : monthlyBreakdown.length === 0 ? (
          <Card>
            <div className="empty-state">
              <span className="empty-state__icon icon-tile icon-tile--neutral icon-tile--lg">
                <Inbox className="w-6 h-6" />
              </span>
              <p className="empty-state__title">لا توجد حركات مسجلة</p>
              <p className="empty-state__desc">ستظهر الشهور والعمولات هنا بعد وصول أول عملية بيع أو دفعة.</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {monthlyBreakdown.map((month) => (
              <MonthCard
                key={month.month}
                month={month}
                isExpanded={expandedMonths.has(month.month)}
                onToggle={toggleMonthExpand}
                onSettle={openBillingForMonth}
              />
            ))}
          </div>
        )}
      </Section>

      {editing && (
        <UserEditModal
          isOpen={editing}
          onClose={() => setEditing(false)}
          user={user}
          onSave={handleSaveEdit}
          onDelete={() => {
            setEditing(false);
            handleDelete();
          }}
        />
      )}

      {billing && (
        <UserBillingModal
          isOpen={billing}
          onClose={handleBillingClose}
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
        isOpen={Boolean(confirmAction)}
        onClose={() => setConfirmAction(null)}
        onConfirm={async () => {
          if (!confirmAction?.action) return false;
          const result = await confirmAction.action();
          if (result === false) return false;
          setConfirmAction(null);
          return true;
        }}
        title={confirmAction?.title || 'تأكيد الإجراء'}
        message={confirmAction?.message || ''}
        variant={confirmAction?.variant || 'danger'}
      />
    </div>
  );
}
