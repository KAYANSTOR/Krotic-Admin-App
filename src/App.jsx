import { lazy, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import LoadingSpinner from './components/LoadingSpinner';
import AppErrorBoundary from './components/AppErrorBoundary';
import { loadRoute, preloadAllRoutes } from './lib/routeLoaders';
import ReadMeterPanel from './components/ReadMeterPanel';
import { LocalDbProvider } from './lib/localDb/LocalDbContext';

const DashboardPage = lazy(() => loadRoute('/'));
const SettingsPage = lazy(() => loadRoute('/settings'));
const UsersPage = lazy(() => loadRoute('/users'));
const UserProfilePage = lazy(() => loadRoute('/users/:uid'));
const SalesPage = lazy(() => loadRoute('/sales'));
const NotificationsPage = lazy(() => loadRoute('/notifications'));
const AdminsPage = lazy(() => loadRoute('/admins'));
const AuditPage = lazy(() => loadRoute('/audit'));
const TemplateCenterPage = lazy(() => loadRoute('/template-center'));
const PaidFeaturesPage = lazy(() => loadRoute('/paid-features'));
const DevicesPage = lazy(() => loadRoute('/devices'));

/** هيكل واحد لكل الصفحات: الشريط الجانبي يبقى ثابتاً أثناء تغيير الصفحة. */
function AdminShell() {
  return (
    <ProtectedRoute>
      <Layout>
        <Outlet />
      </Layout>
    </ProtectedRoute>
  );
}

function AppRoutes() {
  const { currentUser, loading } = useAuth();

  // بعد تسجيل الدخول: تحميل بقية الصفحات في وقت الخمول (بلا سبينر كامل لاحقاً).
  useEffect(() => {
    if (!currentUser) return undefined;
    const idle = window.requestIdleCallback || ((cb) => window.setTimeout(cb, 1200));
    const cancel = window.cancelIdleCallback || window.clearTimeout;
    const handle = idle(() => { preloadAllRoutes().catch(() => undefined); });
    return () => cancel(handle);
  }, [currentUser]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" dir="rtl">
        <LoadingSpinner size="lg" text="جاري التحقق من الجلسة..." />
      </div>
    );
  }

  return (
    <AppErrorBoundary>
      <Routes>
        <Route
          path="/login"
          element={currentUser ? <Navigate to="/" replace /> : <LoginPage />}
        />
        <Route element={<AdminShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/sales" element={<SalesPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/admins" element={<AdminsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/template-center/*" element={<TemplateCenterPage />} />
          <Route path="/paid-features" element={<PaidFeaturesPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/users/:uid" element={<UserProfilePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppErrorBoundary>
  );
}

export default function App() {
  return (
    <Router future={{ v7_startTransition: true }}>
      <AuthProvider>
        <Toaster
          position="bottom-center"
          toastOptions={{
            duration: 3500,
            style: {
              fontFamily: 'Tajawal, sans-serif',
              direction: 'rtl',
              background: '#322B24',
              color: '#fff',
              borderRadius: '12px',
              padding: '14px 16px',
              fontSize: '14px',
              fontWeight: 500,
              maxWidth: 'calc(100vw - 32px)',
              boxShadow: '0 6px 10px 4px rgba(26,20,16,.12), 0 2px 3px rgba(26,20,16,.10)',
            },
          }}
        />
        <ReadMeterPanel />
        <LocalDbProvider>
          <AppRoutes />
        </LocalDbProvider>
      </AuthProvider>
    </Router>
  );
}
