import { useState, useEffect, useMemo } from 'react';
import {
  collection, getDocs, addDoc, doc, deleteDoc, serverTimestamp
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import {
  Bell, Send, Users, User, Globe, History, RefreshCw,
  AlertCircle, Inbox, CheckCircle2, Radio, ShieldCheck, Trash2
} from 'lucide-react';
import toast from 'react-hot-toast';
import PageHeader from '../components/ui/PageHeader';
import { Card, CardHeader } from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import { SkeletonCard, SkeletonPageHeader } from '../components/ui/Skeleton';
import ConfirmDialog from '../components/ConfirmDialog';
import DataFreshness from '../components/ui/DataFreshness';
import { logAdminAction, AUDIT_ACTIONS } from '../lib/auditLog';
import { loadTemplates, saveTemplate, deleteTemplate } from '../lib/notificationTemplates';
import { fetchUsersForSelect, clearAdminDataCache } from '../lib/adminData';

export default function NotificationsPage() {
  const [type, setType] = useState('global');
  const [selectedUser, setSelectedUser] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [users, setUsers] = useState([]);
  const [recentNotifications, setRecentNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [templates, setTemplates] = useState(() => loadTemplates());
  const [templateId, setTemplateId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async ({ force = false } = {}) => {
    setLoadError(false);
    if (force) clearAdminDataCache();
    try {
      const [usersData, notificationResult] = await Promise.all([
        fetchUsersForSelect(),
        getDocs(collection(db, 'app_settings', 'global_config', 'notifications')),
      ]);
      setUsers(usersData);
      const notifs = notificationResult.docs
        .map((notificationDoc) => ({ id: notificationDoc.id, ...notificationDoc.data(), type: 'global' }))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setRecentNotifications(notifs.slice(0, 20));
      setUpdatedAt(Date.now());
    } catch (error) {
      console.error('Error fetching data:', error);
      setLoadError(true);
      toast.error('خطأ في تحميل البيانات');
    }
    setLoading(false);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) {
      toast.error('يرجى ملء جميع الحقول');
      return;
    }
    if (type === 'user' && !selectedUser) {
      toast.error('يرجى اختيار المستخدم');
      return;
    }

    // جدولة: تُكتب الطلبية في notification_requests ليلتقطها المُجدوِل في الخادم.
    if (scheduledAt) {
      const scheduledMs = new Date(scheduledAt).getTime();
      if (!Number.isFinite(scheduledMs) || scheduledMs <= Date.now()) {
        toast.error('اختر وقتاً مستقبلياً للجدولة');
        return;
      }
      setSending(true);
      try {
        await addDoc(collection(db, 'notification_requests'), {
          title: title.trim(),
          body: message.trim(),
          audienceType: type,
          ...(type === 'user' ? { targetUid: selectedUser } : {}),
          data: { route: '/account-notifications' },
          scheduledAt: scheduledMs,
          status: 'scheduled',
          createdBy: auth.currentUser?.uid || null,
          createdAt: serverTimestamp(),
        });
        logAdminAction({
          action: AUDIT_ACTIONS.NOTIFICATION_SCHEDULE,
          targetType: type === 'user' ? 'user' : 'broadcast',
          targetId: type === 'user' ? selectedUser : 'all',
          targetLabel: type === 'user'
            ? (users.find((u) => u.uid === selectedUser)?.name || selectedUser)
            : 'جميع المستخدمين',
          details: { title: title.trim(), scheduled_at: new Date(scheduledMs).toISOString() },
        });
        toast.success('تمت جدولة الإشعار');
        setTitle('');
        setMessage('');
        setScheduledAt('');
      } catch (error) {
        console.error('Error scheduling notification:', error);
        toast.error('تعذر جدولة الإشعار');
      }
      setSending(false);
      return;
    }

    setSending(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        toast.error('انتهت الجلسة، يرجى تسجيل الدخول من جديد');
        setSending(false);
        return;
      }

      // 1) الإرسال الفعلي عبر دالة Vercel الآمنة (FCM)
      const res = await fetch('/api/send-fcm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          title: title.trim(),
          body: message.trim(),
          data: {
            route: '/account-notifications',
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
          },
          ...(type === 'user' ? { targetUid: selectedUser } : {}),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        const errorMessages = {
          missing_token: 'انتهت الجلسة، يرجى تسجيل الدخول من جديد',
          invalid_token: 'انتهت الجلسة، يرجى تسجيل الدخول من جديد',
          not_admin: 'هذا الحساب لا يملك صلاحية إرسال الإشعارات',
          no_devices: 'لا توجد أجهزة مسجّلة لهذا المستخدم بعد',
          server_not_configured: 'خدمة الإشعارات غير مهيأة على الخادم بعد',
          title_and_body_required: 'يرجى ملء العنوان والنص',
        };
        toast.error(errorMessages[data.error] || `فشل إرسال الإشعار (${data.error || res.status})`);
        setSending(false);
        return;
      }

      // 2) تسجيل الإشعار في Firestore (سجل اللوحة + صندوق إشعارات التطبيق)
      try {
        const notificationData = {
          title: title.trim(),
          body: message.trim(),
          message: message.trim(),
          audienceType: type,
          ...(type === 'user' ? { targetUid: selectedUser } : {}),
          data: { route: '/account-notifications' },
          createdBy: auth.currentUser?.uid || null,
          status: 'sent',
          sentCount: data.sent ?? 1,
          createdAt: serverTimestamp(),
        };

        if (type === 'global') {
          await addDoc(collection(db, 'app_settings', 'global_config', 'notifications'), {
            ...notificationData,
            timestamp: Date.now(),
          });
        } else {
          await addDoc(collection(db, 'users', selectedUser, 'notifications'), {
            title: notificationData.title,
            message: notificationData.message,
            is_read: false,
            timestamp: Date.now(),
            createdAt: serverTimestamp(),
          });
        }
      } catch (logError) {
        console.warn('Notification history write failed', logError);
      }

      logAdminAction({
        action: AUDIT_ACTIONS.NOTIFICATION_SEND,
        targetType: type === 'user' ? 'user' : 'broadcast',
        targetId: type === 'user' ? selectedUser : 'all',
        targetLabel: type === 'user' ? (users.find((u) => u.uid === selectedUser)?.name || selectedUser) : 'جميع المستخدمين',
        details: { title: title.trim(), sent: data.sent ?? 1 },
      });

      if (type === 'global') {
        toast.success('تم إرسال الإشعار لجميع الأجهزة بنجاح!');
      } else {
        const userName = users.find((u) => u.uid === selectedUser)?.name || selectedUser;
        toast.success(`تم إرسال الإشعار إلى ${userName} بنجاح`);
      }

      // إعادة ضبط النموذج وتحديث القائمة
      setTitle('');
      setMessage('');
      fetchData();
    } catch (error) {
      console.error('Error sending notification:', error);
      toast.error('تعذر الاتصال بالخادم');
    }
    setSending(false);
  };

  const handleApplyTemplate = (id) => {
    setTemplateId(id);
    const template = templates.find((item) => item.id === id);
    if (!template) return;
    setTitle(template.title);
    setMessage(template.message);
  };

  const handleSaveTemplate = () => {
    if (!title.trim() || !message.trim()) {
      toast.error('اكتب العنوان والنص أولاً لحفظهما كقالب');
      return;
    }
    setTemplates(saveTemplate(title, title, message));
    toast.success('تم حفظ القالب على هذا الجهاز');
  };

  const handleDeleteTemplate = () => {
    if (!templateId) {
      toast.error('اختر قالباً لحذفه');
      return;
    }
    setTemplates(deleteTemplate(templateId));
    setTemplateId('');
    toast.success('تم حذف القالب');
  };

  const handleDeleteNotification = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'app_settings', 'global_config', 'notifications', deleteTarget.id));
      setRecentNotifications((prev) => prev.filter((item) => item.id !== deleteTarget.id));
      logAdminAction({
        action: AUDIT_ACTIONS.NOTIFICATION_DELETE,
        targetType: 'notification',
        targetId: deleteTarget.id,
        targetLabel: deleteTarget.title || '',
      });
      toast.success('تم حذف الإشعار من السجل');
      setDeleteTarget(null);
    } catch (error) {
      console.error('Error deleting notification:', error);
      toast.error('تعذر حذف الإشعار. تحقق من الصلاحيات ثم أعد المحاولة.');
    }
    setDeleting(false);
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '—';
    return new Date(timestamp).toLocaleDateString('ar-IQ', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const selectedUserName = useMemo(
    () => users.find((u) => u.uid === selectedUser)?.name || '',
    [users, selectedUser]
  );

  const canSend = title.trim().length > 0 && message.trim().length > 0 && (type === 'global' || !!selectedUser);

  if (loading) {
    return (
      <div className="notifications-page">
        <SkeletonPageHeader />
        <div className="notif-grid">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={5} />
        </div>
      </div>
    );
  }

  return (
    <div className="notifications-page">
      <PageHeader
        icon={Bell}
        title="الإشعارات"
        description="إرسال إشعارات فورية عبر FCM إلى جميع الأجهزة أو إلى مستخدم محدد، مع سجل كامل للإشعارات العامة."
        meta={`${users.length} مستخدم متاح • ${recentNotifications.length} إشعار عام في السجل`}
        actions={
          <DataFreshness
            updatedAt={updatedAt}
            refreshing={loading}
            onRefresh={() => fetchData({ force: true })}
          />
        }
      />

      {loadError && (
        <div className="notif-error" role="alert">
          <span className="notif-error__icon"><AlertCircle className="w-5 h-5" /></span>
          <div className="notif-error__body">
            <p className="notif-error__title">تعذّر تحميل البيانات</p>
            <p className="notif-error__msg">تحقق من الاتصال ثم أعد المحاولة.</p>
          </div>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={fetchData}>
            إعادة المحاولة
          </Button>
        </div>
      )}

      <div className="notif-grid">
        {/* ====== نموذج الإرسال ====== */}
        <Card className="notif-compose">
          <CardHeader
            icon={Send}
            title="إرسال إشعار جديد"
            description="يُرسَل الإشعار مباشرة إلى الأجهزة عبر FCM بعد التحقق من صلاحيات المدير."
          />

          <form onSubmit={handleSend} className="notif-form" noValidate>
            {/* الجمهور */}
            <div className="notif-field">
              <label className="label-field">الجمهور</label>
              <div className="notif-audience" role="radiogroup" aria-label="نوع الإشعار">
                <button
                  type="button"
                  role="radio"
                  aria-checked={type === 'global'}
                  onClick={() => setType('global')}
                  className={`notif-audience__btn ${type === 'global' ? 'is-active' : ''}`}
                >
                  <span className="notif-audience__icon"><Globe className="w-5 h-5" /></span>
                  <span className="notif-audience__text">
                    <strong>للجميع</strong>
                    <small>إلى جميع الأجهزة المسجّلة</small>
                  </span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={type === 'user'}
                  onClick={() => setType('user')}
                  className={`notif-audience__btn ${type === 'user' ? 'is-active' : ''}`}
                >
                  <span className="notif-audience__icon"><User className="w-5 h-5" /></span>
                  <span className="notif-audience__text">
                    <strong>لمستخدم محدد</strong>
                    <small>إلى أجهزة مستخدم واحد</small>
                  </span>
                </button>
              </div>
            </div>

            {/* المستلم */}
            {type === 'user' && (
              <div className="notif-field">
                <label className="label-field" htmlFor="notif-user">المستلم</label>
                <select
                  id="notif-user"
                  value={selectedUser}
                  onChange={(e) => setSelectedUser(e.target.value)}
                  className="input-field"
                  required
                >
                  <option value="">— اختر شبكة —</option>
                  {users.map((u) => (
                    <option key={u.uid} value={u.uid}>
                      {u.name}
                    </option>
                  ))}
                </select>
                {selectedUserName && (
                  <p className="field-hint">
                    سيُرسَل الإشعار إلى أجهزة: <strong>{selectedUserName}</strong>
                  </p>
                )}
              </div>
            )}

            {/* العنوان */}
            <div className="notif-field">
              <label className="label-field" htmlFor="notif-title">عنوان الإشعار</label>
              <input
                id="notif-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input-field"
                placeholder="أدخل عنوان الإشعار..."
                maxLength={120}
                required
              />
            </div>

            {/* الرسالة */}
            <div className="notif-field">
              <label className="label-field" htmlFor="notif-message">نص الإشعار</label>
              <textarea
                id="notif-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="input-field resize-none"
                rows={4}
                placeholder="أدخل نص الإشعار..."
                maxLength={500}
                required
              />
              <p className="field-hint">{message.length}/500 حرف</p>
            </div>

            {/* القوالب */}
            <div className="notif-field">
              <label className="label-field" htmlFor="notif-template">قوالب جاهزة</label>
              <div className="notif-templates">
                <select
                  id="notif-template"
                  className="input-field"
                  value={templateId}
                  onChange={(e) => handleApplyTemplate(e.target.value)}
                >
                  <option value="">— اختر قالباً —</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
                </select>
                <Button type="button" variant="secondary" size="sm" onClick={handleSaveTemplate}>
                  حفظ كقالب
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleDeleteTemplate}
                  disabled={!templateId}
                >
                  حذف القالب
                </Button>
              </div>
              <p className="field-hint">تُحفظ القوالب على هذا الجهاز فقط لتسريع الإرسال المتكرر.</p>
            </div>

            {/* الجدولة */}
            <div className="notif-field">
              <label className="label-field" htmlFor="notif-schedule">جدولة الإرسال (اختياري)</label>
              <input
                id="notif-schedule"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="input-field"
              />
              <p className="field-hint">
                اتركه فارغاً للإرسال الفوري. عند التحديد يُحفظ الطلب ويُرسَل تلقائياً في الوقت المحدد.
              </p>
            </div>

            {/* معاينة الإشعار */}
            <div className="notif-field">
              <label className="label-field">معاينة الإشعار</label>
              <div className="notif-preview" aria-live="polite">
                <div className="notif-preview__icon">
                  <Bell className="w-5 h-5" />
                </div>
                <div className="notif-preview__body">
                  <div className="notif-preview__head">
                    <span className="notif-preview__app">Krotak Pro</span>
                    <span className="notif-preview__time">الآن</span>
                  </div>
                  <p className="notif-preview__title">
                    {title.trim() || 'عنوان الإشعار'}
                  </p>
                  <p className="notif-preview__text">
                    {message.trim() || 'سيظهر نص الإشعار هنا كما سيستلمه المستخدم.'}
                  </p>
                </div>
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              block
              loading={sending}
              disabled={!canSend}
              icon={sending ? undefined : Send}
            >
              {sending
                ? (scheduledAt ? 'جارٍ الجدولة...' : 'جارٍ الإرسال...')
                : (scheduledAt ? 'جدولة الإشعار' : 'إرسال الإشعار')}
            </Button>

            <p className="notif-note">
              <ShieldCheck className="w-4 h-4" />
              يُرسَل الإشعار مباشرة إلى الأجهزة عبر FCM بعد التحقق من صلاحيات المدير.
            </p>
          </form>
        </Card>

        {/* ====== سجل الإشعارات ====== */}
        <Card className="notif-history">
          <CardHeader
            icon={History}
            title="آخر الإشعارات العامة المرسلة"
            description="أحدث 20 إشعارًا عامًا مسجّلًا في السجل."
            action={
              <Badge tone="brand" dot>
                {recentNotifications.length}
              </Badge>
            }
          />

          {recentNotifications.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state__icon icon-tile icon-tile--neutral icon-tile--lg">
                <Inbox className="w-6 h-6" />
              </span>
              <p className="empty-state__title">لا يوجد إشعارات سابقة</p>
              <p className="empty-state__desc">
                ستظهر هنا الإشعارات العامة التي تُرسَل من هذه اللوحة.
              </p>
            </div>
          ) : (
            <ul className="notif-list">
              {recentNotifications.map((notif) => (
                <li key={notif.id} className="notif-item">
                  <div className="notif-item__icon">
                    <Radio className="w-4 h-4" />
                  </div>
                  <div className="notif-item__body">
                    <div className="notif-item__head">
                      <p className="notif-item__title">{notif.title}</p>
                      <Badge tone="info">عام</Badge>
                    </div>
                    <p className="notif-item__text">{notif.message}</p>
                    <div className="notif-item__meta">
                      <span className="notif-item__meta-item">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {notif.status === 'sent' ? 'تم الإرسال' : (notif.status || 'مرسل')}
                      </span>
                      <span className="notif-item__meta-item">
                        <Users className="w-3.5 h-3.5" />
                        {notif.sentCount ?? 1} جهاز
                      </span>
                      <span className="notif-item__meta-item">
                        {formatDate(notif.timestamp)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="notif-item__delete"
                    onClick={() => setDeleteTarget(notif)}
                    title="حذف الإشعار"
                    aria-label={`حذف الإشعار: ${notif.title || ''}`}
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteNotification}
        title="حذف الإشعار"
        message={`هل أنت متأكد من حذف الإشعار "${deleteTarget?.title || ''}" من السجل؟ لا يمكن التراجع عن هذا الإجراء.`}
        confirmText={deleting ? 'جارٍ الحذف...' : 'نعم، احذف'}
        variant="danger"
      />
    </div>
  );
}
