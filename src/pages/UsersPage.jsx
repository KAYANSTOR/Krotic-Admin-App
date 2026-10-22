// src/pages/UsersPage.jsx
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Timestamp } from 'firebase/firestore';
import { useLocalQuery } from '../lib/localDb/useLocalQuery';
import { useLocalDb } from '../lib/localDb/LocalDbContext';
import { loadLocalConfig, loadLocalUsersWithBilling } from '../lib/localDb/localData';
import {
  Users, Search, UserCheck, Ban, RefreshCw, Edit,
  CheckCircle, DollarSign, CalendarPlus, AlertCircle, Inbox, Activity, KeyRound, ChevronDown, Download, ArrowUpLeft,
  Trash2, X, Phone, ShieldAlert, ShieldCheck, LayoutGrid, List, Sparkles, ExternalLink
} from 'lucide-react';
import toast from 'react-hot-toast';
import PageHero from '../components/ui/PageHero';
import { Card } from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import StatCard from '../components/ui/StatCard';
import Section from '../components/ui/Section';
import DataFreshness from '../components/ui/DataFreshness';
import { SkeletonLine, SkeletonPageHeader, SkeletonCard } from '../components/ui/Skeleton';
import UserEditModal from '../components/UserEditModal';
import UserBillingModal from '../components/UserBillingModal';
import UserAuthModal from '../components/UserAuthModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { formatNumber, formatDate, isExpired, toDate } from '../lib/format';
import { renewNetwork, updateNetworkAccess, repairAccessPage, deleteNetworkAccount, adminApiError } from '../lib/adminApi';
import { downloadCsv, csvStamp } from '../lib/csv';
import { logAdminAction, AUDIT_ACTIONS } from '../lib/auditLog';
import { isUserPhoneVerified } from '../lib/accessStatus';
import { trackSnapshot } from '../lib/localDb/readMeter';
import { getAppUpdateStatus } from '../lib/appVersion';
import useAppRefresh from '../lib/useAppRefresh';

const PAGE_SIZE = 24;
const FILTER_STORAGE_KEY = 'krotak:users-filter';

function hasExpiryCompatibilityGap(user) {
  const modernValue = user?.subscriptionEndsAt;
  const legacyValue = user?.subscription_end_date;
  if (modernValue == null && legacyValue == null) return false;
  const modernDate = toDate(modernValue);
  const legacyDate = toDate(legacyValue);
  return !modernDate || !legacyDate || modernDate.getTime() !== legacyDate.getTime();
}

function loadSavedFilter() {
  try {
    return window.localStorage.getItem(FILTER_STORAGE_KEY) || 'all';
  } catch {
    return 'all';
  }
}

const FILTERS = [
  { value: 'all', label: 'الكل' },
  { value: 'active', label: 'نشط' },
  { value: 'verified', label: 'موثّق بالهاتف' },
  { value: 'unverified', label: 'غير موثّق' },
  { value: 'official', label: 'رسمي' },
  { value: 'trial', label: 'تجريبي' },
  { value: 'expiring', label: 'ينتهي قريباً' },
  { value: 'expired', label: 'منتهي' },
  { value: 'blocked', label: 'محظور' },
  { value: 'update-needed', label: 'يحتاج تحديثاً' },
  { value: 'version-unknown', label: 'إصدار غير معروف' },
];

