import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Timestamp } from 'firebase/firestore';
import {
  Users, Phone, Calendar, DollarSign, Download,
  CalendarPlus, Edit, KeyRound, ShieldCheck, ShieldAlert,
  UserCheck, Ban, Trash2, Inbox, AlertCircle, RefreshCw, MoreVertical,
  CheckCircle2, Clock,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { useLocalQuery } from '../lib/localDb/useLocalQuery';
import { useLocalDb } from '../lib/localDb/LocalDbContext';
import { loadLocalConfig, loadLocalUsersWithBilling } from '../lib/localDb/localData';

import Button from '../components/ui/Button';
import { SkeletonLine, SkeletonPageHeader, SkeletonCard } from '../components/ui/Skeleton';
import UserEditModal from '../components/UserEditModal';
import UserBillingModal from '../components/UserBillingModal';
import UserAuthModal from '../components/UserAuthModal';
import ConfirmDialog from '../components/ConfirmDialog';
import SearchHeader from '../components/ui/SearchHeader';
import HeroMetric from '../components/ui/HeroMetric';
import StatPills from '../components/ui/StatPills';
import DataCard from '../components/ui/DataCard';
import OverflowMenu from '../components/ui/OverflowMenu';
import FilterSheet from '../components/ui/FilterSheet';
import FAB from '../components/ui/FAB';
import useInfiniteScroll from '../hooks/useInfiniteScroll';

import { formatNumber, formatDate, isExpired } from '../lib/format';
import { renewNetwork, updateNetworkAccess, deleteNetworkAccount, adminApiError } from '../lib/adminApi';
import { downloadCsv, csvStamp } from '../lib/csv';
import { logAdminAction, AUDIT_ACTIONS } from '../lib/auditLog';
import { isUserPhoneVerified } from '../lib/accessStatus';
import useAppRefresh from '../lib/useAppRefresh';
import { hasExpiryCompatibilityGap } from '../lib/users/accessHelpers';
import {
  PAGE_SIZE, FILTERS, FILTER_STORAGE_KEY,
  DEFAULT_WARNING_DAYS, resolveInitialFilter,
} from '../lib/users/constants';
import { useUsersFilter, useUsersFilterCounts } from '../hooks/users/useUsersFilter';

export default function UsersPage() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [globalConfig, setGlobalConfig] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState(resolveInitialFilter);
  const [versionSort, setVersionSort] = useState('none');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [menuUser, setMenuUser] = useState(null);

  const [editingUser, setEditingUser] = useState(null);
  const [billingUser, setBillingUser] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [confirmAction, setConfirmAction] = useState(null);
  const hasLoadedUsers = useRef(false);

  const { runSync, syncing, lastSyncAt } = useLocalDb();

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
  const error = usersQuery.error ? 'تعذر تحميل بيانات المستخدمين.' : null;

  const refresh = useCallback(async () => {
    await runSync({ reason: 'manual' });
    usersQuery.refresh();
    configQuery.refresh();
  }, [runSync, usersQuery, configQuery]);

  useAppRefresh(refresh);

  // ====== Handlers (منقولة حرفيًا) ======
  const handleToggleActive = (user) => {
    const newStatus = !user.is_active;
    setConfirmAction({
      title: newStatus ? 'تفعيل المشترك' : 'حظر المشترك',
      message: newStatus
        ? `هل تريد تفعيل حساب "${user.networkName || user.uid}"؟`
        : `هل تريد حظر "${user.networkName || user.uid}"؟ سيتم منعه فوراً.`,
      variant: newStatus ? 'success' : 'danger',
      action: async () => {
        const result = await updateNetworkAccess({
          uid: user.uid,
          accessStatus: newStatus ? 'ACTIVE_PAID' : 'SUSPENDED_GRACE',
        });
        if (!result.ok) { toast.error(adminApiError(result.error, 'تعذر التحديث')); return false; }
        setUsers((prev) => prev.map((u) => (u.uid === user.uid ? {
          ...u, accessStatus: newStatus ? 'ACTIVE_PAID' : 'SUSPENDED_GRACE',
          is_active: newStatus, is_trial: false,
          accessNeedsRepair: hasExpiryCompatibilityGap(u),
        } : u)));
        logAdminAction({
          action: newStatus ? AUDIT_ACTIONS.USER_ACTIVATE : AUDIT_ACTIONS.USER_BLOCK,
          targetType: 'user', targetId: user.uid,
          targetLabel: user.networkName || user.phoneNumber || user.uid,
        }).catch(() => {});
        toast.success(newStatus ? 'تم التفعيل' : 'تم الحظر');
      },
    });
  };

  const handleQuickRenew = (user) => {
    setConfirmAction({
      title: 'تجديد سريع',
      message: 'سيتم تمديد الوصول 30 يوماً.',
      variant: 'success',
      action: async () => {
        const result = await renewNetwork(user.uid, 30);
        if (!result.ok) { toast.error(adminApiError(result.error, 'تعذر التجديد')); return false; }
        const endMs = Number(result.data?.subscriptionEndsAt) || null;
        const newEnd = endMs ? Timestamp.fromMillis(endMs) : null;
        setUsers((prev) => prev.map((u) => (u.uid === user.uid ? {
          ...u, accessStatus: 'ACTIVE_PAID', is_active: true, is_trial: false,
          accessNeedsRepair: false, subscriptionEndsAt: newEnd, subscription_end_date: newEnd,
        } : u)));
        logAdminAction({
          action: AUDIT_ACTIONS.USER_RENEW, targetType: 'user', targetId: user.uid,
          targetLabel: user.networkName || user.phoneNumber || user.uid,
          details: { subscriptionEndsAt: endMs },
        }).catch(() => {});
        toast.success('تم التجديد 30 يوماً');
      },
    });
  };

  const handleSaveEdit = async (uid, updates) => {
    const result = await updateNetworkAccess({ uid, ...updates });
    if (!result.ok) { toast.error(adminApiError(result.error, 'تعذر الحفظ')); return; }
    setUsers((prev) => prev.map((u) => (u.uid === uid ? {
      ...u, ...updates,
      is_active: updates.accessStatus === 'SUSPENDED_GRACE' || updates.accessStatus === 'LOCKED_EXPIRED'
        ? false
        : updates.accessStatus === 'TRIAL' || updates.accessStatus === 'ACTIVE_PAID'
          ? true : u.is_active,
      is_trial: updates.accessStatus === 'TRIAL' ? true : updates.accessStatus ? false : u.is_trial,
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
    } : u)));
    setEditingUser(null);
    toast.success('تم حفظ التعديلات');
  };

  const handleManualPhoneVerify = (user) => {
    const isVerified = isUserPhoneVerified(user);
    const targetName = user.networkName || user.phoneNumber || user.uid;
    const phoneDisplay = user.phoneNumber || user.phone || 'غير مسجّل';

    setConfirmAction({
      title: isVerified ? 'إلغاء توثيق الهاتف' : 'توثيق الهاتف يدوياً',
      message: isVerified
        ? `حساب «${targetName}» (${phoneDisplay}) موثّق حالياً. هل تريد إلغاء التوثيق؟`
        : `هل تريد اعتماد «${targetName}» (${phoneDisplay}) كموثّق برقم الهاتف؟`,
      variant: isVerified ? 'danger' : 'success',
      action: async () => {
        const result = await updateNetworkAccess({ uid: user.uid, phone_verified: !isVerified });
        if (!result.ok) { toast.error(adminApiError(result.error, 'تعذر التحديث')); return false; }
        setUsers((prev) => prev.map((u) => (u.uid === user.uid ? {
          ...u,
          phone_verified: !isVerified, phoneVerified: !isVerified,
          ...(!isVerified ? { phone_verified_at: new Date(), verified_by_admin: true, phone_verified_manual: true } : { phone_verified_manual: false }),
        } : u)));
        logAdminAction({
          action: isVerified ? AUDIT_ACTIONS.USER_PHONE_UNVERIFY : AUDIT_ACTIONS.USER_PHONE_VERIFY_MANUAL,
          targetType: 'user', targetId: user.uid, targetLabel: targetName,
          details: { phone: phoneDisplay },
        }).catch(() => {});
        toast.success(isVerified ? 'تم إلغاء التوثيق' : 'تم التوثيق');
      },
    });
  };

  const handleDeleteUser = (user) => {
    const targetName = user.networkName || user.network_name || user.phone || user.uid;
    setConfirmAction({
      title: 'حذف الحساب',
      message: `حذف «${targetName}» نهائياً مع كل سجلاته؟ لا يمكن التراجع.`,
      variant: 'danger',
      action: async () => {
        const result = await deleteNetworkAccount(user.uid);
        if (!result.ok) { toast.error(adminApiError(result.error, 'تعذر الحذف')); return false; }
        logAdminAction({
          action: AUDIT_ACTIONS.USER_DELETE, targetType: 'user', targetId: user.uid,
          targetLabel: targetName, details: { networkId: user.networkId || null },
        }).catch(() => {});
        toast.success(`تم حذف «${targetName}»`);
        await refresh();
      },
    });
  };

  // ====== Derived ======
  const warningWindowMs = useMemo(() => {
    const days = Number(globalConfig?.warning_days_before_expiry) > 0
      ? Number(globalConfig.warning_days_before_expiry) : DEFAULT_WARNING_DAYS;
    return days * 86_400_000;
  }, [globalConfig]);

  const { filteredUsers, orderedUsers } = useUsersFilter(users, {
    searchTerm, filterType, versionSort, warningWindowMs, globalConfig,
  });
  const filterCounts = useUsersFilterCounts(users, globalConfig, warningWindowMs);

  const visibleUsers = useMemo(() => orderedUsers.slice(0, visibleCount), [orderedUsers, visibleCount]);
  const hasMore = orderedUsers.length > visibleUsers.length;

  const stats = useMemo(() => ({
    total: users.length,
    trial: filterCounts.trial,
    official: filterCounts.official,
    active: filterCounts.active,
    blocked: filterCounts.blocked,
    expired: filterCounts.expired,
    verified: filterCounts.verified,
    unverified: filterCounts.unverified,
  }), [users, filterCounts]);

  const defaultCommission = useMemo(() => {
    const c = Number(globalConfig?.default_commission_rate);
    return globalConfig?.default_commission_rate != null && globalConfig.default_commission_rate !== '' && Number.isFinite(c) ? c : 5;
  }, [globalConfig]);

  const activeFiltersCount = (filterType !== 'all' ? 1 : 0) + (versionSort !== 'none' ? 1 : 0);

  // ====== Effects ======
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [searchTerm, filterType, versionSort]);
  useEffect(() => {
    try { window.localStorage.setItem(FILTER_STORAGE_KEY, filterType); } catch { /* noop */ }
  }, [filterType]);

  const sentinelRef = useInfiniteScroll({
    onLoadMore: () => setVisibleCount((v) => v + PAGE_SIZE),
    hasMore,
  });

  const handleExportUsers = useCallback(() => {
    if (!filteredUsers.length) { toast.error('لا توجد بيانات'); return; }
    downloadCsv(`users-${csvStamp()}`, filteredUsers, [
      { label: 'اسم الشبكة', value: (u) => u.networkName || '' },
      { label: 'رقم الهاتف', value: (u) => u.phoneNumber || '' },
      { label: 'التحقق', value: (u) => (isUserPhoneVerified(u) ? 'مفعّل' : 'غير مفعّل') },
      { label: 'النوع', value: (u) => (u.is_trial ? 'تجريبي' : 'رسمي') },
      { label: 'الحالة', value: (u) => (u.is_active === false ? 'محظور' : 'مفعّل') },
      { label: 'تاريخ التصفية', value: (u) => formatDate(u.subscription_end_date) },
      { label: 'معرّف', value: (u) => u.uid },
    ]);
    toast.success('تم التصدير');
  }, [filteredUsers]);

  // ====== Render ======
  if (loading && users.length === 0) {
    return (
      <div className="space-y-4">
        <SkeletonPageHeader />
        <SkeletonCard lines={6} />
      </div>
    );
  }

  return (
    <div className="pb-24">
      <SearchHeader
        title="المشتركون"
        subtitle={`${formatNumber(stats.total)} حساب • ${formatNumber(stats.active)} نشط`}
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="ابحث باسم الشبكة، الهاتف، المعرّف..."
        onFilterClick={() => setFilterSheetOpen(true)}
        filterCount={activeFiltersCount}
        actions={
          <Button variant="ghost" size="sm" icon={Download} onClick={handleExportUsers} aria-label="تصدير" />
        }
      />

      {error && (
        <div className="mt-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <p className="flex-1">{error}</p>
          <button type="button" onClick={refresh} className="font-bold underline">إعادة المحاولة</button>
        </div>
      )}

      <div className="mt-3">
        <HeroMetric
          label="إجمالي الشبكات"
          value={stats.total}
          unit="حساب"
          icon={Users}
          trend={stats.active > stats.blocked ? 'up' : 'flat'}
          trendLabel={`${formatNumber(stats.active)} نشط`}
          hint={`${formatNumber(stats.blocked)} محظور • ${formatNumber(stats.expired)} منتهي`}
          tone="brand"
        />
      </div>

      <div className="mt-3">
        <StatPills
          items={[
            { key: 'active', icon: CheckCircle2, label: 'نشط', value: formatNumber(stats.active), tone: 'success' },
            { key: 'trial', icon: Clock, label: 'تجريبي', value: formatNumber(stats.trial), tone: 'warning' },
            { key: 'blocked', icon: Ban, label: 'محظور', value: formatNumber(stats.blocked), tone: 'danger' },
            { key: 'verified', icon: ShieldCheck, label: 'موثّق', value: formatNumber(stats.verified), tone: 'brand' },
            { key: 'unverified', icon: ShieldAlert, label: 'غير موثّق', value: formatNumber(stats.unverified), tone: 'neutral' },
          ]}
          onItemClick={(item) => setFilterType(item.key === 'verified' ? 'verified' : item.key === 'unverified' ? 'unverified' : item.key === 'active' ? 'active' : item.key === 'trial' ? 'trial' : item.key === 'blocked' ? 'blocked' : 'all')}
        />
      </div>

      <div className="mt-3 space-y-2.5">
        {filteredUsers.length === 0 ? (
          <div className="p-10 text-center rounded-2xl bg-[var(--ui-surface)] border border-line">
            <span className="inline-flex w-14 h-14 rounded-2xl bg-[var(--ui-sunken)] text-[var(--ui-muted)] items-center justify-center mb-3">
              <Inbox className="w-6 h-6" />
            </span>
            <p className="font-bold text-[var(--ui-ink)]">لا نتائج</p>
            <p className="text-xs text-[var(--ui-muted)] mt-1">
              {searchTerm || filterType !== 'all' ? 'جرّب تعديل البحث أو الفلتر.' : 'لم تُسجّل أي شبكة بعد.'}
            </p>
          </div>
        ) : (
          <>
            {visibleUsers.map((user) => {
              const expired = isExpired(user.subscription_end_date);
              const networkTitle = user.networkName || user.network_name || user.name || `شبكة ${user.uid.slice(0, 8)}`;
              const phone = user.phoneNumber || user.phone || '';
              const isVerified = isUserPhoneVerified(user);

              return (
                <DataCard
                  key={user.uid}
                  avatar={{
                    initial: networkTitle.charAt(0),
                    tone: user.is_active === false ? 'danger' : user.is_trial ? 'warning' : 'brand',
                  }}
                  title={networkTitle}
                  subtitle={phone || 'بدون هاتف'}
                  badges={[
                    { label: user.is_trial ? 'تجريبي' : 'رسمي', tone: user.is_trial ? 'warning' : 'success' },
                    ...(user.is_active === false ? [{ label: 'محظور', tone: 'danger' }] : []),
                    ...(isVerified ? [{ label: 'موثّق', tone: 'success' }] : []),
                  ]}
                  facts={[
                    { icon: Calendar, label: 'الانتهاء', value: expired ? `⚠️ ${formatDate(user.subscription_end_date)}` : formatDate(user.subscription_end_date) },
                    { icon: DollarSign, label: 'المبيعات', value: `${formatNumber(user.reportedSalesValue || 0)} ر.ي` },
                  ]}
                  trailing={
                    <button
                      type="button"
                      onClick={() => setMenuUser(user)}
                      className="p-2 rounded-full text-[var(--ui-muted)] hover:bg-[var(--ui-sunken)] hover:text-[var(--ui-ink)] transition-colors"
                      aria-label="إجراءات"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  }
                  onClick={() => navigate(`/users/${user.uid}`)}
                />
              );
            })}

            {/* Sentinal للتحديد التلقائي */}
            {hasMore && (
              <div ref={sentinelRef} className="py-6 flex justify-center" role="status" aria-live="polite">
                <div className="flex items-center gap-2 text-xs text-[var(--ui-muted)] font-bold">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  جارٍ التحميل...
                </div>
              </div>
            )}

            {!hasMore && filteredUsers.length > 0 && (
              <p className="text-center text-[11px] text-[var(--ui-faint)] py-4">
                وصلت للنهاية — {formatNumber(filteredUsers.length)} حساب
              </p>
            )}
          </>
        )}
      </div>

      <FAB icon={Users} label="إضافة" onClick={() => toast('إضافة مشترك — قريباً')} />

      {/* Filter Sheet */}
      <FilterSheet
        isOpen={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        title="الفلاتر والترتيب"
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setFilterType('all'); setVersionSort('none'); }}
              className="flex-1 min-h-[48px] rounded-xl border border-line font-bold text-sm text-[var(--ui-ink-soft)] hover:bg-[var(--ui-sunken)]"
            >
              إعادة تعيين
            </button>
            <button
              type="button"
              onClick={() => setFilterSheetOpen(false)}
              className="flex-1 min-h-[48px] rounded-xl bg-[var(--ui-brand)] text-white font-bold text-sm"
            >
              تطبيق
            </button>
          </div>
        }
      >
        <div>
          <label className="text-xs font-black text-[var(--ui-ink)] block mb-2">نوع الحساب</label>
          <div className="grid grid-cols-2 gap-2">
            {FILTERS.filter((f) => ['all', 'active', 'verified', 'unverified', 'official', 'trial', 'blocked'].includes(f.value)).map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilterType(f.value)}
                className={`min-h-[48px] rounded-xl border font-bold text-xs transition-all ${
                  filterType === f.value
                    ? 'bg-[var(--ui-brand)] text-white border-[var(--ui-brand)]'
                    : 'bg-[var(--ui-surface)] text-[var(--ui-ink-soft)] border-line hover:bg-[var(--ui-sunken)]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-black text-[var(--ui-ink)] block mb-2">ترتيب الإصدارات</label>
          <select
            value={versionSort}
            onChange={(e) => setVersionSort(e.target.value)}
            className="w-full min-h-[48px] px-4 rounded-xl border border-line bg-[var(--ui-surface)] text-sm"
          >
            <option value="none">افتراضي</option>
            <option value="oldest">الأقدم أولاً</option>
            <option value="newest">الأحدث أولاً</option>
          </select>
        </div>
      </FilterSheet>

      {/* Overflow Menu */}
      <OverflowMenu
        isOpen={Boolean(menuUser)}
        onClose={() => setMenuUser(null)}
        title={menuUser?.networkName || menuUser?.uid}
        subtitle={menuUser?.phoneNumber || menuUser?.phone}
        actions={menuUser ? [
          { key: 'billing', icon: DollarSign, label: 'الفوترة والتسويات', tone: 'brand', onClick: () => setBillingUser(menuUser) },
          { key: 'renew', icon: CalendarPlus, label: 'تجديد 30 يوماً', tone: 'success', onClick: () => handleQuickRenew(menuUser) },
          { key: 'edit', icon: Edit, label: 'تعديل الإعدادات', tone: 'neutral', onClick: () => setEditingUser(menuUser) },
          { key: 'auth', icon: KeyRound, label: 'بيانات الدخول', tone: 'neutral', onClick: () => setAuthUser(menuUser) },
          {
            key: 'verify',
            icon: isUserPhoneVerified(menuUser) ? ShieldCheck : ShieldAlert,
            label: isUserPhoneVerified(menuUser) ? 'إلغاء توثيق الهاتف' : 'توثيق الهاتف يدوياً',
            tone: isUserPhoneVerified(menuUser) ? 'warning' : 'success',
            onClick: () => handleManualPhoneVerify(menuUser),
          },
          {
            key: 'toggle',
            icon: menuUser.is_active === false ? UserCheck : Ban,
            label: menuUser.is_active === false ? 'رفع الحظر' : 'حظر الحساب',
            tone: menuUser.is_active === false ? 'success' : 'danger',
            onClick: () => handleToggleActive(menuUser),
          },
          { key: 'delete', icon: Trash2, label: 'حذف الحساب نهائياً', tone: 'danger', onClick: () => handleDeleteUser(menuUser) },
        ] : []}
      />

      {/* Modals */}
      {editingUser && (
        <UserEditModal user={editingUser} isOpen onClose={() => setEditingUser(null)} onSave={handleSaveEdit} />
      )}
      {billingUser && (
        <UserBillingModal user={billingUser} isOpen onClose={() => setBillingUser(null)} onRefresh={refresh} />
      )}
      {authUser && (
        <UserAuthModal user={authUser} isOpen onClose={() => setAuthUser(null)} />
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
        title={confirmAction?.title || ''}
        message={confirmAction?.message || ''}
        variant={confirmAction?.variant || 'primary'}
      />
    </div>
  );
}
