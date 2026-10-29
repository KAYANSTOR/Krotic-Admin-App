import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Timestamp } from 'firebase/firestore';
import { AlertCircle, Inbox, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

import { useLocalQuery } from '../lib/localDb/useLocalQuery';
import { useLocalDb } from '../lib/localDb/LocalDbContext';
import { loadLocalConfig, loadLocalUsersWithBilling } from '../lib/localDb/localData';

import { Card } from '../components/ui/Card';
import Button from '../components/ui/Button';
import { SkeletonLine, SkeletonPageHeader, SkeletonCard } from '../components/ui/Skeleton';
import UserEditModal from '../components/UserEditModal';
import UserBillingModal from '../components/UserBillingModal';
import UserAuthModal from '../components/UserAuthModal';
import ConfirmDialog from '../components/ConfirmDialog';

import UsersHeader from '../components/users/UsersHeader';
import UsersStats from '../components/users/UsersStats';
import UsersFilters from '../components/users/UsersFilters';
import UserCard from '../components/users/UserCard';
import UserTableRow from '../components/users/UserTableRow';

import { formatDate, isExpired } from '../lib/format';
import { renewNetwork, updateNetworkAccess, deleteNetworkAccount, adminApiError } from '../lib/adminApi';
import { downloadCsv, csvStamp } from '../lib/csv';
import { logAdminAction, AUDIT_ACTIONS } from '../lib/auditLog';
import { isUserPhoneVerified } from '../lib/accessStatus';
import useAppRefresh from '../lib/useAppRefresh';
import { hasExpiryCompatibilityGap } from '../lib/users/accessHelpers';
import {
  PAGE_SIZE,
  VIEW_MODES,
  VIEW_MODE_STORAGE_KEY,
  FILTER_STORAGE_KEY,
  DEFAULT_WARNING_DAYS,
  loadSavedViewMode,
  resolveInitialFilter,
} from '../lib/users/constants';
import {
  useUsersFilter,
  useUsersFilterCounts,
  useUsersPagination,
} from '../hooks/users/useUsersFilter';

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [globalConfig, setGlobalConfig] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState(resolveInitialFilter);
  const [versionSort, setVersionSort] = useState('none');
  const [viewMode, setViewMode] = useState(loadSavedViewMode);

  const [editingUser, setEditingUser] = useState(null);
  const [billingUser, setBillingUser] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [confirmAction, setConfirmAction] = useState(null);
  const hasLoadedUsers = useRef(false);

  const { runSync, syncing, lastSyncAt } = useLocalDb();

  // Users and billing data are read from the local database, not Firestore.
  const usersQuery = useLocalQuery((localDb) => loadLocalUsersWithBilling(localDb), []);
  const configQuery = useLocalQuery((localDb) => loadLocalConfig(localDb), []);

  useEffect(() => {
    if (!usersQuery.data) return;
    setUsers(usersQuery.data.users);
    hasLoadedUsers.current = true;
  }, [usersQuery.data]);

  useEffect(() => {
    if (configQuery.data) setGlobalConfig(configQuery.data);
  }, [configQuery.data]);

  const loading = usersQuery.loading && !hasLoadedUsers.current;
  const error = usersQuery.error ? 'تعذر تحميل بيانات المستخدمين. حاول مرة أخرى.' : null;

  const refresh = useCallback(async () => {
    await runSync({ reason: 'manual' });
    usersQuery.refresh();
    configQuery.refresh();
  }, [runSync, usersQuery, configQuery]);

  useAppRefresh(refresh);

  // ============ Business handlers: preserved from the original page ============

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
        setUsers((prev) => prev.map((currentUser) => (currentUser.uid === user.uid
          ? {
              ...currentUser,
              accessStatus: newStatus ? 'ACTIVE_PAID' : 'SUSPENDED_GRACE',
              is_active: newStatus,
              is_trial: false,
              accessNeedsRepair: hasExpiryCompatibilityGap(currentUser),
            }
          : currentUser)));
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
        setUsers((prev) => prev.map((currentUser) => (currentUser.uid === user.uid
          ? {
              ...currentUser,
              accessStatus: 'ACTIVE_PAID',
              is_active: true,
              is_trial: false,
              accessNeedsRepair: false,
              subscriptionEndsAt: newEnd,
              subscription_end_date: newEnd,
            }
          : currentUser)));
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
    setUsers((prev) => prev.map((user) => {
      if (user.uid !== uid) return user;
      return {
        ...user,
        ...updates,
        is_active: updates.accessStatus === 'SUSPENDED_GRACE' || updates.accessStatus === 'LOCKED_EXPIRED'
          ? false
          : updates.accessStatus === 'TRIAL' || updates.accessStatus === 'ACTIVE_PAID'
            ? true
            : user.is_active,
        is_trial: updates.accessStatus === 'TRIAL'
          ? true
          : updates.accessStatus
            ? false
            : user.is_trial,
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
      };
    }));
    setEditingUser(null);
    const edited = users.find((user) => user.uid === uid);
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
          setUsers((prev) => prev.map((currentUser) => (currentUser.uid === user.uid
            ? {
                ...currentUser,
                phone_verified: true,
                phoneVerified: true,
                phone_verified_at: new Date(),
                verified_by_admin: true,
                phone_verified_manual: true,
              }
            : currentUser)));
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
          setUsers((prev) => prev.map((currentUser) => (currentUser.uid === user.uid
            ? {
                ...currentUser,
                phone_verified: false,
                phoneVerified: false,
                phone_verified_manual: false,
              }
            : currentUser)));
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

  // ============ Derived state ============

  const warningWindowMs = useMemo(() => {
    const days = Number(globalConfig?.warning_days_before_expiry) > 0
      ? Number(globalConfig.warning_days_before_expiry)
      : DEFAULT_WARNING_DAYS;
    return days * 86_400_000;
  }, [globalConfig]);

  const { filteredUsers, orderedUsers } = useUsersFilter(users, {
    searchTerm,
    filterType,
    versionSort,
    warningWindowMs,
    globalConfig,
  });
  const filterCounts = useUsersFilterCounts(users, globalConfig, warningWindowMs);
  const visibleUsers = useUsersPagination(orderedUsers, visibleCount);
  const hasMore = filteredUsers.length > visibleUsers.length;

  const stats = useMemo(() => {
    const total = users.length;
    const trial = users.filter((user) => user.is_trial === true).length;
    const active = users.filter((user) => user.is_active !== false).length;
    const blocked = users.filter((user) => user.is_active === false).length;
    const expired = users.filter((user) => isExpired(user.subscription_end_date)).length;
    return { total, trial, active, blocked, expired };
  }, [users]);

  const defaultCommission = useMemo(() => {
    const commission = Number(globalConfig?.default_commission_rate);
    return globalConfig?.default_commission_rate != null
      && globalConfig.default_commission_rate !== ''
      && Number.isFinite(commission)
      ? commission
      : 5;
  }, [globalConfig]);

  const hasCustomCommission = useCallback((user) => (
    user.commission_rate != null
      && user.commission_rate !== ''
      && Number.isFinite(Number(user.commission_rate))
  ), []);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchTerm, filterType]);

  useEffect(() => {
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, filterType);
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
    } catch {
      // Storage may be unavailable in private browsing or restricted contexts.
    }
  }, [filterType, viewMode]);

  const handleExportUsers = useCallback(() => {
    if (!filteredUsers.length) {
      toast.error('لا توجد بيانات للتصدير');
      return;
    }
    downloadCsv(`users-${csvStamp()}`, filteredUsers, [
      { label: 'اسم الشبكة', value: (user) => user.networkName || '' },
      { label: 'رقم الهاتف', value: (user) => user.phoneNumber || '' },
      { label: 'حالة التحقق (phone_verified)', value: (user) => (isUserPhoneVerified(user) ? 'مفعّل (true)' : 'غير مفعّل (false)') },
      { label: 'النوع', value: (user) => (user.is_trial ? 'تجريبي' : 'رسمي') },
      { label: 'الحالة', value: (user) => (user.is_active === false ? 'محظور' : 'مفعّل') },
      { label: 'نسبة العمولة (%)', value: (user) => (hasCustomCommission(user) ? user.commission_rate : defaultCommission) },
      { label: 'إجمالي المبيعات (ر.ي)', value: (user) => user.reportedSalesValue || 0 },
      { label: 'المبيعات المعتمدة خادمياً (ر.ي)', value: (user) => user.verifiedSalesValue ?? ((user.reportedSalesValue || 0) - (user.legacySalesValue || 0)) },
      { label: 'مبيعات السجلات القديمة (ر.ي)', value: (user) => user.legacySalesValue || 0 },
      { label: 'العمولة المعتمدة خادمياً (ر.ي)', value: (user) => user.verifiedOutstandingCommission ?? user.outstandingCommission ?? 0 },
      { label: 'عمولات قديمة للمراجعة (ر.ي)', value: (user) => user.legacyEstimatedCommission || 0 },
      { label: 'عدد المبيعات المعتمدة', value: (user) => user.verifiedTransactions || 0 },
      { label: 'عدد السجلات القديمة', value: (user) => user.legacyTransactions || 0 },
      { label: 'تاريخ التصفية', value: (user) => formatDate(user.subscription_end_date) },
      { label: 'معرّف الحساب', value: (user) => user.uid },
    ]);
    toast.success('تم تصدير بيانات المشتركين كملف CSV');
  }, [filteredUsers, defaultCommission, hasCustomCommission]);

  const actionProps = (user) => ({
    onBilling: () => setBillingUser(user),
    onRenew: () => handleQuickRenew(user),
    onEdit: () => setEditingUser(user),
    onAuth: () => setAuthUser(user),
    onVerify: () => handleManualPhoneVerify(user),
    onToggle: () => handleToggleActive(user),
    onDelete: () => handleDeleteUser(user),
  });

  if (loading && users.length === 0) {
    return (
      <div className="users-page space-y-4">
        <SkeletonPageHeader />
        <div className="grid grid-cols-2 gap-2.5">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="p-4 rounded-2xl bg-surface border border-line">
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
    <div className="users-page space-y-3.5 pb-24">
      <UsersHeader
        totalUsers={stats.total}
        activeUsers={stats.active}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExport={handleExportUsers}
        lastSyncAt={lastSyncAt}
        refreshing={loading || syncing}
        onRefresh={refresh}
      />

      {error && (
        <div className="users-error" role="alert">
          <span className="users-error__icon"><AlertCircle className="w-5 h-5" aria-hidden="true" /></span>
          <div className="users-error__body">
            <p className="users-error__title">تعذر تحميل البيانات</p>
            <p className="users-error__msg">{error}</p>
          </div>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refresh}>
            إعادة المحاولة
          </Button>
        </div>
      )}

      <UsersStats stats={stats} />

      <UsersFilters
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        filterType={filterType}
        onFilterChange={setFilterType}
        filterCounts={filterCounts}
        versionSort={versionSort}
        onVersionSortChange={setVersionSort}
      />

      {filteredUsers.length === 0 ? (
        <Card className="p-8 text-center rounded-2xl">
          <span className="empty-state__icon icon-tile icon-tile--neutral icon-tile--lg mx-auto mb-3">
            <Inbox className="w-6 h-6" aria-hidden="true" />
          </span>
          <p className="font-bold text-ink">لا يوجد مشتركون مطابقون</p>
          <p className="text-xs text-muted mt-1">
            {searchTerm || filterType !== 'all'
              ? 'جرّب تعديل كلمة البحث أو الفلتر.'
              : 'لم يتم تسجيل أي شبكة حتى الآن.'}
          </p>
        </Card>
      ) : viewMode === VIEW_MODES.TABLE ? (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-xs">
            <table className="w-full text-right text-xs">
              <thead className="bg-surface-sunken/80 border-b border-line text-muted font-bold">
                <tr>
                  <th className="p-3 text-right">المشترك والشبكة</th>
                  <th className="p-3 text-right">رقم الهاتف</th>
                  <th className="p-3 text-right">التحقق</th>
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
                {visibleUsers.map((user) => (
                  <UserTableRow
                    key={user.uid}
                    user={user}
                    defaultCommission={defaultCommission}
                    hasCustomCommission={hasCustomCommission}
                    {...actionProps(user)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <Button
              variant="secondary"
              size="md"
              block
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            >
              عرض المزيد من المشتركين ({filteredUsers.length - visibleUsers.length} متبقٍ)
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleUsers.map((user) => (
            <UserCard
              key={user.uid}
              user={user}
              defaultCommission={defaultCommission}
              hasCustomCommission={hasCustomCommission}
              {...actionProps(user)}
            />
          ))}
          {hasMore && (
            <Button
              variant="secondary"
              size="md"
              block
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            >
              عرض المزيد من المشتركين ({filteredUsers.length - visibleUsers.length} متبقٍ)
            </Button>
          )}
        </div>
      )}

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
