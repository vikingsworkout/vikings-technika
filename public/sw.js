// Jednoduchý service worker: appka sa dá nainštalovať a vlastné súbory sa načítajú
// aj pri slabom signáli. Vždy skúsi najprv sieť (aby sa zmeny prejavili hneď).
const CACHE = 'vt-v18';
const SHELL = ['./', 'index.html', 'js/app.js', 'js/pose.js', 'js/db.js', 'js/exercises.js', 'js/recorder.js', 'logo.png', 'fonts/texturina-latin.woff2', 'fonts/texturina-latin-ext.woff2', 'manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
