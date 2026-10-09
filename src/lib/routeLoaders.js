const routeLoaders = {
  '/': () => import('../pages/DashboardPage'),
  '/settings': () => import('../pages/SettingsPage'),
  '/users': () => import('../pages/UsersPage'),
  '/sales': () => import('../pages/SalesPage'),
  '/notifications': () => import('../pages/NotificationsPage'),
  '/admins': () => import('../pages/AdminsPage'),
  '/audit': () => import('../pages/AuditPage'),
};

const loadedRoutes = new Map();

export function loadRoute(path) {
  if (!routeLoaders[path]) return Promise.resolve();
  if (!loadedRoutes.has(path)) {
    loadedRoutes.set(path, routeLoaders[path]());
  }
  return loadedRoutes.get(path);
}

export function preloadRoutes() {
  return Promise.all(
    Object.keys(routeLoaders).map((path) => loadRoute(path))
  );
}

export default routeLoaders;
