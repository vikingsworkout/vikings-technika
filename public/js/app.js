import { EXERCISES, AUTO, GROUPS, findExercise, matchExercise } from './exercises.js';
import { analyzeVideo, preload, MAX_SECONDS, CLIP_PTS, CLIP_BONES } from './pose.js';
import * as db from './db.js';
import { Recorder, recorderSupported } from './recorder.js';

const $ = (id) => document.getElementById(id);
const views = ['vHome', 'vNew', 'vRec', 'vWork', 'vResult'];
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* nič */ } },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON_CAM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';

let selected = findExercise(ls.get('vt-ex')) || AUTO;
let current = null;        // práve spracovávaná analýza
let pendingFile = null;    // video, ktoré sa analyzuje (pre "skúsiť znova")

function show(view) {
  if (view !== 'vRec') recorder.close();
  views.forEach(v => { $(v).hidden = v !== view; });
  $('btnHome').hidden = view === 'vHome';
  $('btnNew').hidden = true; // na domove je hlavné tlačidlo priamo v karte
  closeViewer(); closePlayer();
  window.scrollTo(0, 0);
}

// ---------- smerovanie ----------
async function route() {
  const h = location.hash;
  if (h === '#/nova') { renderNew(); show('vNew'); preload(); return; }
  if (h === '#/nahravanie') { show('vRec'); openRecorder(); return; }
  if (h.startsWith('#/r/')) {
    const item = (current && current.id === h.slice(4)) ? current : await db.get(h.slice(4));
    if (item && item.result) { current = item; renderResult(item); show('vResult'); return; }
  }
  if (h === '#/praca' && current) { show('vWork'); return; }
  renderHome(); show('vHome');
}
window.addEventListener('hashchange', route);
$('btnHome').onclick = () => {
  // z výsledku a výberu cviku späť domov, z nahrávania späť na výber cviku
  location.hash = location.hash === '#/nahravanie' ? '#/nova' : '#/';
};
$('btnNew').onclick = () => { location.hash = '#/nova'; };

function selectExercise(id) {
  const e = findExercise(id);
  if (e) { selected = e; ls.set('vt-ex', e.id); }
}

