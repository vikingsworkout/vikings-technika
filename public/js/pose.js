// Pose detection v prehliadači (MediaPipe Pose Landmarker) + výpočet uhlov kĺbov,
// počítanie opakovaní a výber kľúčových snímok. Video sa nikam neposiela.

const MP_VERSION = '0.10.14';
const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

export const MAX_SECONDS = 30;
// záznam pre "video analýzy": zmenšené snímky + body tela (prehráva sa v appke s kostrou)
export const CLIP_PTS = [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
export const CLIP_BONES = [[7, 11], [8, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [28, 30], [27, 31], [28, 32], [29, 31], [30, 32]];
const CLIP_MAX = 180, CLIP_SIDE = 360;

// indexy bodov MediaPipe
const P = { nose: 0, lEar: 7, rEar: 8, lHeel: 29, rHeel: 30, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16, lHip: 23, rHip: 24, lKn: 25, rKn: 26, lAn: 27, rAn: 28, lFt: 31, rFt: 32 };
const BONES = [[7, 11], [8, 12], [29, 31], [30, 32], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32], [27, 29], [28, 30]];

let landmarkerPromise = null;
// MediaPipe v režime VIDEO vyžaduje stále rastúce časy naprieč všetkými videami,
// preto si pamätáme posledný použitý čas (inak druhé video v poradí spadne).
let lastTs = 0;

// Promise s časovým limitom – nič nesmie visieť donekonečna.
function withTimeout(promise, ms, message) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(message)), ms); })])
    .finally(() => clearTimeout(t));
}

async function getLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = withTimeout((async () => {
      const { PoseLandmarker, FilesetResolver } = await import(`${MP_URL}/vision_bundle.mjs`);
      const fileset = await FilesetResolver.forVisionTasks(`${MP_URL}/wasm`);
      const opts = (delegate) => ({
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO', numPoses: 1,
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      // GPU na niektorých mobiloch zlyhá alebo zamrzne – vtedy prejdeme na CPU
      try { return await withTimeout(PoseLandmarker.createFromOptions(fileset, opts('GPU')), 25_000, 'gpu'); }
      catch { return await PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
    })(), 90_000, 'Model na rozpoznanie postavy sa nepodarilo načítať (slabý internet?). Skús to znova na Wi-Fi.');
    landmarkerPromise.catch(() => { landmarkerPromise = null; });
  }
  return landmarkerPromise;
}

// spustí sťahovanie modelu na pozadí, aby bol pripravený, kým si používateľ vyberá video
export function preload() { getLandmarker().catch(() => {}); }

// ---------- geometria ----------
function angle(a, b, c) { // uhol ABC v stupňoch (null, ak niektorý bod nie je spoľahlivo viditeľný)
  if ([a, b, c].some(q => (q.visibility ?? 1) < 0.35)) return null;
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (!d) return null;
  return Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / d))) * 180 / Math.PI;
}
function fromVertical(bottom, top) { // odklon úsečky od zvislice (0 = kolmo hore)
  return Math.atan2(Math.abs(top.x - bottom.x), bottom.y - top.y) * 180 / Math.PI;
}
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const vis = (l, ...ids) => ids.reduce((s, i) => s + (l[i].visibility ?? 0), 0) / ids.length;

