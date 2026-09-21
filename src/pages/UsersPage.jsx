import { useState, useEffect } from 'react';
import { collection, getDocs, doc, getDoc, updateDoc, Timestamp, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import {
  Users, Search, UserCheck, UserX, RefreshCw, Edit, Ban,
  CheckCircle, ArrowUpDown, Filter, DollarSign, CalendarPlus
} from 'lucide-react';
import toast from 'react-hot-toast';
import LoadingSpinner from '../components/LoadingSpinner';
import UserEditModal from '../components/UserEditModal';
import UserBillingModal from '../components/UserBillingModal';
import ConfirmDialog from '../components/ConfirmDialog';

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
      // Fetch global config for default commission
      const configDoc = await getDoc(doc(db, 'app_settings', 'global_config'));
      let globalCommission = 5;
      if (configDoc.exists()) {
        const configData = configDoc.data();
        setGlobalConfig(configData);
        globalCommission = configData.default_commission_rate || 5;
      }

      // Fetch users
      const usersSnap = await getDocs(collection(db, 'users'));
      const usersData = [];

      for (const userDoc of usersSnap.docs) {
        const userData = { uid: userDoc.id, ...userDoc.data() };

        // Fetch network metadata
        try {
          const metaDoc = await getDoc(
            doc(db, 'networks', userDoc.id, '_metadata', 'info')
          );
          if (metaDoc.exists()) {
            const meta = metaDoc.data();
            userData.networkName = meta.name || '';
            userData.phoneNumber = meta.phoneNumber || '';
          }
        } catch (e) {
          console.warn('Could not fetch metadata for', userDoc.id);
        }

        // Fetch Sales & Payments to calculate balance
        let totalDue = 0;
        let totalPaid = 0;
        const activeRate = (userData.commission_rate != null && userData.commission_rate > 0) 
          ? userData.commission_rate 
          : globalCommission;

        const salesSnap = await getDocs(collection(db, 'networks', userDoc.id, 'sales'));
        salesSnap.forEach(saleDoc => {
          const sale = saleDoc.data();
          if (sale.status === 'COMPLETED') {
            totalDue += (sale.faceValue || 0) * (activeRate / 100);
          }
        });

        const paymentsSnap = await getDocs(collection(db, 'networks', userDoc.id, 'payments'));
        paymentsSnap.forEach(payDoc => {
          totalPaid += (payDoc.data().amount || 0);
        });

        userData.balance = totalDue - totalPaid;
        usersData.push(userData);
      }

      setUsers(usersData);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('خطأ في تحميل بيانات المستخدمين');
    }
    setLoading(false);
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
          setUsers((prev) =>
            prev.map((u) => (u.uid === user.uid ? { ...u, is_active: newStatus } : u))
          );
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
          setUsers((prev) =>
            prev.map((u) => (u.uid === user.uid ? { ...u, is_trial: false } : u))
          );
          toast.success('تم تحويل المستخدم إلى رسمي');
        } catch (error) {
          toast.error('حدث خطأ');
        }
      },
      variant: 'primary',
    });
  };

  const handleQuickRenew = async (user) => {
    // Calculate last day of next month
    const now = new Date();
    // next month (0-indexed)
    const nextMonth = now.getMonth() + 1;
    // Year might roll over if current is December
    const year = nextMonth > 11 ? now.getFullYear() + 1 : now.getFullYear();
    const actualNextMonth = nextMonth % 12;
    
    // Setting day to 0 gets the last day of the previous month.
    // So to get last day of next month, we need the 0th day of the month after next month.
    const lastDayOfNextMonth = new Date(year, actualNextMonth + 1, 0);
    // Set time to end of day
    lastDayOfNextMonth.setHours(23, 59, 59, 999);

    setConfirmAction({
      user,
      title: 'تجديد سريع',
      message: `سيتم تحديث تاريخ الانتهاء ليصبح: ${lastDayOfNextMonth.toLocaleDateString('ar-IQ')}. هل أنت متأكد؟`,
      action: async () => {
        try {
          const newTimestamp = Timestamp.fromDate(lastDayOfNextMonth);
          await updateDoc(doc(db, 'users', user.uid), { subscription_end_date: newTimestamp });
          setUsers((prev) =>
            prev.map((u) => (u.uid === user.uid ? { ...u, subscription_end_date: newTimestamp } : u))
          );
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
        firestoreUpdates.subscription_end_date = Timestamp.fromDate(
          new Date(updates.subscription_end_date)
        );
      }
      await updateDoc(doc(db, 'users', uid), firestoreUpdates);
      setUsers((prev) =>
        prev.map((u) => (u.uid === uid ? { ...u, ...updates } : u))
      );
      setEditingUser(null);
      toast.success('تم حفظ التعديلات بنجاح');
    } catch (error) {
      console.error(error);
      toast.error('حدث خطأ في حفظ التعديلات');
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '—';
    let date;
    if (timestamp.toDate) {
      date = timestamp.toDate();
    } else if (timestamp.seconds) {
      date = new Date(timestamp.seconds * 1000);
    } else if (typeof timestamp === 'number') {
      date = new Date(timestamp);
    } else {
      date = new Date(timestamp);
    }
    return date.toLocaleDateString('ar-IQ', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const isExpired = (timestamp) => {
    if (!timestamp) return false;
    let date;
    if (timestamp.toDate) {
      date = timestamp.toDate();
    } else if (timestamp.seconds) {
      date = new Date(timestamp.seconds * 1000);
    } else {
      date = new Date(timestamp);
    }
    return date < new Date();
  };

  // Filter users
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

  const formatNumber = (num) => new Intl.NumberFormat('ar-YE').format(Math.round(num || 0));

  if (loading) return <LoadingSpinner size="lg" />;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="page-title flex items-center gap-3">
            <Users className="w-7 h-7 text-primary-600" />
            إدارة المستخدمين والفوترة
          </h1>
          <p className="text-gray-500 mt-1">{users.length} مستخدم مسجل</p>
        </div>
        <button onClick={fetchData} className="btn-secondary flex items-center gap-2">
          <RefreshCw className="w-4 h-4" />
          تحديث البيانات
        </button>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="بحث بالاسم، رقم الهاتف..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-field pr-10"
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
      </div>

      {/* Users Table */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
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
                  <td colSpan="6" className="px-6 py-12 text-center text-gray-500">
                    لا يوجد مستخدمين
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.uid} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-semibold text-gray-900">
                          {user.networkName || '—'}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5" dir="ltr">{user.phoneNumber || '—'}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1 items-start">
                        {user.is_trial ? (
                          <span className="badge-warning">تجريبي</span>
                        ) : (
                          <span className="badge-success">رسمي</span>
                        )}
                        {user.is_active === false && (
                          <span className="badge-danger">محظور</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {user.commission_rate != null && user.commission_rate > 0 
                        ? <span className="font-bold text-primary-600">{user.commission_rate}% (خاصة)</span>
                        : `${globalConfig?.default_commission_rate || 5}% (عامة)`
                      }
                    </td>
                    <td className="px-6 py-4">
                      <span className={`font-bold ${user.balance > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                        {formatNumber(user.balance)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`text-sm ${
                          isExpired(user.subscription_end_date)
                            ? 'text-red-600 font-semibold'
                            : 'text-gray-600'
                        }`}
                      >
                        {formatDate(user.subscription_end_date)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 flex-wrap">
                        {/* Financials / Billing */}
                        <button
                          onClick={() => setBillingUser(user)}
                          className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg flex items-center gap-1"
                          title="الفوترة والدفعات"
                        >
                          <DollarSign className="w-4 h-4" />
                          <span className="text-xs font-medium">الفوترة</span>
                        </button>
                        
                        {/* Quick Renew */}
                        <button
                          onClick={() => handleQuickRenew(user)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg flex items-center gap-1"
                          title="تجديد لآخر يوم من الشهر القادم"
                        >
                          <CalendarPlus className="w-4 h-4" />
                        </button>

                        {/* Edit Settings */}
                        <button
                          onClick={() => setEditingUser(user)}
                          className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                          title="تعديل الإعدادات"
                        >
                          <Edit className="w-4 h-4" />
                        </button>

                        {/* Make Official */}
                        {user.is_trial && (
                          <button
                            onClick={() => handleMakeOfficial(user)}
                            className="p-2 text-primary-600 hover:bg-primary-50 rounded-lg"
                            title="تحويل لرسمي"
                          >
                            <CheckCircle className="w-4 h-4" />
                          </button>
                        )}

                        {/* Ban / Activate */}
                        <button
                          onClick={() => handleToggleActive(user)}
                          className={`p-2 rounded-lg ${
                            user.is_active === false
                              ? 'text-emerald-600 hover:bg-emerald-50'
                              : 'text-red-600 hover:bg-red-50'
                          }`}
                          title={user.is_active === false ? 'إلغاء الحظر' : 'حظر'}
                        >
                          {user.is_active === false ? (
                            <UserCheck className="w-4 h-4" />
                          ) : (
                            <Ban className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Settings Modal */}
      <UserEditModal
        isOpen={!!editingUser}
        onClose={() => setEditingUser(null)}
        user={editingUser}
        onSave={handleSaveEdit}
      />

      {/* Billing Modal */}
      <UserBillingModal
        isOpen={!!billingUser}
        onClose={() => {
          setBillingUser(null);
          fetchData(); // Refresh list to get updated balances
        }}
        user={billingUser}
        globalCommission={globalConfig?.default_commission_rate || 5}
      />

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => {
          confirmAction?.action();
          setConfirmAction(null);
        }}
        title={confirmAction?.title || ''}
        message={confirmAction?.message || ''}
        variant={confirmAction?.variant || 'danger'}
      />
    </div>
  );
}