// ---------- domov: mriežka videí ----------
function dayLabel(ts) {
  const d = new Date(ts), now = new Date();
  const days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5);
  if (days === 0) return 'dnes';
  if (days === 1) return 'včera';
  return d.toLocaleDateString('sk-SK', { day: 'numeric', month: 'numeric' });
}
const fmtT = (t) => { const x = Math.max(0, Math.round(Number(t) || 0)); return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`; };
const mmss = (s) => s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

async function renderHome() {
  const items = await db.list();
  const last = items[0];
  // posledný výsledok + jedna vec na dnes priamo nad tlačidlom
  const tip = last ? todayOf(last.result || {}) : null;
  const lastName = last ? (last.result?.exercise?.name || last.exercise?.name || 'Cvik') : '';
  $('lastTip').innerHTML = last && tip && !tip.good ? `
    <button class="lasttip" id="btnLast" style="appearance:none;width:100%;text-align:left;color:inherit;font:inherit;cursor:pointer">
      <span class="sc" style="color:${scoreColor(last.result?.score)}">${last.result?.score ?? '–'}</span>
      <span><span class="k" style="display:block">POSLEDNE: ${esc(lastName.toUpperCase())}</span><span class="t" style="display:block">Dnes sa sústreď: ${esc(tip.title)}</span></span><span class="ar" aria-hidden="true">›</span>
    </button>` : '';
  if ($('btnLast')) $('btnLast').onclick = () => { location.hash = '#/r/' + last.id; };
  $('btnStart').onclick = () => { location.hash = '#/nova'; };

  $('histWrap').hidden = !items.length;
  $('histCount').textContent = items.length ? `${items.length} ${plural(items.length, 'video', 'videá', 'videí')}` : '';
  $('hist').innerHTML = items.map(it => {
    const s = it.result?.score;
    const name = it.result?.exercise?.name || it.exercise?.name || 'Cvik';
    const exId = it.exercise?.id && it.exercise.id !== 'auto' ? it.exercise.id : (matchExercise(it.result?.exercise?.name)?.id || 'auto');
    return `<div class="vt">
      <button class="open" data-id="${esc(it.id)}" aria-label="Otvoriť rozbor: ${esc(name)}">
        <div class="ph">${it.thumb ? `<img src="${esc(it.thumb)}" alt="" loading="lazy">` : ''}<span class="sc" style="color:${scoreColor(s)}">${s ?? '–'}</span></div>
        <div class="meta"><b>${esc(name)}</b><span>${dayLabel(it.created)}</span></div>
      </button>
      <button class="again" data-ex="${esc(exId)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>Skúsiť znova lepšie</button>
    </div>`;
  }).join('');
  $('hist').querySelectorAll('.vt .open').forEach(b => b.onclick = () => { location.hash = '#/r/' + b.dataset.id; });
  // rovnaký cvik ako na videu, rovno na výber s predvoleným cvikom
  $('hist').querySelectorAll('.vt .again').forEach(b => b.onclick = () => { selectExercise(b.dataset.ex); location.hash = '#/nova'; });
}

// ---------- nové video: výber cviku ----------
// malé ikonky cvikov (postavičky)
const EX_ICON = {
  klik: '<circle cx="4.6" cy="10.4" r="1.7"/><path d="M6.4 11.2 20.5 14.6M8.6 11.7v5.8M2.5 18.5h19"/>',
  'pritah-hrazda': '<path d="M3.5 3h17M9 3l1.5 4.6M15 3l-1.5 4.6"/><circle cx="12" cy="8.2" r="1.7"/><path d="M12 10v5.2M12 15.2l-1.6 5.3M12 15.2l1.6 5.3"/>',
  drep: '<circle cx="8.6" cy="4.2" r="1.7"/><path d="M9.2 6.1 10.8 12l5 .4-.9 6.6M9.7 8.2h6M4 20.5h16.5"/>',
  vypad: '<circle cx="12" cy="3.6" r="1.7"/><path d="M12 5.5v6M12 11.5l4.4 1.6v5.7M12 11.5l-3 4.3-4 2.8M3 20.5h18"/>',
  'mrtvy-tah': '<circle cx="6.8" cy="6.6" r="1.7"/><path d="M8.5 7.6 15 10.2l-.4 9.3M9.6 8.4l.4 7.2M4 16h12.5"/><circle cx="4.4" cy="16" r="2.2"/><circle cx="16.1" cy="16" r="2.2"/>',
  bench: '<circle cx="4.6" cy="12" r="1.6"/><path d="M6.4 12.6h8.2l3.4 1.2v5M9.4 12.6V6.8M5.5 6.8h8M3 15h16M5 15v4M17 15v4"/>',
  'tlak-nad-hlavu': '<circle cx="12" cy="7.2" r="1.7"/><path d="M12 9v6M12 15l-1.8 5.5M12 15l1.8 5.5M12 10.2 9.2 3.5M12 10.2l2.8-6.7M5 3.2h14"/>',
  'hip-thrust': '<circle cx="4.4" cy="8.4" r="1.6"/><path d="M6 9.6h8.6l3 4v5.4M2.5 11.5h5v8M2.5 20h19"/>',
};
const ICON_AI = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8zM19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9zM5.5 15l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/></svg>';
const ICON_TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';

function renderNew() {
  const on = (id) => id === selected.id;
  const row = (e) => `<button class="ex" data-id="${e.id}" aria-pressed="${on(e.id)}">
      <span class="pic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${EX_ICON[e.id] || ''}</svg></span>
      <span class="nm"><b>${esc(e.name)}</b>${e.hint ? `<span class="s">${esc(e.hint)}</span>` : ''}</span>
      <span class="rd">${on(e.id) ? ICON_TICK : ''}</span></button>`;
  $('chips').innerHTML = `
    <button class="exauto" data-id="auto" aria-pressed="${on('auto')}">
      <span class="ai">${ICON_AI}</span>
      <span style="flex:1"><b>Rozpoznať automaticky</b><span class="s">AI zistí cvik sama z videa</span></span>
      <span class="rd">${on('auto') ? ICON_TICK : ''}</span>
    </button>
    ${GROUPS.map(g => {
      const list = EXERCISES.filter(e => e.group === g.id);
      return list.length ? `<div class="exgroup">${esc(g.name)}</div><div class="excard">${list.map(row).join('')}</div>` : '';
    }).join('')}`;
  $('chips').querySelectorAll('[data-id]').forEach(c => c.onclick = () => { selectExercise(c.dataset.id); renderNew(); });
  $('guideText').textContent = selected.camera;
}

for (const id of ['inCam', 'inFile']) {
  $(id).addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) startAnalysis(f);
  });
}


// ---------- nahrávanie s odpočtom ----------
const recorder = new Recorder($('recVideo'), {
  onState: (st, n) => {
    $('recCd').hidden = st !== 'countdown';
    if (st === 'countdown') $('recCdNum').textContent = n;
    $('recBadge').hidden = st !== 'recording';
    $('btnRecStart').hidden = st !== 'ready';
    $('btnRecStop').hidden = st !== 'recording';
    $('btnRecCancel').hidden = st !== 'countdown';
    $('btnFlip').hidden = st !== 'ready';
    $('recHint').textContent = st === 'recording' ? `Cvič. Nahrávanie sa zastaví samo po ${MAX_SECONDS} s.`
      : st === 'countdown' ? 'Zaujmi polohu…' : 'Polož mobil, zaujmi polohu. Po stlačení máš 5 sekúnd.';
  },
  onTick: (sec, max) => {
    const left = Math.max(0, Math.ceil(max - sec));
    $('recTime').textContent = `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}` + (left <= 5 ? ` · ${left}` : '');
  },
});

$('btnRec').onclick = () => {
  if (!recorderSupported()) { $('inCam').click(); return; } // starší prehliadač: systémová kamera
  location.hash = '#/nahravanie';
};

async function openRecorder() {
  try { await recorder.open(); preload(); }
  catch (e) {
    console.error(e);
    // bez povolenia kamery → systémová kamera mobilu
    location.hash = '#/nova';
    setTimeout(() => $('inCam').click(), 50);
  }
}
$('btnFlip').onclick = () => recorder.flip().catch(() => {});
$('btnRecStart').onclick = async () => {
  try {
    const file = await recorder.start({ countdown: 5, maxSeconds: MAX_SECONDS });
    recorder.close();
    startAnalysis(file);
  } catch (e) { if (e) console.error(e); }
};
$('btnRecStop').onclick = () => recorder.stop();
$('btnRecCancel').onclick = () => recorder.cancel();

// ---------- spracovanie ----------
function setProgress(p, text) {
  $('bar').style.width = Math.round(p * 100) + '%';
  if (text) $('workStatus').textContent = text;
}
function showError(msg, needCode = false) {
  $('workErr').hidden = false; $('workErrText').textContent = msg;
  $('codeBox').hidden = !needCode;
  if (needCode) $('codeInput').value = ls.get('vt-code') || '';
}

async function startAnalysis(file) {
  pendingFile = file;
  current = { id: String(Date.now()), created: Date.now(), exercise: { id: selected.id, name: selected.name, en: selected.en }, signal: selected.signal };
  $('workErr').hidden = true; $('workTitle').textContent = 'Analyzujem…';
  const vid = $('workVideo');
  if (vid.src) URL.revokeObjectURL(vid.src);
  vid.src = URL.createObjectURL(file); vid.hidden = false;
  vid.play().catch(() => {});
  location.hash = '#/praca'; show('vWork');
  setProgress(0, 'Overujem prístup…');
  // kód overíme hneď, nie až po minútovej analýze videa
  if (await accessDenied()) {
    showError('Táto appka je chránená prístupovým kódom. Zadaj ho a pokračuj.', true);
    current = null;
    return;
  }
  setProgress(0, 'Pripravujem…');
  try {
    const { summary, keyframes, thumb, clip } = await analyzeVideo(file, { signal: selected.signal, posture: selected.posture ?? null, minAmp: selected.minAmp ?? 25, start: selected.start ?? null, onProgress: (p, t) => setProgress(p * 0.5, t) });
    Object.assign(current, { summary, keyframes, thumb, clip });
    if (summary.video.duration_s > MAX_SECONDS) setProgress(0.5, `Video je dlhšie ako ${MAX_SECONDS} s, analyzujem prvých ${MAX_SECONDS} s.`);
  } catch (e) {
    console.error(e);
    showError(e.message || 'Analýza videa zlyhala.');
    current = null;
    return;
  }
  await runAi();
}

// true = server chce kód a ten uložený nesedí; pri výpadku siete pokračujeme (chyba príde neskôr)
async function accessDenied() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch('/api/analyze', { headers: { 'x-access-code': ls.get('vt-code') || '' }, cache: 'no-store', signal: ctrl.signal });
    clearTimeout(t);
    return res.status === 401;
  } catch { return false; }
}

async function runAi() {
  $('workErr').hidden = true;
  setProgress(0.55, 'AI hľadá správnu techniku a vyhodnocuje tvoj pohyb… (zvyčajne 20–60 s)');
  let fake = 0.55;
  const tick = setInterval(() => { fake = Math.min(0.95, fake + 0.01); setProgress(fake); }, 700);
  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(), 150_000); // poistka, aby appka nevisela donekonečna
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-access-code': ls.get('vt-code') || '' },
      body: JSON.stringify({ exercise: current.exercise, summary: current.summary, keyframes: current.keyframes }),
    });
    const data = await res.json().catch(() => ({ error: `Server vrátil chybu (HTTP ${res.status}).` }));
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`); err.code = data.code; throw err;
    }
    current.result = data.result; current.sources = data.sources || [];
    await db.save(current);
    db.pruneClips(15);
    setProgress(1, 'Hotovo');
    location.hash = '#/r/' + current.id;
  } catch (e) {
    console.error(e);
    const msg = e.code === 'auth' ? 'Táto appka je chránená prístupovým kódom.'
      : e.name === 'AbortError' ? 'Server neodpovedal včas. Skontroluj internet a skús to znova (video netreba nahrávať znova).'
      : (e.message || 'Spojenie so serverom zlyhalo.');
    showError(msg, e.code === 'auth');
  } finally { clearInterval(tick); clearTimeout(killer); }
}

