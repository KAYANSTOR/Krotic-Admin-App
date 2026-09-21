import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import { Download, Menu, LogOut, User } from 'lucide-react';
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

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="lg:mr-72">
        <header className="app-header sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200/80 px-4 lg:px-8 py-3.5">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-xl hover:bg-slate-100 transition-colors"
            >
              <Menu className="w-6 h-6 text-slate-600" />
            </button>

            <div className="flex items-center gap-3 mr-auto lg:mr-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-gradient-to-br from-teal-100 to-teal-50 rounded-full flex items-center justify-center ring-1 ring-teal-200/50">
                  <User className="w-4.5 h-4.5 text-teal-700" />
                </div>
                <div className="hidden sm:block">
                  <p className="text-sm font-semibold text-slate-900 leading-tight">
                    {adminData?.name || 'المدير'}
                  </p>
                  <p className="text-xs text-slate-500">{adminData?.email}</p>
                </div>
              </div>

              {installPrompt && (
                <button
                  onClick={handleInstall}
                  className="flex items-center gap-2 rounded-xl bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-700 transition-colors hover:bg-teal-100"
                >
                  <Download className="h-4 w-4" />
                  <span className="hidden sm:inline">تثبيت</span>
                </button>
              )}

              <button
                onClick={handleLogout}
                className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-xl transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">خروج</span>
              </button>
            </div>
          </div>
        </header>

        <main className="app-main p-4 pb-28 lg:p-8 lg:pb-8">{children}</main>
        <BottomNav />
      </div>
    </div>
  );
}
