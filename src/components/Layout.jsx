import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import { Download, Menu, LogOut } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const { adminData, logout } = useAuth();
  const navigate = useNavigate();

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
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
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
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="app-body lg:ms-72">
        <header className="app-header">
          <div className="app-header__inner">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="app-header__menu lg:hidden"
              aria-label="فتح القائمة"
            >
              <Menu className="w-5 h-5" />
            </button>

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

        <main className="app-main">{children}</main>
        <BottomNav />
      </div>
    </div>
  );
}
