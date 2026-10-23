// Jednoduchý service worker: appka sa dá nainštalovať a vlastné súbory sa načítajú
// aj pri slabom signáli. Vždy skúsi najprv sieť (aby sa zmeny prejavili hneď).
const CACHE = 'vt-v32';
// náhľady cvikov z appky (videa.vikingsworkout.com): z pamäte hneď, druhé otvorenie bez čakania
const ICACHE = 'vt-nahlady-v1';
// rozpoznávanie postavy (MediaPipe: knižnica, WASM, modely) – súbory s pevnou verziou, ~25 MB.
// Po prvom stiahnutí sa berú z pamäte zariadenia, takže živá kostra pri ďalšom otvorení naskočí hneď.
const MPCACHE = 'vt-mediapipe-0.10.14';
const isMP = (u) => u.startsWith('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/') || u.startsWith('https://storage.googleapis.com/mediapipe-models/');
const SHELL = ['./', 'index.html', 'js/app.js', 'js/pose.js', 'js/pose-worker.js', 'js/livecount.js', 'js/db.js', 'js/exercises.js', 'js/recorder.js', 'js/vw.js', 'js/vwui.js', 'js/sk.js', 'logo.png', 'fonts/texturina-latin.woff2', 'fonts/texturina-latin-ext.woff2', 'manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE && x !== ICACHE && x !== MPCACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
const pendingImg = new Map();
self.addEventListener('message', e => {
  const d = e.data;
  if (!d || d.type !== 'vt-img-ok' || typeof d.url !== 'string' || !pendingImg.has(d.url)) return;
  const r = pendingImg.get(d.url); pendingImg.delete(d.url);
  e.waitUntil(caches.open(ICACHE).then(async c => {
    await c.put(d.url, r);
    const k = await c.keys();
    for (const x of k.slice(0, Math.max(0, k.length - 150))) await c.delete(x);
  }).catch(() => {}));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method === 'GET' && isMP(e.request.url)) {
    e.respondWith(caches.open(MPCACHE).then(c => c.match(e.request.url).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok && r.type !== 'opaque') c.put(e.request.url, r.clone()).catch(() => {});
      return r;
    }))).catch(() => fetch(e.request)));
    return;
  }
  if (e.request.method === 'GET' && u.origin === 'https://videa.vikingsworkout.com' && /\.(jpe?g|webp|png)$/i.test(u.pathname)) {
    // do pamäte ide až keď stránka potvrdí, že sa obrázok načítal (chybný náhľad sa tak neuloží)
    e.respondWith(caches.open(ICACHE).then(c => c.match(e.request)).then(hit => hit || fetch(e.request).then(r => {
      pendingImg.set(e.request.url, r.clone()); setTimeout(() => pendingImg.delete(e.request.url), 60000);
      return r;
    })).catch(() => fetch(e.request)));
    return;
  }
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
