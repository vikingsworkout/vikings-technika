import { EXERCISES, AUTO, findExercise, matchExercise } from './exercises.js';
import { analyzeVideo, preload, MAX_SECONDS } from './pose.js';
import * as db from './db.js';
import { Recorder, recorderSupported } from './recorder.js';

const $ = (id) => document.getElementById(id);
const views = ['vHome', 'vNew', 'vRec', 'vWork', 'vResult'];
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* nič */ } },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let selected = findExercise(ls.get('vt-ex')) || AUTO;
let current = null;        // práve spracovávaná analýza
let pendingFile = null;    // video, ktoré sa analyzuje (pre "skúsiť znova")

function show(view) {
  if (view !== 'vRec') recorder.close();
  views.forEach(v => { $(v).hidden = v !== view; });
  $('btnHome').hidden = view === 'vHome';
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
$('btnHome').onclick = () => { location.hash = '#/'; };
$('btnNew').onclick = () => { location.hash = '#/nova'; };

// ---------- domov ----------
async function renderHome() {
  const items = await db.list();
  const box = $('hist');
  if (!items.length) { box.innerHTML = '<div class="empty">Zatiaľ žiadne analýzy. Začni tlačidlom vyššie.</div>'; return; }
  box.innerHTML = items.map(it => `
    <button class="hitem" data-id="${esc(it.id)}">
      <img src="${esc(it.thumb || '')}" alt="">
      <div><div class="t">${esc(it.result?.exercise?.name || it.exercise?.name || 'Cvik')}</div>
      <div class="d">${new Date(it.created).toLocaleString('sk-SK', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</div></div>
      <div class="sc" style="color:${scoreColor(it.result?.score)};border-color:color-mix(in srgb, ${scoreColor(it.result?.score)} 40%, transparent)">${it.result?.score ?? '–'}</div>
    </button>`).join('');
  box.querySelectorAll('.hitem').forEach(b => b.onclick = () => { location.hash = '#/r/' + b.dataset.id; });
}

// ---------- výber cviku ----------
function renderNew() {
  const all = [AUTO, ...EXERCISES];
  $('chips').innerHTML = all.map(e => `<button class="chip${e.id === 'auto' ? ' auto' : ''}" data-id="${e.id}" aria-pressed="${e.id === selected.id}">${e.id === 'auto' ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8zM19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9z"/></svg>' : ''}${esc(e.name)}</button>`).join('');
  $('chips').querySelectorAll('.chip').forEach(c => c.onclick = () => {
    selected = findExercise(c.dataset.id); ls.set('vt-ex', selected.id); renderNew();
  });
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
    const { summary, keyframes, thumb } = await analyzeVideo(file, { signal: selected.signal, posture: selected.posture ?? null, minAmp: selected.minAmp ?? 25, onProgress: (p, t) => setProgress(p * 0.5, t) });
    Object.assign(current, { summary, keyframes, thumb });
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
function scoreLabel(s) {
  if (s == null) return 'Nedá sa posúdiť';
  return s >= 85 ? 'Výborná technika' : s >= 70 ? 'Dobrá technika' : s >= 55 ? 'Treba doladiť' : 'Treba opraviť';
}
const plural = (n, one, few, many) => n === 1 ? one : (n >= 2 && n <= 4) ? few : many;
const ckList = (arr, cls = '') => Array.isArray(arr) && arr.length ? `<ul class="ck ${cls}">${arr.map(x => `<li><span>${esc(x)}</span></li>`).join('')}</ul>` : '<p class="mu small" style="margin:0">—</p>';
const sevOrder = { 'vysoká': 0, 'stredná': 1, 'nízka': 2 };

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

  $('vResult').innerHTML = `
    ${mismatch ? `<div class="card err small"><b>Pozor:</b> AI si myslí, že na videu je iný cvik, než si vybral (${esc(item.exercise.name)}). Ak to nesedí, zmeň cvik dole.</div>` : ''}
    <div class="card hero" style="--c:${scoreColor(score)}">
      <p class="exname">${esc(ex.name || item.exercise.name)}</p>
      <div class="exmeta">${item.exercise.id === 'auto' ? `Rozpoznané AI${ex.confidence ? ` · istota ${esc(ex.confidence)}` : ''}` : 'Vybraný cvik'} · ${new Date(item.created).toLocaleString('sk-SK', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
      <div class="scorerow">
        <div class="ring" style="--p:${score ?? 0};--c:${scoreColor(score)}"><div>${score ?? '?'}</div></div>
        <div><div class="slabel" style="color:${scoreColor(score)}">${scoreLabel(score)}</div><p class="verdict">${esc(r.verdict || '')}</p></div>
      </div>
      <div class="stats">
        <div class="stat"><b>${reps || '–'}</b><span>${plural(reps, 'opakovanie', 'opakovania', 'opakovaní')}</span></div>
        <div class="stat"><b>${dur != null ? Math.round(dur) + ' s' : '–'}</b><span>dĺžka série</span></div>
        <div class="stat"><b style="font-size:15px;line-height:22px">${esc(view || '–')}</b><span>pohľad kamery</span></div>
      </div>
      ${r.summary ? `<p class="sum">${esc(r.summary)}</p>` : ''}
    </div>

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

    <div class="card">
      <div class="sec"><div class="ic acc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5h11M6.5 17.5h11M4 9v6M20 9v6M2 11v2M22 11v2"/></svg></div><h2>Zapojené svaly</h2></div>
      ${prim.length ? `<div class="mrow"><span>Hlavné</span><div class="muscles">${prim.map(m => `<span class="tag p">${esc(m)}</span>`).join('')}</div></div>` : ''}
      ${sec.length ? `<div class="mrow" style="margin:0"><span>Pomocné</span><div class="muscles">${sec.map(m => `<span class="tag">${esc(m)}</span>`).join('')}</div></div>` : ''}
    </div>

    <details class="card">
      <summary><div class="ic mu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/></svg></div>Správna technika</summary>
      ${r.description ? `<p style="font-size:15px">${esc(r.description)}</p>` : ''}
      ${Array.isArray(r.cues) && r.cues.length ? `<p class="small mu" style="margin-bottom:4px">Pokyny na zapamätanie</p>${ckList(r.cues, 'c')}` : ''}
    </details>

    ${r.camera_limits ? `<details class="card"><summary><div class="ic mu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg></div>Uhol kamery</summary><p style="margin:0;font-size:15px">${esc(r.camera_limits)}</p></details>` : ''}

    ${item.keyframes?.length ? `<details class="card"><summary><div class="ic mu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>Analyzované snímky</summary><div class="frames">${item.keyframes.map(k => `<figure><img src="${k.dataUrl}" alt=""><figcaption>${esc(k.label)} · ${k.t} s</figcaption></figure>`).join('')}</div></details>` : ''}

    <div class="card"><div class="sec"><div class="ic mu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/></svg></div><h2>Iný cvik?</h2></div>
      <p class="small mu">Ak AI rozpoznala cvik zle, vyber správny a rozbor sa zopakuje.</p>
      <div class="row"><select id="reEx">${EXERCISES.map(e => `<option value="${e.id}"${e.id === (matchExercise(ex.name)?.id || item.exercise.id) ? ' selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
      <button class="btn sec" id="btnRe" style="flex:0 0 auto;width:auto">Zopakovať</button></div>
    </div>
    <button class="btn pri" id="btnAgain" style="margin-top:6px">Nová analýza</button>
    <button class="btn ghost" id="btnDel" style="margin:10px auto 0;display:block">Vymazať z histórie</button>
  `;
  $('btnAgain').onclick = () => { location.hash = '#/nova'; };
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
