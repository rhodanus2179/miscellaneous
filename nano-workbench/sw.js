const CACHE = 'nano-workbench-v0.2.1';
const ASSETS = [
  './', './index.html', './styles.css', './styles-v02.css', './manifest.webmanifest', './icon.svg',
  './js/main.js', './js/app.js', './js/config.js', './js/utils.js', './js/storage.js',
  './js/markdown.js', './js/images.js', './js/ai.js',
  './js/workspace/index.js', './js/workspace/state.js', './js/workspace/context.js',
  './js/workspace/projects.js', './js/workspace/memories.js', './js/workspace/styles.js',
  './js/workspace/skills.js', './js/workspace/project-ui.js', './js/workspace/memory-ui.js',
  './js/workspace/memory-refinement.js', './js/workspace/style-skill-ui.js', './js/workspace/harness-ui.js', './js/workspace/slash-ui.js',
  './js/harness/schemas.js', './js/harness/clarification.js', './js/harness/prompt-envelope.js',
  './js/harness/slash-commands.js',
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
