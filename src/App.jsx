import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import LoadingSpinner from './components/LoadingSpinner';
import { loadRoute, preloadRoutes } from './lib/routeLoaders';

const DashboardPage = lazy(() => loadRoute('/'));
const SettingsPage = lazy(() => loadRoute('/settings'));
const UsersPage = lazy(() => loadRoute('/users'));
const SalesPage = lazy(() => loadRoute('/sales'));
const NotificationsPage = lazy(() => loadRoute('/notifications'));
const AdminsPage = lazy(() => loadRoute('/admins'));

function AppRoutes() {
  const { currentUser, loading } = useAuth();

  useEffect(() => {
    if (loading || !currentUser) return undefined;
    const idleCallback = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 120));
    const cancelIdleCallback = window.cancelIdleCallback || window.clearTimeout;
    const handle = idleCallback(() => {
      preloadRoutes().catch((error) => console.debug('Route preloading skipped:', error));
    });
    return () => cancelIdleCallback(handle);
  }, [currentUser, loading]);

  if (loading) return null;

  return (
    <Suspense
      fallback={
        <div className="route-loading">
          <LoadingSpinner size="lg" text="جارٍ تجهيز الصفحة..." />
        </div>
      }
    >
      <Routes>
      <Route
        path="/login"
        element={currentUser ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout>
              <DashboardPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <Layout>
              <SettingsPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/users"
        element={
          <ProtectedRoute>
            <Layout>
              <UsersPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/sales"
        element={
          <ProtectedRoute>
            <Layout>
              <SalesPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/notifications"
        element={
          <ProtectedRoute>
            <Layout>
              <NotificationsPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admins"
        element={
          <ProtectedRoute>
            <Layout>
              <AdminsPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <Router>
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
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
}
