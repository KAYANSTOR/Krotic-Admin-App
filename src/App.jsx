import { lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import LoadingSpinner from './components/LoadingSpinner';
import AppErrorBoundary from './components/AppErrorBoundary';
import { loadRoute } from './lib/routeLoaders';
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
          position="top-center"
          toastOptions={{
            duration: 3000,
            style: {
              fontFamily: 'Tajawal, sans-serif',
              direction: 'rtl',
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
