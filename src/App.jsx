import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import LoadingSpinner from './components/LoadingSpinner';
import AppErrorBoundary from './components/AppErrorBoundary';
import { loadRoute } from './lib/routeLoaders';

const DashboardPage = lazy(() => loadRoute('/'));
const SettingsPage = lazy(() => loadRoute('/settings'));
const UsersPage = lazy(() => loadRoute('/users'));
const UserProfilePage = lazy(() => loadRoute('/users/:uid'));
const SalesPage = lazy(() => loadRoute('/sales'));
const NotificationsPage = lazy(() => loadRoute('/notifications'));
const AdminsPage = lazy(() => loadRoute('/admins'));
const AuditPage = lazy(() => loadRoute('/audit'));
const TemplateCenterPage = lazy(() => loadRoute('/template-center'));

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
    <Suspense
      fallback={
        <div className="route-loading">
          <LoadingSpinner size="lg" text="جارٍ تجهيز الصفحة..." />
        </div>
      }
    >
      <AppErrorBoundary>
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
      <Route
        path="/audit"
        element={
          <ProtectedRoute>
            <Layout>
              <AuditPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/template-center"
        element={
          <ProtectedRoute>
            <Layout>
              <TemplateCenterPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/users/:uid"
        element={
          <ProtectedRoute>
            <Layout>
              <UserProfilePage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppErrorBoundary>
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
