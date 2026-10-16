// Pose detection v prehliadači (MediaPipe Pose Landmarker) + výpočet uhlov kĺbov,
// počítanie opakovaní a výber kľúčových snímok. Video sa nikam neposiela.

const MP_VERSION = '0.10.14';
const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

export const MAX_SECONDS = 30;

// indexy bodov MediaPipe
const P = { nose: 0, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16, lHip: 23, rHip: 24, lKn: 25, rKn: 26, lAn: 27, rAn: 28, lFt: 31, rFt: 32 };
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32], [27, 29], [28, 30]];

let landmarkerPromise = null;

async function getLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { PoseLandmarker, FilesetResolver } = await import(`${MP_URL}/vision_bundle.mjs`);
      const fileset = await FilesetResolver.forVisionTasks(`${MP_URL}/wasm`);
      const opts = (delegate) => ({
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO', numPoses: 1,
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      try { return await PoseLandmarker.createFromOptions(fileset, opts('GPU')); }
      catch { return await PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
    })();
    landmarkerPromise.catch(() => { landmarkerPromise = null; });
  }
  return landmarkerPromise;
}

// spustí sťahovanie modelu na pozadí, aby bol pripravený, kým si používateľ vyberá video
export function preload() { getLandmarker().catch(() => {}); }

// ---------- geometria ----------
function angle(a, b, c) { // uhol ABC v stupňoch
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
  const side = (s, e, w, h, k, a) => ({
    knee: angle(p[h], p[k], p[a]),
    hip: angle(p[s], p[h], p[k]),
    elbow: angle(p[s], p[e], p[w]),
    shoulder: angle(p[e], p[s], p[h]),
    shin: fromVertical(p[a], p[k]),
    vis: vis(p, s, e, w, h, k, a),
  });
  const L = side(P.lSh, P.lEl, P.lWr, P.lHip, P.lKn, P.lAn);
  const R = side(P.rSh, P.rEl, P.rWr, P.rHip, P.rKn, P.rAn);
  const shM = mid(p[P.lSh], p[P.rSh]), hipM = mid(p[P.lHip], p[P.rHip]);
  const torso = Math.hypot(shM.x - hipM.x, shM.y - hipM.y) || 1;
  const kneeW = Math.abs(p[P.lKn].x - p[P.rKn].x), ankleW = Math.abs(p[P.lAn].x - p[P.rAn].x);
  return {
    L, R,
    trunk: fromVertical(hipM, shM),
    shoulderWidthRatio: Math.abs(p[P.lSh].x - p[P.rSh].x) / torso,
    kneeAnkleRatio: ankleW > 5 ? kneeW / ankleW : null,
  };
}

