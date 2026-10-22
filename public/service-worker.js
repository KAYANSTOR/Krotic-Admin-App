const SHELL_CACHE = 'krotak-pro-shell-v5';
const RUNTIME_CACHE = 'krotak-pro-runtime-v5';
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icons/krotak-pro-192.png',
  '/icons/krotak-pro-512.png',
  '/icons/krotak-pro-48.png',
  '/favicon.ico',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((cacheName) => cacheName !== SHELL_CACHE && cacheName !== RUNTIME_CACHE)
        .map((cacheName) => caches.delete(cacheName))
    ))
  );
  self.clients.claim();
});

function isCacheableAsset(url) {
  return url.pathname.startsWith('/assets/')
    || url.pathname.startsWith('/icons/')
    || /\.(?:js|css|png|jpg|jpeg|svg|webp|woff2?)$/.test(url.pathname);
}

// يسمح للصفحة بطلب تفعيل النسخة الجديدة فوراً.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // لا نُخزّن طلبات الـ API ولا نتدخّل في اتصالات Firebase (بيانات حيّة دائماً).
  if (url.pathname.startsWith('/api/') || url.origin !== self.location.origin) return;

  // التنقّل: كاش التطبيق أولاً مع التحديث في الخلفية لسرعة فائقة وانتقالات فورية
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('/').then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              const copy = response.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy)).catch(() => {});
            }
            return response;
          })
          .catch(() => cached);

        return cached || networkFetch;
      })
    );
    return;
  }

  // الأصول الثابتة: نخدمها فوراً من الكاش ونحدّثها في الخلفية.
  if (isCacheableAsset(url)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response && response.status === 200) cache.put(request, response.clone());
            return response;
          })
          .catch(() => null);
        return cached || (await network) || Response.error();
      })
    );
  }
});

// التعامل مع وصول إشعارات الدفع في الخلفية حتى عندما تكون لوحة الإدارة مقفلة
self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { title: 'كروتك برو', body: event.data.text() };
    }
  }

  const title = payload.title || '🔔 تنبيه جديد - كروتك برو';
  const iconUrl = new URL('/icons/krotak-pro-192.png', self.location.origin).href;
  const badgeUrl = new URL('/icons/krotak-pro-48.png', self.location.origin).href;

  const options = {
    body: payload.body || 'عملية جديدة في لوحة الإدارة',
    icon: iconUrl,
    badge: badgeUrl,
    data: { url: payload.url || '/' },
    vibrate: [120, 60, 120],
    dir: 'rtl',
    lang: 'ar',
    tag: payload.tag || `krotak-push-${Date.now()}`,
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// التعامل مع النقر على إشعارات الهاتف / النظام لفتح التطبيق والانتقال للشاشة المناسبة
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url && 'focus' in client) {
          if ('navigate' in client && targetUrl) {
            client.navigate(targetUrl);
          }
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

