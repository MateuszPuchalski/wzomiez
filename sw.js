const CACHE = 'object-dimensions-v5';
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/aruco.js',
  'js/measure.js',
  'js/camera.js',
  'js/worker.js',
  'vendor/opencv.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'marker/marker.html',
  'marker/aruco-4x4_50-id0.svg',
  'marker/aruco-4x4_50-id1.svg',
  'marker/aruco-4x4_50-id2.svg',
  'marker/aruco-4x4_50-id3.svg',
];

// Large/immutable assets stay cache-first; the app shell is network-first so
// deployed updates reach users on the next load instead of being pinned to a
// stale cache forever.
const CACHE_FIRST = /vendor\/opencv\.js$|icons\/|marker\/aruco/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function fromNetwork(request) {
  const res = await fetch(request);
  if (res.ok && new URL(request.url).origin === location.origin) {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(request, copy));
  }
  return res;
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (CACHE_FIRST.test(e.request.url)) {
    e.respondWith(caches.match(e.request).then(cached => cached || fromNetwork(e.request)));
  } else {
    e.respondWith(fromNetwork(e.request).catch(() => caches.match(e.request)));
  }
});
