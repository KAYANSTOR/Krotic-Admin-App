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
  { value: 'verified', label: 'موثّق' },
  { value: 'unverified', label: 'غير موثّق' },
  { value: 'official', label: 'رسمي' },
  { value: 'trial', label: 'تجريبي' },
  { value: 'expiring', label: 'ينتهي قريباً' },
  { value: 'expired', label: 'منتهي' },
  { value: 'blocked', label: 'محظور' },
  { value: 'update-needed', label: 'يحتاج تحديث' },
  { value: 'version-unknown', label: 'إصدار مجهول' },
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
        title: 'توثيق الهاتف يدوياً',
        message: `توثيق حساب «${targetName}» (${phoneDisplay}) يدوياً؟ يُستخدم عند تعذر وصول رمز SMS.`,
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
        message: `إلغاء توثيق «${targetName}» (${phoneDisplay})؟`,
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
      message: `حذف حساب «${targetName}» نهائياً مع كل بياناته؟ لا يمكن التراجع.`,
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

  // PLACEHOLDER_END_PART1 — full JSX return will be appended in next commit
  return null;
}
