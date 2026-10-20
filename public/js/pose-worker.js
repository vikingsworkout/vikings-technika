// Rozpoznávanie postavy (MediaPipe Pose Landmarker) mimo hlavného vlákna stránky.
// Načítanie modelu aj výpočet bežia tu, takže tlačidlá (krížik, nahrávanie) reagujú vždy,
// aj keď sa model na mobile pripravuje dlho alebo grafika (GPU) zamrzne.
//
// Dva modely:
//   live – ľahký model (pose_landmarker_lite, ~5 MB) na živú kostru pri nahrávaní. Pripraví sa ako prvý,
//          na procesore (CPU), aby kostra naskočila čo najskôr – bez čakania na grafiku.
//   full – presný model (pose_landmarker_full) na rozbor nahratého videa. Načíta sa hneď potom na pozadí;
//          grafiku (GPU) skúsime len mimo iPhonu/Safari a najviac pár sekúnd, inak procesor.
// Správy: { t: 'init' } → { t: 'ready', delegate, model } a neskôr { t: 'full', delegate } | { t: 'full-fail', msg }
//         { t: 'fail', msg } – ani ľahký model sa nepripravil
//         { t: 'detect', id, bmp, ts, q: 'live' | 'full' } → { t: 'res', id, lm: [[x, y, z, visibility] × 33] | null } | { t: 'err', id, msg }

const MP_VERSION = '0.10.14';
const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL = {
  live: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
};
// iPhone / Safari: grafika vo workeri býva pomalá alebo zamrzne – rovno procesor
const UA = navigator.userAgent || '';
const WEBKIT = /iPhone|iPad|iPod/.test(UA) || (/AppleWebKit/.test(UA) && !/(Chrome|Chromium|Edg)\//.test(UA));

// MediaPipe načítava svoj WASM skript cez importScripts, ktorý v module workeri nefunguje –
// nahradíme ho synchrónnym stiahnutím a spustením v globálnom rozsahu (definuje ModuleFactory).
self.importScripts = (...urls) => {
  for (const u of urls) {
    const x = new XMLHttpRequest();
    x.open('GET', String(u), false);
    x.send();
    if (x.status && (x.status < 200 || x.status >= 300)) throw new Error('importScripts ' + x.status + ' ' + u);
    (0, eval)(x.responseText + '\n//# sourceURL=' + u);
  }
};

const withTimeout = (p, ms, msg) => {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t));
};

let lib = null, filesetP = null;
const L = { live: null, full: null };          // pripravené modely
const TS = { live: 0, full: 0 };               // čas snímok musí v každom modeli stále rásť
let initP = null, fullP = null, fullDelegate = '', fullFailed = false;

async function fileset() {
  if (!filesetP) {
    filesetP = (async () => {
      lib = await import(`${MP_URL}/vision_bundle.mjs`);
      return lib.FilesetResolver.forVisionTasks(`${MP_URL}/wasm`);
    })();
    filesetP.catch(() => { filesetP = null; });
  }
  return filesetP;
}
const opts = (model, delegate) => ({
  baseOptions: { modelAssetPath: MODEL[model], delegate },
  runningMode: 'VIDEO', numPoses: 1,
  minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
});
// skúšobný výpočet na rovnakom type obrázka ako naostro: niektoré prehliadače model vytvoria, ale výpočet zlyhá
async function probe(m, q) {
  const c = new OffscreenCanvas(64, 64); c.getContext('2d').fillRect(0, 0, 64, 64);
  const b = await createImageBitmap(c);
  try { m.detectForVideo(b, ++TS[q]); } finally { b.close(); }
}
async function create(model, delegate) {
  const fs = await fileset();
  const m = await lib.PoseLandmarker.createFromOptions(fs, opts(model, delegate));
  try { await probe(m, model); } catch (e) { try { m.close(); } catch { /* nič */ } throw e; }
  return m;
}