function resolveInitialFilter() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('filter');
    if (fromUrl && FILTERS.some((item) => item.value === fromUrl)) return fromUrl;
  } catch {
    // safe fallback
  }
  return loadSavedFilter();
}

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [globalConfig, setGlobalConfig] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState(resolveInitialFilter);
  const [versionSort, setVersionSort] = useState('none');
  const [viewMode, setViewMode] = useState('cards');

  const [editingUser, setEditingUser] = useState(null);
  const [billingUser, setBillingUser] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [confirmAction, setConfirmAction] = useState(null);
  const [repairingAccess, setRepairingAccess] = useState(false);
  const hasLoadedUsers = useRef(false);
  const navigate = useNavigate();

  const { runSync, syncing, lastSyncAt } = useLocalDb();

  // القائمة والتقارير المالية من القاعدة المحلية: صفر قراءات عند التنقل.
  const usersQuery = useLocalQuery((localDb) => loadLocalUsersWithBilling(localDb), []);
  const configQuery = useLocalQuery((localDb) => loadLocalConfig(localDb), []);

  useEffect(() => {
    const data = usersQuery.data;
    if (!data) return;
    setUsers(data.users);
    hasLoadedUsers.current = true;
  }, [usersQuery.data]);

  useEffect(() => {
    if (configQuery.data) setGlobalConfig(configQuery.data);
  }, [configQuery.data]);

  const loading = usersQuery.loading && !hasLoadedUsers.current;
  const error = usersQuery.error ? 'تعذر تحميل بيانات المستخدمين. حاول مرة أخرى.' : null;
  const partialErrors = usersQuery.error
    ? ['تعذر قراءة المجاميع المالية من القاعدة المحلية؛ ما زالت قائمة المستخدمين متاحة.']
    : [];
  const billingRefreshing = syncing;

  const refresh = async () => {
    await runSync({ reason: 'manual' });
    usersQuery.refresh();
    configQuery.refresh();
  };

  useAppRefresh(refresh);

  const handleToggleActive = (user) => {
    const newStatus = !user.is_active;
    setConfirmAction({
      user,
      title: newStatus ? 'تفعيل المشترك' : 'حظر المشترك',
      message: newStatus
        ? `هل تريد تفعيل حساب "${user.networkName || user.uid}"؟`
        : `هل تريد حظر "${user.networkName || user.uid}"؟ سيتم منعه من استخدام التطبيق فوراً.`,
      action: async () => {
        const result = await updateNetworkAccess({
          uid: user.uid,
          accessStatus: newStatus ? 'ACTIVE_PAID' : 'SUSPENDED_GRACE',
        });
        if (!result.ok) {
          toast.error(adminApiError(result.error, 'تعذر تحديث حالة المستخدم'));
          return false;
        }
        setUsers((prev) => prev.map((u) => (u.uid === user.uid
          ? {
              ...u,
              accessStatus: newStatus ? 'ACTIVE_PAID' : 'SUSPENDED_GRACE',
              is_active: newStatus,
              is_trial: false,
              accessNeedsRepair: hasExpiryCompatibilityGap(u),
            }
          : u)));
        logAdminAction({
          action: newStatus ? AUDIT_ACTIONS.USER_ACTIVATE : AUDIT_ACTIONS.USER_BLOCK,
          targetType: 'user',
          targetId: user.uid,
          targetLabel: user.networkName || user.phoneNumber || user.uid,
        });
        toast.success(newStatus ? 'تم تفعيل الحساب' : 'تم حظر الحساب');
      },
      variant: newStatus ? 'success' : 'danger',
    });
  };

  const handleMakeOfficial = (user) => {
    setConfirmAction({
      user,
      title: 'تحويل الحساب إلى رسمي',
      message: `هل تريد تحويل "${user.networkName || user.uid}" من مستخدم تجريبي إلى حساب رسمي دائم؟`,
      action: async () => {
        const result = await updateNetworkAccess({ uid: user.uid, accessStatus: 'ACTIVE_PAID' });
        if (!result.ok) {
          toast.error(adminApiError(result.error, 'تعذر تحويل المستخدم إلى رسمي'));
          return false;
        }
        setUsers((prev) => prev.map((u) => (u.uid === user.uid
          ? { ...u, accessStatus: 'ACTIVE_PAID', is_active: true, is_trial: false, accessNeedsRepair: hasExpiryCompatibilityGap(u) }
          : u)));
        logAdminAction({
          action: AUDIT_ACTIONS.USER_MAKE_OFFICIAL,
          targetType: 'user',
          targetId: user.uid,
          targetLabel: user.networkName || user.phoneNumber || user.uid,
        });
        toast.success('تم تحويل الحساب إلى رسمي بنجاح');
      },
      variant: 'primary',
    });
  };

  const handleQuickRenew = (user) => {
    setConfirmAction({
      user,
      title: 'تجديد اشتراك سريع',
      message: 'سيتم تمديد الوصول 30 يوماً إضافية للشبكة. هل أنت متأكد؟',
      action: async () => {
        const result = await renewNetwork(user.uid, 30);
        if (!result.ok) {
          toast.error(adminApiError(result.error, 'تعذر التجديد'));
          return false;
        }
        const endMs = Number(result.data?.subscriptionEndsAt) || null;
        const newEnd = endMs ? Timestamp.fromMillis(endMs) : null;
        setUsers((prev) => prev.map((u) => (u.uid === user.uid
          ? {
              ...u,
              accessStatus: 'ACTIVE_PAID',
              is_active: true,
              is_trial: false,
              accessNeedsRepair: false,
              subscriptionEndsAt: newEnd,
              subscription_end_date: newEnd,
            }
          : u)));
        logAdminAction({
          action: AUDIT_ACTIONS.USER_RENEW,
          targetType: 'user',
          targetId: user.uid,
          targetLabel: user.networkName || user.phoneNumber || user.uid,
          details: { subscriptionEndsAt: endMs },
        });
        toast.success('تم تجديد الاشتراك بنجاح لمدة 30 يوماً');
      },
      variant: 'success',
    });
  };

  const handleSaveEdit = async (uid, updates) => {
    const result = await updateNetworkAccess({ uid, ...updates });
    if (!result.ok) {
      toast.error(adminApiError(result.error, 'تعذر حفظ التعديلات'));
      return;
    }
    setUsers((prev) => prev.map((u) => (u.uid === uid
      ? {
          ...u,
          ...updates,
          is_active: updates.accessStatus === 'SUSPENDED_GRACE' || updates.accessStatus === 'LOCKED_EXPIRED'
            ? false
            : updates.accessStatus === 'TRIAL' || updates.accessStatus === 'ACTIVE_PAID'
              ? true
              : u.is_active,
          is_trial: updates.accessStatus === 'TRIAL'
            ? true
            : updates.accessStatus
              ? false
              : u.is_trial,
          ...(updates.phone_verified !== undefined ? {
            phone_verified: Boolean(updates.phone_verified),
            phoneVerified: Boolean(updates.phone_verified),
            ...(updates.phone_verified ? { phone_verified_manual: true } : {}),
          } : {}),
          ...(updates.subscriptionEndsAt != null ? {
            subscriptionEndsAt: Timestamp.fromMillis(Number(updates.subscriptionEndsAt)),
            subscription_end_date: Timestamp.fromMillis(Number(updates.subscriptionEndsAt)),
          } : {}),
          accessNeedsRepair: false,
        }
      : u)));
    setEditingUser(null);
    const edited = users.find((u) => u.uid === uid);
    logAdminAction({
      action: AUDIT_ACTIONS.USER_EDIT,
      targetType: 'user',
      targetId: uid,
      targetLabel: edited?.networkName || edited?.phoneNumber || uid,
      details: {
        commission_rate: updates.commission_rate ?? null,
        has_custom_warning: updates.has_custom_warning ?? null,
        subscriptionEndsAt: updates.subscriptionEndsAt ?? null,
        phone_verified: updates.phone_verified ?? null,
      },
    });
    toast.success('تم حفظ التعديلات بنجاح');
  };

  const handleManualPhoneVerify = (user) => {
    const isVerified = isUserPhoneVerified(user);
    const targetName = user.networkName || user.phoneNumber || user.uid;
    const phoneDisplay = user.phoneNumber || user.phone || 'غير مسجّل';

    if (!isVerified) {
      setConfirmAction({
        user,
        title: 'تفعيل التحقق من الهاتف يدوياً (للدعم الفني)',
        message: `هل تريد تفعيل واعتماد حساب «${targetName}» برقم الهاتف (${phoneDisplay}) يدوياً؟

ملاحظة للدعم الفني: يُستخدم هذا الإجراء لمساعدة المشتركين في حال تعذر وصول كود التحقق SMS بسبب مشاكل الشبكة أو تغطية المشغل. سيتم اعتماد الحساب فوراً كـ (phone_verified: true).`,
        variant: 'success',
        action: async () => {
          const result = await updateNetworkAccess({
            uid: user.uid,
            phone_verified: true,
          });
          if (!result.ok) {
            toast.error(adminApiError(result.error, 'تعذر تفعيل التحقق من الهاتف'));
            return false;
          }
          setUsers((prev) => prev.map((u) => (u.uid === user.uid
            ? {
                ...u,
                phone_verified: true,
                phoneVerified: true,
                phone_verified_at: new Date(),
                verified_by_admin: true,
                phone_verified_manual: true,
              }
            : u)));
          await logAdminAction({
            action: AUDIT_ACTIONS.USER_PHONE_VERIFY_MANUAL,
            targetType: 'user',
            targetId: user.uid,
            targetLabel: targetName,
            details: { phone: phoneDisplay, manual: true, reason: 'دعم فني - تفعيل يدوي' },
          }).catch(() => {});
          toast.success(`تم تفعيل وتوثيق حساب «${targetName}» برقم الهاتف بنجاح`);
          return true;
        },
      });
    } else {
      setConfirmAction({
        user,
        title: 'إلغاء توثيق الهاتف',
        message: `حساب «${targetName}» مفعل وموثّق بالهاتف حالياً (${phoneDisplay}). هل تريد إلغاء حالة التوثيق؟ (phone_verified: false)`,
        variant: 'danger',
        action: async () => {
          const result = await updateNetworkAccess({
            uid: user.uid,
            phone_verified: false,
          });
          if (!result.ok) {
            toast.error(adminApiError(result.error, 'تعذر إلغاء توثيق الهاتف'));
            return false;
          }
          setUsers((prev) => prev.map((u) => (u.uid === user.uid
            ? {
                ...u,
                phone_verified: false,
                phoneVerified: false,
                phone_verified_manual: false,
              }
            : u)));
          await logAdminAction({
            action: AUDIT_ACTIONS.USER_PHONE_UNVERIFY,
            targetType: 'user',
            targetId: user.uid,
            targetLabel: targetName,
            details: { phone: phoneDisplay },
          }).catch(() => {});
          toast.success(`تم إلغاء توثيق الهاتف لحساب «${targetName}»`);
          return true;
        },
      });
    }
  };

  const handleDeleteUser = (user) => {
    const targetName = user.networkName || user.network_name || user.phone || user.uid;
    setConfirmAction({
      title: 'حذف حساب المشترك والشبكة',
      message: `هل أنت متأكد من حذف الحساب «${targetName}»؟ سيتم حذف جميع بيانات المشترك والشبكة وسجلاتها نهائياً ولا يمكن التراجع عن هذا الإجراء.`,
      variant: 'danger',
      action: async () => {
        const result = await deleteNetworkAccount(user.uid);
        if (!result.ok) {
          toast.error(adminApiError(result.error, 'تعذر حذف الحساب'));
          return false;
        }
        await logAdminAction({
          action: AUDIT_ACTIONS.USER_DELETE,
          targetType: 'user',
          targetId: user.uid,
          targetLabel: targetName,
          details: { networkId: user.networkId || null },
        }).catch(() => {});
        toast.success(`تم حذف الحساب «${targetName}» بنجاح`);
        await refresh();
        return true;
      },
    });
  };

  const warningWindowMs = useMemo(() => {
    const days = Number(globalConfig?.warning_days_before_expiry) > 0
      ? Number(globalConfig.warning_days_before_expiry)
      : 5;
    return days * 86_400_000;
  }, [globalConfig]);

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const q = searchTerm.toLowerCase();
      const matchesSearch =
        (user.networkName || '').toLowerCase().includes(q) ||
        (user.network_name || '').toLowerCase().includes(q) ||
        (user.name || '').toLowerCase().includes(q) ||
        (user.phoneNumber || '').includes(q) ||
        (user.phone || '').includes(q) ||
        (user.networkId || '').toLowerCase().includes(q) ||
        String(user.app_version || '').toLowerCase().includes(q) ||
        String(user.app_version_code || '').includes(q) ||
        user.uid.toLowerCase().includes(q);

      if (filterType === 'active') return matchesSearch && user.is_active !== false;
      if (filterType === 'verified') return matchesSearch && isUserPhoneVerified(user);
      if (filterType === 'unverified') return matchesSearch && !isUserPhoneVerified(user);
      if (filterType === 'trial') return matchesSearch && user.is_trial === true;
      if (filterType === 'official') return matchesSearch && user.is_trial === false;
      if (filterType === 'blocked') return matchesSearch && user.is_active === false;
      if (filterType === 'update-needed') return matchesSearch && getAppUpdateStatus(user, globalConfig) === 'outdated';
      if (filterType === 'version-unknown') return matchesSearch && getAppUpdateStatus(user, globalConfig) === 'unknown';
      if (filterType === 'expired') return matchesSearch && isExpired(user.subscription_end_date);
      if (filterType === 'expiring') {
        if (!matchesSearch || isExpired(user.subscription_end_date)) return false;
        const endDate = toDate(user.subscription_end_date);
        if (!endDate) return false;
        return endDate.getTime() - Date.now() <= warningWindowMs;
      }
      return matchesSearch;
    });
  }, [users, searchTerm, filterType, warningWindowMs, globalConfig]);
  const orderedUsers = useMemo(() => {
    if (versionSort === 'none') return filteredUsers;
    return [...filteredUsers].sort((a, b) => {
      const rank = (user) => ({ outdated: 0, unknown: 1, current: 2 })[getAppUpdateStatus(user, globalConfig)];
      const byStatus = rank(a) - rank(b);
      if (byStatus) return byStatus;
      const codeDelta = (Number(a.app_version_code) || 0) - (Number(b.app_version_code) || 0);
      return versionSort === 'oldest' ? codeDelta : -codeDelta;
    });
  }, [filteredUsers, versionSort, globalConfig]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchTerm, filterType]);

  useEffect(() => {
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, filterType);
    } catch {
      // safe fallback
    }
  }, [filterType]);

  const visibleUsers = useMemo(
    () => orderedUsers.slice(0, visibleCount),
    [orderedUsers, visibleCount]
  );
  const hasMore = filteredUsers.length > visibleUsers.length;

  const stats = useMemo(() => {
    const total = users.length;
    const trial = users.filter((u) => u.is_trial === true).length;
    const official = users.filter((u) => u.is_trial === false).length;
    const active = users.filter((u) => u.is_active !== false).length;
    const blocked = users.filter((u) => u.is_active === false).length;
    const expired = users.filter((u) => isExpired(u.subscription_end_date)).length;
    const verified = users.filter((u) => isUserPhoneVerified(u)).length;
    const unverified = total - verified;
    return { total, trial, official, active, blocked, expired, verified, unverified };
  }, [users]);

  const accessRepairCount = users.filter((user) => user.accessNeedsRepair === true).length;

  const getUserBilling = (user) => user;

  const configuredGlobalCommission = Number(globalConfig?.default_commission_rate);
  const defaultCommission = globalConfig?.default_commission_rate != null
    && globalConfig.default_commission_rate !== ''
    && Number.isFinite(configuredGlobalCommission)
    ? configuredGlobalCommission
    : 5;
  const hasCustomCommission = (user) => user.commission_rate != null
    && user.commission_rate !== ''
    && Number.isFinite(Number(user.commission_rate));

  const handleExportUsers = useCallback(() => {
    if (!filteredUsers.length) {
      toast.error('لا توجد بيانات للتصدير');
      return;
    }
    downloadCsv(`users-${csvStamp()}`, filteredUsers, [
      { label: 'اسم الشبكة', value: (u) => u.networkName || '' },
      { label: 'رقم الهاتف', value: (u) => u.phoneNumber || '' },
      { label: 'حالة التحقق (phone_verified)', value: (u) => (isUserPhoneVerified(u) ? 'مفعّل (true)' : 'غير مفعّل (false)') },
      { label: 'النوع', value: (u) => (u.is_trial ? 'تجريبي' : 'رسمي') },
      { label: 'الحالة', value: (u) => (u.is_active === false ? 'محظور' : 'مفعّل') },
      { label: 'نسبة العمولة (%)', value: (u) => (hasCustomCommission(u) ? u.commission_rate : defaultCommission) },
      { label: 'إجمالي المبيعات (ر.ي)', value: (u) => { const b = getUserBilling(u); return b.reportedSalesValue || 0; } },
      { label: 'المبيعات المعتمدة خادمياً (ر.ي)', value: (u) => { const b = getUserBilling(u); return b.verifiedSalesValue ?? ((b.reportedSalesValue || 0) - (b.legacySalesValue || 0)); } },
      { label: 'مبيعات السجلات القديمة (ر.ي)', value: (u) => { const b = getUserBilling(u); return b.legacySalesValue || 0; } },
      { label: 'العمولة المعتمدة خادمياً (ر.ي)', value: (u) => { const b = getUserBilling(u); return b.verifiedOutstandingCommission ?? b.outstandingCommission ?? 0; } },
      { label: 'عمولات قديمة للمراجعة (ر.ي)', value: (u) => { const b = getUserBilling(u); return b.legacyEstimatedCommission || 0; } },
      { label: 'عدد المبيعات المعتمدة', value: (u) => { const b = getUserBilling(u); return b.verifiedTransactions || 0; } },
      { label: 'عدد السجلات القديمة', value: (u) => { const b = getUserBilling(u); return b.legacyTransactions || 0; } },
      { label: 'تاريخ التصفية', value: (u) => formatDate(u.subscription_end_date) },
      { label: 'معرّف الحساب', value: (u) => u.uid },
    ]);
    toast.success('تم تصدير بيانات المشتركين كملف CSV');
  }, [filteredUsers, defaultCommission]);

  if (loading && users.length === 0) {
    return (
      <div className="users-page space-y-4">
        <SkeletonPageHeader />
        <div className="grid grid-cols-2 gap-2.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="p-4 rounded-2xl bg-surface border border-line">
              <SkeletonLine className="w-1/2 mb-2" />
              <SkeletonLine className="w-3/4 h-6" />
            </div>
          ))}
        </div>
        <SkeletonCard lines={6} />
      </div>
    );
  }

  return (
    <div className="users-page space-y-4 pb-24">
      {/* Android Top Page Header */}
      <PageHero
        icon={Users}
        title="دليل المشتركين والشبكات"
        subtitle="إدارة حسابات الشبكات، الفوترة، وتجديد الاشتراكات"
        meta={`${users.length} حساب مسجّل • ${stats.active} نشط`}
        actions={
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center rounded-xl bg-surface border border-line p-0.5 shadow-xs" role="tablist" aria-label="نمط العرض">
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                  viewMode === 'cards'
                    ? 'bg-brand text-white shadow-xs'
                    : 'text-muted hover:text-ink'
                }`}
                title="عرض بطاقات المشتركين"
                aria-label="عرض البطاقات"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">بطاقات</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                  viewMode === 'table'
                    ? 'bg-brand text-white shadow-xs'
                    : 'text-muted hover:text-ink'
                }`}
                title="عرض جدول المشتركين مع عمود حالة التحقق بالهاتف (phone_verified)"
                aria-label="عرض جدول البيانات"
              >
                <List className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">جدول</span>
              </button>
            </div>
            <Button variant="secondary" size="sm" icon={Download} onClick={handleExportUsers}>
              تصدير CSV
            </Button>
            <DataFreshness
              lastSyncedAt={lastSyncAt}
              refreshing={loading || billingRefreshing}
              onRefresh={refresh}
            />
          </div>
        }
      />

      {error && (
        <div className="users-error" role="alert">
          <span className="users-error__icon"><AlertCircle className="w-5 h-5" /></span>
          <div className="users-error__body">
            <p className="users-error__title">تعذر تحميل البيانات</p>
            <p className="users-error__msg">{error}</p>
          </div>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refresh}>
            إعادة المحاولة
          </Button>
        </div>
      )}

      {/* Android Material 3 KPI Header (4 كروت أندرويد مصممة للهاتف) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="p-3.5 rounded-2xl bg-surface border border-line shadow-xs">
          <span className="text-[11px] font-bold text-muted block mb-1">إجمالي الشبكات</span>
          <p className="text-xl font-black text-ink font-mono">{formatNumber(stats.total)}</p>
          <span className="text-[10px] text-muted">حساب مسجل</span>
        </div>

        <div className="p-3.5 rounded-2xl bg-surface border border-line shadow-xs">
          <span className="text-[11px] font-bold text-emerald-600 block mb-1">حسابات نشطة</span>
          <p className="text-xl font-black text-emerald-600 font-mono">{formatNumber(stats.active)}</p>
          <span className="text-[10px] text-muted">مفعّلة وتعمل</span>
        </div>

        <div className="p-3.5 rounded-2xl bg-surface border border-line shadow-xs">
          <span className="text-[11px] font-bold text-amber-600 block mb-1">حسابات تجريبية</span>
          <p className="text-xl font-black text-amber-600 font-mono">{formatNumber(stats.trial)}</p>
          <span className="text-[10px] text-muted">فترة تجريبية</span>
        </div>

        <div className="p-3.5 rounded-2xl bg-surface border border-line shadow-xs">
          <span className="text-[11px] font-bold text-rose-600 block mb-1">محظورون / منتهية</span>
          <p className="text-xl font-black text-rose-600 font-mono">{formatNumber(stats.blocked + stats.expired)}</p>
          <span className="text-[10px] text-muted">بحاجة لمتابعة</span>
        </div>
      </div>

      {/* Android Top Search Bar with Clear Icon */}
      <div className="relative">
        <Search className="w-4 h-4 absolute right-3.5 top-3.5 text-muted pointer-events-none" />
        <input
          type="text"
          placeholder="ابحث باسم الشبكة، رقم الهاتف، المعرّف..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="input-field pr-10 text-xs py-2.5 rounded-xl bg-surface shadow-xs"
        />
        {searchTerm && (
          <button
            type="button"
            onClick={() => setSearchTerm('')}
            className="absolute left-3.5 top-3 text-muted hover:text-ink"
            aria-label="مسح البحث"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <label className="flex items-center gap-2 text-xs font-semibold text-muted">
        ترتيب الإصدارات
        <select className="input-field py-2 text-xs" value={versionSort} onChange={(e) => setVersionSort(e.target.value)}>
          <option value="none">الترتيب الافتراضي</option>
          <option value="oldest">الأقدم أولاً</option>
          <option value="newest">الأحدث أولاً</option>
        </select>
      </label>
      {/* Android Horizontal Filter Chips Carousel with Count Badges (قابلة للتمرير بالأصبع) */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar touch-pan-x">
        {FILTERS.map((f) => {
          let count = stats.total;
          if (f.value === 'active') count = stats.active;
          if (f.value === 'verified') count = stats.verified;
          if (f.value === 'unverified') count = stats.unverified;
          if (f.value === 'official') count = stats.official;
          if (f.value === 'trial') count = stats.trial;
          if (f.value === 'expired') count = stats.expired;
          if (f.value === 'blocked') count = stats.blocked;

          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilterType(f.value)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-all flex items-center gap-1.5 ${
                filterType === f.value
                  ? 'bg-brand text-white border-brand shadow-xs'
                  : 'bg-surface text-ink-soft border-line hover:bg-surface-sunken'
              }`}
            >
              <span>{f.label}</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${filterType === f.value ? 'bg-white/20 text-white' : 'bg-surface-sunken text-muted'}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>
      {/* عرض المشتركين: جدول بيانات (Table) أو بطاقات لمس (Cards) */}
      {filteredUsers.length === 0 ? (
        <Card className="p-8 text-center rounded-2xl">
          <span className="empty-state__icon icon-tile icon-tile--neutral icon-tile--lg mx-auto mb-3">
            <Inbox className="w-6 h-6" />
          </span>
          <p className="font-bold text-ink">لا يوجد مشتركون مطابقون</p>
          <p className="text-xs text-muted mt-1">
            {searchTerm || filterType !== 'all'
              ? 'جرّب تعديل كلمة البحث أو فلتر العرض.'
              : 'لم يتم تسجيل أي شبكة حتى الآن.'}
          </p>
        </Card>
      ) : viewMode === 'table' ? (
        /* ================= جدول المشتركين مع عمود حالة التحقق بالهاتف ================= */
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-xs">
            <table className="w-full text-right text-xs">
              <thead className="bg-surface-sunken/80 border-b border-line text-muted font-bold">
                <tr>
                  <th className="p-3 text-right">المشترك والشبكة</th>
                  <th className="p-3 text-right">رقم الهاتف</th>
                  <th className="p-3 text-right">حالة التحقق (phone_verified)</th>
                  <th className="p-3 text-right">النوع</th>
                  <th className="p-3 text-right">الحالة</th>
                  <th className="p-3 text-right">العمولة</th>
                  <th className="p-3 text-right">تاريخ الانتهاء</th>
                  <th className="p-3 text-right">المبيعات المكتملة</th>
                  <th className="p-3 text-right">العمولة المعتمدة</th>
                  <th className="p-3 text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {visibleUsers.map((user) => {
                  const billing = getUserBilling(user);
                  const expired = isExpired(user.subscription_end_date);
                  const networkTitle = user.networkName || `شبكة ${user.uid.slice(0, 8)}`;
                  const phoneStr = user.phoneNumber || user.phone || '';
                  const isVerified = isUserPhoneVerified(user);

                  return (
                    <tr
                      key={user.uid}
                      className="hover:bg-surface-sunken/40 transition-colors"
                    >
                      {/* المشترك والشبكة */}
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => navigate(`/users/${user.uid}`)}
                          className="flex items-center gap-2 text-right group"
                        >
                          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand/20 to-brand/5 border border-brand/20 text-brand-deep flex items-center justify-center font-black text-xs flex-shrink-0">
                            {networkTitle.charAt(0)}
                          </div>
                          <div>
                            <div className="font-extrabold text-ink group-hover:text-brand transition-colors flex items-center gap-1">
                              <span>{networkTitle}</span>
                              <ArrowUpLeft className="w-3 h-3 text-muted opacity-60" />
                            </div>
                            <span className="font-mono text-[10px] text-muted">{user.uid.slice(0, 10)}...</span>
                          </div>
                        </button>
                      </td>

                      {/* رقم الهاتف */}
                      <td className="p-3 font-mono" dir="ltr">
                        {phoneStr ? (
                          <a
                            href={`tel:${phoneStr}`}
                            className="text-xs text-muted hover:text-brand flex items-center gap-1 justify-end"
                          >
                            <Phone className="w-3 h-3 text-muted" />
                            <span>{phoneStr}</span>
                          </a>
                        ) : (
                          <span className="text-muted text-[11px]">—</span>
                        )}
                      </td>

                      {/* عمود حالة التحقق: phone_verified */}
                      <td className="p-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {isVerified ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                              <span>مفعّل (true)</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                              <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                              <span>غير مفعّل (false)</span>
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={() => handleManualPhoneVerify(user)}
                            className={`px-2 py-0.5 rounded-lg text-[10px] font-extrabold transition-all border ${
                              isVerified
                                ? 'bg-surface-sunken text-muted hover:text-rose-600 border-line hover:border-rose-300'
                                : 'bg-emerald-600 text-white hover:bg-emerald-700 border-emerald-600 shadow-xs'
                            }`}
                            title={isVerified ? 'إلغاء توثيق الهاتف' : 'تفعيل الحساب يدوياً برقم الهاتف (للدعم الفني)'}
                          >
                            {isVerified ? 'إلغاء التوثيق' : 'تفعيل يدوي (دعم فني)'}
                          </button>
                        </div>
                      </td>

                      {/* النوع */}
                      <td className="p-3 whitespace-nowrap">
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                          user.is_trial ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        }`}>
                          {user.is_trial ? 'تجريبي' : 'رسمي'}
                        </span>
                      </td>

                      {/* الحالة */}
                      <td className="p-3 whitespace-nowrap">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          user.is_active === false
                            ? 'bg-rose-100 text-rose-800 border border-rose-300'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}>
                          {user.is_active === false ? 'محظور' : 'نشط'}
                        </span>
                      </td>

                      {/* العمولة */}
                      <td className="p-3 whitespace-nowrap font-bold text-ink">
                        {hasCustomCommission(user)
                          ? <span className="text-brand font-black">{user.commission_rate}%</span>
                          : `${defaultCommission}%`}
                      </td>

                      {/* تاريخ الانتهاء */}
                      <td className={`p-3 whitespace-nowrap font-bold ${expired ? 'text-rose-600 font-black' : 'text-ink-soft'}`}>
                        {formatDate(user.subscription_end_date)}
                      </td>

                      {/* المبيعات المكتملة مع الفصل بين المعتمد والقديم */}
                      <td className="p-3 whitespace-nowrap font-mono">
                        <div className="font-bold text-ink">{formatNumber(billing.reportedSalesValue || 0)} ر.ي</div>
                        <div className="flex items-center gap-1.5 text-[10px] mt-0.5">
                          <span className="text-emerald-700 font-bold" title="مبيعات معتمدة خادمياً عبر Ingest">
                            {formatNumber(billing.verifiedTransactions || 0)} معتمدة
                          </span>
                          {(billing.legacyTransactions > 0 || billing.legacySalesValue > 0) && (
                            <>
                              <span className="text-muted">•</span>
                              <span className="text-amber-800 font-semibold" title="سجلات قديمة قيد المراجعة والتسوية">
                                {formatNumber(billing.legacyTransactions || 0)} قديمة
                              </span>
                            </>
                          )}
                        </div>
                      </td>
                      {/* العمولة المعتمدة خادمياً وفصل العمولات القديمة */}
                      <td className="p-3 whitespace-nowrap font-mono">
                        <div className="font-bold text-emerald-600">
                          {formatNumber(billing.verifiedOutstandingCommission ?? 0)} ر.ي
                        </div>
                        {(billing.legacyEstimatedCommission > 0) && (
                          <div className="text-[10px] text-amber-800 font-semibold mt-0.5" title="عمولات تقديرية لسجلات قديمة للمراجعة والتسوية اليدوية">
                            + {formatNumber(billing.legacyEstimatedCommission)} ر.ي قديمة
                          </div>
                        )}
                      </td>

                      {/* الإجراءات */}
                      <td className="p-3 whitespace-nowrap text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => setBillingUser(user)}
                            className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                            title="الفوترة والدفعات"
                          >
                            <DollarSign className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleQuickRenew(user)}
                            className="p-1.5 rounded-lg bg-brand-soft/40 text-brand-deep hover:bg-brand-soft/60 transition-colors"
                            title="تجديد الاشتراك"
                            aria-label={`تجديد اشتراك: ${user.networkName || "المستخدم"}`}
                          >
                            <CalendarPlus className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingUser(user)}
                            className="p-1.5 rounded-lg bg-surface-sunken text-ink hover:bg-line/40 transition-colors"
                            title="تعديل الإعدادات"
                            aria-label={`تعديل إعدادات: ${user.networkName || "المستخدم"}`}
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setAuthUser(user)}
                            className="p-1.5 rounded-lg bg-surface-sunken text-ink hover:bg-line/40 transition-colors"
                            title="بيانات الدخول"
                            aria-label={`بيانات الدخول وكلمة المرور: ${user.networkName || "المستخدم"}`}
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleActive(user)}
                            className={`p-1.5 rounded-lg transition-colors ${
                              user.is_active === false
                                ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                            }`}
                            title={user.is_active === false ? 'إلغاء الحظر' : 'حظر'}
                            aria-label={user.is_active === false ? 'إلغاء حظر المستخدم' : 'حظر المستخدم'}
                          >
                            {user.is_active === false ? <UserCheck className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteUser(user)}
                            className="p-1.5 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors"
                            title="حذف الحساب"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <Button
              variant="secondary"
              size="md"
              block
              onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
              className="rounded-xl font-bold mt-2"
            >
              عرض المزيد من المشتركين ({filteredUsers.length - visibleUsers.length} متبقٍ)
            </Button>
          )}
        </div>
      ) : (
        /* ================= بطاقات المشتركين بنمط أندرويد اللمسي ================= */
        <div className="space-y-3">
          {visibleUsers.map((user) => {
            const billing = getUserBilling(user);
            const expired = isExpired(user.subscription_end_date);
            const networkTitle = user.networkName || `شبكة ${user.uid.slice(0, 8)}`;
            const phoneStr = user.phoneNumber || user.phone || '';
            const isVerified = isUserPhoneVerified(user);

            return (
              <div
                key={user.uid}
                tabIndex={0}
                role="button"
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigate(`/users/${user.uid}`);
                  }
                }}
                className="p-3.5 sm:p-4 rounded-2xl bg-surface border border-line shadow-xs space-y-3 hover:border-brand/40 transition-all"
              >
                {/* رأس بطاقة المشترك */}
                <div className="flex items-start justify-between gap-2">
                  <div
                    className="flex items-start gap-2.5 cursor-pointer flex-1 min-w-0"
                    onClick={() => navigate(`/users/${user.uid}`)}
                  >
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-brand/20 to-brand/5 border border-brand/20 text-brand-deep flex items-center justify-center font-black text-base flex-shrink-0">
                      {networkTitle.charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-sm font-extrabold text-ink truncate leading-tight">{networkTitle}</h3>
                        <ArrowUpLeft className="w-3.5 h-3.5 text-muted opacity-60 flex-shrink-0" />
                      </div>
                      {phoneStr ? (
                        <div className="flex items-center gap-2 flex-wrap mt-0.5">
                          <a
                            href={`tel:${phoneStr}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs text-muted hover:text-brand flex items-center gap-1"
                            dir="ltr"
                          >
                            <Phone className="w-3 h-3 text-muted" />
                            <span>{phoneStr}</span>
                          </a>

                          {/* شارة حالة التحقق برقم الهاتف */}
                          {isVerified ? (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-black px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300"
                              title="الحساب مفعّل برقم الهاتف (phone_verified: true)"
                            >
                              <ShieldCheck className="w-3 h-3 text-emerald-600" />
                              <span>مفعّل بالهاتف (true)</span>
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-800 border border-amber-300"
                              title="الحساب غير مفعّل بالهاتف (phone_verified: false) - بانتظار كود التحقق"
                            >
                              <ShieldAlert className="w-3 h-3 text-amber-600" />
                              <span>غير مفعّل (false)</span>
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-xs text-muted">بدون هاتف</p>
                          <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 rounded border border-amber-200">
                            غير مفعّل
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* شارات الحالة */}
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                      user.is_trial ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    }`}>
                      {user.is_trial ? 'تجريبي' : 'رسمي'}
                    </span>
                    {user.is_active === false && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300">
                        محظور
                      </span>
                    )}
                  </div>
                </div>

                {/* مقاييس البطاقة (2x2 Grid للموبايل واضحة جداً) */}
                <div
                  className="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-surface-sunken/60 border border-line/60 cursor-pointer text-xs"
                  onClick={() => navigate(`/users/${user.uid}`)}
                >
                  <div>
                    <span className="text-[10px] text-muted block font-semibold">نسبة العمولة</span>
                    <span className="font-bold text-ink">
                      {hasCustomCommission(user)
                        ? <span className="text-brand font-black">{user.commission_rate}% (خاصة)</span>
                        : `${defaultCommission}% (عامة)`}
                    </span>
                  </div>

                  <div className="text-left">
                    <span className="text-[10px] text-muted block font-semibold">تاريخ الانتهاء</span>
                    <span className={`font-bold ${expired ? 'text-rose-600 font-black' : 'text-ink-soft'}`}>
                      {formatDate(user.subscription_end_date)}
                    </span>
                  </div>

                  <div className="pt-1 border-t border-line/40">
                    <span className="text-[10px] text-muted block font-semibold">المبيعات المكتملة</span>
                    <span className="font-mono font-black text-ink">{formatNumber(billing.reportedSalesValue || 0)} ر.ي</span>
                    <div className="flex items-center gap-1 text-[10px] mt-0.5">
                      <span className="text-emerald-700 font-bold">{formatNumber(billing.verifiedTransactions || 0)} معتمدة</span>
                      {(billing.legacyTransactions > 0) && (
                        <>
                          <span className="text-muted">•</span>
                          <span className="text-amber-800 font-semibold">{formatNumber(billing.legacyTransactions)} قديمة</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="pt-1 border-t border-line/40 text-left">
                    <span className="text-[10px] text-muted block font-semibold">العمولة المعتمدة خادمياً</span>
                    <span className="font-mono font-black text-emerald-600">{formatNumber(billing.verifiedOutstandingCommission ?? 0)} ر.ي</span>
                    {(billing.legacyEstimatedCommission > 0) && (
                      <span className="text-[10px] text-amber-800 block truncate" title="عمولات تقديرية لسجلات قديمة للمراجعة والتسوية اليدوية">
                        + {formatNumber(billing.legacyEstimatedCommission)} ر.ي قديمة
                      </span>
                    )}
                  </div>
                </div>

                {/* شريط الإجراءات السريعة بنمط أندرويد (Touch targets مريحة) */}
                <div
                  className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 pt-1 border-t border-line/60"
                  onClick={(event) => event.stopPropagation()}
                >
                  {/* الفوترة */}
                  <button
                    type="button"
                    onClick={() => setBillingUser(user)}
                    className="flex flex-col items-center justify-center p-2 rounded-xl bg-emerald-50 text-emerald-800 hover:bg-emerald-100 transition-colors text-[11px] font-bold gap-1 active:scale-95"
                    title="الفوترة والدفعات"
                  >
                    <DollarSign className="w-4 h-4 text-emerald-600" />
                    <span>الفوترة</span>
                  </button>

                  {/* تجديد */}
                  <button
                    type="button"
                    onClick={() => handleQuickRenew(user)}
                    className="flex flex-col items-center justify-center p-2 rounded-xl bg-brand-soft/40 text-brand-deep hover:bg-brand-soft/60 transition-colors text-[11px] font-bold gap-1 active:scale-95"
                    title="تجديد"
                    aria-label={`تجديد اشتراك: ${user.networkName || "المستخدم"}`}
                  >
                    <CalendarPlus className="w-4 h-4 text-brand" />
                    <span>تجديد</span>
                  </button>

                  {/* تعديل */}
                  <button
                    type="button"
                    onClick={() => setEditingUser(user)}
                    className="flex flex-col items-center justify-center p-2 rounded-xl bg-surface-sunken text-ink hover:bg-line/40 transition-colors text-[11px] font-bold gap-1 active:scale-95"
                    title="تعديل"
                    aria-label={`تعديل إعدادات: ${user.networkName || "المستخدم"}`}
                  >
                    <Edit className="w-4 h-4 text-muted" />
                    <span>تعديل</span>
                  </button>

                  {/* بيانات الدخول */}
                  <button
                    type="button"
                    onClick={() => setAuthUser(user)}
                    className="flex flex-col items-center justify-center p-2 rounded-xl bg-surface-sunken text-ink hover:bg-line/40 transition-colors text-[11px] font-bold gap-1 active:scale-95"
                    title="بيانات الدخول"
                    aria-label={`بيانات الدخول وكلمة المرور: ${user.networkName || "المستخدم"}`}
                  >
                    <KeyRound className="w-4 h-4 text-muted" />
                    <span>الدخول</span>
                  </button>

                  {/* التفعيل اليدوي برقم الهاتف (للدعم الفني) */}
                  <button
                    type="button"
                    onClick={() => handleManualPhoneVerify(user)}
                    className={`flex flex-col items-center justify-center p-2 rounded-xl text-[11px] font-bold gap-1 active:scale-95 transition-colors ${
                      isVerified
                        ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                        : 'bg-amber-50 text-amber-900 hover:bg-amber-100 border border-amber-200 shadow-xs'
                    }`}
                    title={isVerified ? 'إلغاء توثيق الهاتف' : 'تفعيل الحساب يدوياً برقم الهاتف (للدعم الفني)'}
                    aria-label={`تفعيل التحقق من الهاتف: ${user.networkName || "المستخدم"}`}
                  >
                    {isVerified ? (
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <ShieldAlert className="w-4 h-4 text-amber-600" />
                    )}
                    <span>{isVerified ? 'الهاتف مفعّل' : 'تفعيل يدوي'}</span>
                  </button>

                  {/* حظر / تفعيل */}
                  <button
                    type="button"
                    onClick={() => handleToggleActive(user)}
                    className={`flex flex-col items-center justify-center p-2 rounded-xl text-[11px] font-bold gap-1 active:scale-95 transition-colors ${
                      user.is_active === false
                        ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                        : 'bg-rose-50 text-rose-800 hover:bg-rose-100'
                    }`}
                    title={user.is_active === false ? 'إلغاء الحظر' : 'حظر'}
                    aria-label={user.is_active === false ? 'إلغاء حظر المستخدم' : 'حظر المستخدم'}
                  >
                    {user.is_active === false ? <UserCheck className="w-4 h-4 text-emerald-600" /> : <Ban className="w-4 h-4 text-rose-600" />}
                    <span>{user.is_active === false ? 'تفعيل' : 'حظر'}</span>
                  </button>

                  {/* حذف الحساب (تجريبي أو نهائي) */}
                  <button
                    type="button"
                    onClick={() => handleDeleteUser(user)}
                    className="flex flex-col items-center justify-center p-2 rounded-xl bg-rose-50 text-rose-800 hover:bg-rose-100 transition-colors text-[11px] font-bold gap-1 active:scale-95"
                    title="حذف الحساب نهائياً"
                  >
                    <Trash2 className="w-4 h-4 text-rose-600" />
                    <span>حذف</span>
                  </button>
                </div>
              </div>
            );
          })}

          {hasMore && (
            <Button
              variant="secondary"
              size="md"
              block
              onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
              className="rounded-xl font-bold mt-2"
            >
              عرض المزيد من المشتركين ({filteredUsers.length - visibleUsers.length} متبقٍ)
            </Button>
          )}
        </div>
      )}

      {/* Modals */}
      {editingUser && (
        <UserEditModal
          user={editingUser}
          isOpen={!!editingUser}
          onClose={() => setEditingUser(null)}
          onSave={handleSaveEdit}
        />
      )}

      {billingUser && (
        <UserBillingModal
          user={billingUser}
          isOpen={!!billingUser}
          onClose={() => setBillingUser(null)}
          onRefresh={refresh}
        />
      )}

      {authUser && (
        <UserAuthModal
          user={authUser}
          isOpen={!!authUser}
          onClose={() => setAuthUser(null)}
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
        variant={confirmAction?.variant || 'primary'}
      />
    </div>
  );
}
