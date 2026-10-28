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

  // Handlers and main UI body continue — full decluttered implementation in next commit on this branch
  return (
    <div className="users-page space-y-3.5 pb-24 p-4">
      <p className="text-muted text-sm">جاري استكمال واجهة المستخدمين المنظّفة…</p>
    </div>
  );
}
