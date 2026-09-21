import { useState, useEffect } from 'react';
import {
  collection, getDocs, addDoc, doc, getDoc, query, orderBy, limit
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  Bell, Send, Users, User, Globe, History, RefreshCw
} from 'lucide-react';
import toast from 'react-hot-toast';
import LoadingSpinner from '../components/LoadingSpinner';

export default function NotificationsPage() {
  const [type, setType] = useState('global');
  const [selectedUser, setSelectedUser] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [users, setUsers] = useState([]);
  const [recentNotifications, setRecentNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      // Fetch users for dropdown
      const usersSnap = await getDocs(collection(db, 'users'));
      const usersData = [];
      for (const userDoc of usersSnap.docs) {
        let name = userDoc.id;
        try {
          const metaDoc = await getDoc(
            doc(db, 'networks', userDoc.id, '_metadata', 'info')
          );
          if (metaDoc.exists()) {
            name = metaDoc.data().name || userDoc.id;
          }
        } catch (e) {}
        usersData.push({ uid: userDoc.id, name });
      }
      setUsers(usersData);

      // Fetch recent global notifications
      try {
        const notifSnap = await getDocs(
          collection(db, 'app_settings', 'global_config', 'notifications')
        );
        const notifs = [];
        notifSnap.forEach((d) => notifs.push({ id: d.id, ...d.data(), type: 'global' }));
        notifs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        setRecentNotifications(notifs.slice(0, 20));
      } catch (e) {
        console.warn('Could not fetch notifications history');
      }
    } catch (error) {
      console.error('Error fetching data:', error);
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

    setSending(true);
    try {
      const notificationData = {
        title: title.trim(),
        message: message.trim(),
        timestamp: Date.now(),
      };

      if (type === 'global') {
        await addDoc(
          collection(db, 'app_settings', 'global_config', 'notifications'),
          notificationData
        );
        toast.success('تم إرسال الإشعار العام بنجاح');
      } else {
        await addDoc(
          collection(db, 'users', selectedUser, 'notifications'),
          {
            ...notificationData,
            is_read: false,
          }
        );
        const userName = users.find((u) => u.uid === selectedUser)?.name || selectedUser;
        toast.success(`تم إرسال الإشعار إلى: ${userName}`);
      }

      // Reset form
      setTitle('');
      setMessage('');

      // Refresh notifications list
      fetchData();
    } catch (error) {
      console.error('Error sending notification:', error);
      toast.error('حدث خطأ أثناء إرسال الإشعار');
    }
    setSending(false);
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

  if (loading) return <LoadingSpinner size="lg" />;

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
          </form>
        </div>

        {/* Recent Notifications */}
        <div className="card">
          <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
            <History className="w-5 h-5" />
            آخر الإشعارات العامة المرسلة
          </h3>

          {recentNotifications.length === 0 ? (
            <p className="text-gray-500 text-center py-8">لا يوجد إشعارات سابقة</p>
          ) : (
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {recentNotifications.map((notif) => (
                <div
                  key={notif.id}
                  className="p-4 bg-gray-50 rounded-xl border border-gray-100"
                >
                  <div className="flex items-start justify-between mb-1">
                    <p className="font-semibold text-gray-900 text-sm">{notif.title}</p>
                    <span className="badge-info text-xs">عام</span>
                  </div>
                  <p className="text-sm text-gray-600 mb-2">{notif.message}</p>
                  <p className="text-xs text-gray-400">{formatDate(notif.timestamp)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
