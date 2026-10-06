import { useState, useEffect } from 'react';
import {
  collection, collectionGroup, getDocs, doc, getDoc, query, orderBy, limit,
  serverTimestamp, deleteDoc, setDoc, updateDoc, writeBatch, where
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { mapWithConcurrency } from '../lib/mapWithConcurrency';
import {
  Bell, Send, Users, User, Globe, History, RefreshCw, Trash2
} from 'lucide-react';
import toast from 'react-hot-toast';
import LoadingSpinner from '../components/LoadingSpinner';
import ConfirmDialog from '../components/ConfirmDialog';

export default function NotificationsPage() {
  const [type, setType] = useState('global');
  const [selectedUser, setSelectedUser] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [users, setUsers] = useState([]);
  const [recentNotifications, setRecentNotifications] = useState([]);
  const [historyUserUid, setHistoryUserUid] = useState('');
  const [userNotifications, setUserNotifications] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [loadingUserHistory, setLoadingUserHistory] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [usersSnap, historyResult, legacyResult] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(query(
          collection(db, 'admin_notification_history'),
          orderBy('timestamp', 'desc'),
          limit(20),
        )).then((snapshot) => ({ snapshot })).catch((error) => ({ error })),
        getDocs(query(
          collection(db, 'app_settings', 'global_config', 'notifications'),
          orderBy('timestamp', 'desc'),
          limit(20),
        )).then((snapshot) => ({ snapshot })).catch((error) => ({ error })),
      ]);
      const usersData = await mapWithConcurrency(usersSnap.docs, 8, async (userDoc) => {
        const userData = userDoc.data();
        let name = userData.network_name || userDoc.id;
        if (!userData.network_name) {
          try {
            const metaDoc = await getDoc(doc(db, 'networks', userDoc.id, '_metadata', 'info'));
            if (metaDoc.exists()) name = metaDoc.data().name || userDoc.id;
          } catch (error) {
            console.warn('Could not fetch metadata for', userDoc.id);
          }
        }
        return { uid: userDoc.id, name };
      });
      setUsers(usersData);

      const history = historyResult.snapshot?.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        source: 'history',
      })) || [];
      const legacy = legacyResult.snapshot?.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        audienceType: 'global',
        source: 'legacy',
      })) || [];
      const toMillis = (value) => value?.toMillis?.() ?? Number(value || 0);
      setRecentNotifications([...history, ...legacy]
        .sort((a, b) => toMillis(b.timestamp) - toMillis(a.timestamp))
        .slice(0, 20));
      if (!historyResult.snapshot) console.warn('Could not fetch admin notification history:', historyResult.error);
      if (!legacyResult.snapshot) console.warn('Could not fetch legacy notifications history:', legacyResult.error);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('خطأ في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  };

  const fetchUserInbox = async (uid) => {
    setHistoryUserUid(uid);
    if (!uid) {
      setUserNotifications([]);
      return;
    }
    setLoadingUserHistory(true);
    try {
      const inboxSnap = await getDocs(query(
        collection(db, 'users', uid, 'notifications'),
        orderBy('timestamp', 'desc'),
        limit(20),
      ));
      setUserNotifications(inboxSnap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        source: 'userInbox',
        targetUid: uid,
      })));
    } catch (error) {
      console.error('Error fetching user notification history:', error);
      toast.error('تعذر تحميل إشعارات الحساب');
    } finally {
      setLoadingUserHistory(false);
    }
  };

  const handleDeleteNotification = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget.source === 'legacy') {
        await deleteDoc(doc(db, 'app_settings', 'global_config', 'notifications', deleteTarget.id));
      } else if (deleteTarget.source === 'userInbox') {
        await deleteDoc(doc(db, 'users', deleteTarget.targetUid, 'notifications', deleteTarget.id));
      } else {
        if (deleteTarget.audienceType === 'global' && deleteTarget.broadcastId) {
          const copies = await getDocs(query(
            collectionGroup(db, 'notifications'),
            where('broadcastId', '==', deleteTarget.broadcastId),
          ));
          for (let start = 0; start < copies.docs.length; start += 400) {
            const batch = writeBatch(db);
            copies.docs.slice(start, start + 400).forEach((copy) => batch.delete(copy.ref));
            await batch.commit();
          }
        } else if (deleteTarget.targetUid && deleteTarget.inboxNotificationId) {
          await deleteDoc(doc(
            db,
            'users',
            deleteTarget.targetUid,
            'notifications',
            deleteTarget.inboxNotificationId,
          ));
        }
        await deleteDoc(doc(db, 'admin_notification_history', deleteTarget.id));
      }

      if (deleteTarget.source === 'userInbox') {
        await fetchUserInbox(deleteTarget.targetUid);
        toast.success('تم حذف الإشعار من صندوق الحساب');
      } else {
        await fetchData();
        toast.success('تم حذف الإشعار من سجل الإدارة وصناديق التطبيق');
      }
    } catch (error) {
      console.error('Error deleting notification:', error);
      toast.error('تعذر حذف الإشعار');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
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

      // Keep admin history private, and materialize inbox items only for current accounts.
      let createdHistoryRef = null;
      try {
        const historyRef = doc(collection(db, 'admin_notification_history'));
        createdHistoryRef = historyRef;
        const sentAt = Date.now();
        const notificationData = {
          title: title.trim(),
          body: message.trim(),
          message: message.trim(),
          audienceType: type,
          ...(type === 'user'
            ? { targetUid: selectedUser, inboxNotificationId: historyRef.id }
            : { broadcastId: historyRef.id, inboxRecipientCount: users.length }),
          data: { route: '/account-notifications' },
          createdBy: auth.currentUser?.uid || null,
          status: 'sent',
          sentCount: data.sent ?? 1,
          timestamp: sentAt,
          createdAt: serverTimestamp(),
        };

        await setDoc(historyRef, notificationData);
        if (type === 'global') {
          for (let start = 0; start < users.length; start += 400) {
            const batch = writeBatch(db);
            users.slice(start, start + 400).forEach((user) => {
              batch.set(doc(db, 'users', user.uid, 'notifications', historyRef.id), {
                title: notificationData.title,
                message: notificationData.message,
                body: notificationData.body,
                is_read: false,
                timestamp: sentAt,
                createdAt: serverTimestamp(),
                broadcastId: historyRef.id,
              });
            });
            await batch.commit();
          }
        } else {
          await setDoc(doc(db, 'users', selectedUser, 'notifications', historyRef.id), {
            title: notificationData.title,
            message: notificationData.message,
            body: notificationData.body,
            is_read: false,
            timestamp: sentAt,
            createdAt: serverTimestamp(),
          });
        }
      } catch (logError) {
        console.error('Notification inbox/history write failed after FCM send:', logError);
        if (createdHistoryRef) {
          await updateDoc(createdHistoryRef, { status: 'partial' }).catch(() => undefined);
        }
        toast.error('أُرسل التنبيه عبر FCM، لكن تعذر حفظه كاملًا في سجل/صندوق الإشعارات');
        setTitle('');
        setMessage('');
        await fetchData();
        setSending(false);
        return;
      }

      if (type === 'global') {
        toast.success('تم إرسال الإشعار لجميع الأجهزة بنجاح!');
      } else {
        const userName = users.find((u) => u.uid === selectedUser)?.name || selectedUser;
        toast.success(`تم إرسال الإشعار إلى ${userName} بنجاح`);
      }

      // إعادة ضبط النموذج وتحديث القائمة
      setTitle('');
      setMessage('');
      await fetchData();
    } catch (error) {
      console.error('Error sending notification:', error);
      toast.error('تعذر الاتصال بالخادم');
    }
    setSending(false);
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '—';
    const value = timestamp?.toDate?.() || new Date(timestamp?.toMillis?.() ?? timestamp);
    return value.toLocaleDateString('ar-IQ', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) return <LoadingSpinner size="lg" />;

  const historyItems = historyUserUid ? userNotifications : recentNotifications;
  const historyTitle = historyUserUid ? 'صندوق إشعارات الحساب' : 'سجل الإشعارات المرسلة';

  return (
    <div>
      <div className="mb-8">
        <h1 className="page-title flex items-center gap-3">
          <Bell className="w-7 h-7 text-primary-600" />
          الإشعارات
        </h1>
        <p className="text-gray-500 mt-1">إرسال إشعارات للمستخدمين</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Send Notification Form */}
        <div className="card">
          <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
            <Send className="w-5 h-5" />
            إرسال إشعار جديد
          </h3>

          <form onSubmit={handleSend} className="space-y-4">
            {/* Type Selection */}
            <div>
              <label className="label-field">نوع الإشعار</label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setType('global')}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 transition-all ${
                    type === 'global'
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-200 hover:border-gray-300 text-gray-600'
                  }`}
                >
                  <Globe className="w-5 h-5" />
                  للجميع
                </button>
                <button
                  type="button"
                  onClick={() => setType('user')}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 transition-all ${
                    type === 'user'
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-200 hover:border-gray-300 text-gray-600'
                  }`}
                >
                  <User className="w-5 h-5" />
                  لمستخدم محدد
                </button>
              </div>
            </div>

            {/* User Selection */}
            {type === 'user' && (
              <div>
                <label className="label-field">اختر المستخدم</label>
                <select
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
              </div>
            )}

            {/* Title */}
            <div>
              <label className="label-field">عنوان الإشعار</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input-field"
                placeholder="أدخل عنوان الإشعار..."
                required
              />
            </div>

            {/* Message */}
            <div>
              <label className="label-field">نص الإشعار</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="input-field resize-none"
                rows={4}
                placeholder="أدخل نص الإشعار..."
                required
              />
            </div>

            <button
              type="submit"
              disabled={sending}
              className="w-full btn-primary flex items-center justify-center gap-2 py-3"
            >
              {sending ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  إرسال الإشعار
                </>
              )}
            </button>

            <p className="text-xs text-gray-400 text-center">
              يُرسَل عبر FCM. الإشعار العام يُحفظ لصندوق الحسابات الموجودة وقت الإرسال فقط؛ الحسابات الجديدة لا ترث الرسائل السابقة.
            </p>
          </form>
        </div>

        {/* Recent Notifications */}
        <div className="card">
          <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
            <History className="w-5 h-5" />
            {historyTitle}
          </h3>

          <div className="mb-4">
            <label className="label-field">السجل المعروض</label>
            <select
              value={historyUserUid}
              onChange={(e) => fetchUserInbox(e.target.value)}
              className="input-field"
            >
              <option value="">سجل الإرسال (عام وخاص)</option>
              {users.map((u) => (
                <option key={u.uid} value={u.uid}>صندوق: {u.name}</option>
              ))}
            </select>
          </div>

          {loadingUserHistory ? (
            <LoadingSpinner />
          ) : historyItems.length === 0 ? (
            <p className="text-gray-500 text-center py-8">لا توجد إشعارات في هذا السجل</p>
          ) : (
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {historyItems.map((notif) => (
                <div
                  key={`${notif.source}-${notif.id}`}
                  className="p-4 bg-gray-50 rounded-xl border border-gray-100"
                >
                  <div className="flex items-start justify-between mb-1">
                    <p className="font-semibold text-gray-900 text-sm">{notif.title}</p>
                    <div className="flex items-center gap-2">
                      <span className="badge-info text-xs">
                        {notif.source === 'legacy' ? 'عام سابق' : notif.audienceType === 'user' ? 'خاص' : 'عام'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(notif)}
                        className="row-action row-action--danger"
                        title="حذف الإشعار"
                        aria-label="حذف الإشعار"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 mb-2">{notif.message || notif.body}</p>
                  {notif.audienceType === 'user' && notif.targetUid && (
                    <p className="text-xs text-gray-500 mb-2">
                      إلى: {users.find((user) => user.uid === notif.targetUid)?.name || notif.targetUid}
                    </p>
                  )}
                  <p className="text-xs text-gray-400">{formatDate(notif.timestamp)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteNotification}
        title="حذف الإشعار"
        message={deleteTarget?.source === 'history' && deleteTarget?.audienceType === 'global'
          ? 'سيُحذف الإشعار من سجل الإدارة ومن صناديق الحسابات التي استلمته. لا يمكن التراجع عن الحذف.'
          : deleteTarget?.source === 'legacy'
            ? 'سيُحذف الإشعار العام القديم من مصدر التطبيق، ولن يظهر بعد ذلك عند تحديث صندوق الإشعارات. لا يمكن التراجع عن الحذف.'
            : deleteTarget?.source === 'userInbox'
              ? 'سيُحذف الإشعار من صندوق هذا الحساب فقط. سيبقى سجل الإرسال الإداري محفوظًا.'
              : 'سيُحذف الإشعار من السجل وصندوق الحساب المقصود. لا يمكن التراجع عن الحذف.'}
        confirmText={deleting ? 'جارٍ الحذف...' : 'حذف الإشعار'}
        variant="danger"
      />
    </div>
  );
}
