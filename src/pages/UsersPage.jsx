import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { AlertCircle, RefreshCw, Inbox } from 'lucide-react';

import { useLocalQuery } from '../lib/localDb/useLocalQuery.js';
import { useLocalDb } from '../lib/localDb/LocalDbContext.jsx';
import { loadLocalConfig, loadLocalUsersWithBilling } from '../lib/localDb/localData.js';

import { Card } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import { SkeletonLine, SkeletonPageHeader, SkeletonCard } from '../components/ui/Skeleton.jsx';
import UserEditModal from '../components/UserEditModal.jsx';
import UserBillingModal from '../components/UserBillingModal.jsx';
import UserAuthModal from '../components/UserAuthModal.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

import UsersHeader from '../components/users/UsersHeader.jsx';
import UsersStats from '../components/users/UsersStats.jsx';
import UsersFilters from '../components/users/UsersFilters.jsx';
import UserCard from '../components/users/UserCard.jsx';
import UserTableRow from '../components/users/UserTableRow.jsx';

import { formatDate } from '../lib/format.js';
import { downloadCsv, csvStamp } from '../lib/csv.js';
import { isUserPhoneVerified } from '../lib/accessStatus.js';
import useAppRefresh from '../lib/useAppRefresh.js';
import { useUsersFilter, useFilterCounts, usePagination } from '../hooks/users/useUsersFilter.js';
import { useUsersActions } from '../hooks/users/useUsersActions.js';
import {
  FILTER_STORAGE_KEY,
  VIEW_MODE_STORAGE_KEY,
  VIEW_MODES,
  DEFAULT_WARNING_DAYS,
  DEFAULT_COMMISSION,
  loadSavedViewMode,
  resolveInitialFilter,
} from '../lib/users/constants.js';

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

  // Keep the loading skeleton until the first query resolves, but let query errors render.
  const loading = !hasLoadedUsers.current && usersQuery.loading;
  const error = usersQuery.error
    ? 'تعذر تحميل بيانات المستخدمين. حاول مرة أخرى.'
    : null;

  const usersRefresh = usersQuery.refresh;
  const configRefresh = configQuery.refresh;

  const refresh = useCallback(async () => {
    try {
      await runSync({ reason: 'manual' });
    } catch {
      toast.error('تعذر تحديث البيانات من الخادم. ستبقى البيانات المحلية معروضة.');
    } finally {
      usersRefresh();
      configRefresh();
    }
  }, [runSync, usersRefresh, configRefresh]);

  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  const stableRefresh = useCallback(() => refreshRef.current(), []);
  useAppRefresh(stableRefresh);

  // Every successful mutation shares this sync-then-reload path.
  const syncInBackground = useCallback(() => {
    runSync({ reason: 'mutation' })
      .then(() => {
        usersRefresh();
        configRefresh();
      })
      .catch(() => {
        // Keep the optimistic local update if connectivity is unavailable.
      });
  }, [runSync, usersRefresh, configRefresh]);

  const {
    handleToggleActive,
    handleQuickRenew,
    handleSaveEdit,
    handleManualPhoneVerify,
    handleDeleteUser,
  } = useUsersActions({
    setUsers,
    setConfirmAction,
    setEditingUser,
    syncInBackground,
  });

  const warningWindowMs = useMemo(() => {
    const configuredDays = Number(globalConfig?.warning_days_before_expiry);
    const days = Number.isFinite(configuredDays) && configuredDays > 0
      ? configuredDays
      : DEFAULT_WARNING_DAYS;
    return days * 86_400_000;
  }, [globalConfig]);

  const filterCounts = useFilterCounts(users, globalConfig, warningWindowMs);
  const { filteredUsers, orderedUsers } = useUsersFilter(users, {
    searchTerm,
    filterType,
    versionSort,
    warningWindowMs,
    globalConfig,
  });
  const { visibleUsers, hasMore, loadMore } = usePagination(
    orderedUsers,
    searchTerm,
    filterType,
    versionSort,
  );

  // Keep filter selection shareable in the URL and persistent on this device.
  useEffect(() => {
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, filterType);
    } catch {
      // Storage can be disabled by the browser.
    }
    try {
      const url = new URL(window.location.href);
      if (filterType === 'all') url.searchParams.delete('filter');
      else url.searchParams.set('filter', filterType);
      window.history.replaceState({}, '', url.toString());
    } catch {
      // Safe fallback in non-browser test environments.
    }
  }, [filterType]);

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
    } catch {
      // Storage can be disabled by the browser.
    }
  }, [viewMode]);

  const stats = useMemo(() => ({
    total: users.length,
    trial: filterCounts.trial,
    official: filterCounts.official,
    active: filterCounts.active,
    blocked: filterCounts.blocked,
    expired: filterCounts.expired,
    verified: filterCounts.verified,
    unverified: filterCounts.unverified,
  }), [users.length, filterCounts]);

  const configuredGlobalCommission = Number(globalConfig?.default_commission_rate);
  const defaultCommission = globalConfig?.default_commission_rate != null
    && globalConfig.default_commission_rate !== ''
    && Number.isFinite(configuredGlobalCommission)
    ? configuredGlobalCommission
    : DEFAULT_COMMISSION;

  const hasCustomCommission = useCallback((user) => user.commission_rate != null
    && user.commission_rate !== ''
    && Number.isFinite(Number(user.commission_rate)), []);

  const handleExportUsers = useCallback(() => {
    if (!filteredUsers.length) {
      toast.error('لا توجد بيانات للتصدير');
      return;
    }

    downloadCsv(`users-${csvStamp()}`, filteredUsers, [
      { label: 'اسم الشبكة', value: (user) => user.networkName || user.network_name || '' },
      { label: 'رقم الهاتف', value: (user) => user.phoneNumber || user.phone || '' },
      {
        label: 'حالة التحقق من الهاتف',
        value: (user) => (isUserPhoneVerified(user) ? 'مفعّل' : 'غير مفعّل'),
      },
      { label: 'النوع', value: (user) => (user.is_trial ? 'تجريبي' : 'رسمي') },
      { label: 'الحالة', value: (user) => (user.is_active === false ? 'محظور' : 'مفعّل') },
      {
        label: 'نسبة العمولة (%)',
        value: (user) => (hasCustomCommission(user) ? user.commission_rate : defaultCommission),
      },
      { label: 'إجمالي المبيعات (ر.ي)', value: (user) => user.reportedSalesValue || 0 },
      {
        label: 'المبيعات المعتمدة خادمياً (ر.ي)',
        value: (user) => user.verifiedSalesValue
          ?? ((user.reportedSalesValue || 0) - (user.legacySalesValue || 0)),
      },
      { label: 'مبيعات السجلات القديمة (ر.ي)', value: (user) => user.legacySalesValue || 0 },
      {
        label: 'العمولة المعتمدة خادمياً (ر.ي)',
        value: (user) => user.verifiedOutstandingCommission ?? user.outstandingCommission ?? 0,
      },
      { label: 'عمولات قديمة للمراجعة (ر.ي)', value: (user) => user.legacyEstimatedCommission || 0 },
      { label: 'عدد المبيعات المعتمدة', value: (user) => user.verifiedTransactions || 0 },
      { label: 'عدد السجلات القديمة', value: (user) => user.legacyTransactions || 0 },
      { label: 'تاريخ الانتهاء', value: (user) => formatDate(user.subscriptionEndsAt ?? user.subscription_end_date) },
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

  const renderBody = () => {
    if (filteredUsers.length === 0) {
      return (
        <Card className="p-8 text-center rounded-2xl">
          <span className="empty-state__icon icon-tile icon-tile--neutral icon-tile--lg mx-auto mb-3">
            <Inbox className="w-6 h-6" />
          </span>
          <p className="font-bold text-ink">لا نتائج</p>
          <p className="text-xs text-muted mt-1">
            {searchTerm || filterType !== 'all'
              ? 'عدّل البحث أو الفلتر.'
              : 'لا شبكات مسجّلة بعد.'}
          </p>
        </Card>
      );
    }

    if (viewMode === VIEW_MODES.TABLE) {
      return (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-xs">
            <table className="w-full text-right text-xs">
              <thead className="bg-surface-sunken/80 border-b border-line text-muted font-bold">
                <tr>
                  <th scope="col" className="p-3 text-right">الشبكة</th>
                  <th scope="col" className="p-3 text-right">رقم الهاتف</th>
                  <th scope="col" className="p-3 text-right">التحقق</th>
                  <th scope="col" className="p-3 text-right">النوع</th>
                  <th scope="col" className="p-3 text-right">الحالة</th>
                  <th scope="col" className="p-3 text-right">العمولة</th>
                  <th scope="col" className="p-3 text-right">الانتهاء</th>
                  <th scope="col" className="p-3 text-right">المبيعات</th>
                  <th scope="col" className="p-3 text-right">العمولة</th>
                  <th scope="col" className="p-3 text-center">الإجراءات</th>
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
              onClick={loadMore}
              className="rounded-xl font-bold mt-2"
            >
              المزيد ({filteredUsers.length - visibleUsers.length})
            </Button>
          )}
        </div>
      );
    }

    return (
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
            onClick={loadMore}
            className="rounded-xl font-bold mt-2"
          >
            المزيد ({filteredUsers.length - visibleUsers.length})
          </Button>
        )}
      </div>
    );
  };

  if (loading && users.length === 0) {
    return (
      <div className="users-page space-y-4">
        <SkeletonPageHeader />
        <div className="grid grid-cols-2 gap-2.5">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="p-4 rounded-2xl bg-surface border border-line">
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
        usersCount={stats.total}
        activeCount={stats.active}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExport={handleExportUsers}
        lastSyncAt={lastSyncAt}
        refreshing={loading || syncing}
        onRefresh={refresh}
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

      {renderBody()}

      {editingUser && (
        <UserEditModal
          user={editingUser}
          isOpen={Boolean(editingUser)}
          onClose={() => setEditingUser(null)}
          onSave={handleSaveEdit}
        />
      )}

      {billingUser && (
        <UserBillingModal
          user={billingUser}
          isOpen={Boolean(billingUser)}
          onClose={() => setBillingUser(null)}
          onRefresh={refresh}
        />
      )}

      {authUser && (
        <UserAuthModal
          user={authUser}
          isOpen={Boolean(authUser)}
          onClose={() => setAuthUser(null)}
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
        title={confirmAction?.title || ''}
        message={confirmAction?.message || ''}
        variant={confirmAction?.variant || 'primary'}
      />
    </div>
  );
}