$('btnRetry').onclick = () => {
  if (!$('codeBox').hidden) ls.set('vt-code', $('codeInput').value.trim());
  $('workErr').hidden = true;
  if (current && current.summary) { location.hash = '#/praca'; runAi(); }
  else if (pendingFile) startAnalysis(pendingFile);
};
$('btnBack').onclick = () => { location.hash = '#/nova'; };

// ---------- výsledok ----------
function scoreColor(s) {
  if (s == null) return 'var(--mu)';
  return s >= 80 ? 'var(--ok)' : s >= 55 ? 'var(--warn)' : 'var(--bad)';
}
const plural = (n, one, few, many) => n === 1 ? one : (n >= 2 && n <= 4) ? few : many;
const ckList = (arr, cls = '') => Array.isArray(arr) && arr.length ? `<ul class="ck ${cls}">${arr.map(x => `<li><span>${esc(x)}</span></li>`).join('')}</ul>` : '<p class="mu small" style="margin:0">—</p>';
const sevOrder = { 'vysoká': 0, 'stredná': 1, 'nízka': 2 };

// "Jedna vec na dnes": z poľa today od AI, inak z prvého kroku k 100 bodom alebo najväčšej chyby
function todayOf(r) {
  const steps = (Array.isArray(r.to_100) ? r.to_100 : []).filter(x => x && x.step).sort((a, b) => (Number(b.gain) || 0) - (Number(a.gain) || 0));
  const issues = (Array.isArray(r.issues) ? r.issues : []).slice().sort((a, b) => (sevOrder[a.severity] ?? 1) - (sevOrder[b.severity] ?? 1));
  if (r.today && r.today.title) return { title: r.today.title, detail: r.today.detail || issues[0]?.fix || '', gain: Number(r.today.gain) || Number(steps[0]?.gain) || 0, frame: r.today.frame };
  if (steps.length) return { title: steps[0].step, detail: issues[0]?.detail || '', gain: Number(steps[0].gain) || 0 };
  if (issues.length) return { title: issues[0].title, detail: issues[0].fix || issues[0].detail || '', gain: 0 };
  if (typeof r.score === 'number') return { good: true, title: 'Drž túto techniku', detail: (Array.isArray(r.good) && r.good[0]) || 'Nič podstatné na opravu.', gain: 0 };
  return null;
}