function frameMetrics(lm, W, H) {
  const p = lm.map(q => ({ x: q.x * W, y: q.y * H, visibility: q.visibility }));
  const shM = mid(p[P.lSh], p[P.rSh]), hipM = mid(p[P.lHip], p[P.rHip]);
  const torso = Math.hypot(shM.x - hipM.x, shM.y - hipM.y) || 1;
  const ok = (...ids) => ids.every(i => (p[i].visibility ?? 1) >= 0.35);
  const side = (ear, s, e, w, h, k, a, heel, toe) => ({
    knee: angle(p[h], p[k], p[a]),
    hip: angle(p[s], p[h], p[k]),
    elbow: angle(p[s], p[e], p[w]),
    shoulder: angle(p[e], p[s], p[h]),
    shin: fromVertical(p[a], p[k]),
    ankle: angle(p[k], p[a], p[toe]),                 // členok (dorziflexia): menší uhol = koleno viac vpredu
    body_line: angle(p[s], p[h], p[a]),               // línia rameno–bok–členok, 180 = rovné telo
    neck: angle(p[ear], p[s], p[h]),                  // hlava v predĺžení trupu ≈ 160–180
    forearm: ok(e, w) ? (a => Math.min(a, 180 - a))(fromVertical(p[e], p[w])) : null, // odklon predlaktia od zvislice (hore aj dole)
    heel_lift: ok(heel, toe) ? 100 * (p[toe].y - p[heel].y) / torso : null, // >0 = päta nad špičkou
    wristX: ok(w) ? p[w].x / torso : null,            // pre dráhu činky / rúk
    vis: vis(p, s, e, w, h, k, a),
  });
  const L = side(P.lEar, P.lSh, P.lEl, P.lWr, P.lHip, P.lKn, P.lAn, P.lHeel, P.lFt);
  const R = side(P.rEar, P.rSh, P.rEl, P.rWr, P.rHip, P.rKn, P.rAn, P.rHeel, P.rFt);
  const kneeW = Math.abs(p[P.lKn].x - p[P.rKn].x), ankleW = Math.abs(p[P.lAn].x - p[P.rAn].x);
  const anM = mid(p[P.lAn], p[P.rAn]);
  const wrM = mid(p[P.lWr], p[P.rWr]);
  return {
    hipY: hipM.y, ankleY: anM.y,
    wristsUp: wrM.y < shM.y - 0.15 * torso, // ruky nad ramenami (visenie, tlak nad hlavu)
    bodyLen: Math.hypot(shM.x - anM.x, shM.y - anM.y),
    L, R,
    trunk: fromVertical(hipM, shM),
    legs: fromVertical(anM, hipM), // 0 = nohy zvislo (stoj), ~90 = vodorovne (vzpor, ležmo)
    shoulderWidthRatio: Math.abs(p[P.lSh].x - p[P.rSh].x) / torso,
    kneeAnkleRatio: ankleW > 5 ? kneeW / ankleW : null,
    shoulderTilt: (p[P.lSh].y - p[P.rSh].y) / torso * 100, // naklonenie ramien (pohľad spredu/zozadu)
    hipTilt: (p[P.lHip].y - p[P.rHip].y) / torso * 100,
    hipShift: (hipM.x - anM.x) / torso * 100,               // posun bokov do strany voči chodidlám
  };
}

// ---------- načítanie videa a seekovanie ----------
function loadVideo(file) {
  return withTimeout(loadVideoInner(file), 20_000, 'Video sa nepodarilo otvoriť. Skús ho nahrať znova, prípadne vo formáte MP4.');
}
function loadVideoInner(file) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
    v.src = URL.createObjectURL(file);
    // iOS Safari pri skrytom videu často nevyšle loadeddata, preto stačí loadedmetadata
    let started = false;
    const ready = async () => {
      if (started) return; started = true;
      // niektoré videá (WebM z prehliadača, časť Androidov) hlásia dĺžku Infinity –
      // skok na koniec prinúti prehliadač dĺžku zistiť
      if (!isFinite(v.duration)) {
        await new Promise((res) => {
          const done = () => { if (isFinite(v.duration)) { v.removeEventListener('durationchange', done); res(); } };
          v.addEventListener('durationchange', done);
          v.currentTime = 1e9;
          setTimeout(res, 4000);
        });
        v.currentTime = 0;
      }
      resolve(v);
    };
    v.onloadedmetadata = ready;
    v.onloadeddata = ready;
    v.onerror = () => reject(new Error('Video sa nepodarilo načítať. Skús iný formát (MP4/MOV).'));
    v.load();
  });
}
function seek(v, t) {
  return new Promise((resolve) => {
    let done = false;
    const fin = () => { if (!done) { done = true; v.removeEventListener('seeked', fin); resolve(); } };
    v.addEventListener('seeked', fin);
    v.currentTime = Math.min(t, Math.max(0, v.duration - 0.01));
    setTimeout(fin, 1500); // poistka pre prehliadače, ktoré seeked nevyšlú
  });
}

