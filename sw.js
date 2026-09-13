const CACHE_NAME = 'cineplay-v4';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './js/player.js',
  './js/subs.js',
  './js/finder.js',
  './js/net.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(STATIC_ASSETS.map(url =>
        fetch(url).then(r => { if (r.ok) return cache.put(url, r); }).catch(() => {})
      ))
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* never intercept video streaming / range requests — let the browser handle them */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // skip video/media + cross-origin + range
  if (event.request.headers.get('range') ||
      event.request.destination === 'video' ||
      /\.(mp4|mkv|webm|m3u8|ts|m4s|mpd|key)$/i.test(url.pathname)) return;
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