// snímka, na ktorej je chyba najlepšie vidieť
function focusFrame(item, today) {
  const kf = item.keyframes || [];
  if (!kf.length) return null;
  const n = Number(today?.frame);
  if (n >= 1 && n <= kf.length) return kf[n - 1];
  return kf.find(k => /najmenší rozsah/.test(k.label) && /krajná/.test(k.label))
    || [...kf].reverse().find(k => /krajná poloha/.test(k.label)) || kf[Math.floor(kf.length / 2)];
}

function openViewer(k) {
  $('viewerImg').src = k.dataUrl;
  $('viewerCap').innerHTML = `${esc(k.label)}<span>${fmtT(k.t)} vo videu · oranžová = rozpoznaná kostra</span>`;
  $('viewer').hidden = false;
}
function closeViewer() { $('viewer').hidden = true; }
$('btnViewerClose').onclick = closeViewer;
$('viewer').addEventListener('click', (e) => { if (e.target === $('viewer')) closeViewer(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('viewer').hidden) closeViewer(); });

// ---------- prehrávač videa analýzy (snímky + kostra) ----------
const JOINT_PTS = { knee: [25, 26], hip: [23, 24], elbow: [13, 14], shoulder: [11, 12] };
const JOINT_SK = { knee: 'koleno', hip: 'bok', elbow: 'lakeť', shoulder: 'rameno' };
const P = { clip: null, urls: [], imgs: [], t: 0, playing: false, speed: 1, raf: 0, last: 0, cur: -1 };

