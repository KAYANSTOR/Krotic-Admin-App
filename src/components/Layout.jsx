import { useEffect, useState, useRef, Suspense } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLocalDb } from '../lib/localDb/LocalDbContext';
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
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import useOnlineStatus from '../lib/useOnlineStatus';
import { emitAppRefresh } from '../lib/useAppRefresh';
import { trackSnapshot } from '../lib/localDb/readMeter';
import { formatNumber } from '../lib/format';
import { PageSkeleton } from './ui/Skeleton';
import useBodyScrollLock from '../lib/useBodyScrollLock';
import {
  getNotificationPreferences,
  subscribeNotificationPreferences,
  dispatchPhoneNotification,
  shouldAlertNewEvent,
} from '../lib/phoneNotifications';
import { TEMPLATE_CENTER_TITLES } from '../lib/templateCenterRoutes';

/** عنوان الصفحة الحالية ليظهر في الشريط العلوي على الشاشات الصغيرة. */
const PAGE_TITLES = {
  '/': 'الرئيسية',
  '/settings': 'الإعدادات العامة',
  '/users': 'إدارة المستخدمين',
  '/sales': 'المبيعات والعمولات',
  '/notifications': 'الإشعارات',
  '/admins': 'إدارة المدراء',
  '/audit': 'سجل العمليات',
  ...TEMPLATE_CENTER_TITLES,
  '/paid-features': 'مزايا الحساب',
};

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [phoneNotifModalOpen, setPhoneNotifModalOpen] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState(() => getNotificationPreferences());
  const [incomingUserAlert, setIncomingUserAlert] = useState(null);
  const { adminData, logout } = useAuth();
  const { runSync } = useLocalDb();
  const navigate = useNavigate();
  const location = useLocation();
  const online = useOnlineStatus();

  const pageTitle = PAGE_TITLES[location.pathname] || 'لوحة التحكم';

  // درج التنقل على الهاتف: قفل تمرير الخلفية، إغلاق بـ Escape، وإغلاق تلقائي عند تغيير الصفحة.
  useBodyScrollLock(sidebarOpen);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [sidebarOpen]);

  // الاشتراك في تفضيلات إشعارات الهاتف لتحديث الأيقونة فوراً
  useEffect(() => {
    return subscribeNotificationPreferences((prefs) => {
      setNotifPrefs(prefs);
    });
  }, []);

  // تنبيه مستخدم جديد بأقل قراءات: استمع لأحدث وثيقة فقط بدل تنزيل users كاملة.
  useEffect(() => {
    let initialSnapshot = true;
    let timer = null;
    const newestUsers = query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(1));
    const unsubscribe = onSnapshot(newestUsers, (snapshot) => {
      trackSnapshot('layout:users-realtime', snapshot, { initial: initialSnapshot });
      if (initialSnapshot) {
        initialSnapshot = false;
        return;
      }
      snapshot.docChanges().forEach((change) => {
        if (change.type !== 'added') return;
        const data = change.doc.data() || {};
        const docId = change.doc.id;
        const createdMs = data.createdAt?.toMillis?.() || data.created_at?.toMillis?.()
          || (data.createdAt ? new Date(data.createdAt).getTime() : Date.now());
        if (!shouldAlertNewEvent('user', docId, createdMs)) return;
        const name = data.networkName || data.name || data.phone || data.phoneNumber || 'مشترك جديد';
        const phone = data.phone || data.phoneNumber || '';
        setIncomingUserAlert({ id: docId, name, phone });
        dispatchPhoneNotification({
          title: '🎉 مستخدم جديد سجّل حسابه!',
          body: phone ? `تم تسجيل شبكة جديدة: ${name} (${phone})` : `تم تسجيل شبكة جديدة: ${name}`,
          url: `/users/${docId}`,
          type: 'user',
          tag: `user-${docId}`,
        });
        if (timer) window.clearTimeout(timer);
        timer = window.setTimeout(() => setIncomingUserAlert((current) => (current?.id === docId ? null : current)), 7000);
      });
    }, (error) => console.warn('Latest-user realtime subscription failed:', error));
    return () => {
      if (timer) window.clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  // عودة الاتصال: مزامنة تزايدية + إعادة نبض للشاشات من القاعدة المحلية.
  useEffect(() => {
    const handleOnline = () => {
      runSync({ reason: 'online' }).catch(() => undefined);
      emitAppRefresh();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [runSync]);

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
      {incomingUserAlert && (
        <aside role="status" className="fixed top-3 inset-x-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-96 z-50 bg-slate-900 text-white p-3 rounded-2xl border border-sky-500/40 shadow-xl">
          <div className="flex items-center gap-3">
            <UserPlus className="w-5 h-5 text-sky-300 shrink-0" />
            <button type="button" className="text-right min-w-0 flex-1" onClick={() => { navigate(`/users/${incomingUserAlert.id}`); setIncomingUserAlert(null); }}>
              <span className="block text-xs font-black text-sky-300">مستخدم جديد سجّل حسابه</span>
              <span className="block text-xs truncate">{incomingUserAlert.name}{incomingUserAlert.phone ? ` • ${incomingUserAlert.phone}` : ''}</span>
            </button>
            <button type="button" className="p-1 text-slate-300" aria-label="إغلاق التنبيه" onClick={() => setIncomingUserAlert(null)}><X className="w-4 h-4" /></button>
          </div>
        </aside>
      )}

      <div className="app-body lg:ms-[264px]">
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
          <PullToRefresh
            onRefresh={async () => {
              // التحديث اليدوي يزامن التغييرات ويستورد تاريخ السجلات القديمة عند وجود نقص محلي.
              await runSync({ reason: 'manual' }).catch(() => undefined);
              emitAppRefresh();
              await new Promise((resolve) => setTimeout(resolve, 400));
            }}
          >
            <Suspense fallback={<PageSkeleton />}>
              {children}
            </Suspense>
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
