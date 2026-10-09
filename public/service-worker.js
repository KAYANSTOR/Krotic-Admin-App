const SHELL_CACHE = 'krotak-pro-shell-v3';
const RUNTIME_CACHE = 'krotak-pro-runtime-v3';
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icons/krotak-pro-192.png',
  '/icons/krotak-pro-512.png',
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

  // التنقّل: الشبكة أولاً، ومحتوى التطبيق المخزَّن عند انقطاع الاتصال.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match('/'))
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