function openPlayer(clip, jumpT) {
  closePlayer();
  Object.assign(P, { clip, urls: clip.frames.map(f => URL.createObjectURL(f.img)), imgs: [], t: 0, playing: false, speed: 1, cur: -1 });
  const c = $('pCanvas');
  c.width = clip.w * 2; c.height = clip.h * 2;
  c.style.aspectRatio = `${clip.w} / ${clip.h}`;
  $('pSpeed').textContent = '1×';
  if (jumpT != null && jumpT <= clip.duration) {
    $('pMark').hidden = false; $('pMark').style.left = `${(100 * jumpT / clip.duration).toFixed(2)}%`;
    $('pJump').hidden = false; $('pJump').textContent = `Skočiť na chybu (${fmtT(jumpT)})`;
    $('pJump').onclick = () => { pause(); seekTo(Math.max(0, jumpT - 0.6)); P.speed = 0.5; $('pSpeed').textContent = '½×'; play(); };
  } else { $('pMark').hidden = true; $('pJump').hidden = true; }
  $('player').hidden = false;
  seekTo(0);
  play();
}
function closePlayer() {
  if (!P.clip) return;
  pause();
  P.urls.forEach(u => URL.revokeObjectURL(u));
  Object.assign(P, { clip: null, urls: [], imgs: [] });
  $('player').hidden = true;
}
function getImg(i) {
  if (!P.imgs[i] && P.urls[i]) { const im = new Image(); im.decoding = 'async'; im.src = P.urls[i]; P.imgs[i] = im; }
  return P.imgs[i];
}
function idxAt(t) {
  const fr = P.clip.frames;
  let i = Math.min(fr.length - 1, Math.max(0, Math.round(t * P.clip.fps)));
  while (i > 0 && fr[i].t > t) i--;
  while (i < fr.length - 1 && fr[i + 1].t <= t) i++;
  return i;
}
function drawFrame(i) {
  const clip = P.clip, f = clip.frames[i], im = getImg(i);
  for (let k = 1; k <= 6; k++) getImg(i + k); // prednačítanie
  if (!im || !im.complete || !im.naturalWidth) { if (im) im.onload = () => { if (P.clip && P.cur === i) drawFrame(i); }; return; }
  const c = $('pCanvas'), g = c.getContext('2d'), W = c.width, H = c.height;
  g.drawImage(im, 0, 0, W, H);
  if (f.lm) {
    const pt = {}; CLIP_PTS.forEach((id, k) => { pt[id] = f.lm[k]; });
    const vis = (id) => pt[id] && pt[id][2] >= 0.3;
    g.lineCap = 'round'; g.lineWidth = Math.max(3, W / 120); g.strokeStyle = 'rgba(255,122,61,.95)';
    for (const [a, b] of CLIP_BONES) {
      if (!vis(a) || !vis(b)) continue;
      g.beginPath(); g.moveTo(pt[a][0] * W, pt[a][1] * H); g.lineTo(pt[b][0] * W, pt[b][1] * H); g.stroke();
    }
    g.fillStyle = '#fff';
    for (const id of CLIP_PTS) {
      if (!vis(id) || id === 0) continue;
      g.beginPath(); g.arc(pt[id][0] * W, pt[id][1] * H, g.lineWidth * 1.15, 0, Math.PI * 2); g.fill();
    }
    // hlavný kĺb: krúžok + uhol
    const jid = JOINT_PTS[clip.joint]?.[clip.side === 'L' ? 0 : 1];
    if (jid != null && vis(jid)) {
      const x = pt[jid][0] * W, y = pt[jid][1] * H, r = g.lineWidth * 4;
      g.lineWidth = Math.max(3, W / 140); g.strokeStyle = '#fff';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
      if (f.a != null) {
        const txt = `${JOINT_SK[clip.joint] || ''} ${f.a}°`.trim();
        g.font = `800 ${Math.round(W / 16)}px Barlow, system-ui, sans-serif`;
        const tw = g.measureText(txt).width, ph = W / 12, px = Math.min(W - tw - ph * 0.8, x + r + 8), py = Math.max(ph, y - r - 8);
        g.fillStyle = 'rgba(0,0,0,.72)';
        g.beginPath(); g.roundRect ? g.roundRect(px - ph * 0.35, py - ph * 0.8, tw + ph * 0.7, ph, ph / 2) : g.rect(px - ph * 0.35, py - ph * 0.8, tw + ph * 0.7, ph); g.fill();
        g.fillStyle = '#fff'; g.fillText(txt, px, py - ph * 0.08);
      }
    }
  }
  // počítadlo opakovaní
  const reps = clip.reps || [], t = f.t;
  const k = reps.findIndex(r => t >= r.s && t <= r.e);
  const done = reps.filter(r => r.e < t).length;
  const label = k >= 0 ? `Opakovanie ${k + 1} / ${reps.length}` : reps.length && done === reps.length ? `Hotovo · ${reps.length} opak.` : reps.length ? (done ? `Opakovanie ${done} / ${reps.length}` : 'Príprava') : '';
  if (label) {
    g.font = `800 ${Math.round(W / 15)}px Barlow, system-ui, sans-serif`;
    const tw = g.measureText(label).width, ph = W / 10.5;
    g.fillStyle = 'rgba(0,0,0,.65)';
    g.beginPath(); g.roundRect ? g.roundRect(W / 30, W / 30, tw + ph * 0.8, ph, ph / 2) : g.rect(W / 30, W / 30, tw + ph * 0.8, ph); g.fill();
    g.fillStyle = '#fff'; g.fillText(label, W / 30 + ph * 0.4, W / 30 + ph * 0.68);
  }
}
function seekTo(t) {
  P.t = Math.max(0, Math.min(P.clip.duration, t));
  const i = idxAt(P.t);
  P.cur = i; drawFrame(i);
  $('pRange').value = Math.round(1000 * P.t / (P.clip.duration || 1));
  $('pTime').textContent = fmtT(P.t);
}
function tick(now) {
  if (!P.playing || !P.clip) return;
  const dt = Math.min(0.1, (now - P.last) / 1000); P.last = now;
  let t = P.t + dt * P.speed;
  if (t >= P.clip.duration) { seekTo(P.clip.duration); pause(); return; }
  P.t = t;
  const i = idxAt(t);
  if (i !== P.cur) { P.cur = i; drawFrame(i); }
  $('pRange').value = Math.round(1000 * t / (P.clip.duration || 1));
  $('pTime').textContent = fmtT(t);
  P.raf = requestAnimationFrame(tick);
}
function play() {
  if (!P.clip) return;
  if (P.t >= P.clip.duration - 0.05) seekTo(0);
  P.playing = true; P.last = performance.now();
  $('pIcoPlay').toggleAttribute('hidden', true); $('pIcoPause').toggleAttribute('hidden', false); $('pPlay').setAttribute('aria-label', 'Pozastaviť');
  P.raf = requestAnimationFrame(tick);
}
function pause() {
  P.playing = false; cancelAnimationFrame(P.raf);
  $('pIcoPlay').toggleAttribute('hidden', false); $('pIcoPause').toggleAttribute('hidden', true); $('pPlay').setAttribute('aria-label', 'Prehrať');
}
$('pPlay').onclick = () => (P.playing ? pause() : play());
$('pRange').addEventListener('input', () => { if (!P.clip) return; pause(); seekTo(P.clip.duration * $('pRange').value / 1000); });
$('pSpeed').onclick = () => { P.speed = P.speed === 1 ? 0.5 : P.speed === 0.5 ? 0.25 : 1; $('pSpeed').textContent = P.speed === 1 ? '1×' : P.speed === 0.5 ? '½×' : '¼×'; };
$('btnPlayerClose').onclick = closePlayer;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && P.clip) closePlayer(); });

