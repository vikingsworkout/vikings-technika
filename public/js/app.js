import { EXERCISES, AUTO, findExercise, matchExercise } from './exercises.js';
import { analyzeVideo, preload, MAX_SECONDS } from './pose.js';
import * as db from './db.js';

const $ = (id) => document.getElementById(id);
const views = ['vHome', 'vNew', 'vWork', 'vResult'];
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* nič */ } },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let selected = findExercise(ls.get('vt-ex')) || AUTO;
let current = null;        // práve spracovávaná analýza
let pendingFile = null;    // video, ktoré sa analyzuje (pre "skúsiť znova")

function show(view) {
  views.forEach(v => { $(v).hidden = v !== view; });
  $('btnHome').hidden = view === 'vHome';
  window.scrollTo(0, 0);
}

// ---------- smerovanie ----------
async function route() {
  const h = location.hash;
  if (h === '#/nova') { renderNew(); show('vNew'); preload(); return; }
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
      <div class="sc" style="color:${scoreColor(it.result?.score)}">${it.result?.score ?? '–'}</div>
    </button>`).join('');
  box.querySelectorAll('.hitem').forEach(b => b.onclick = () => { location.hash = '#/r/' + b.dataset.id; });
}

// ---------- výber cviku ----------
function renderNew() {
  const all = [AUTO, ...EXERCISES];
  $('chips').innerHTML = all.map(e => `<button class="chip${e.id === 'auto' ? ' auto' : ''}" data-id="${e.id}" aria-pressed="${e.id === selected.id}">${e.id === 'auto' ? '✨ ' : ''}${esc(e.name)}</button>`).join('');
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
  setProgress(0, 'Pripravujem…');
  try {
    const { summary, keyframes, thumb } = await analyzeVideo(file, { signal: selected.signal, onProgress: (p, t) => setProgress(p * 0.5, t) });
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

async function runAi() {
  $('workErr').hidden = true;
  setProgress(0.55, 'AI hľadá správnu techniku a vyhodnocuje tvoj pohyb… (zvyčajne 20–60 s)');
  let fake = 0.55;
  const tick = setInterval(() => { fake = Math.min(0.95, fake + 0.01); setProgress(fake); }, 700);
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
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
    showError(e.code === 'auth' ? 'Táto appka je chránená prístupovým kódom.' : (e.message || 'Spojenie so serverom zlyhalo.'), e.code === 'auth');
  } finally { clearInterval(tick); }
}

$('btnRetry').onclick = () => {
  if (!$('codeBox').hidden) ls.set('vt-code', $('codeInput').value.trim());
  if (current && current.summary) { location.hash = '#/praca'; runAi(); }
  else if (pendingFile) startAnalysis(pendingFile);
};
$('btnBack').onclick = () => { location.hash = '#/nova'; };

// ---------- výsledok ----------
function scoreColor(s) {
  if (s == null) return 'var(--mu)';
  return s >= 80 ? 'var(--ok)' : s >= 55 ? 'var(--warn)' : 'var(--bad)';
}
const list = (arr, cls = '') => Array.isArray(arr) && arr.length ? `<ul class="list ${cls}">${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="mu small">—</p>';

function renderResult(item) {
  const r = item.result || {};
  const ex = r.exercise || {};
  const score = typeof r.score === 'number' ? Math.max(0, Math.min(100, Math.round(r.score))) : null;
  const mismatch = item.exercise.id !== 'auto' && ex.matches_selected === false;
  const reps = item.summary?.reps_detected;
  const issues = Array.isArray(r.issues) ? r.issues : [];

  $('vResult').innerHTML = `
    <div class="exline">
      <span class="tag">🏋️ ${esc(ex.name || item.exercise.name)}</span>
      ${item.exercise.id === 'auto' ? `<span class="tag">rozpoznané AI${ex.confidence ? ` · istota ${esc(ex.confidence)}` : ''}</span>` : ''}
      ${reps ? `<span class="tag">${reps}× opakovanie</span>` : ''}
    </div>
    ${mismatch ? `<div class="card err small"><b>Pozor:</b> AI si myslí, že na videu je iný cvik, než si vybral (${esc(item.exercise.name)}). Skontroluj a prípadne zmeň cvik nižšie.</div>` : ''}
    <div class="card">
      <div class="scorebox">
        <div class="ring" style="--p:${score ?? 0};--c:${scoreColor(score)}"><div>${score ?? '?'}</div></div>
        <div><p class="verdict">${esc(r.verdict || '')}</p><p class="mu small" style="margin:0">Hodnotenie techniky 0–100</p></div>
      </div>
      ${r.summary ? `<p style="margin:14px 0 0">${esc(r.summary)}</p>` : ''}
    </div>

    <div class="card"><h3>Čo zlepšiť</h3>
      ${issues.length ? issues.map(i => `<div class="issue ${esc(i.severity || '')}"><b>${esc(i.title)}</b><p>${esc(i.detail)}</p>${i.fix ? `<p class="fix">→ ${esc(i.fix)}</p>` : ''}</div>`).join('') : '<p class="mu">Žiadne podstatné chyby. Výborne!</p>'}
    </div>
    <div class="card"><h3>Čo robíš dobre</h3>${list(r.good, 'good')}</div>
    <div class="card"><h3>Na čo si dávať pozor</h3>${list(r.watch_out, 'warn')}</div>
    <div class="card"><h3>Zapojené svaly</h3>
      <div class="muscles">${(r.muscles?.primary || []).map(m => `<span class="tag p">${esc(m)}</span>`).join('')}${(r.muscles?.secondary || []).map(m => `<span class="tag">${esc(m)}</span>`).join('')}</div>
      <p class="mu small" style="margin:10px 0 0">Oranžové sú hlavné svaly, sivé pomocné.</p>
    </div>
    <div class="card"><h3>Správna technika</h3>
      ${r.description ? `<p>${esc(r.description)}</p>` : ''}
      ${Array.isArray(r.cues) && r.cues.length ? `<p class="small mu" style="margin-bottom:6px">Pokyny na zapamätanie:</p>${list(r.cues)}` : ''}
    </div>
    ${r.camera_limits ? `<div class="card"><h3>Uhol kamery</h3><p style="margin:0">${esc(r.camera_limits)}</p></div>` : ''}
    ${item.keyframes?.length ? `<h3 style="margin-top:18px">Analyzované snímky</h3><div class="frames">${item.keyframes.map(k => `<figure><img src="${k.dataUrl}" alt=""><figcaption>${esc(k.label)} · ${k.t} s</figcaption></figure>`).join('')}</div>` : ''}

    <div class="card" style="margin-top:18px"><h3>Iný cvik?</h3>
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
