import { useState, useEffect, useCallback } from 'react';
import { collection, getDocs, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Smartphone, Trash2, RefreshCw, Inbox } from 'lucide-react';
import toast from 'react-hot-toast';
import Button from './ui/Button';
import ConfirmDialog from './ConfirmDialog';
import { SkeletonLine } from './ui/Skeleton';
import { formatDate } from '../lib/format';
import { logAdminAction, AUDIT_ACTIONS } from '../lib/auditLog';

function deviceLabel(device) {
  const parts = [device.platform, device.appVersion].filter(Boolean);
  return parts.length ? parts.join(' • ') : 'جهاز مسجّل';
}

function deviceTimestamp(device) {
  return device.updatedAt || device.lastSeenAt || device.lastSeen || device.createdAt || null;
}

/**
 * إدارة أجهزة إشعارات العميل (FCM) — القراءة والحذف مسموحان للمدير في firestore.rules.
 */
export default function UserDevicesPanel({ userId, userLabel }) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const snapshot = await getDocs(collection(db, 'users', userId, 'devices'));
      setDevices(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    } catch (err) {
      console.error('Error fetching devices:', err);
      setError('تعذر جلب أجهزة هذا الحساب.');
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'users', userId, 'devices', deleteTarget.id));
      setDevices((prev) => prev.filter((item) => item.id !== deleteTarget.id));
      logAdminAction({
        action: AUDIT_ACTIONS.DEVICE_DELETE,
        targetType: 'device',
        targetId: deleteTarget.id,
        targetLabel: userLabel || userId,
      });
      toast.success('تم حذف الجهاز من قائمة الإشعارات');
      setDeleteTarget(null);
    } catch (err) {
      console.error('Error deleting device:', err);
      toast.error('تعذر حذف الجهاز');
    }
    setDeleting(false);
  };

  return (
    <div className="auth-reset devices-panel">
      <div className="auth-reset__head">
        <span className="auth-reset__icon" aria-hidden="true">
          <Smartphone className="w-4 h-4" />
        </span>
        <div className="devices-panel__head-text">
          <p className="auth-reset__title">أجهزة الإشعارات ({devices.length})</p>
          <p className="auth-reset__desc">
            الأجهزة التي يستقبل عليها العميل إشعارات FCM. احذف الأجهزة القديمة أو المعطّلة
            لتحسين وصول الإشعارات.
          </p>
        </div>
        <Button variant="ghost" size="xs" icon={RefreshCw} onClick={load} loading={loading}>
          تحديث
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2 mt-3" aria-hidden="true">
          <SkeletonLine className="w-full h-11 rounded-[12px]" />
          <SkeletonLine className="w-2/3 h-11 rounded-[12px]" />
        </div>
      ) : error ? (
        <p className="auth-warn mt-3">{error}</p>
      ) : devices.length === 0 ? (
        <div className="devices-empty">
          <Inbox className="w-4 h-4" aria-hidden="true" />
          <span>لا توجد أجهزة مسجّلة لهذا الحساب.</span>
        </div>
      ) : (
        <ul className="devices-list">
          {devices.map((device) => (
            <li key={device.id} className="devices-item">
              <span className="devices-item__icon" aria-hidden="true">
                <Smartphone className="w-4 h-4" />
              </span>
              <span className="devices-item__body">
                <span className="devices-item__title">{deviceLabel(device)}</span>
                <span className="devices-item__meta">
                  <span className="mono-value" dir="ltr">
                    {device.token ? `…${String(device.token).slice(-10)}` : device.id.slice(0, 12)}
                  </span>
                  {deviceTimestamp(device) ? (
                    <span className="devices-item__time">{formatDate(deviceTimestamp(device), { withTime: true })}</span>
                  ) : null}
                </span>
              </span>
              <button
                type="button"
                className="notif-item__delete"
                onClick={() => setDeleteTarget(device)}
                title="حذف الجهاز"
                aria-label="حذف الجهاز"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="حذف جهاز"
        message="سيتم حذف توكن هذا الجهاز، ولن يستقبل العميل إشعارات عليه حتى يسجّل الدخول من التطبيق مجدداً. هل أنت متأكد؟"
        confirmText={deleting ? 'جارٍ الحذف...' : 'نعم، احذف الجهاز'}
        variant="danger"
      />
    </div>
  );
}