// ---------- štatistika ----------
const r0 = (x) => x == null || Number.isNaN(x) ? null : Math.round(x);
const r1 = (x) => x == null || Number.isNaN(x) ? null : Math.round(x * 10) / 10;
function pct(arr, q) {
  const a = arr.filter(x => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  return a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))];
}
function interpolate(series) { // doplní chýbajúce hodnoty lineárne
  const out = series.slice(); let last = -1;
  for (let i = 0; i < out.length; i++) {
    if (out[i] == null) continue;
    if (last === -1) { for (let j = 0; j < i; j++) out[j] = out[i]; }
    else for (let j = last + 1; j < i; j++) out[j] = out[last] + (out[i] - out[last]) * (j - last) / (i - last);
    last = i;
  }
  if (last >= 0) for (let j = last + 1; j < out.length; j++) out[j] = out[last];
  return out;
}
function smooth(s, w = 2) {
  return s.map((_, i) => {
    let sum = 0, n = 0;
    for (let j = i - w; j <= i + w; j++) if (s[j] != null) { sum += s[j]; n++; }
    return n ? sum / n : null;
  });
}

function detectReps(frames, values) {
  const s = smooth(interpolate(values));
  const lo = pct(s, 0.05), hi = pct(s, 0.95);
  if (lo == null || hi - lo < 20) return { reps: [], range: hi - lo };
  const upTh = lo + 0.7 * (hi - lo), downTh = lo + 0.4 * (hi - lo);
  const reps = []; let state = null, start = 0, minI = 0;
  for (let i = 0; i < s.length; i++) {
    if (state === null) {
      if (s[i] >= upTh) { state = 'up'; start = i; }
      else if (s[i] <= downTh) { state = 'down'; start = i; minI = i; } // video začína dole (napr. mŕtvy ťah)
      continue;
    }
    if (state === 'up') {
      if (s[i] >= upTh) start = i; // posledný bod hore pred zostupom
      else if (s[i] <= downTh) { state = 'down'; minI = i; }
    } else if (state === 'down') {
      if (s[i] < s[minI]) minI = i;
      if (s[i] >= upTh) { reps.push({ start, bottom: minI, end: i }); state = 'up'; start = i; }
    }
  }
  return { reps, range: hi - lo };
}

