import { useState, useEffect } from 'react';
import {
  collection, getDocs, doc, deleteDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  ShieldCheck, UserPlus, Trash2, RefreshCw, Eye, EyeOff,
  Mail, Phone, User, Users, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import PageHeader from '../components/ui/PageHeader';
import { Card, CardHeader } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import { Field, Input } from '../components/ui/Field';
import ConfirmDialog from '../components/ConfirmDialog';
import { SkeletonCard, SkeletonPageHeader } from '../components/ui/Skeleton';
import DataFreshness from '../components/ui/DataFreshness';

function AdminsSkeleton() {
  return (
    <div className="admins-page">
      <SkeletonPageHeader />
      <div className="admins-grid">
        {[0, 1, 2].map((i) => (
          <SkeletonCard key={i} lines={3} />
        ))}
      </div>
    </div>
  );
}

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
  const [updatedAt, setUpdatedAt] = useState(null);
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
      setUpdatedAt(Date.now());
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

  if (loading) return <AdminsSkeleton />;

  return (
    <div className="admins-page">
      <PageHeader
        icon={ShieldCheck}
        title="إدارة المدراء"
        description="إضافة وحذف حسابات المدراء الذين يمكنهم الوصول إلى لوحة التحكم."
        meta={`${admins.length} مدير مسجل`}
        actions={
          <>
            <DataFreshness updatedAt={updatedAt} refreshing={loading} onRefresh={fetchAdmins} />
            <Button
              variant={showForm ? 'ghost' : 'primary'}
              icon={showForm ? X : UserPlus}
              onClick={() => setShowForm((v) => !v)}
            >
              {showForm ? 'إلغاء' : 'إضافة مدير'}
            </Button>
          </>
        }
      />

      {showForm && (
        <Card className="mb-6">
          <CardHeader
            icon={UserPlus}
            title="إنشاء حساب مدير جديد"
            description="سيتمكن هذا الحساب من تسجيل الدخول إلى لوحة التحكم مباشرة."
          />
          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="الاسم الكامل" required>
              <Input
                type="text"
                icon={User}
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="أدخل الاسم"
                required
              />
            </Field>
            <Field label="البريد الإلكتروني" required>
              <Input
                type="email"
                icon={Mail}
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="admin@example.com"
                required
              />
            </Field>
            <Field label="رقم الهاتف" required>
              <Input
                type="tel"
                icon={Phone}
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="07xxxxxxxxx"
                required
              />
            </Field>
            <Field label="كلمة المرور" hint="6 أحرف على الأقل." required>
              <Input
                type={showPassword ? 'text' : 'password'}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="••••••••"
                minLength={6}
                required
                endAdornment={
                  <button
                    type="button"
                    className="field-adorn"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
              />
            </Field>
            <div className="sm:col-span-2 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowForm(false)}>
                إلغاء
              </Button>
              <Button type="submit" variant="primary" icon={UserPlus} loading={creating}>
                إنشاء الحساب
              </Button>
            </div>
          </form>
        </Card>
      )}

      {admins.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title="لا يوجد مدراء مسجّلون"
            description="أضف أول حساب مدير للتمكن من إدارة اللوحة."
            action={
              <Button variant="primary" icon={UserPlus} onClick={() => setShowForm(true)}>
                إضافة مدير
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="admins-grid">
          {admins.map((admin) => (
            <Card key={admin.id} className="admin-card">
              <div className="admin-card__head">
                <span className="icon-tile icon-tile--brand icon-tile--lg">
                  <ShieldCheck className="w-5 h-5" aria-hidden="true" />
                </span>
                {admin.id !== currentUser?.uid && (
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(admin)}
                    className="row-action row-action--danger"
                    title="حذف"
                    aria-label={`حذف ${admin.name || 'المدير'}`}
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </div>

              <p className="admin-card__name">{admin.name || '—'}</p>

              <div className="admin-card__meta">
                <div className="admin-card__meta-row">
                  <Mail className="w-4 h-4" aria-hidden="true" />
                  <span dir="ltr">{admin.email || '—'}</span>
                </div>
                <div className="admin-card__meta-row">
                  <Phone className="w-4 h-4" aria-hidden="true" />
                  <span dir="ltr">{admin.phone || '—'}</span>
                </div>
              </div>

              <div className="admin-card__footer">
                <span className="admin-card__date">أُضيف في {formatDate(admin.createdAt)}</span>
                {admin.id === currentUser?.uid && <Badge tone="brand">أنت</Badge>}
              </div>
            </Card>
          ))}
        </div>
      )}

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
