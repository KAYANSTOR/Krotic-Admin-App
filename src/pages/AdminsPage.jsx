import { useState, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  ShieldCheck, UserPlus, Trash2, KeyRound, Phone, MoreVertical, RefreshCw, Mail,
} from 'lucide-react';
import toast from 'react-hot-toast';

import SearchHeader from '../components/ui/SearchHeader';
import HeroMetric from '../components/ui/HeroMetric';
import DataCard from '../components/ui/DataCard';
import OverflowMenu from '../components/ui/OverflowMenu';
import FAB from '../components/ui/FAB';
import ConfirmDialog from '../components/ConfirmDialog';
import ChangeAdminPasswordModal from '../components/ChangeAdminPasswordModal';
import AdminCreateModal from '../components/admins/AdminCreateModal';

import { logAdminAction, AUDIT_ACTIONS } from '../lib/auditLog';
import { useLocalQuery } from '../lib/localDb/useLocalQuery';
import { useLocalDb } from '../lib/localDb/LocalDbContext';
import { loadLocalAdmins } from '../lib/localDb/localData';
import { deleteAdminAccount, adminApiError } from '../lib/adminApi';
import useAppRefresh from '../lib/useAppRefresh';
import { formatDate } from '../lib/format';

export default function AdminsPage() {
  const [creating, setCreating] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [menuAdmin, setMenuAdmin] = useState(null);

  const { createAdmin, currentUser } = useAuth();
  const { runSync, syncing } = useLocalDb();

  const adminsQuery = useLocalQuery((localDb) => loadLocalAdmins(localDb), []);
  const admins = adminsQuery.data || [];
  const loading = adminsQuery.loading && !adminsQuery.data;

  const refresh = async () => {
    await runSync({ reason: 'manual' });
    adminsQuery.refresh();
  };
  useAppRefresh(refresh);

  const handleCreate = async (data) => {
    if (data.password.length < 6) {
      toast.error('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return false;
    }
    setCreating(true);
    try {
      await createAdmin(data.email, data.password, data.name, data.phone);
      logAdminAction({
        action: AUDIT_ACTIONS.ADMIN_CREATE,
        targetType: 'admin',
        targetId: data.email,
        targetLabel: data.name || data.email,
      }).catch(() => {});
      toast.success('تم إنشاء حساب المدير');
      await refresh();
      return true;
    } catch (error) {
      console.error('Admin creation failed:', error);
      toast.error(error.message || 'تعذر إنشاء الحساب');
      return false;
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return false;
    try {
      const result = await deleteAdminAccount(deleteTarget.id);
      if (!result.ok) {
        toast.error(adminApiError(result.error, 'تعذر حذف المدير'));
        return false;
      }
      logAdminAction({
        action: AUDIT_ACTIONS.ADMIN_DELETE,
        targetType: 'admin',
        targetId: deleteTarget.id,
        targetLabel: deleteTarget.name || deleteTarget.email || deleteTarget.id,
      }).catch((error) => console.warn('Admin deletion audit failed:', error));
      toast.success('تم حذف المدير');
      setDeleteTarget(null);
      await refresh();
      return true;
    } catch (error) {
      console.error('Admin deletion failed:', error);
      toast.error('تعذر الحذف. تحقق من الاتصال');
      return false;
    }
  };

  const stats = useMemo(() => {
    const total = admins.length;
    const self = admins.filter((a) => a.id === currentUser?.uid).length;
    return { total, self, others: total - self };
  }, [admins, currentUser?.uid]);

  if (loading) {
    return (
      <div className="space-y-4 pb-24">
        <div className="h-16 rounded-2xl bg-[var(--ui-sunken)]/60 animate-pulse" />
        <div className="h-32 rounded-3xl bg-[var(--ui-sunken)]/60 animate-pulse" />
        <div className="h-20 rounded-2xl bg-[var(--ui-sunken)]/60 animate-pulse" />
        <div className="h-20 rounded-2xl bg-[var(--ui-sunken)]/60 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="pb-24">
      <SearchHeader
        title="المدراء"
        subtitle={`${admins.length} مدير مسجّل`}
        actions={
          <>
            <button
              type="button"
              onClick={() => setShowPasswordModal(true)}
              className="p-2.5 rounded-full text-[var(--ui-muted)] hover:bg-[var(--ui-sunken)] hover:text-[var(--ui-ink)]"
              aria-label="تعديل كلمة مروري"
            >
              <KeyRound className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={refresh}
              disabled={syncing}
              className="p-2.5 rounded-full text-[var(--ui-muted)] hover:bg-[var(--ui-sunken)] hover:text-[var(--ui-ink)] disabled:opacity-50"
              aria-label="تحديث"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            </button>
          </>
        }
      />

      <div className="mt-3">
        <HeroMetric
          label="حسابات المدراء"
          value={stats.total}
          unit="مدير"
          icon={ShieldCheck}
          trend="flat"
          hint={stats.self > 0 ? 'حسابك مسجل في هذه القائمة' : 'لا يوجد حساب مطابق لجلسة حالية'}
          tone="brand"
        />
      </div>

      <div className="mt-3 space-y-2.5">
        {admins.length === 0 ? (
          <div className="p-10 text-center rounded-2xl bg-[var(--ui-surface)] border border-line">
            <ShieldCheck className="w-6 h-6 mx-auto mb-2 text-[var(--ui-muted)]" />
            <p className="font-bold text-[var(--ui-ink)]">لا يوجد مدراء</p>
            <p className="text-xs text-[var(--ui-muted)] mt-1">أضف أول مدير من الزر العائم.</p>
          </div>
        ) : (
          admins.map((admin) => {
            const isSelf = admin.id === currentUser?.uid;
            const displayName = admin.name || '—';
            return (
              <DataCard
                key={admin.id}
                avatar={{
                  initial: displayName.charAt(0),
                  tone: isSelf ? 'brand' : 'neutral',
                }}
                title={displayName}
                subtitle={admin.email || '—'}
                badges={isSelf ? [{ label: 'أنت', tone: 'brand' }] : []}
                facts={[
                  ...(admin.phone ? [{ icon: Phone, label: 'الهاتف', value: admin.phone }] : []),
                  ...(admin.createdAt ? [{ label: 'أُضيف', value: formatDate(admin.createdAt) }] : []),
                ]}
                trailing={
                  <button
                    type="button"
                    onClick={() => setMenuAdmin(admin)}
                    className="p-2 rounded-full text-[var(--ui-muted)] hover:bg-[var(--ui-sunken)] hover:text-[var(--ui-ink)]"
                    aria-label="إجراءات"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                }
              />
            );
          })
        )}
      </div>

      <FAB icon={UserPlus} label="إضافة مدير" extended onClick={() => setShowCreateModal(true)} />

      <AdminCreateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreate}
        creating={creating}
      />

      <OverflowMenu
        isOpen={Boolean(menuAdmin)}
        onClose={() => setMenuAdmin(null)}
        title={menuAdmin?.name || '—'}
        subtitle={menuAdmin?.email || '—'}
        actions={menuAdmin ? (
          menuAdmin.id === currentUser?.uid
            ? [
                {
                  key: 'pwd',
                  icon: KeyRound,
                  label: 'تغيير كلمة المرور',
                  tone: 'brand',
                  onClick: () => setShowPasswordModal(true),
                },
              ]
            : [
                {
                  key: 'delete',
                  icon: Trash2,
                  label: 'حذف المدير',
                  tone: 'danger',
                  onClick: () => setDeleteTarget(menuAdmin),
                },
              ]
        ) : []}
      />

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="حذف المدير"
        message={`هل أنت متأكد من حذف "${deleteTarget?.name || '—'}" من قائمة المدراء؟ لن يتمكن من الدخول للوحة بعد الآن.`}
        confirmText="نعم، احذف"
        variant="danger"
      />

      <ChangeAdminPasswordModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
      />
    </div>
  );
}
