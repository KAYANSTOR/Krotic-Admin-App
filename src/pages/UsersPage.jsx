// src/pages/UsersPage.jsx
import { useState, useEffect, useMemo, useCallback } from 'react';
import { doc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { fetchUsersWithBilling, clearAdminDataCache } from '../lib/adminData';
import {
  Users, Search, UserCheck, Ban, RefreshCw, Edit,
  CheckCircle, DollarSign, CalendarPlus, AlertCircle, Inbox, Activity, KeyRound, ChevronDown, Download,
} from 'lucide-react';
import toast from 'react-hot-toast';
import PageHeader from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import StatCard from '../components/ui/StatCard';
import Section from '../components/ui/Section';
import DataFreshness from '../components/ui/DataFreshness';
import { SkeletonLine, SkeletonPageHeader, SkeletonTable } from '../components/ui/Skeleton';
import UserEditModal from '../components/UserEditModal';
import UserBillingModal from '../components/UserBillingModal';
import UserAuthModal from '../components/UserAuthModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { formatNumber, formatDate, isExpired } from '../lib/format';
import { downloadCsv, csvStamp } from '../lib/csv';
import { logAdminAction, AUDIT_ACTIONS } from '../lib/auditLog';

const PAGE_SIZE = 24;
const FILTER_STORAGE_KEY = 'krotak:users-filter';

function loadSavedFilter() {
  try {
    return window.localStorage.getItem(FILTER_STORAGE_KEY) || 'all';
  } catch {
    return 'all';
  }
}

const FILTERS = [
  { value: 'all', label: 'الكل' },
  { value: 'trial', label: 'تجريبي' },
  { value: 'official', label: 'رسمي' },
  { value: 'debt', label: 'عليهم ديون' },
  { value: 'blocked', label: 'محظور' },
];

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [globalConfig, setGlobalConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState(loadSavedFilter);

  const [editingUser, setEditingUser] = useState(null);
  const [billingUser, setBillingUser] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [confirmAction, setConfirmAction] = useState(null);

  const fetchData = useCallback(async ({ force = false } = {}) => {
    setLoading(true);
    setError(null);
    if (force) clearAdminDataCache();
    try {
      const { users: usersData, globalConfig: config } = await fetchUsersWithBilling();
      setGlobalConfig(config);
      setUsers(usersData);
      setUpdatedAt(Date.now());
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('تعذر تحميل بيانات المستخدمين. حاول مرة أخرى.');
      toast.error('خطأ في تحميل بيانات المستخدمين');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggleActive = (user) => {
    const newStatus = !user.is_active;
    setConfirmAction({
      user,
      title: newStatus ? 'تفعيل المستخدم' : 'حظر المستخدم',
      message: newStatus
        ? `هل تريد تفعيل حساب "${user.networkName || user.uid}"؟`
        : `هل تريد حظر "${user.networkName || user.uid}"؟ سيتم طرده من التطبيق فوراً.`,
      action: async () => {
        try {
          await updateDoc(doc(db, 'users', user.uid), { is_active: newStatus });
          setUsers((prev) => prev.map((u) => (u.uid === user.uid ? { ...u, is_active: newStatus } : u)));
          logAdminAction({
            action: newStatus ? AUDIT_ACTIONS.USER_ACTIVATE : AUDIT_ACTIONS.USER_BLOCK,
            targetType: 'user',
            targetId: user.uid,
            targetLabel: user.networkName || user.phoneNumber || user.uid,
          });
          toast.success(newStatus ? 'تم تفعيل المستخدم' : 'تم حظر المستخدم');
        } catch (err) {
          toast.error('حدث خطأ');
        }
      },
      variant: newStatus ? 'success' : 'danger',
    });
  };

  const handleMakeOfficial = (user) => {
    setConfirmAction({
      user,
      title: 'تحويل إلى رسمي',
      message: `هل تريد تحويل "${user.networkName || user.uid}" من مستخدم تجريبي إلى رسمي؟`,
      action: async () => {
        try {
          await updateDoc(doc(db, 'users', user.uid), { is_trial: false });
          setUsers((prev) => prev.map((u) => (u.uid === user.uid ? { ...u, is_trial: false } : u)));
          logAdminAction({
            action: AUDIT_ACTIONS.USER_MAKE_OFFICIAL,
            targetType: 'user',
            targetId: user.uid,
            targetLabel: user.networkName || user.phoneNumber || user.uid,
          });
          toast.success('تم تحويل المستخدم إلى رسمي');
        } catch (err) {
          toast.error('حدث خطأ');
        }
      },
      variant: 'primary',
    });
  };

  const handleQuickRenew = async (user) => {
    const now = new Date();
    const nextMonth = now.getMonth() + 1;
    const year = nextMonth > 11 ? now.getFullYear() + 1 : now.getFullYear();
    const actualNextMonth = nextMonth % 12;
    const lastDayOfNextMonth = new Date(year, actualNextMonth + 1, 0);
    lastDayOfNextMonth.setHours(23, 59, 59, 999);

    setConfirmAction({
      user,
      title: 'تجديد سريع',
      message: `سيتم تحديث تاريخ الانتهاء ليصبح: ${lastDayOfNextMonth.toLocaleDateString('ar-IQ')}. هل أنت متأكد؟`,
      action: async () => {
        try {
          const newTimestamp = Timestamp.fromDate(lastDayOfNextMonth);
          await updateDoc(doc(db, 'users', user.uid), { subscription_end_date: newTimestamp });
          setUsers((prev) => prev.map((u) => (u.uid === user.uid ? { ...u, subscription_end_date: newTimestamp } : u)));
          logAdminAction({
            action: AUDIT_ACTIONS.USER_RENEW,
            targetType: 'user',
            targetId: user.uid,
            targetLabel: user.networkName || user.phoneNumber || user.uid,
            details: { subscription_end_date: newTimestamp.toDate().toISOString() },
          });
          toast.success('تم التجديد بنجاح');
        } catch (err) {
          toast.error('حدث خطأ أثناء التجديد');
        }
      },
      variant: 'success',
    });
  };

  const handleSaveEdit = async (uid, updates) => {
    try {
      const firestoreUpdates = { ...updates };
      if (updates.subscription_end_date) {
        firestoreUpdates.subscription_end_date = Timestamp.fromDate(new Date(updates.subscription_end_date));
      }
      await updateDoc(doc(db, 'users', uid), firestoreUpdates);
      setUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, ...updates } : u)));
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
          subscription_end_date: updates.subscription_end_date || null,
        },
      });
      toast.success('تم حفظ التعديلات بنجاح');
    } catch (err) {
      console.error(err);
      toast.error('حدث خطأ في حفظ التعديلات');
    }
  };

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const matchesSearch =
        (user.networkName || '').includes(searchTerm) ||
        (user.phoneNumber || '').includes(searchTerm) ||
        user.uid.includes(searchTerm);

      if (filterType === 'trial') return matchesSearch && user.is_trial === true;
      if (filterType === 'official') return matchesSearch && user.is_trial === false;
      if (filterType === 'blocked') return matchesSearch && user.is_active === false;
      if (filterType === 'debt') return matchesSearch && user.balance > 0;
      return matchesSearch;
    });
  }, [users, searchTerm, filterType]);

  // نُعيد نافذة العرض إلى حجمها الأول عند تغيير البحث أو التصفية.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchTerm, filterType]);

  // نتذكّر آخر تصفية استخدمها المدير.
  useEffect(() => {
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, filterType);
    } catch {
      // التخزين المحلي قد يكون معطّلاً؛ التصفية تعمل بدون حفظ.
    }
  }, [filterType]);

  const visibleUsers = useMemo(
    () => filteredUsers.slice(0, visibleCount),
    [filteredUsers, visibleCount]
  );
  const hasMore = filteredUsers.length > visibleUsers.length;

  const stats = useMemo(() => {
    const total = users.length;
    const trial = users.filter((u) => u.is_trial === true).length;
    const debt = users.filter((u) => u.balance > 0).length;
    const blocked = users.filter((u) => u.is_active === false).length;
    return { total, trial, debt, blocked };
  }, [users]);

  const defaultCommission = globalConfig?.default_commission_rate || 5;

  const handleExportUsers = useCallback(() => {
    if (!filteredUsers.length) {
      toast.error('لا توجد بيانات للتصدير');
      return;
    }
    downloadCsv(`users-${csvStamp()}`, filteredUsers, [
      { label: 'اسم الشبكة', value: (u) => u.networkName || '' },
      { label: 'رقم الهاتف', value: (u) => u.phoneNumber || '' },
      { label: 'النوع', value: (u) => (u.is_trial ? 'تجريبي' : 'رسمي') },
      { label: 'الحالة', value: (u) => (u.is_active === false ? 'محظور' : 'مفعّل') },
      { label: 'نسبة العمولة', value: (u) => (u.commission_rate > 0 ? u.commission_rate : defaultCommission) },
      { label: 'الديون', value: (u) => Math.round(Number(u.balance) || 0) },
      { label: 'تاريخ التصفية', value: (u) => formatDate(u.subscription_end_date) },
      { label: 'معرّف الحساب', value: (u) => u.uid },
    ]);
    toast.success('تم تصدير بيانات المستخدمين');
  }, [filteredUsers, defaultCommission]);

  if (loading) {
    return (
      <div className="users-page">
        <SkeletonPageHeader />
        <div className="grid-kpi">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card stat-card">
              <div className="stat-card__body space-y-2">
                <SkeletonLine className="w-2/3" />
                <SkeletonLine className="w-1/2 h-8" />
              </div>
            </div>
          ))}
        </div>
        <Card flush><SkeletonTable rows={6} /></Card>
      </div>
    );
  }

  return (
    <div className="users-page">
      <PageHeader
        icon={Users}
        title="إدارة المستخدمين والفوترة"
        description={`${users.length} مستخدم مسجل`}
        actions={
          <DataFreshness updatedAt={updatedAt} refreshing={loading} onRefresh={() => fetchData({ force: true })} />
        }
      />

      {error && (
        <div className="users-error" role="alert">
          <span className="users-error__icon"><AlertCircle className="w-5 h-5" /></span>
          <div className="users-error__body">
            <p className="users-error__title">تعذر تحميل البيانات</p>
            <p className="users-error__msg">{error}</p>
          </div>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={fetchData}>
            إعادة المحاولة
          </Button>
        </div>
      )}

      <div className="grid-kpi">
        <StatCard title="إجمالي المستخدمين" value={formatNumber(stats.total)} icon={Users} tone="brand" iconStart />
        <StatCard title="حسابات تجريبية" value={formatNumber(stats.trial)} icon={Activity} tone="warning" iconStart />
        <StatCard title="عليهم ديون" value={formatNumber(stats.debt)} icon={DollarSign} tone="danger" iconStart />
        <StatCard title="محظورون" value={formatNumber(stats.blocked)} icon={Ban} tone="neutral" iconStart />
      </div>

      <Section
        eyebrow="السجل"
        title="قائمة المستخدمين"
        description={`${formatNumber(filteredUsers.length)} من ${formatNumber(users.length)} مستخدم`}
        className="users-list-section"
        action={
          <Button variant="secondary" size="sm" icon={Download} onClick={handleExportUsers}>
            تصدير CSV
          </Button>
        }
      >
      <Card className="users-toolbar-card">
        <div className="users-toolbar">
          <div className="users-search">
            <Search className="field-affix field-affix--lead w-5 h-5" aria-hidden="true" />
            <input
              type="text"
              placeholder="بحث بالاسم، رقم الهاتف..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-field input-field--lead"
              aria-label="بحث"
            />
          </div>
          <div className="users-filters" role="tablist" aria-label="تصفية المستخدمين">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={filterType === f.value}
                onClick={() => setFilterType(f.value)}
                className={`users-filter ${filterType === f.value ? 'is-active' : ''}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {filteredUsers.length === 0 ? (
        <Card>
          <div className="empty-state">
            <span className="empty-state__icon icon-tile icon-tile--neutral icon-tile--lg">
              <Inbox className="w-6 h-6" />
            </span>
            <p className="empty-state__title">لا يوجد مستخدمون مطابقون</p>
            <p className="empty-state__desc">
              {searchTerm || filterType !== 'all'
                ? 'جرّب تعديل كلمة البحث أو التصفية.'
                : 'لم يتم تسجيل أي مستخدم بعد.'}
            </p>
          </div>
        </Card>
      ) : (
        <>
          <Card flush className="users-table-card">
            <div className="overflow-x-auto">
              <table className="responsive-data-table w-full">
                <thead>
                  <tr className="table-header">
                    <th className="text-right px-6 py-4">الشبكة</th>
                    <th className="text-right px-6 py-4">النوع</th>
                    <th className="text-right px-6 py-4">العمولة</th>
                    <th className="text-right px-6 py-4">الديون (ريال يمني)</th>
                    <th className="text-right px-6 py-4">تاريخ التصفية</th>
                    <th className="text-right px-6 py-4">الإجراءات السريعة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {visibleUsers.map((user) => (
                    <tr key={user.uid} className="hover:bg-surface-sunken transition-colors">
                      <td className="px-6 py-4" data-label="الشبكة">
                        <div>
                          <p className="font-semibold text-ink">{user.networkName || '—'}</p>
                          <p className="text-xs text-ink-tertiary mt-0.5" dir="ltr">{user.phoneNumber || '—'}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4" data-label="النوع">
                        <div className="flex flex-col gap-1 items-start">
                          {user.is_trial ? <Badge tone="warning">تجريبي</Badge> : <Badge tone="success">رسمي</Badge>}
                          {user.is_active === false && <Badge tone="danger">محظور</Badge>}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-ink-soft" data-label="العمولة">
                        {user.commission_rate != null && user.commission_rate > 0
                          ? <span className="font-bold text-primary-600">{user.commission_rate}% (خاصة)</span>
                          : `${defaultCommission}% (عامة)`}
                      </td>
                      <td className="px-6 py-4" data-label="الديون">
                        <span className={`font-bold ${user.balance > 0 ? 'text-danger-ink' : 'text-ink'}`}>
                          {formatNumber(user.balance)}
                        </span>
                      </td>
                      <td className="px-6 py-4" data-label="تاريخ التصفية">
                        <span className={`text-sm ${isExpired(user.subscription_end_date) ? 'text-danger-ink font-semibold' : 'text-ink-soft'}`}>
                          {formatDate(user.subscription_end_date)}
                        </span>
                      </td>
                      <td className="px-6 py-4" data-label="الإجراءات السريعة">
                        <div className="flex items-center gap-1 flex-wrap">
                          <button onClick={() => setBillingUser(user)} className="row-action row-action--success" title="الفوترة والدفعات">
                            <DollarSign className="w-4 h-4" />
                            <span className="text-xs font-medium">الفوترة</span>
                          </button>
                          <button onClick={() => handleQuickRenew(user)} className="row-action row-action--brand" title="تجديد لآخر يوم من الشهر القادم">
                            <CalendarPlus className="w-4 h-4" />
                          </button>
                          <button onClick={() => setEditingUser(user)} className="row-action row-action--neutral" title="تعديل الإعدادات">
                            <Edit className="w-4 h-4" />
                          </button>
                          <button onClick={() => setAuthUser(user)} className="row-action row-action--neutral" title="بيانات الدخول وكلمة المرور">
                            <KeyRound className="w-4 h-4" />
                          </button>
                          {user.is_trial && (
                            <button onClick={() => handleMakeOfficial(user)} className="row-action row-action--brand-soft" title="تحويل لرسمي">
                              <CheckCircle className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => handleToggleActive(user)}
                            className={`row-action ${user.is_active === false ? 'row-action--success' : 'row-action--danger'}`}
                            title={user.is_active === false ? 'إلغاء الحظر' : 'حظر'}
                          >
                            {user.is_active === false ? <UserCheck className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="users-cards">
            {visibleUsers.map((user) => {
              const expired = isExpired(user.subscription_end_date);
              const hasDebt = user.balance > 0;
              return (
                <article key={user.uid} className="user-card">
                  <header className="user-card__head">
                    <div className="user-card__identity">
                      <p className="user-card__name">{user.networkName || '—'}</p>
                      <p className="user-card__phone" dir="ltr">{user.phoneNumber || '—'}</p>
                    </div>
                    <div className="user-card__badges">
                      {user.is_trial ? <Badge tone="warning">تجريبي</Badge> : <Badge tone="success">رسمي</Badge>}
                      {user.is_active === false && <Badge tone="danger">محظور</Badge>}
                    </div>
                  </header>

                  <dl className="user-card__meta">
                    <div className="user-card__meta-item">
                      <dt>العمولة</dt>
                      <dd>
                        {user.commission_rate != null && user.commission_rate > 0
                          ? <span className="text-primary-600 font-bold">{user.commission_rate}% (خاصة)</span>
                          : <span>{defaultCommission}% (عامة)</span>}
                      </dd>
                    </div>
                    <div className="user-card__meta-item">
                      <dt>الديون</dt>
                      <dd className={hasDebt ? 'text-danger-ink font-bold' : 'font-bold'}>
                        {formatNumber(user.balance)}
                      </dd>
                    </div>
                    <div className="user-card__meta-item">
                      <dt>تاريخ التصفية</dt>
                      <dd className={expired ? 'text-danger-ink font-semibold' : ''}>
                        {formatDate(user.subscription_end_date)}
                      </dd>
                    </div>
                  </dl>

                  <div className="user-card__actions">
                    <button onClick={() => setBillingUser(user)} className="row-action row-action--success">
                      <DollarSign className="w-4 h-4" />
                      <span className="text-xs font-medium">الفوترة</span>
                    </button>
                    <button onClick={() => handleQuickRenew(user)} className="row-action row-action--brand" title="تجديد">
                      <CalendarPlus className="w-4 h-4" />
                    </button>
                    <button onClick={() => setEditingUser(user)} className="row-action row-action--neutral" title="تعديل">
                      <Edit className="w-4 h-4" />
                    </button>
                    <button onClick={() => setAuthUser(user)} className="row-action row-action--neutral" title="بيانات الدخول وكلمة المرور">
                      <KeyRound className="w-4 h-4" />
                    </button>
                    {user.is_trial && (
                      <button onClick={() => handleMakeOfficial(user)} className="row-action row-action--brand-soft" title="تحويل لرسمي">
                        <CheckCircle className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => handleToggleActive(user)}
                      className={`row-action ${user.is_active === false ? 'row-action--success' : 'row-action--danger'}`}
                      title={user.is_active === false ? 'إلغاء الحظر' : 'حظر'}
                    >
                      {user.is_active === false ? <UserCheck className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      {filteredUsers.length > 0 && (
        <div className="list-footer">
          <p className="list-footer__count">
            يُعرض {formatNumber(visibleUsers.length)} من {formatNumber(filteredUsers.length)} مستخدم
          </p>
          {hasMore && (
            <Button
              variant="secondary"
              icon={ChevronDown}
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            >
              عرض المزيد
            </Button>
          )}
        </div>
      )}
      </Section>

      {editingUser && (
        <UserEditModal
          isOpen={!!editingUser}
          onClose={() => setEditingUser(null)}
          user={editingUser}
          onSave={handleSaveEdit}
          globalCommission={defaultCommission}
        />
      )}

      {billingUser && (
        <UserBillingModal
          isOpen={!!billingUser}
          onClose={() => { setBillingUser(null); fetchData({ force: true }); }}
          user={billingUser}
          globalCommission={defaultCommission}
        />
      )}

      {authUser && (
        <UserAuthModal
          isOpen={!!authUser}
          onClose={() => setAuthUser(null)}
          user={authUser}
        />
      )}

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
