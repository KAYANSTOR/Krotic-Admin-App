import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  ShieldCheck, UserPlus, Trash2, Eye, EyeOff,
  Mail, Phone, User, Users, X, KeyRound,
} from 'lucide-react';
import toast from 'react-hot-toast';
import PageHero from '../components/ui/PageHero';
import Section from '../components/ui/Section';
import { Card, CardHeader } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import { Field, Input } from '../components/ui/Field';
import ConfirmDialog from '../components/ConfirmDialog';
import ChangeAdminPasswordModal from '../components/ChangeAdminPasswordModal';
import { SkeletonCard, SkeletonPageHeader } from '../components/ui/Skeleton';
import DataFreshness from '../components/ui/DataFreshness';
import { logAdminAction, AUDIT_ACTIONS } from '../lib/auditLog';
import { useLocalQuery } from '../lib/localDb/useLocalQuery';
import { useLocalDb } from '../lib/localDb/LocalDbContext';
import { loadLocalAdmins } from '../lib/localDb/localData';
import { deleteAdminAccount, adminApiError } from '../lib/adminApi';
import useAppRefresh from '../lib/useAppRefresh';

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
  const [showMyPasswordModal, setShowMyPasswordModal] = useState(false);
  const { createAdmin, currentUser } = useAuth();
  const { runSync, syncing, lastSyncAt } = useLocalDb();

  // القراءة من القاعدة المحلية: صفر قراءات عند التنقل، وقراءة تزايدية عند التحديث.
  const adminsQuery = useLocalQuery((localDb) => loadLocalAdmins(localDb), []);
  const admins = adminsQuery.data || [];
  const loading = adminsQuery.loading;

  const refresh = async () => {
    await runSync({ reason: 'manual' });
    adminsQuery.refresh();
  };

  // السحب للأسفل على الجوال يزامن التغييرات فقط.
  useAppRefresh(refresh);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (formData.password.length < 6) {
      toast.error('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }
    setCreating(true);
    try {
      await createAdmin(formData.email, formData.password, formData.name, formData.phone);
      logAdminAction({
        action: AUDIT_ACTIONS.ADMIN_CREATE,
        targetType: 'admin',
        targetId: formData.email,
        targetLabel: formData.name || formData.email,
      });
      toast.success('تم إنشاء حساب المدير بنجاح');
      setFormData({ name: '', email: '', phone: '', password: '' });
      setShowForm(false);
      await refresh();
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'تعذر إنشاء حساب المدير');
    }
    setCreating(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return false;
    try {
      const result = await deleteAdminAccount(deleteTarget.id);
      if (!result.ok) {
        toast.error(adminApiError(result.error, 'تعذر حذف المدير'));
        return false;
      }
      void logAdminAction({
        action: AUDIT_ACTIONS.ADMIN_DELETE,
        targetType: 'admin',
        targetId: deleteTarget.id,
        targetLabel: deleteTarget.name || deleteTarget.email || deleteTarget.id,
      }).catch((error) => console.warn('Admin deletion audit failed:', error));
      toast.success('تم حذف المدير من القائمة');
      setDeleteTarget(null);
      await refresh();
      return true;
    } catch (error) {
      console.error('Admin deletion failed:', error);
      toast.error('تعذر حذف المدير. تحقق من الاتصال ثم حاول مرة أخرى.');
      return false;
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
      <PageHero
        icon={ShieldCheck}
        title="إدارة المدراء"
        subtitle="إضافة وحذف حسابات المدراء الذين يمكنهم الوصول إلى لوحة التحكم."
        meta={`${admins.length} مدير مسجل`}
        actions={
          <>
            <DataFreshness lastSyncedAt={lastSyncAt} refreshing={loading || syncing} onRefresh={refresh} />
            <Button
              variant="secondary"
              icon={KeyRound}
              onClick={() => setShowMyPasswordModal(true)}
            >
              تعديل كلمة مروري
            </Button>
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
        <Section eyebrow="إنشاء" aria-label="إنشاء حساب مدير">
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
        </Section>
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
        <Section eyebrow="الفريق" title="حسابات المدراء" aria-label="حسابات المدراء">
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

              <div className="admin-card__footer flex items-center justify-between">
                <span className="admin-card__date">أُضيف في {formatDate(admin.createdAt)}</span>
                {admin.id === currentUser?.uid ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowMyPasswordModal(true)}
                      className="text-[11px] font-bold text-brand hover:underline flex items-center gap-1 bg-brand-soft px-2 py-0.5 rounded-md"
                      title="تغيير كلمة المرور الخاصة بك"
                    >
                      <KeyRound className="w-3 h-3" />
                      <span>تغيير كلمة المرور</span>
                    </button>
                    <Badge tone="brand">أنت</Badge>
                  </div>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
        </Section>
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

      <ChangeAdminPasswordModal
        isOpen={showMyPasswordModal}
        onClose={() => setShowMyPasswordModal(false)}
      />
    </div>
  );
}
