// ★ 任何檔案有改就 bump CACHE_NAME(cache-first,不 bump 舊使用者永遠拿舊版)
// 舊站(無源碼版)是 xiangqi-3d-shell-v1;這是重建版,接著往下編號。
// ★★★ 2026-09-14 全艦隊修「index.html 進快取名單」地雷(3D-Chess 幻影版實錘,補丁 static-pwa-ship/patches/patch-sw-index.mjs):
//    Cloudflare Pages 把 /index.html 308 轉到 / ⇒ 名單裡有 './index.html' 的話 install 存到的是 redirected:true 的回應,
//    導覽拿到它瀏覽器直接拒收 ⇒ 裝成 App 開就 ERR_FAILED;每次 bump SW 重踩。⇒ 名單只認 './',永遠不要再把 index.html 加回來;
//    離線導覽退路也只退 './'。
const CACHE_NAME = 'xiangqi-3d-shell-v22';
const ASSETS_TO_CACHE = [
  './',
  './css/style.css',
  './js/pieces.js',
  './js/gameLogic.js',
  './js/openings.js',
  './js/puzzles.js',
  './js/save.js',
  './js/ai.js',
  './js/renderer.js',
  './js/app.js',
  './js/view-kit.js',
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
    caches.match(event.request).then((hit) => hit || fetch(event.request).catch(() =>
      // 離線退路:導覽請求(開 App / 重整)退回殼層 './'(0914 起不用 index.html,見檔頭 ★★★)
      (event.request.mode === 'navigate' ? caches.match('./') : undefined).then((shell) => shell || Response.error()),
    )),
  );
});

// 🏷️ 版號回報（0820 全艤隊範本）：頁尾徽章問「實際執行中的版本」，答案 = 本 SW 的快取名。
self.addEventListener('message', function (e) {
  if (e && e.data === 'GET_VERSION' && e.source) e.source.postMessage({ type: 'SW_VERSION', v: CACHE_NAME });
});