function renderResult(item) {
  const r = item.result || {};
  const ex = r.exercise || {};
  const score = typeof r.score === 'number' ? Math.max(0, Math.min(100, Math.round(r.score))) : null;
  const mismatch = item.exercise.id !== 'auto' && ex.matches_selected === false;
  const sm = item.summary || {};
  const reps = sm.reps_detected || 0;
  const act = sm.active_segment;
  const dur = act ? Math.max(0, act.end_s - act.start_s) : sm.video?.analyzed_s;
  const view = (sm.camera_view_estimate || '').replace(' alebo zozadu', '').replace(' (asi 45°)', '');
  const issues = (Array.isArray(r.issues) ? r.issues : []).slice().sort((a, b) => (sevOrder[a.severity] ?? 1) - (sevOrder[b.severity] ?? 1));
  const prim = r.muscles?.primary || [], sec = r.muscles?.secondary || [];
  const breakdown = Array.isArray(r.score_breakdown) ? r.score_breakdown : [];
  const to100 = (Array.isArray(r.to_100) ? r.to_100 : []).filter(x => x && x.step).sort((a, b) => (Number(b.gain) || 0) - (Number(a.gain) || 0));
  const missing = score != null ? 100 - score : null;
  const today = todayOf(r);
  const frame = focusFrame(item, today);
  const after = today && today.gain && score != null ? Math.min(100, score + today.gain) : null;
  const hasClip = !!(item.clip && item.clip.frames && item.clip.frames.length);
  const errT = today && !today.good && frame ? Number(frame.t) : null;

  $('vResult').innerHTML = `
    <div class="rmeta">${esc(ex.name || item.exercise.name)}${reps ? ` · ${reps} ${plural(reps, 'opakovanie', 'opakovania', 'opakovaní')}` : ''}</div>
    ${mismatch ? `<div class="card err mismatch"><b>Pozor:</b> AI si myslí, že na videu je iný cvik, než si vybral (${esc(item.exercise.name)}). Ak to nesedí, zmeň cvik v celom rozbore dole.</div>` : ''}
    <div class="bigscore"><span class="n" style="color:${scoreColor(score)}">${score ?? '?'}</span><span class="of">/100</span></div>
    <p class="rverdict">${esc(r.verdict || '')}</p>

    ${today ? `<div class="todaycard${today.good ? ' good' : ''}">
      <div class="k">${today.good ? 'VÝBORNE' : 'JEDNA VEC NA DNES'}</div>
      <div class="t">${esc(today.title)}</div>
      ${today.detail ? `<div class="d">${esc(today.detail)}</div>` : ''}
      ${after ? `<div class="g">Oprav to a máš ${after} bodov.</div>` : ''}
    </div>` : ''}

    ${hasClip ? `<button class="seeframe" id="btnSee">
      <span class="th">${frame ? `<img src="${frame.dataUrl}" alt="">` : ''}<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></span>
      <span style="flex:1"><b>Pozri si video analýzy</b><span>Kostra a body, ktoré appka sledovala${errT != null ? ` · chyba v ${fmtT(errT)}` : ''}</span></span>
    </button>` : frame ? `<button class="seeframe" id="btnSee">
      <span class="th"><img src="${frame.dataUrl}" alt=""><svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></span>
      <span style="flex:1"><b>${today && !today.good ? 'Pozri, kde sa to stalo' : 'Pozri si snímku'}</b><span>${esc(frame.label)} · ${fmtT(frame.t)}</span></span>
    </button>` : ''}

    <button class="linkbtn" id="btnFull" aria-expanded="false">Zobraziť celý rozbor</button>

    <div class="full" id="full" hidden>
      <div class="stats">
        <div class="stat"><b>${reps || '–'}</b><span>${plural(reps, 'opakovanie', 'opakovania', 'opakovaní')}</span></div>
        <div class="stat"><b>${dur != null ? Math.round(dur) + ' s' : '–'}</b><span>dĺžka série</span></div>
        <div class="stat"><b style="font-size:17px;line-height:29px">${esc(view || '–')}</b><span>pohľad kamery</span></div>
      </div>
      ${r.summary ? `<p class="sum">${esc(r.summary)}</p>` : ''}

      ${score != null && (breakdown.length || to100.length) ? `
      <div class="card">
        <div class="sec"><div class="ic acc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg></div><h2>Cesta k 100 bodom</h2>${missing ? `<span class="cnt">chýba ${missing} b.</span>` : ''}</div>
        ${breakdown.length ? `<div class="bd">${breakdown.map(b => {
          const max = Number(b.max) || 20, pts = Math.max(0, Math.min(max, Number(b.points) || 0));
          return `<div><div class="bdt"><span>${esc(b.area)}</span><b>${pts}/${max}</b></div>
            <div class="bdbar"><div style="width:${Math.round(100 * pts / max)}%;background:${scoreColor(100 * pts / max)}"></div></div>
            ${b.note ? `<div class="bdn">${esc(b.note)}</div>` : ''}</div>`;
        }).join('')}</div>` : ''}
        ${to100.length ? `<p class="small mu" style="margin:14px 0 4px">Čo zmeniť, aby si mal 100 bodov:</p>
          <ol class="t100">${to100.map(x => `<li><span>${esc(x.step)}</span>${Number(x.gain) ? `<b>+${Math.round(Number(x.gain))}</b>` : ''}</li>`).join('')}</ol>` : ''}
      </div>` : ''}

      <div class="card">
        <div class="sec"><div class="ic warn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 20V10M18 20V4M6 20v-4"/></svg></div><h2>Čo zlepšiť</h2><span class="cnt">${issues.length || ''}</span></div>
        ${issues.length ? issues.map((i, k) => `
          <div class="iss ${esc(i.severity || '')}">
            <div class="n">${k + 1}</div>
            <div class="tt">${esc(i.title)}${i.severity ? `<span class="sev">${esc(i.severity)}</span>` : ''}</div>
            ${i.detail ? `<div class="dt">${esc(i.detail)}</div>` : ''}
            ${i.fix ? `<div class="fx"><b>Ako na to:</b> ${esc(i.fix)}</div>` : ''}
          </div>`).join('') : '<p class="mu" style="margin:0">Žiadne podstatné chyby. Výborne!</p>'}
      </div>

      <div class="card">
        <div class="sec"><div class="ic ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div><h2>Čo robíš dobre</h2></div>
        ${ckList(r.good)}
      </div>

      <div class="card">
        <div class="sec"><div class="ic bad"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/></svg></div><h2>Na čo si dávať pozor</h2></div>
        ${ckList(r.watch_out, 'w')}
      </div>

      ${prim.length || sec.length ? `<div class="card">
        <div class="sec"><div class="ic acc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5h11M6.5 17.5h11M4 9v6M20 9v6M2 11v2M22 11v2"/></svg></div><h2>Zapojené svaly</h2></div>
        ${prim.length ? `<div class="mrow"><span>Hlavné</span><div class="muscles">${prim.map(m => `<span class="tag p">${esc(m)}</span>`).join('')}</div></div>` : ''}
        ${sec.length ? `<div class="mrow" style="margin:0"><span>Pomocné</span><div class="muscles">${sec.map(m => `<span class="tag">${esc(m)}</span>`).join('')}</div></div>` : ''}
      </div>` : ''}

      <details class="card">
        <summary>Správna technika</summary>
        ${r.description ? `<p style="font-size:16px">${esc(r.description)}</p>` : ''}
        ${Array.isArray(r.cues) && r.cues.length ? `<p class="small mu" style="margin-bottom:4px">Pokyny na zapamätanie</p>${ckList(r.cues, 'c')}` : ''}
      </details>

      ${r.camera_limits ? `<details class="card"><summary>Uhol kamery</summary><p style="margin:0;font-size:16px">${esc(r.camera_limits)}</p></details>` : ''}

      ${item.keyframes?.length ? `<details class="card"><summary>Snímky z videa</summary><div class="frames">${item.keyframes.map((k, i) => `<button data-k="${i}"><img src="${k.dataUrl}" alt=""><span>${esc(k.label)} · ${fmtT(k.t)}</span></button>`).join('')}</div></details>` : ''}

      <div class="card"><h2 style="margin-bottom:6px">Iný cvik?</h2>
        <p class="small mu">Ak AI rozpoznala cvik zle, vyber správny a rozbor sa zopakuje.</p>
        <div class="row"><select id="reEx" aria-label="Cvik">${EXERCISES.map(e => `<option value="${e.id}"${e.id === (matchExercise(ex.name)?.id || item.exercise.id) ? ' selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
        <button class="btn sec" id="btnRe" style="flex:0 0 auto;width:auto;padding:13px 16px;font-size:16px">Zopakovať</button></div>
      </div>
      <button class="btn ghost" id="btnDel" style="margin:4px auto 0;display:block;color:var(--mu)">Vymazať z histórie</button>
    </div>

    <div class="stickybar"><button class="btn pri" id="btnAgain">${today && !today.good ? 'Skúsiť to opraviť' : 'Natočiť ďalšiu sériu'}</button></div>
  `;

  if ($('btnSee')) $('btnSee').onclick = () => hasClip ? openPlayer(item.clip, errT) : openViewer(frame);
  $('vResult').querySelectorAll('.frames button').forEach(b => b.onclick = () => openViewer(item.keyframes[Number(b.dataset.k)]));
  $('btnFull').onclick = () => {
    const open = $('full').hidden;
    $('full').hidden = !open;
    $('btnFull').textContent = open ? 'Skryť celý rozbor' : 'Zobraziť celý rozbor';
    $('btnFull').setAttribute('aria-expanded', String(open));
  };
  $('btnAgain').onclick = () => {
    const exId = item.exercise.id !== 'auto' ? item.exercise.id : (matchExercise(ex.name)?.id || 'auto');
    selectExercise(exId);
    location.hash = '#/nova';
  };
  $('btnDel').onclick = async () => { await db.remove(item.id); location.hash = '#/'; };
  $('btnRe').onclick = () => {
    const e = findExercise($('reEx').value);
    current = { ...item, id: String(Date.now()), created: Date.now(), exercise: { id: e.id, name: e.name, en: e.en }, result: null };
    $('workTitle').textContent = 'Opakujem rozbor…';
    $('workVideo').removeAttribute('src'); $('workVideo').hidden = true;
    location.hash = '#/praca'; show('vWork'); runAi();
  };
}

// ---------- štart ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
route();
