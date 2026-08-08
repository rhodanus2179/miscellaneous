const CACHE = 'nano-workbench-v0.1.0';
const ASSETS = [
  './', './index.html', './styles.css', './manifest.webmanifest', './icon.svg',
  './js/main.js', './js/app.js', './js/config.js', './js/utils.js', './js/storage.js',
  './js/markdown.js', './js/images.js', './js/ai.js',
];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then((response) => { const copy = response.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); return response; }).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => { const copy = response.clone(); caches.open(CACHE).then((c) => c.put(event.request, copy)); return response; })));
});
