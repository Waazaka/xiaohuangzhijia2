/* HomeFrame service worker：缓存应用壳，支持离线打开。
   数据写操作（POST）始终走网络；API 读取网络优先、失败回退缓存。 */
const CACHE = 'homeframe-v1';
const SHELL = [
  '/',
  '/public/index.html',
  '/public/app.js',
  '/public/styles.css',
  '/public/icon.svg',
  '/manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // 写操作走网络

  const url = new URL(req.url);

  // API：网络优先，断网时回退缓存
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // 静态资源与应用壳：缓存优先，缺失则网络并回填
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      });
    })
  );
});
