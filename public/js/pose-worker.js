// Rozpoznávanie postavy (MediaPipe Pose Landmarker) mimo hlavného vlákna stránky.
// Načítanie modelu aj výpočet bežia tu, takže tlačidlá (krížik, nahrávanie) reagujú vždy,
// aj keď sa model na mobile pripravuje dlho alebo grafika (GPU) zamrzne.
// Správy: { t: 'init' } → { t: 'ready', delegate } | { t: 'fail', msg }
//         { t: 'detect', id, bmp, ts } → { t: 'res', id, lm: [[x, y, z, visibility] × 33] | null } | { t: 'err', id, msg }

const MP_VERSION = '0.10.14';
const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

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

let lmk = null, initP = null, lastTs = 0;

async function init() {
  const { PoseLandmarker, FilesetResolver } = await import(`${MP_URL}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${MP_URL}/wasm`);
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  // skúšobný výpočet na rovnakom type obrázka ako naostro: niektoré prehliadače model vytvoria, ale výpočet vo workeri zlyhá
  const probe = async (m) => {
    const c = new OffscreenCanvas(64, 64); c.getContext('2d').fillRect(0, 0, 64, 64);
    const b = await createImageBitmap(c);
    try { m.detectForVideo(b, ++lastTs); } finally { b.close(); }
  };
  // GPU je rýchlejšie, ale na niektorých mobiloch zlyhá alebo zamrzne – vtedy CPU
  try {
    const g = await withTimeout(PoseLandmarker.createFromOptions(fileset, opts('GPU')), 20000, 'gpu timeout');
    await probe(g);
    lmk = g; return 'GPU';
  } catch { /* CPU */ }
  const c = await PoseLandmarker.createFromOptions(fileset, opts('CPU'));
  await probe(c); // keď ani CPU vo workeri nejde, stránka použije záložný spôsob
  lmk = c; return 'CPU';
}

self.onmessage = async (e) => {
  const m = e.data || {};
  if (m.t === 'init') {
    if (!initP) initP = withTimeout(init(), 90000, 'Model sa nenačítal včas.');
    try { const delegate = await initP; self.postMessage({ t: 'ready', delegate }); }
    catch (err) { initP = null; self.postMessage({ t: 'fail', msg: String(err && err.message || err) }); }
    return;
  }
  if (m.t === 'detect') {
    const bmp = m.bmp;
    try {
      if (!lmk) throw new Error('model nie je pripravený');
      lastTs = Math.max(lastTs + 1, Math.round(Number(m.ts) || 0)); // časy musia stále rásť
      const res = lmk.detectForVideo(bmp, lastTs);
      const l = res.landmarks && res.landmarks[0];
      self.postMessage({ t: 'res', id: m.id, lm: l ? l.map(q => [q.x, q.y, q.z, q.visibility ?? 1]) : null });
    } catch (err) {
      self.postMessage({ t: 'err', id: m.id, msg: String(err && err.message || err) });
    } finally {
      try { bmp && bmp.close && bmp.close(); } catch { /* nič */ }
    }
  }
};
