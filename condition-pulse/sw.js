const CACHE_NAME = 'condition-pulse-v0.2.0';
const APP_SHELL = [
  './', './index.html', './styles.css', './mobile-fixes.css?v=0.1.2', './v02.css?v=0.2.0',
  './manifest.webmanifest', './icon.svg', './icon-maskable.svg',
  './data/questions.ja.json',
  './js/app.js', './js/checkin.js', './js/config.js', './js/export.js', './js/import.js',
  './js/feedback.js', './js/patterns.js', './js/preferences.js', './js/question-selector.js',
  './js/readiness.js', './js/router.js', './js/scoring.js', './js/storage.js',
  './js/time-bands.js', './js/update-manager.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const isNavigation = event.request.mode === 'navigate';
  if (isNavigation) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (!response || response.status !== 200 || response.type === 'opaque') return response;
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      return response;
    }))
  );
});