// ---------- hlavná funkcia ----------
export async function analyzeVideo(file, { signal = null, posture = null, minAmp = 25, onProgress = () => {} } = {}) {
  onProgress(0, 'Načítavam model na rozpoznanie postavy…');
  const [landmarker, v] = await Promise.all([getLandmarker(), loadVideo(file)]);
  try { await v.play(); v.pause(); } catch { /* iOS niekedy potrebuje play pred seekovaním */ }

  const W = v.videoWidth, H = v.videoHeight;
  const fullDuration = v.duration;
  if (!W || !H || !isFinite(fullDuration)) throw new Error('Video sa nepodarilo prečítať.');
  const duration = Math.min(fullDuration, MAX_SECONDS);
  const step = Math.max(1 / 15, duration / 400); // hustejšie snímkovanie (max. 400 snímok)
  const frames = [];
  const base = lastTs + 1000;
  // záznam pre prehrávač: max. CLIP_MAX snímok, dlhšia strana CLIP_SIDE px
  const stride = Math.max(1, Math.ceil(Math.ceil(duration / step) / CLIP_MAX));
  const cs = Math.min(1, CLIP_SIDE / Math.max(W, H));
  const cc = document.createElement('canvas');
  cc.width = Math.round(W * cs); cc.height = Math.round(H * cs);
  const cg = cc.getContext('2d');
  const clipFrames = [];
  let clipOk = true;

  for (let t = 0; t < duration; t += step) {
    await seek(v, t);
    lastTs = Math.max(lastTs + 1, base + Math.round(t * 1000));
    let res;
    try { res = landmarker.detectForVideo(v, lastTs); }
    catch (e) {
      landmarkerPromise = null; // model resetneme, pri ďalšom pokuse sa vytvorí nový
      throw new Error('Rozpoznávanie postavy zlyhalo. Skús to znova, prípadne obnov stránku.');
    }
    const lm = res.landmarks && res.landmarks[0];
    frames.push({ t, lm: lm || null, m: lm ? frameMetrics(lm, W, H) : null });
    if (clipOk && (frames.length - 1) % stride === 0) {
      try {
        cg.drawImage(v, 0, 0, cc.width, cc.height);
        const img = await new Promise(r => cc.toBlob(r, 'image/jpeg', 0.62));
        if (img) clipFrames.push({ t, fi: frames.length - 1, img,
          lm: lm ? CLIP_PTS.map(i => [Math.round(lm[i].x * 1000) / 1000, Math.round(lm[i].y * 1000) / 1000, Math.round((lm[i].visibility ?? 1) * 100) / 100]) : null });
      } catch { clipOk = false; } // záznam je len doplnok, analýzu nesmie zastaviť
    }
    onProgress(0.05 + 0.85 * (t / duration), 'Analyzujem pohyb…');
  }

  const ok = frames.filter(f => f.m);
  if (ok.length < Math.max(5, frames.length * 0.3)) {
    throw new Error('Na videu sa nepodarilo spoľahlivo rozpoznať postavu. Skús natočiť celé telo v zábere, s dobrým svetlom a pozadím.');
  }

  // dominantná (lepšie viditeľná) strana
  const visL = ok.reduce((s, f) => s + f.m.L.vis, 0) / ok.length;
  const visR = ok.reduce((s, f) => s + f.m.R.vis, 0) / ok.length;
  const sideKey = visL >= visR ? 'L' : 'R';
  const swr = pct(ok.map(f => f.m.shoulderWidthRatio), 0.5);
  const view = swr < 0.35 ? 'zboku' : swr > 0.6 ? 'spredu alebo zozadu' : 'šikmo (asi 45°)';

  const series = (k) => frames.map(f => f.m ? f.m[sideKey][k] : null);

  // --- 1) rozdelenie videa podľa polohy tela (stoj vs. vodorovne), aby sa
  //        prípravný pohyb (napr. zľahnutie do vzporu pred klikmi) nerátal ako opakovanie
  const fps = 1 / step;
  // polohy: H = vodorovne (vzpor, ležmo), P = visenie (ruky hore, nohy nad zemou), V = stoj
  const okM = frames.filter(f => f.m).map(f => f.m);
  const floorY = pct(okM.map(m => m.ankleY), 0.9);
  const bodyLen = pct(okM.map(m => m.bodyLen), 0.5) || 1;
  const rawPost = frames.map(f => {
    if (!f.m) return null;
    if (f.m.legs != null && f.m.legs > 55) return 'H';
    if (f.m.wristsUp && floorY - f.m.ankleY > 0.07 * bodyLen) return 'P';
    return 'V';
  });
  for (let i = 0; i < rawPost.length; i++) if (rawPost[i] == null) rawPost[i] = i ? rawPost[i - 1] : null;
  const firstKnown = rawPost.find(x => x) || 'V';
  for (let i = 0; i < rawPost.length && rawPost[i] == null; i++) rawPost[i] = firstKnown;
  const half = Math.max(2, Math.round(fps * 0.5));
  const post = rawPost.map((_, i) => { // najčastejšia poloha v okne ~1 s
    const c = { H: 0, P: 0, V: 0 };
    for (let j = Math.max(0, i - half); j <= Math.min(rawPost.length - 1, i + half); j++) c[rawPost[j]]++;
    return Object.keys(c).reduce((a, b) => (c[b] > c[a] ? b : a), rawPost[i]);
  });
  let segments = [];
  for (let i = 0; i < post.length; i++) {
    const last = segments[segments.length - 1];
    if (last && last.p === post[i]) last.to = i; else segments.push({ p: post[i], from: i, to: i });
  }
  // krátke úseky (< 1 s) pripojiť k susedom
  segments = segments.reduce((acc, sg) => {
    const dur = (sg.to - sg.from + 1) * step;
    if (acc.length && (dur < 1 || acc[acc.length - 1].p === sg.p)) { acc[acc.length - 1].to = sg.to; return acc; }
    acc.push({ ...sg }); return acc;
  }, []);

  // --- 2) v každom úseku a pre každý kandidátny kĺb nájdi opakovania; vyber
  //        najpresvedčivejšiu sériu (viac podobných opakovaní = lepšie)
  const joints = signal ? [signal] : ['elbow', 'knee', 'hip'];
  const stats = (arr) => { const m = arr.reduce((a, b) => a + b, 0) / arr.length; const sd = Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length); return { m, cv: m ? sd / m : 1 }; };
  let best = null;
  const consider = (from, to, joint, segP) => {
    const vals = series(joint).slice(from, to + 1);
    let { reps } = detectReps(frames.slice(from, to + 1), vals);
    const sm = smooth(interpolate(vals));
    reps = reps.map(r => ({ start: r.start + from, bottom: r.bottom + from, end: r.end + from,
      amp: Math.max(...sm.slice(r.start, r.end + 1)) - sm[r.bottom], dur: (r.end - r.start) * step }))
      .filter(r => r.dur >= 0.5 && r.dur <= 10 && r.amp >= minAmp);
    if (reps.length > 1) { // odfiltruj výrazne menšie „opakovania“ (šum, prechodový pohyb)
      const medAmp = [...reps.map(r => r.amp)].sort((a, b) => a - b)[Math.floor(reps.length / 2)];
      reps = reps.filter(r => r.amp >= 0.45 * medAmp);
    }
    if (reps.length >= 3) { // opakovanie v inej výške tela (zoskok z hrazdy, odchod) nie je opakovanie
      const hipAt = (i) => { for (let d = 0; d < 6; d++) { const f = frames[i + d] || frames[i - d]; if (f && f.m) return f.m.hipY; } return null; };
      const hy = reps.map(r => hipAt(r.bottom));
      const med = [...hy.filter(x => x != null)].sort((a, b) => a - b)[Math.floor(hy.filter(x => x != null).length / 2)];
      reps = reps.filter((r, k) => hy[k] == null || Math.abs(hy[k] - med) <= 0.15 * bodyLen);
    }
    if (!reps.length) return;
    const a = stats(reps.map(r => r.amp)), d = stats(reps.map(r => r.dur));
    const consistency = reps.length > 1 ? 1 - Math.min(1, (a.cv + d.cv) / 2) : 0.3;
    const score = reps.length * (0.6 + 0.4 * consistency) + (reps.length >= 2 ? 1 : 0) + a.m / 1000;
    if (!best || score > best.score) best = { score, reps, joint, from, to, p: segP };
  };
  // ak poznáme cvik, hľadáme najprv v úsekoch s očakávanou polohou tela (napr. zhyby len vo visení)
  const longEnough = segments.filter(sg => (sg.to - sg.from + 1) * step >= 1.5);
  const preferred = posture ? longEnough.filter(sg => sg.p === posture) : longEnough;
  for (const sg of preferred) for (const j of joints) consider(sg.from, sg.to, j, sg.p);
  if (!best && posture) for (const sg of longEnough) for (const j of joints) consider(sg.from, sg.to, j, sg.p);
  if (!best) for (const j of joints) consider(0, frames.length - 1, j, null); // záloha: celé video

  const reps = best ? best.reps : [];
  const sig = best ? best.joint : (signal || 'knee');
  const pad = Math.round(0.7 * fps);
  let actFrom = 0, actTo = frames.length - 1;
  if (reps.length) { actFrom = Math.max(best.from, reps[0].start - pad); actTo = Math.min(best.to, reps[reps.length - 1].end + pad); }
  else { // bez opakovaní: najdlhší úsek
    const longest = segments.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a), segments[0]);
    if (longest) { actFrom = longest.from; actTo = longest.to; }
  }
  const POST_NAMES = { H: 'vodorovná (vzpor, ležmo, napr. kliky)', P: 'visenie (napr. na hrazde)', V: 'vzpriamená (stoj)' };
  const actPosture = POST_NAMES[best?.p || post[actFrom]] || POST_NAMES.V;

  const metricsOf = (from, to) => {
    const slice = frames.slice(from, to + 1).filter(f => f.m);
    const out = {};
    for (const k of ['knee', 'hip', 'elbow', 'shoulder', 'shin', 'ankle', 'body_line', 'neck', 'forearm']) {
      const vals = slice.map(f => f.m[sideKey][k]).filter(x => x != null);
      if (vals.length >= 2) out[k] = { min: r0(Math.min(...vals)), max: r0(Math.max(...vals)) };
    }
    const hl = slice.map(f => f.m[sideKey].heel_lift).filter(x => x != null);
    if (hl.length) out.heel_lift_pct = { max: r0(Math.max(...hl)) };
    const wx = slice.map(f => f.m[sideKey].wristX).filter(x => x != null);
    if (wx.length >= 2) out.wrist_horizontal_travel_pct = r0(100 * (Math.max(...wx) - Math.min(...wx)));
    const tr = slice.map(f => f.m.trunk).filter(x => x != null);
    if (tr.length) out.trunk_lean = { min: r0(Math.min(...tr)), max: r0(Math.max(...tr)) };
    if (view !== 'zboku') {
      const ka = slice.map(f => f.m.kneeAnkleRatio).filter(x => x != null);
      if (ka.length) out.knee_to_ankle_width_ratio = { min: r1(Math.min(...ka)), max: r1(Math.max(...ka)) };
      const asym = slice.map(f => (f.m.L.knee != null && f.m.R.knee != null) ? Math.abs(f.m.L.knee - f.m.R.knee) : null).filter(x => x != null);
      if (asym.length) out.left_right_knee_diff = { max: r0(Math.max(...asym)) };
      for (const k of ['elbow', 'hip']) {
        const d = slice.map(f => (f.m.L[k] != null && f.m.R[k] != null) ? Math.abs(f.m.L[k] - f.m.R[k]) : null).filter(x => x != null);
        if (d.length) out[`left_right_${k}_diff`] = { max: r0(Math.max(...d)) };
      }
      const absMax = (key) => { const a = slice.map(f => Math.abs(f.m[key])).filter(x => Number.isFinite(x)); return a.length ? r0(Math.max(...a)) : null; };
      out.shoulder_tilt_pct = absMax('shoulderTilt');
      out.hip_tilt_pct = absMax('hipTilt');
      out.hip_side_shift_pct = absMax('hipShift');
    }
    return out;
  };

  const sigAt = (i) => { const v = frames[i]?.m?.[sideKey]?.[sig]; return v == null ? null : r0(v); };
  // pauza v krajnej polohe: koľko snímok je hlavný uhol do 5° od minima
  const pauseAt = (r) => {
    const b = sigAt(r.bottom); if (b == null) return null;
    let n = 0; for (let i = r.start; i <= r.end; i++) { const v = sigAt(i); if (v != null && v - b <= 5) n++; }
    return r1(n * step);
  };
  const repData = reps.map((r, i) => ({
    n: i + 1,
    start_s: r1(frames[r.start].t), bottom_s: r1(frames[r.bottom].t), end_s: r1(frames[r.end].t),
    down_s: r1(frames[r.bottom].t - frames[r.start].t), up_s: r1(frames[r.end].t - frames[r.bottom].t),
    pause_bottom_s: pauseAt(r),
    main_joint: { top: sigAt(r.start), bottom: sigAt(r.bottom), range: r0(r.amp) },
    angles: metricsOf(r.start, r.end),
  }));
  // konzistencia série: rozsah a tempo prvého vs. posledného opakovania (únava)
  const consistency = repData.length >= 2 ? {
    range_first_last: [repData[0].main_joint.range, repData[repData.length - 1].main_joint.range],
    duration_first_last_s: [r1(repData[0].end_s - repData[0].start_s), r1(repData[repData.length - 1].end_s - repData[repData.length - 1].start_s)],
    range_min_max: [Math.min(...repData.map(r => r.main_joint.range)), Math.max(...repData.map(r => r.main_joint.range))],
  } : null;

  const summary = {
    video: { duration_s: r1(fullDuration), analyzed_s: r1(duration), width: W, height: H },
    frames_analyzed: frames.length, person_detected_pct: r0(100 * ok.length / frames.length),
    camera_view_estimate: view, measured_side: sideKey === 'L' ? 'ľavá' : 'pravá',
    rep_signal_joint: sig, reps_detected: repData.length,
    active_segment: { start_s: r1(frames[actFrom].t), end_s: r1(frames[actTo].t), body_posture: actPosture,
      note: 'Hodnoť len tento úsek. Pohyb pred ním a po ňom je príprava alebo odchod (napr. zaujatie polohy) a nie je súčasť cviku.' },
    posture_timeline: segments.map(sg => ({ from_s: r1(frames[sg.from].t), to_s: r1(frames[sg.to].t), posture: { H: 'vodorovná', P: 'visenie', V: 'vzpriamená' }[sg.p] })),
    angle_notes: 'Uhly v stupňoch, 2D z kamery (meraná strana tela). knee/hip/elbow/shoulder: 180 = vystreté. body_line: rameno–bok–členok, 180 = telo v rovine (kliky, vzpor, visenie). neck: ucho–rameno–bok, ~170–180 = hlava v predĺžení trupu, menej = predsunutá alebo zaklonená hlava. ankle: koleno–členok–špička, menej = väčší predklon holene. forearm: odklon predlaktia od zvislice (0 = zápästie presne nad/pod lakťom). trunk_lean/shin: odklon od zvislice (0 = kolmo). heel_lift_pct: zdvih päty v % dĺžky trupu (>8 = päta sa odlepuje). wrist_horizontal_travel_pct: vodorovný pohyb rúk/činky v % dĺžky trupu. Pohľad spredu/zozadu: knee_to_ankle_width_ratio < 1 = kolená idú dovnútra; left_right_*_diff = rozdiel ľavej a pravej strany; shoulder/hip_tilt_pct = naklonenie; hip_side_shift_pct = posun bokov do strany. main_joint = hlavný kĺb opakovania (top = horná poloha, bottom = krajná poloha, range = rozsah). pause_bottom_s = výdrž v krajnej polohe.',
    overall_active_segment: metricsOf(actFrom, actTo),
    reps: repData,
    set_consistency: consistency,
  };

  // ---------- kľúčové snímky ----------
  onProgress(0.92, 'Pripravujem kľúčové snímky…');
  const picks = [];
  const firstOk = frames.findIndex((f, i) => f.m && i >= actFrom);
  picks.push({ i: reps.length ? reps[0].start : firstOk, label: 'Východisková poloha' });
  if (reps.length) {
    // prvé, stredné, posledné a najslabšie (najmenší rozsah) opakovanie – každé v 3 fázach
    const weakest = reps.reduce((a, r, k) => (r.amp < reps[a].amp ? k : a), 0);
    const sel = [...new Set([0, Math.floor((reps.length - 1) / 2), reps.length - 1, weakest])].sort((a, b) => a - b);
    for (const k of sel) {
      const r = reps[k];
      const medAmp = [...reps.map(x => x.amp)].sort((x, y) => x - y)[Math.floor(reps.length / 2)];
      const tag = k === weakest && reps.length > 2 && r.amp < 0.9 * medAmp ? ' (najmenší rozsah)' : '';
      picks.push({ i: Math.round((r.start + r.bottom) / 2), label: `Opakovanie ${k + 1}${tag}: pohyb dole` });
      picks.push({ i: r.bottom, label: `Opakovanie ${k + 1}${tag}: krajná poloha` });
      picks.push({ i: Math.round((r.bottom + r.end) / 2), label: `Opakovanie ${k + 1}${tag}: pohyb späť` });
    }
    picks.push({ i: reps[reps.length - 1].end, label: 'Záverečná poloha' });
  } else {
    for (let q = 1; q <= 7; q++) picks.push({ i: Math.round(actFrom + q * (actTo - actFrom) / 8), label: `Snímka ${q + 1}` });
  }
  const uniq = []; const seen = new Set();
  for (const p of picks) if (p.i >= 0 && p.i < frames.length && !seen.has(p.i)) { seen.add(p.i); uniq.push(p); }
  // max. 12 snímok – pri prebytku vynecháme rovnomerne zo stredu, začiatok a koniec ostanú
  let chosen = uniq;
  if (chosen.length > 12) { const k = (chosen.length - 1) / 11; chosen = Array.from({ length: 12 }, (_, j) => uniq[Math.round(j * k)]); }

  const keyframes = [];
  for (const p of chosen) {
    const f = frames[p.i];
    await seek(v, f.t);
    keyframes.push({ t: r1(f.t), label: p.label, dataUrl: drawFrame(v, f.lm, 600, true) });
  }
  await seek(v, frames[chosen[0].i].t);
  const thumb = drawFrame(v, null, 360, false);

  URL.revokeObjectURL(v.src);
  onProgress(1, 'Hotovo');
  const clip = clipFrames.length >= 5 ? {
    w: cc.width, h: cc.height, fps: 1 / (step * stride), duration: r1(duration), side: sideKey, joint: sig,
    frames: clipFrames.map(c => ({ t: Math.round(c.t * 100) / 100, img: c.img, lm: c.lm, a: r0(frames[c.fi].m?.[sideKey]?.[sig]) })),
    reps: repData.map(r => ({ s: r.start_s, b: r.bottom_s, e: r.end_s })),
  } : null;
  return { summary, keyframes, thumb, clip };
}

