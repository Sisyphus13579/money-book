/* 离线支持：第一次打开时把全部文件存进缓存，之后断网也能正常打开 */
const CACHE = 'moneybook-v1';

/* 相对 sw.js 自身解析，所以放在 GitHub Pages 的子目录下也对 */
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    /* 逐个 add：个别文件取不到也不该让整次安装失败 */
    await Promise.all(ASSETS.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/*
 * 联网时走网络（所以改了代码刷新就能看到新版，不用清缓存），
 * 断网时才回落到缓存。
 */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;   /* 外部资源一概不插手 */

  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') {
        const c = await caches.open(CACHE);
        c.put(req, res.clone());
      }
      return res;
    } catch {
      /* 断网 */
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;

      /* 直接开网址（导航请求）时回落到首页，避免白屏 */
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html') || await caches.match('./');
        if (shell) return shell;
      }
      return new Response('当前离线，且这个资源没有缓存过。', {
        status: 503,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  })());
});
