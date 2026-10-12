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

function getConnection() {
  if (typeof navigator === 'undefined') return undefined;
  return navigator.connection || navigator.mozConnection || navigator.webkitConnection;
}

/** لا نضيف طلبات اختيارية على الشبكات التي يُرجح أن تكون محدودة أو بطيئة. */
export function canPreloadRoute() {
  const connection = getConnection();
  if (!connection) return true;
  if (connection.saveData) return false;
  return connection.effectiveType !== 'slow-2g' && connection.effectiveType !== '2g';
}

export function loadRoute(path) {
  if (!routeLoaders[path]) return Promise.resolve();
  if (!loadedRoutes.has(path)) {
    loadedRoutes.set(path, routeLoaders[path]());
  }
  return loadedRoutes.get(path);
}

/** يُستدعى فقط من نوايا تنقل واضحة مثل hover أو focus أو pointer-down. */
export function preloadRoute(path) {
  if (!canPreloadRoute()) return Promise.resolve();
  return loadRoute(path);
}

export default routeLoaders;