function drawFrame(v, lm, maxSide, withSkeleton) {
  const W = v.videoWidth, H = v.videoHeight;
  const s = Math.min(1, maxSide / Math.max(W, H));
  const c = document.createElement('canvas');
  c.width = Math.round(W * s); c.height = Math.round(H * s);
  const g = c.getContext('2d');
  g.drawImage(v, 0, 0, c.width, c.height);
  if (withSkeleton && lm) {
    g.lineWidth = Math.max(2, c.width / 200); g.strokeStyle = 'rgba(255,122,69,0.9)';
    for (const [a, b] of BONES) {
      if ((lm[a].visibility ?? 1) < 0.3 || (lm[b].visibility ?? 1) < 0.3) continue;
      g.beginPath(); g.moveTo(lm[a].x * c.width, lm[a].y * c.height); g.lineTo(lm[b].x * c.width, lm[b].y * c.height); g.stroke();
    }
    g.fillStyle = '#fff';
    for (const i of [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]) {
      if ((lm[i].visibility ?? 1) < 0.3) continue;
      g.beginPath(); g.arc(lm[i].x * c.width, lm[i].y * c.height, g.lineWidth * 1.2, 0, Math.PI * 2); g.fill();
    }
  }
  return c.toDataURL('image/jpeg', 0.72);
}