// ---------- načítanie videa a seekovanie ----------
function loadVideo(file) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
    v.src = URL.createObjectURL(file);
    v.onloadeddata = async () => {
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
export async function analyzeVideo(file, { signal = null, onProgress = () => {} } = {}) {
  onProgress(0, 'Načítavam model na rozpoznanie postavy…');
  const [landmarker, v] = await Promise.all([getLandmarker(), loadVideo(file)]);
  try { await v.play(); v.pause(); } catch { /* iOS niekedy potrebuje play pred seekovaním */ }

  const W = v.videoWidth, H = v.videoHeight;
  const fullDuration = v.duration;
  if (!W || !H || !isFinite(fullDuration)) throw new Error('Video sa nepodarilo prečítať.');
  const duration = Math.min(fullDuration, MAX_SECONDS);
  const step = Math.max(1 / 12, duration / 300);
  const frames = [];
  let ts = 0;

  for (let t = 0; t < duration; t += step) {
    await seek(v, t);
    ts = Math.max(ts + 1, Math.round(t * 1000));
    const res = landmarker.detectForVideo(v, ts);
    const lm = res.landmarks && res.landmarks[0];
    frames.push({ t, lm: lm || null, m: lm ? frameMetrics(lm, W, H) : null });
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
  let sig = signal;
  if (!sig) { // automaticky: uhol s najväčším rozsahom
    let best = 0;
    for (const k of ['knee', 'hip', 'elbow']) {
      const s = series(k); const range = (pct(s, 0.95) ?? 0) - (pct(s, 0.05) ?? 0);
      if (range > best) { best = range; sig = k; }
    }
  }
  const { reps } = detectReps(frames, series(sig));

  const metricsOf = (from, to) => {
    const slice = frames.slice(from, to + 1).filter(f => f.m);
    const out = {};
    for (const k of ['knee', 'hip', 'elbow', 'shoulder', 'shin']) {
      const vals = slice.map(f => f.m[sideKey][k]).filter(x => x != null);
      if (vals.length) out[k] = { min: r0(Math.min(...vals)), max: r0(Math.max(...vals)) };
    }
    const tr = slice.map(f => f.m.trunk).filter(x => x != null);
    if (tr.length) out.trunk_lean = { min: r0(Math.min(...tr)), max: r0(Math.max(...tr)) };
    if (view !== 'zboku') {
      const ka = slice.map(f => f.m.kneeAnkleRatio).filter(x => x != null);
      if (ka.length) out.knee_to_ankle_width_ratio = { min: r1(Math.min(...ka)), max: r1(Math.max(...ka)) };
      const asym = slice.map(f => (f.m.L.knee != null && f.m.R.knee != null) ? Math.abs(f.m.L.knee - f.m.R.knee) : null).filter(x => x != null);
      if (asym.length) out.left_right_knee_diff = { max: r0(Math.max(...asym)) };
    }
    return out;
  };

  const repData = reps.map((r, i) => ({
    n: i + 1,
    start_s: r1(frames[r.start].t), bottom_s: r1(frames[r.bottom].t), end_s: r1(frames[r.end].t),
    down_s: r1(frames[r.bottom].t - frames[r.start].t), up_s: r1(frames[r.end].t - frames[r.bottom].t),
    angles: metricsOf(r.start, r.end),
  }));

  const summary = {
    video: { duration_s: r1(fullDuration), analyzed_s: r1(duration), width: W, height: H },
    frames_analyzed: frames.length, person_detected_pct: r0(100 * ok.length / frames.length),
    camera_view_estimate: view, measured_side: sideKey === 'L' ? 'ľavá' : 'pravá',
    rep_signal_joint: sig, reps_detected: repData.length,
    angle_notes: 'Uhly v stupňoch, 2D z kamery. knee/hip/elbow/shoulder: 180 = vystreté. trunk_lean/shin: odklon od zvislice (0 = kolmo). knee_to_ankle_width_ratio < 1 môže znamenať kolená idúce dovnútra (len pri pohľade spredu).',
    overall: metricsOf(0, frames.length - 1),
    reps: repData,
  };

  // ---------- kľúčové snímky ----------
  onProgress(0.92, 'Pripravujem kľúčové snímky…');
  const picks = [];
  const firstOk = frames.findIndex(f => f.m);
  picks.push({ i: reps.length ? reps[0].start : firstOk, label: 'Východisková poloha' });
  if (reps.length) {
    const sel = [...new Set([0, Math.floor((reps.length - 1) / 2), reps.length - 1])];
    for (const k of sel) {
      const r = reps[k];
      picks.push({ i: Math.round((r.start + r.bottom) / 2), label: `Opakovanie ${k + 1}: pohyb dole` });
      picks.push({ i: r.bottom, label: `Opakovanie ${k + 1}: krajná poloha` });
    }
  } else {
    for (let q = 1; q <= 4; q++) picks.push({ i: Math.round(q * (frames.length - 1) / 5), label: `Snímka ${q + 1}` });
  }
  const uniq = []; const seen = new Set();
  for (const p of picks) if (p.i >= 0 && !seen.has(p.i)) { seen.add(p.i); uniq.push(p); }
  const chosen = uniq.slice(0, 7);

  const keyframes = [];
  for (const p of chosen) {
    const f = frames[p.i];
    await seek(v, f.t);
    keyframes.push({ t: r1(f.t), label: p.label, dataUrl: drawFrame(v, f.lm, 640, true) });
  }
  await seek(v, frames[chosen[0].i].t);
  const thumb = drawFrame(v, null, 200, false);

  URL.revokeObjectURL(v.src);
  onProgress(1, 'Hotovo');
  return { summary, keyframes, thumb };
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
    for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      if ((lm[i].visibility ?? 1) < 0.3) continue;
      g.beginPath(); g.arc(lm[i].x * c.width, lm[i].y * c.height, g.lineWidth * 1.2, 0, Math.PI * 2); g.fill();
    }
  }
  return c.toDataURL('image/jpeg', 0.72);
}
