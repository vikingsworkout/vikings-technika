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
  closeViewer();
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
    return `<button class="vt" data-id="${esc(it.id)}">
      <div class="ph">${it.thumb ? `<img src="${esc(it.thumb)}" alt="" loading="lazy">` : ''}<span class="sc" style="color:${scoreColor(s)}">${s ?? '–'}</span></div>
      <div class="meta"><b>${esc(name)}</b><span>${dayLabel(it.created)}</span></div>
    </button>`;
  }).join('');
  $('hist').querySelectorAll('.vt').forEach(b => b.onclick = () => { location.hash = '#/r/' + b.dataset.id; });
}

// ---------- nové video: výber cviku ----------
function renderNew() {
  const all = [...EXERCISES, AUTO];
  $('chips').innerHTML = all.map(e => {
    const on = e.id === selected.id;
    return `<button class="ex${e.id === 'auto' ? ' auto' : ''}" data-id="${e.id}" aria-pressed="${on}">${e.id === 'auto' ? 'Iný cvik / rozpoznať automaticky' : esc(e.name)}${on ? ICON_CHECK : ''}</button>`;
  }).join('');
  $('chips').querySelectorAll('.ex').forEach(c => c.onclick = () => { selectExercise(c.dataset.id); renderNew(); });
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

    ${frame ? `<button class="seeframe" id="btnSee">
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

  if ($('btnSee')) $('btnSee').onclick = () => openViewer(frame);
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