// ľahký model na živú kostru – vždy procesor (spoľahlivé a rýchle na štart)
async function initLive() {
  L.live = await create('live', 'CPU');
  return 'CPU';
}
// grafika bez skutočného GPU (softvérové vykresľovanie) počíta pomalšie ako procesor
function softwareGL() {
  try {
    const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
    try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* nič */ }
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(r);
  } catch { return false; }
}
// presný model na rozbor: mimo Safari skúsime grafiku, ale ak do 6 s nie je hotová, beží súbežne aj
// procesor a vyhrá to, čo je skôr; pomalší model sa zatvorí
async function initFull() {
  if (WEBKIT || softwareGL()) { L.full = await create('full', 'CPU'); return 'CPU'; }
  const gpu = withTimeout(create('full', 'GPU'), 25_000, 'gpu timeout').then(m => ({ m, d: 'GPU' }));
  const cpuLater = new Promise((res, rej) => {
    const t = setTimeout(() => create('full', 'CPU').then(m => res({ m, d: 'CPU' }), rej), 6_000);
    gpu.then(() => clearTimeout(t), () => { clearTimeout(t); create('full', 'CPU').then(m => res({ m, d: 'CPU' }), rej); });
  });
  const first = await Promise.any([gpu, cpuLater]);
  L.full = first.m;
  // druhý (pomalší) model, ak sa ešte dokončí, zatvoríme
  for (const p of [gpu, cpuLater]) p.then(({ m }) => { if (m !== L.full) { try { m.close(); } catch { /* nič */ } } }, () => {});
  return first.d;
}

function startFull() {
  if (!fullP) {
    fullP = withTimeout(initFull(), 120_000, 'Presný model sa nepripravil včas.');
    fullP.then((d) => { fullDelegate = d; fullFailed = false; self.postMessage({ t: 'full', delegate: d }); },
      (err) => { fullP = null; fullFailed = true; self.postMessage({ t: 'full-fail', msg: String(err && err.message || err) }); });
  }
  return fullP;
}

self.onmessage = async (e) => {
  const m = e.data || {};
  if (m.t === 'init') {
    if (!initP) initP = withTimeout(initLive(), 90_000, 'Model sa nenačítal včas.');
    try {
      const delegate = await initP;
      self.postMessage({ t: 'ready', delegate, model: 'live' });
      startFull(); // presný model na rozbor sa pripravuje na pozadí, kým človek nahráva
    } catch (err) {
      initP = null;
      // ak nejde ani ľahký model, skúsime aspoň presný (a ten použijeme aj na živú kostru)
      try { await startFull(); self.postMessage({ t: 'ready', delegate: fullDelegate, model: 'full' }); }
      catch { self.postMessage({ t: 'fail', msg: String(err && err.message || err) }); }
    }
    return;
  }
  if (m.t === 'full?') { fullFailed = false; startFull().catch(() => {}); return; }
  if (m.t === 'detect') {
    const bmp = m.bmp;
    try {
      let q = m.q === 'live' ? 'live' : 'full';
      if (q === 'full' && !L.full) {
        // rozbor čaká na presný model; ak sa nedá pripraviť, použijeme ľahký (radšej rozbor ako chyba)
        // a pri každej snímke ho znova neskúšame (napr. bez internetu by rozbor stál)
        if (!fullFailed) { try { await startFull(); } catch { /* nižšie */ } }
        if (!L.full) q = 'live';
      }
      if (q === 'live' && !L.live) q = 'full';
      const lmk = L[q];
      if (!lmk) throw new Error('model nie je pripravený');
      TS[q] = Math.max(TS[q] + 1, Math.round(Number(m.ts) || 0)); // časy musia stále rásť
      const res = lmk.detectForVideo(bmp, TS[q]);
      const l = res.landmarks && res.landmarks[0];
      self.postMessage({ t: 'res', id: m.id, lm: l ? l.map(p => [p.x, p.y, p.z, p.visibility ?? 1]) : null });
    } catch (err) {
      self.postMessage({ t: 'err', id: m.id, msg: String(err && err.message || err) });
    } finally {
      try { bmp && bmp.close && bmp.close(); } catch { /* nič */ }
    }
  }
};
