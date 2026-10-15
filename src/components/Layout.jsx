import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import PullToRefresh from './PullToRefresh';
import { Download, Menu, LogOut, WifiOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { useLocation, useNavigate } from 'react-router-dom';
import useOnlineStatus from '../lib/useOnlineStatus';
import { emitAppRefresh } from '../lib/useAppRefresh';

/** عنوان الصفحة الحالية ليظهر في الشريط العلوي على الشاشات الصغيرة. */
const PAGE_TITLES = {
  '/': 'الرئيسية',
  '/settings': 'الإعدادات العامة',
  '/users': 'إدارة المستخدمين',
  '/sales': 'المبيعات والعمولات',
  '/notifications': 'الإشعارات',
  '/admins': 'إدارة المدراء',
  '/audit': 'سجل العمليات',
};

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const { adminData, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const online = useOnlineStatus();

  const pageTitle = PAGE_TITLES[location.pathname] || 'لوحة التحكم';

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
              <div className="admin-chip">
                <span className="admin-chip__avatar">{initial}</span>
                <div className="hidden sm:block">
                  <p className="admin-chip__name">{adminData?.name || 'المدير'}</p>
                  <p className="admin-chip__email">{adminData?.email}</p>
                </div>
              </div>

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
    </div>
  );
}
