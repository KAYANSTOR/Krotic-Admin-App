import { useState, useEffect } from 'react';
import {
  collection, getDocs, doc, deleteDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  ShieldCheck, UserPlus, Trash2, RefreshCw, Eye, EyeOff,
  Mail, Phone, User
} from 'lucide-react';
import toast from 'react-hot-toast';
import LoadingSpinner from '../components/LoadingSpinner';
import ConfirmDialog from '../components/ConfirmDialog';

export default function AdminsPage() {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const { createAdmin, currentUser } = useAuth();

  useEffect(() => {
    fetchAdmins();
  }, []);

  const fetchAdmins = async () => {
    setLoading(true);
    try {
      const adminsSnap = await getDocs(collection(db, 'Admins'));
      const adminsData = [];
      adminsSnap.forEach((d) => adminsData.push({ id: d.id, ...d.data() }));
      adminsData.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      setAdmins(adminsData);
    } catch (error) {
      console.error('Error fetching admins:', error);
      toast.error('خطأ في تحميل بيانات المدراء');
    }
    setLoading(false);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (formData.password.length < 6) {
      toast.error('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }
    setCreating(true);
    try {
      await createAdmin(formData.email, formData.password, formData.name, formData.phone);
      toast.success('تم إنشاء حساب المدير بنجاح');
      setFormData({ name: '', email: '', phone: '', password: '' });
      setShowForm(false);
      fetchAdmins();
    } catch (error) {
      console.error(error);
      if (error.code === 'auth/email-already-in-use') {
        toast.error('هذا البريد الإلكتروني مستخدم بالفعل');
      } else {
        toast.error('حدث خطأ أثناء إنشاء الحساب: ' + error.message);
      }
    }
    setCreating(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, 'Admins', deleteTarget.id));
      toast.success('تم حذف المدير من القائمة');
      setDeleteTarget(null);
      fetchAdmins();
    } catch (error) {
      console.error(error);
      toast.error('حدث خطأ أثناء الحذف');
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '—';
    return new Date(timestamp).toLocaleDateString('ar-IQ', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (loading) return <LoadingSpinner size="lg" />;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="page-title flex items-center gap-3">
            <ShieldCheck className="w-7 h-7 text-primary-600" />
            إدارة المدراء
          </h1>
          <p className="text-gray-500 mt-1">{admins.length} مدير مسجل</p>
        </div>
        <div className="flex gap-3">
          <button onClick={fetchAdmins} className="btn-secondary flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            تحديث
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="btn-primary flex items-center gap-2"
          >
            <UserPlus className="w-4 h-4" />
            إضافة مدير
          </button>
        </div>
      </div>

      {/* Create Admin Form */}
      {showForm && (
        <div className="card mb-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">إنشاء حساب مدير جديد</h3>
          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label-field">الاسم الكامل</label>
              <div className="relative">
                <User className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="input-field pr-10"
                  placeholder="أدخل الاسم"
                  required
                />
              </div>
            </div>
            <div>
              <label className="label-field">البريد الإلكتروني</label>
              <div className="relative">
                <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="input-field pr-10"
                  placeholder="admin@example.com"
                  required
                />
              </div>
            </div>
            <div>
              <label className="label-field">رقم الهاتف</label>
              <div className="relative">
                <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="input-field pr-10"
                  placeholder="07xxxxxxxxx"
                  required
                />
              </div>
            </div>
            <div>
              <label className="label-field">كلمة المرور</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="input-field pl-10"
                  placeholder="6 أحرف على الأقل"
                  minLength={6}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="sm:col-span-2 flex gap-3 justify-end">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">
                إلغاء
              </button>
              <button type="submit" disabled={creating} className="btn-primary flex items-center gap-2">
                {creating ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <UserPlus className="w-4 h-4" />
                )}
                إنشاء الحساب
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Admins Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {admins.map((admin) => (
          <div key={admin.id} className="card">
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center">
                <ShieldCheck className="w-6 h-6 text-primary-600" />
              </div>
              {admin.id !== currentUser?.uid && (
                <button
                  onClick={() => setDeleteTarget(admin)}
                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                  title="حذف"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
            <h3 className="font-bold text-gray-900 text-lg">{admin.name || '—'}</h3>
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Mail className="w-4 h-4 text-gray-400" />
                <span dir="ltr">{admin.email || '—'}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Phone className="w-4 h-4 text-gray-400" />
                <span dir="ltr">{admin.phone || '—'}</span>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-400">تاريخ الإنشاء: {formatDate(admin.createdAt)}</p>
              {admin.id === currentUser?.uid && (
                <span className="badge-info mt-2">أنت</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="حذف المدير"
        message={`هل أنت متأكد من حذف "${deleteTarget?.name}" من قائمة المدراء؟ لن يتمكن من الدخول للوحة التحكم بعد الآن.`}
        confirmText="نعم، احذف"
        variant="danger"
      />
    </div>
  );
}
