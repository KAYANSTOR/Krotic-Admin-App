import { useState, useEffect, useMemo, useRef } from 'react';
import {
  collection, addDoc, doc, deleteDoc, serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import {
  Bell, Send, Users, User, Globe, History, RefreshCw,
  AlertCircle, Inbox, CheckCircle2, Radio, ShieldCheck, Trash2,
  FileText, Plus, Sparkles, Clock, Search, X, Smartphone,
} from 'lucide-react';
import PhoneNotificationModal from '../components/PhoneNotificationModal';
import toast from 'react-hot-toast';
import PageHero from '../components/ui/PageHero';
import Section from '../components/ui/Section';
import { Card, CardHeader } from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import { SkeletonCard, SkeletonPageHeader } from '../components/ui/Skeleton';
import ConfirmDialog from '../components/ConfirmDialog';
import DataFreshness from '../components/ui/DataFreshness';
import { logAdminAction, AUDIT_ACTIONS } from '../lib/auditLog';
import { loadTemplates, saveTemplate, deleteTemplate } from '../lib/notificationTemplates';
import { fetchUsersForSelect, fetchNotificationHistory, getAdminDataCacheState, subscribeAdminDataCache, invalidateNotificationHistory } from '../lib/adminData';
import useAppRefresh from '../lib/useAppRefresh';
import { triggerScheduledDispatch } from '../lib/adminApi';

const DEFAULT_QUICK_PRESETS = [
  {
    title: 'تحديث جديد لتطبيق كروتك برو',
    message: 'يتوفر الآن تحديث جديد للتطبيق يشمل تحسينات في سرعة الطباعة والاتصال. يرجى التحديث الآن.',
  },
  {
    title: 'تذكير بسداد العمولة الشهرية',
    message: 'نرجو مراجعة كشف الحساب وسداد العمولة المستحقة لضمان استمرار الخدمة دون انقطاع.',
  },
  {
    title: 'صيانة دورية مجدولة',
    message: 'سيتم إجراء صيانة دورية للخوادم الليلة من الساعة 3 فجراً وحتى 4 فجراً. شكراً لتفهمكم.',
  },
  {
    title: 'تنبيه هام للشبكات',
    message: 'يرجى التأكد من مزامنة كروت الشبكة قبل نهاية اليوم لضمان دقة التقارير المالية.',
  },
];

export function toNotificationMillis(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  try {
    if (typeof value.toMillis === 'function') {
      const millis = value.toMillis();
      return Number.isFinite(millis) ? millis : null;
    }
    if (typeof value.toDate === 'function') {
      const millis = value.toDate().getTime();
      return Number.isFinite(millis) ? millis : null;
    }
  } catch {
    return null;
  }
  if (typeof value === 'string') {
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

export function notificationMillis(data) {
  return toNotificationMillis(data?.timestamp) ?? toNotificationMillis(data?.createdAt);
}

export default function NotificationsPage() {
  const [type, setType] = useState('global');
  const [selectedUser, setSelectedUser] = useState('');
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [users, setUsers] = useState([]);
  const [recentNotifications, setRecentNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [cacheState, setCacheState] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [templates, setTemplates] = useState(() => loadTemplates());
  const [templateId, setTemplateId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [activeTab, setActiveTab] = useState('compose'); // 'compose' | 'history' | 'templates'
  const [historySearch, setHistorySearch] = useState('');
  const [phoneModalOpen, setPhoneModalOpen] = useState(false);
  const latestRequestId = useRef(0);

  useEffect(() => {
    fetchData();
    return () => { latestRequestId.current += 1; };
  }, []);

  useEffect(() => subscribeAdminDataCache('notification-history', (history) => {
    if (!Array.isArray(history)) return;
    setRecentNotifications(history.map((data) => ({
      ...data,
      type: 'global',
      displayTimestamp: notificationMillis(data),
    })));
    setCacheState(getAdminDataCacheState('notification-history'));
  }), []);

  useAppRefresh(() => fetchData({ force: true }));

  useEffect(() => {
    triggerScheduledDispatch();
  }, []);

  const fetchData = async ({ force = false } = {}) => {
    const requestId = ++latestRequestId.current;
    setLoadError(false);
    if (force) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const [usersData, notificationHistory] = await Promise.all([
        fetchUsersForSelect({ force }),
        fetchNotificationHistory({ force }),
      ]);
      if (requestId !== latestRequestId.current) return;
      setUsers(usersData);
      const notifs = notificationHistory.map((data) => ({
        ...data,
        type: 'global',
        displayTimestamp: notificationMillis(data),
      }));
      setRecentNotifications(notifs);
      setCacheState(getAdminDataCacheState('notification-history'));
      setUpdatedAt(Date.now());
    } catch (error) {
      if (requestId !== latestRequestId.current) return;
      console.error('Error fetching data:', error);
      setLoadError(true);
      toast.error(force ? 'تعذر تحديث سجل الإشعارات' : 'خطأ في تحميل البيانات');
    } finally {
      if (requestId === latestRequestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) {
      toast.error('يرجى ملء العنوان ونص الإشعار');
      return;
    }
    if (type === 'user' && !selectedUser) {
      toast.error('يرجى اختيار المستخدم المستلم');
      return;
    }

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
        toast.success('تمت جدولة الإشعار بنجاح');
        setTitle('');
        setMessage('');
        setScheduledAt('');
        setActiveTab('history');
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
          invalidateNotificationHistory();
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

      setTitle('');
      setMessage('');
      fetchData({ force: true });
      setActiveTab('history');
    } catch (error) {
      console.error('Error sending notification:', error);
      toast.error('تعذر الاتصال بالخادم لإرسال الإشعار');
    }
    setSending(false);
  };

  const handleApplyQuickPreset = (preset) => {
    setTitle(preset.title);
    setMessage(preset.message);
    toast.success('تم تطبيق القالب الجاهز');
  };

  const handleApplyTemplate = (id) => {
    setTemplateId(id);
    const template = templates.find((item) => item.id === id);
    if (!template) return;
    setTitle(template.title);
    setMessage(template.message);
    toast.success(`تم اختيار قالب: ${template.name}`);
  };

  const handleSaveTemplate = () => {
    if (!title.trim() || !message.trim()) {
      toast.error('اكتب العنوان والنص أولاً لحفظهما كقالب');
      return;
    }
    const newTemplates = saveTemplate(title, title, message);
    setTemplates(newTemplates);
    toast.success('تم حفظ القالب بنجاح');
  };

  const handleDeleteTemplate = (idToDelete) => {
    const targetId = idToDelete || templateId;
    if (!targetId) return;
    const newTemplates = deleteTemplate(targetId);
    setTemplates(newTemplates);
    if (templateId === targetId) setTemplateId('');
    toast.success('تم حذف القالب');
  };

  const handleDeleteNotification = async () => {
    if (!deleteTarget) return false;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'app_settings', 'global_config', 'notifications', deleteTarget.id));
      setRecentNotifications((prev) => prev.filter((item) => item.id !== deleteTarget.id));
      void logAdminAction({
        action: AUDIT_ACTIONS.NOTIFICATION_DELETE,
        targetType: 'notification',
        targetId: deleteTarget.id,
        targetLabel: deleteTarget.title || '',
      }).catch((error) => console.warn('Notification delete audit failed:', error));
      toast.success('تم حذف الإشعار من السجل');
      setDeleteTarget(null);
      return true;
    } catch (error) {
      console.error('Error deleting notification:', error);
      toast.error('تعذر حذف الإشعار');
      return false;
    } finally {
      setDeleting(false);
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    return date.toLocaleDateString('ar-YE', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const filteredUsers = useMemo(() => {
    if (!userSearchTerm.trim()) return users;
    const q = userSearchTerm.toLowerCase();
    return users.filter((u) => u.name?.toLowerCase().includes(q) || u.phone?.includes(q) || u.uid?.includes(q));
  }, [users, userSearchTerm]);

  const filteredHistory = useMemo(() => {
    if (!historySearch.trim()) return recentNotifications;
    const q = historySearch.toLowerCase();
    return recentNotifications.filter((n) =>
      n.title?.toLowerCase().includes(q) || n.message?.toLowerCase().includes(q)
    );
  }, [recentNotifications, historySearch]);

  const selectedUserName = useMemo(
    () => users.find((u) => u.uid === selectedUser)?.name || '',
    [users, selectedUser]
  );

  const canSend = title.trim().length > 0 && message.trim().length > 0 && (type === 'global' || !!selectedUser);

  if (loading) {
    return (
      <div className="notifications-page space-y-4">
        <SkeletonPageHeader />
        <div className="grid-kpi">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={5} />
        </div>
      </div>
    );
  }

  return (
    <div className="notifications-page space-y-4 pb-20">
      {/* Android Top Page Hero */}
      <PageHero
        icon={Bell}
        title="مركز الإشعارات الفورية"
        subtitle="بث تنبيهات push مباشرة لهواتف العملاء ومتابعة السجل"
        meta={`${users.length} شبكة مسجّلة • ${recentNotifications.length} إشعار في السجل`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              icon={Smartphone}
              onClick={() => setPhoneModalOpen(true)}
              className="font-bold text-xs"
            >
              إشعارات هاتفي الحية
            </Button>
            <DataFreshness
              updatedAt={updatedAt}
              refreshing={loading || refreshing}
              onRefresh={() => fetchData({ force: true })}
              fromCache={cacheState?.fromCache ?? null}
            />
          </div>
        }
      />

      {loadError && (
        <div className="notif-error" role="alert">
          <span className="notif-error__icon"><AlertCircle className="w-5 h-5" /></span>
          <div className="notif-error__body">
            <p className="notif-error__title">تعذّر تحديث السجل</p>
            <p className="notif-error__msg">تحقق من الاتصال بالإنترنت ثم أعد المحاولة.</p>
          </div>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => fetchData({ force: true })}>
            إعادة المحاولة
          </Button>
        </div>
      )}

      {/* Android App Segmented Bar (3 واضحين ومرنين للهاتف) */}
      <div className="android-tabs" role="tablist" aria-label="أقسام الإشعارات">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'compose'}
          onClick={() => setActiveTab('compose')}
          className={`android-tab ${activeTab === 'compose' ? 'is-active' : ''}`}
        >
          <Send className="w-4 h-4 ml-1" />
          <span>إرسال إشعار</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'history'}
          onClick={() => setActiveTab('history')}
          className={`android-tab ${activeTab === 'history' ? 'is-active' : ''}`}
        >
          <History className="w-4 h-4 ml-1" />
          <span>السجل</span>
          <span className="android-tab__badge">{recentNotifications.length}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'templates'}
          onClick={() => setActiveTab('templates')}
          className={`android-tab ${activeTab === 'templates' ? 'is-active' : ''}`}
        >
          <FileText className="w-4 h-4 ml-1" />
          <span>القوالب</span>
          <span className="android-tab__badge">{templates.length}</span>
        </button>
      </div>

      {/* ===================== TAB 1: COMPOSE ===================== */}
      {activeTab === 'compose' && (
        <div className="space-y-4">
          {/* Quick Preset Chips Carousel for mobile (ضغط سريع لملء الرسائل الشائعة) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-ink-soft flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-brand" />
                نماذج رسائل سريعة بنقرة واحدة:
              </span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar touch-pan-x">
              {DEFAULT_QUICK_PRESETS.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleApplyQuickPreset(p)}
                  className="flex-shrink-0 text-right px-3 py-2 bg-surface hover:bg-surface-sunken border border-line rounded-xl text-xs font-semibold text-ink transition-all active:scale-95 shadow-xs max-w-[200px] truncate"
                >
                  {p.title}
                </button>
              ))}
            </div>
          </div>

          <Card className="notif-compose p-4 sm:p-6 rounded-2xl shadow-sm border border-line">
            <form onSubmit={handleSend} className="space-y-5" noValidate>
              {/* اختيار الجمهور بنمط أزرار أندرويد كبيرة ومريحة للمس */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-ink-soft">نوع الجمهور المستهدف</label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => { setType('global'); setSelectedUser(''); }}
                    className={`flex items-center gap-3 p-3.5 rounded-xl border text-right transition-all active:scale-98 ${
                      type === 'global'
                        ? 'border-brand bg-brand-soft/20 text-brand-deep font-bold ring-2 ring-brand/30 shadow-xs'
                        : 'border-line bg-surface text-ink-soft hover:bg-surface-sunken'
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${type === 'global' ? 'bg-brand text-white' : 'bg-surface-sunken text-muted'}`}>
                      <Globe className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold leading-tight">للجميع</p>
                      <p className="text-xs text-muted mt-0.5">كافة الهواتف المسجلة</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setType('user')}
                    className={`flex items-center gap-3 p-3.5 rounded-xl border text-right transition-all active:scale-98 ${
                      type === 'user'
                        ? 'border-brand bg-brand-soft/20 text-brand-deep font-bold ring-2 ring-brand/30 shadow-xs'
                        : 'border-line bg-surface text-ink-soft hover:bg-surface-sunken'
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${type === 'user' ? 'bg-brand text-white' : 'bg-surface-sunken text-muted'}`}>
                      <User className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold leading-tight">لمشترك محدد</p>
                      <p className="text-xs text-muted mt-0.5">هواتف شبكة واحدة</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* اختيار المستلم إن كان خاصاً */}
              {type === 'user' && (
                <div className="space-y-2 p-3 bg-surface-sunken/60 rounded-xl border border-line">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-ink" htmlFor="notif-user-select">اختر المشترك المستلم</label>
                    {selectedUserName && (
                      <span className="text-xs text-brand font-bold">المحدد: {selectedUserName}</span>
                    )}
                  </div>
                  {/* شريط بحث سريع للمستخدمين */}
                  <div className="relative">
                    <Search className="w-4 h-4 absolute right-3 top-3 text-muted pointer-events-none" />
                    <input
                      type="text"
                      placeholder="ابحث باسم المشترك أو الرقم..."
                      value={userSearchTerm}
                      onChange={(e) => setUserSearchTerm(e.target.value)}
                      className="input-field pr-9 text-xs"
                    />
                    {userSearchTerm && (
                      <button
                        type="button"
                        onClick={() => setUserSearchTerm('')}
                        className="absolute left-3 top-2.5 text-muted hover:text-ink"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <select
                    id="notif-user-select"
                    value={selectedUser}
                    onChange={(e) => setSelectedUser(e.target.value)}
                    className="input-field"
                    required
                  >
                    <option value="">— اختر من القائمة ({filteredUsers.length} متاح) —</option>
                    {filteredUsers.map((u) => (
                      <option key={u.uid} value={u.uid}>
                        {u.name} {u.phone ? `(${u.phone})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* عنوان الإشعار */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-ink" htmlFor="notif-title-input">عنوان الإشعار</label>
                  <span className="text-[11px] text-muted">{title.length}/120</span>
                </div>
                <input
                  id="notif-title-input"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="input-field"
                  placeholder="مثال: تنبيه هام، تحديث جديد، تذكير بالاشتراك..."
                  maxLength={120}
                  required
                />
              </div>

              {/* نص الرسالة */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-ink" htmlFor="notif-body-input">نص رسالة الإشعار</label>
                  <span className="text-[11px] text-muted">{message.length}/500</span>
                </div>
                <textarea
                  id="notif-body-input"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="input-field resize-none leading-relaxed"
                  rows={4}
                  placeholder="اكتب تفاصيل الإشعار بوضوح هنا..."
                  maxLength={500}
                  required
                />
              </div>

              {/* جدولة الإرسال (اختياري) */}
              <div className="p-3 bg-surface-sunken/40 rounded-xl border border-line space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-ink">
                  <Clock className="w-4 h-4 text-brand" />
                  <span>جدولة الإرسال لوقت لاحق (اختياري)</span>
                </div>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="input-field text-xs"
                />
                <p className="text-[11px] text-muted leading-tight">
                  اتركه فارغاً ليتم البث فوراً عبر FCM لجميع الأجهزة المستهدفة. هذا النشر يفحص الإشعارات المجدولة مرة واحدة يومياً قرابة 06:00 UTC.
                </p>
              </div>

              {/* Android System Push Notification Live Mockup (المعاينة الحية لنظام أندرويد) */}
              <div className="space-y-1.5 pt-1">
                <label className="text-xs font-bold text-ink-soft flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5 text-brand" />
                  معاينة الإشعار كما سيظهر على شاشة هاتف المستخدم:
                </label>
                <div className="p-3.5 rounded-2xl bg-slate-900 text-white shadow-md border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-slate-400 text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="w-4 h-4 rounded-full bg-brand flex items-center justify-center text-[9px] font-bold text-white">
                        K
                      </div>
                      <span className="font-semibold text-slate-300">كروتك برو</span>
                      <span>•</span>
                      <span className="text-[11px]">الآن</span>
                    </div>
                    <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded-full text-slate-300">
                      {type === 'global' ? 'عام' : (selectedUserName || 'خاص')}
                    </span>
                  </div>
                  <div className="space-y-0.5 pr-1">
                    <p className="text-sm font-bold text-slate-100">
                      {title.trim() || 'عنوان الإشعار سيظهر هنا'}
                    </p>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {message.trim() || 'نص رسالة الإشعار الفوري سيظهر هنا للمستخدم فور إرساله عبر الخادم.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Actions Footer */}
              <div className="pt-2 flex flex-col gap-2">
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  block
                  loading={sending}
                  disabled={!canSend}
                  icon={sending ? undefined : Send}
                  className="h-13 text-base font-extrabold shadow-md shadow-brand/25 active:scale-98"
                >
                  {sending
                    ? (scheduledAt ? 'جارٍ الجدولة...' : 'جارٍ إرسال الإشعار...')
                    : (scheduledAt ? 'جدولة الإشعار الفوري' : 'إرسال الإشعار الآن')}
                </Button>

                {title.trim() && message.trim() && (
                  <button
                    type="button"
                    onClick={handleSaveTemplate}
                    className="text-xs text-brand-deep hover:underline text-center py-1 font-semibold"
                  >
                    + حفظ النص الحالي كقالب للاستخدام المستقبلي
                  </button>
                )}
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* ===================== TAB 2: HISTORY ===================== */}
      {activeTab === 'history' && (
        <div className="space-y-3">
          {/* شريط البحث في السجل */}
          <div className="relative">
            <Search className="w-4 h-4 absolute right-3.5 top-3.5 text-muted pointer-events-none" />
            <input
              type="text"
              placeholder="ابحث في سجل الإشعارات..."
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              className="input-field pr-10 text-xs py-2.5 rounded-xl bg-surface"
            />
            {historySearch && (
              <button
                type="button"
                onClick={() => setHistorySearch('')}
                className="absolute left-3.5 top-3 text-muted hover:text-ink"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {filteredHistory.length === 0 ? (
            <Card className="p-8 text-center rounded-2xl">
              <span className="empty-state__icon icon-tile icon-tile--neutral icon-tile--lg mx-auto mb-3">
                <Inbox className="w-6 h-6" />
              </span>
              <p className="font-bold text-ink">لا توجد إشعارات سابقة</p>
              <p className="text-xs text-muted mt-1">
                {historySearch ? 'لا توجد نتائج تطابق بحثك.' : 'لم يتم إرسال أي إشعارات عامة بعد.'}
              </p>
            </Card>
          ) : (
            <div className="space-y-2.5">
              {filteredHistory.map((notif) => (
                <div
                  key={notif.id}
                  className="p-3.5 sm:p-4 rounded-2xl bg-surface border border-line shadow-xs space-y-2 hover:border-brand/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-brand-soft text-brand-deep flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Bell className="w-4.5 h-4.5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-extrabold text-ink leading-snug">{notif.title}</h4>
                        <p className="text-xs text-ink-soft mt-1 leading-relaxed">{notif.message}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(notif)}
                      className="p-1.5 text-muted hover:text-danger hover:bg-danger-soft/30 rounded-lg transition-colors flex-shrink-0"
                      title="حذف الإشعار"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-muted pt-2 border-t border-line/50">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-600">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {notif.status === 'sent' ? 'مرسل' : notif.status}
                      </span>
                      <span>•</span>
                      <span>{notif.sentCount ?? 1} جهاز</span>
                    </div>
                    <span dir="rtl">{formatDate(notif.displayTimestamp ?? notificationMillis(notif))}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===================== TAB 3: TEMPLATES ===================== */}
      {activeTab === 'templates' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-ink-soft">القوالب المحفوظة ({templates.length})</span>
            <Button
              variant="secondary"
              size="sm"
              icon={Plus}
              onClick={() => setActiveTab('compose')}
            >
              إنشاء قالب جديد
            </Button>
          </div>

          <div className="grid gap-2.5">
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                className="p-3.5 rounded-2xl bg-surface border border-line shadow-xs flex flex-col justify-between gap-3"
              >
                <div>
                  <h4 className="text-sm font-bold text-ink">{tpl.name}</h4>
                  <p className="text-xs text-ink-soft mt-1 line-clamp-2 leading-relaxed">{tpl.message}</p>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-line/60">
                  <button
                    type="button"
                    onClick={() => { handleApplyTemplate(tpl.id); setActiveTab('compose'); }}
                    className="text-xs font-bold text-brand hover:underline flex items-center gap-1"
                  >
                    <Send className="w-3 h-3" />
                    استخدام في النموذج
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteTemplate(tpl.id)}
                    className="text-xs text-danger hover:underline p-1"
                  >
                    حذف القالب
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteNotification}
        title="حذف الإشعار"
        message={`هل أنت متأكد من حذف الإشعار "${deleteTarget?.title || ''}" من السجل؟ لا يمكن التراجع عن هذا الإجراء.`}
        confirmText={deleting ? 'جارٍ الحذف...' : 'نعم، احذف'}
        variant="danger"
      />

      <PhoneNotificationModal
        isOpen={phoneModalOpen}
        onClose={() => setPhoneModalOpen(false)}
      />
    </div>
  );
}
