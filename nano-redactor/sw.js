const CACHE_NAME = 'nano-redactor-v0.1.1';
const APP_SHELL = ['./','./index.html','./styles.css','./manifest.webmanifest','./js/main.js','./js/ai.js','./js/chunker.js','./js/mail-context.js','./js/rules.js','./js/spans.js','./js/redactor.js','./js/ui.js'];
self.addEventListener('install', (event) => { event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))); self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))); self.clients.claim(); });
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url); if (url.origin !== self.location.origin) return;
  const pathname = url.pathname; const shellUrls = new Set(APP_SHELL.map((item) => new URL(item, self.location.href).pathname));
  if (!shellUrls.has(pathname)) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
