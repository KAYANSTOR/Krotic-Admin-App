import { useState, useEffect } from 'react';
import { collection, getDocs, doc, getDoc, updateDoc, Timestamp, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { mapWithConcurrency } from '../lib/mapWithConcurrency';
import {
  Users, Search, UserCheck, Ban, RefreshCw, Edit,
  CheckCircle, DollarSign, CalendarPlus,
} from 'lucide-react';
import toast from 'react-hot-toast';
import PageHeader from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import { SkeletonTable } from '../components/ui/Skeleton';
import UserEditModal from '../components/UserEditModal';
import UserBillingModal from '../components/UserBillingModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { formatNumber, formatDate, isExpired } from '../lib/format';

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [globalConfig, setGlobalConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');

  const [editingUser, setEditingUser] = useState(null);
  const [billingUser, setBillingUser] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [configDoc, usersSnap] = await Promise.all([
        getDoc(doc(db, 'app_settings', 'global_config')),
        getDocs(collection(db, 'users')),
      ]);
      let globalCommission = 5;
      if (configDoc.exists()) {
        const configData = configDoc.data();
        setGlobalConfig(configData);
        globalCommission = configData.default_commission_rate || 5;
      }

      const usersData = await mapWithConcurrency(usersSnap.docs, 5, async (userDoc) => {
        const userData = { uid: userDoc.id, ...userDoc.data() };
        const [metaDoc, salesSnap, paymentsSnap] = await Promise.all([
          getDoc(doc(db, 'networks', userDoc.id, '_metadata', 'info')).catch(() => null),
          getDocs(query(
            collection(db, 'networks', userDoc.id, 'sales'),
            where('status', '==', 'COMPLETED'),
          )),
          getDocs(collection(db, 'networks', userDoc.id, 'payments')),
        ]);
        if (metaDoc?.exists()) {
          const meta = metaDoc.data();
          userData.networkName = meta.name || '';
          userData.phoneNumber = meta.phoneNumber || '';
        }
        let totalDue = 0;
        let totalPaid = 0;
        const activeRate = (userData.commission_rate != null && userData.commission_rate > 0)
          ? userData.commission_rate
          : globalCommission;

        salesSnap.forEach((saleDoc) => {
          const sale = saleDoc.data();
          totalDue += (sale.faceValue || 0) * (activeRate / 100);
        });

        paymentsSnap.forEach((payDoc) => {
          totalPaid += (payDoc.data().amount || 0);
        });

        userData.balance = totalDue - totalPaid;
        return userData;
      });

      setUsers(usersData);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('خطأ في تحميل بيانات المستخدمين');
    } finally {
      setLoading(false);
    }
  };

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
          toast.success(newStatus ? 'تم تفعيل المستخدم' : 'تم حظر المستخدم');
        } catch (error) {
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
          toast.success('تم تحويل المستخدم إلى رسمي');
        } catch (error) {
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
          toast.success('تم التجديد بنجاح');
        } catch (error) {
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
      toast.success('تم حفظ التعديلات بنجاح');
    } catch (error) {
      console.error(error);
      toast.error('حدث خطأ في حفظ التعديلات');
    }
  };

  const filteredUsers = users.filter((user) => {
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

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="إدارة المستخدمين والفوترة" description="جارٍ التحميل..." />
        <Card flush><SkeletonTable rows={6} /></Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        icon={Users}
        title="إدارة المستخدمين والفوترة"
        description={`${users.length} مستخدم مسجل`}
        actions={<Button variant="secondary" icon={RefreshCw} onClick={fetchData}>تحديث البيانات</Button>}
      />

      <Card className="mb-6">
        <div className="toolbar">
          <div className="relative flex-1">
            <Search className="field-affix field-affix--lead w-5 h-5" aria-hidden="true" />
            <input
              type="text"
              placeholder="بحث بالاسم، رقم الهاتف..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-field input-field--lead"
            />
          </div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="input-field w-full sm:w-48"
          >
            <option value="all">الكل</option>
            <option value="trial">تجريبي</option>
            <option value="official">رسمي</option>
            <option value="debt">عليهم ديون</option>
            <option value="blocked">محظور</option>
          </select>
        </div>
      </Card>

      <Card flush>
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
            <tbody className="divide-y divide-gray-100">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-6 py-12 text-center text-gray-500">لا يوجد مستخدمين</td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.uid} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4" data-label="الشبكة">
                      <div>
                        <p className="font-semibold text-gray-900">{user.networkName || '—'}</p>
                        <p className="text-xs text-gray-400 mt-0.5" dir="ltr">{user.phoneNumber || '—'}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4" data-label="النوع">
                      <div className="flex flex-col gap-1 items-start">
                        {user.is_trial ? <Badge tone="warning">تجريبي</Badge> : <Badge tone="success">رسمي</Badge>}
                        {user.is_active === false && <Badge tone="danger">محظور</Badge>}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-600" data-label="العمولة">
                      {user.commission_rate != null && user.commission_rate > 0
                        ? <span className="font-bold text-primary-600">{user.commission_rate}% (خاصة)</span>
                        : `${globalConfig?.default_commission_rate || 5}% (عامة)`}
                    </td>
                    <td className="px-6 py-4" data-label="الديون">
                      <span className={`font-bold ${user.balance > 0 ? 'text-red-600' : 'text-gray-900'}`}>{formatNumber(user.balance)}</span>
                    </td>
                    <td className="px-6 py-4" data-label="تاريخ التصفية">
                      <span className={`text-sm ${isExpired(user.subscription_end_date) ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <UserEditModal
        isOpen={!!editingUser}
        onClose={() => setEditingUser(null)}
        user={editingUser}
        onSave={handleSaveEdit}
      />

      <UserBillingModal
        isOpen={!!billingUser}
        onClose={() => { setBillingUser(null); fetchData(); }}
        user={billingUser}
        globalCommission={globalConfig?.default_commission_rate || 5}
      />

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
