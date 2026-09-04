// ★ 任何檔案有改就 bump CACHE_NAME(cache-first,不 bump 舊使用者永遠拿舊版)
// 舊站(無源碼版)是 xiangqi-3d-shell-v1;這是重建版,接著往下編號。
const CACHE_NAME = 'xiangqi-3d-shell-v7';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/style.css',
  './js/pieces.js',
  './js/gameLogic.js',
  './js/openings.js',
  './js/puzzles.js',
  './js/save.js',
  './js/ai.js',
  './js/renderer.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // ⚠ 逐一 add:addAll 只要**一個**外部資產抓不到就整批失敗 ⇒ 整站靜默不離線
      Promise.all(ASSETS_TO_CACHE.map((url) => cache.add(url).catch(() => null))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request)),
  );
});

// 🏷️ 版號回報（0820 全艤隊範本）：頁尾徽章問「實際執行中的版本」，答案 = 本 SW 的快取名。
self.addEventListener('message', function (e) {
  if (e && e.data === 'GET_VERSION' && e.source) e.source.postMessage({ type: 'SW_VERSION', v: CACHE_NAME });
});
