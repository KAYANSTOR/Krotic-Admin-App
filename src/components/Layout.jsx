import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import PullToRefresh from './PullToRefresh';
import ChangeAdminPasswordModal from './ChangeAdminPasswordModal';
import PhoneNotificationModal from './PhoneNotificationModal';
import {
  Download, Menu, LogOut, WifiOff, KeyRound, TrendingUp, X,
  Bell, BellOff, UserPlus,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useLocation, useNavigate } from 'react-router-dom';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import useOnlineStatus from '../lib/useOnlineStatus';
import { emitAppRefresh } from '../lib/useAppRefresh';
import { formatNumber } from '../lib/format';
import {
  getNotificationPreferences,
  subscribeNotificationPreferences,
  dispatchPhoneNotification,
  shouldAlertNewEvent,
} from '../lib/phoneNotifications';

/** عنوان الصفحة الحالية ليظهر في الشريط العلوي على الشاشات الصغيرة. */
const PAGE_TITLES = {
  '/': 'الرئيسية',
  '/settings': 'الإعدادات العامة',
  '/users': 'إدارة المستخدمين',
  '/sales': 'المبيعات والعمولات',
  '/notifications': 'الإشعارات',
  '/admins': 'إدارة المدراء',
  '/audit': 'سجل العمليات',
  '/template-center': 'المحافظ والقوالب',
  '/template-center/wallets': 'المحافظ ومصادر الرسائل',
  '/template-center/inbound': 'قوالب التحويل الواردة',
  '/template-center/outbound': 'الرسائل الصادرة',
  '/template-center/releases': 'الإصدارات والمؤشرات',
  '/template-center/reconciliation': 'التسوية والعناصر القديمة',
};

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [phoneNotifModalOpen, setPhoneNotifModalOpen] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState(() => getNotificationPreferences());
  const [incomingUserAlert, setIncomingUserAlert] = useState(null);
  const { adminData, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const online = useOnlineStatus();

  const pageTitle = PAGE_TITLES[location.pathname] || 'لوحة التحكم';

  // الاشتراك في تفضيلات إشعارات الهاتف لتحديث الأيقونة فوراً
  useEffect(() => {
    return subscribeNotificationPreferences((prefs) => {
      setNotifPrefs(prefs);
    });
  }, []);

  // مراقبة تسجيل أي مستخدم جديد في الوقت الفعلي وإرسال إشعار حي للهاتف
  useEffect(() => {
    const usersCol = collection(db, 'users');
    const unsubscribe = onSnapshot(
      usersCol,
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const data = change.doc.data() || {};
            const docId = change.doc.id;
            const createdMs = data.createdAt?.toMillis?.()
              || data.created_at?.toMillis?.()
              || (data.createdAt ? new Date(data.createdAt).getTime() : Date.now());

            // التأكد من أن هذا المشترك جديد فعلاً ولم يُنبه عنه سابقاً
            if (!shouldAlertNewEvent('user', docId, createdMs)) {
              return;
            }

            const netName = data.networkName || data.name || data.phone || data.phoneNumber || 'مشترك جديد';
            const phone = data.phone || data.phoneNumber || '';
            const userAlertObj = { id: docId, name: netName, phone };

            // إرسال إشعار حي لشريط إشعارات الهاتف
            dispatchPhoneNotification({
              title: '🎉 مستخدم جديد سجّل حسابه!',
              body: phone
                ? `تم تسجيل شبكة جديدة: ${netName} (${phone})`
                : `تم تسجيل شبكة جديدة: ${netName}`,
              url: `/users/${docId}`,
              type: 'user',
              tag: `user-${docId}`,
            });

            // شريط عائم في أعلى الشاشة داخل التطبيق
            setIncomingUserAlert(userAlertObj);

            setTimeout(() => {
              setIncomingUserAlert((curr) => (curr?.id === docId ? null : curr));
            }, 7000);
          }
        });
      },
      (error) => {
        console.warn('Realtime users subscription error:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  // أعلِن عند عودة الاتصال، وأعد النبض لكل صفحة عبر حدث التحديث العام.
  useEffect(() => {
    const handleOnline = () => emitAppRefresh();
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      toast.success('يمكنك فتح التطبيق من جهازك مباشرة');
    } catch (error) {
      console.error('[v0] Install prompt failed:', error);
      toast.error('تعذر تثبيت التطبيق الآن');
    } finally {
      setInstallPrompt(null);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      toast.success('تم تسجيل الخروج بنجاح');
      navigate('/login');
    } catch (error) {
      toast.error('حدث خطأ أثناء تسجيل الخروج');
    }
  };

  const initial = (adminData?.name || 'م').trim().charAt(0);

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">تخطي إلى المحتوى</a>
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* شريط عائم عند تسجيل مستخدم جديد */}
      {incomingUserAlert && (
        <aside
          role="status"
          aria-label="تنبيه تسجيل مستخدم جديد"
          className="fixed top-3 inset-x-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-96 z-50 sale-pill-enter bg-slate-900/95 dark:bg-slate-950/95 text-white p-3 rounded-2xl border border-sky-500/50 shadow-2xl backdrop-blur-md cursor-pointer transition-all select-none"
          onClick={() => {
            navigate(`/users/${incomingUserAlert.id}`);
            setIncomingUserAlert(null);
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-8 h-8 rounded-full bg-sky-500/20 text-sky-400 flex items-center justify-center shrink-0">
                <UserPlus className="w-4 h-4 animate-bounce" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-black text-sky-400">مستخدم جديد سجّل حسابه!</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" />
                </div>
                <p className="text-xs text-slate-100 font-bold truncate mt-0.5">
                  {incomingUserAlert.name} {incomingUserAlert.phone ? `• ${incomingUserAlert.phone}` : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[10px] font-bold text-sky-300 bg-sky-500/20 px-2 py-0.5 rounded-md hover:bg-sky-500/30">
                عرض
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIncomingUserAlert(null);
                }}
                className="p-1 text-slate-400 hover:text-white rounded-md transition-colors"
                aria-label="إغلاق التنبيه"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </aside>
      )}

      <div className="app-body lg:ms-72">
        <header className="app-header">
          <div className="app-header__inner">
            <div className="app-header__lead">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="app-header__menu lg:hidden"
                aria-label="فتح القائمة"
              >
                <Menu className="w-5 h-5" />
              </button>
              <p className="app-header__title">{pageTitle}</p>
            </div>

            <div className="app-header__actions">
              {/* زر إعدادات وتشغيل/إلغاء إشعارات الهاتف الحية */}
              <button
                type="button"
                onClick={() => setPhoneNotifModalOpen(true)}
                className={`p-2 rounded-xl transition-all relative ${
                  notifPrefs.enabled
                    ? 'text-brand bg-brand/10 hover:bg-brand/20'
                    : 'text-ink-secondary hover:text-ink hover:bg-surface-sunken opacity-70'
                }`}
                title={notifPrefs.enabled ? 'إشعارات الهاتف الحية: قيد التشغيل (اضغط للإلغاء أو التخصيص)' : 'إشعارات الهاتف الحية: متوقفة (اضغط للتشغيل)'}
                aria-label="إعدادات وتشغيل إشعارات الهاتف الحية"
              >
                {notifPrefs.enabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                {notifPrefs.enabled && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-surface animate-pulse" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setPasswordModalOpen(true)}
                className="admin-chip hover:opacity-90 transition-opacity"
                title="تعديل كلمة مرور المدير"
                aria-label="تعديل كلمة مرور المدير"
              >
                <span className="admin-chip__avatar">{initial}</span>
                <div className="hidden sm:block text-right">
                  <p className="admin-chip__name flex items-center gap-1">
                    <span>{adminData?.name || 'المدير'}</span>
                    <KeyRound className="w-3 h-3 text-brand" />
                  </p>
                  <p className="admin-chip__email">{adminData?.email}</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setPasswordModalOpen(true)}
                className="p-2 rounded-xl text-ink-secondary hover:text-brand hover:bg-surface-sunken transition-colors"
                title="تعديل كلمة مرور المدير"
                aria-label="تعديل كلمة مرور المدير"
              >
                <KeyRound className="w-4 h-4" />
              </button>

              {installPrompt && (
                <button type="button" onClick={handleInstall} className="app-header__install">
                  <Download className="w-4 h-4" />
                  <span className="hidden sm:inline">تثبيت</span>
                </button>
              )}

              <button type="button" onClick={handleLogout} className="app-header__logout" title="خروج">
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">خروج</span>
              </button>
            </div>
          </div>
        </header>

        {!online && (
          <div className="offline-banner" role="status" aria-live="assertive">
            <WifiOff className="w-4 h-4" aria-hidden="true" />
            <span>لا يوجد اتصال بالإنترنت — تُعرض آخر بيانات متاحة. سيُحدَّث تلقائياً عند عودة الاتصال.</span>
          </div>
        )}

        <main className="app-main" id="main-content" tabIndex={-1}>
          <PullToRefresh onRefresh={async () => { emitAppRefresh(); await new Promise((r) => setTimeout(r, 700)); }}>
            {children}
          </PullToRefresh>
        </main>
        <BottomNav />
      </div>

      <ChangeAdminPasswordModal
        isOpen={passwordModalOpen}
        onClose={() => setPasswordModalOpen(false)}
      />

      <PhoneNotificationModal
        isOpen={phoneNotifModalOpen}
        onClose={() => setPhoneNotifModalOpen(false)}
      />
    </div>
  );
}
