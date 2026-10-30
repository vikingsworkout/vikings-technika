import { EXERCISES, AUTO, findExercise, matchExercise, isHold, maxSecondsFor, duelMeasure } from './exercises.js';
import { analyzeVideo, preload, CLIP_PTS, CLIP_BONES, liveLandmarker, detectLive } from './pose.js';
import { createLiveCounter } from './livecount.js';
import * as db from './db.js';
import { Recorder, recorderSupported } from './recorder.js';
import { VW, vwFrom, vwExName, vwResultId, vwResultName, vwResultEid, vwHz, vwToken, vwPost, vwImg, vwBox, vwBoxP, vwDay, vwEmbedded, vwNoMap, vwDuel } from './vw.js';
import { fixResultSk } from './sk.js';
import { IC, frameSvg, NEW_HTML, PICK_HTML, REC_HTML, WORK_HTML, PLAYER_HTML } from './vwui.js';

const $ = (id) => document.getElementById(id);
const on = (id, fn, ev = 'click') => { const el = $(id); if (el) el.addEventListener(ev, fn); };
const hide = (id, h) => { const el = $(id); if (el) el.hidden = h; };
// v appke Viking's Workout: obrazovky podľa návrhu „Technika vo Viking's Workout“
if (VW) {
  $('vNew').innerHTML = NEW_HTML;
  $('vPick').innerHTML = PICK_HTML;
  $('vRec').innerHTML = REC_HTML;
  $('vWork').innerHTML = WORK_HTML;
  $('player').innerHTML = PLAYER_HTML;
  const hd = document.querySelector('header');
  hd.insertBefore($('btnHome'), hd.firstChild);
}
// v appke Viking's Workout meníme obrazovky bez nových záznamov v histórii (Späť v appke zatvorí Techniku)
const go = (h) => { if (VW) location.replace(h); else location.hash = h; };
const views = ['vHome', 'vPick', 'vNew', 'vRec', 'vWork', 'vResult', 'vHist'];
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* nič */ } },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON_CAM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';

const storedEx = findExercise(ls.get('vt-ex'));
let selected = storedEx && !isHold(storedEx) ? storedEx : AUTO; // výdrže rozpozná automatický režim
let current = null;        // práve spracovávaná analýza
let pendingFile = null;    // video, ktoré sa analyzuje (pre "skúsiť znova")
// v appke: čo sa natáča. Názov je z appky (detail cviku, tréning) alebo z výberu cviku; `measure` je cvik, podľa
// ktorého sa meria (výdrže a cviky, ktoré nevieme merať presne, rozpozná automatický režim s názvom ako nápovedou),
// `guide` je cvik, podľa ktorého ukážeme návod na natočenie a čo appka skontroluje.
let vwHint = '';
let pick = null;           // { src: 'app' | 'list' | 'auto', name, eid, img, box, boxp, guide, measure }
function makePick(src, name, { id = null, eid = '', img = '', box = null, boxp = null } = {}) {
  const e = id ? findExercise(id) : (name && !vwNoMap(name) ? matchExercise(name) : null);
  const guide = e && e.id !== 'auto' ? e : null;
  return { src, name, eid, img, box: img ? box : null, boxp: img ? boxp : null, guide, measure: guide && !isHold(guide) ? guide : AUTO };
}
function applyPick(p) {
  pick = p; selected = p.measure;
  vwHint = selected.id === 'auto' && p.src !== 'auto' ? p.name : '';
}
const appPick = VW && vwDuel ? duelPick() : VW && vwExName ? makePick('app', vwExName, { img: vwImg, box: vwBox, boxp: vwBoxP }) : null;
if (appPick) applyPick(appPick);
if (vwDuel) document.documentElement.classList.add('duel');
// Súboj: cvik podľa disciplíny z appky (vlastný cvik podľa názvu); meria sa presne ním (plank ako výdrž), bez rozboru AI
function duelPick() {
  const g = duelMeasure(vwDuel.dx, vwExName);
  return { src: 'app', name: vwExName || g.name, eid: '', img: '', box: null, boxp: null, guide: g, measure: g };
}
// najdlhšie nahrávanie: v Súboji séria do vyčerpania (3 min) alebo dlhá výdrž (5 min)
const maxRec = () => vwDuel ? (isHold(selected) ? 300 : 180) : maxSecondsFor(selected);
const ICON_BACK = IC.back;
const ICON_X = IC.x;
const KICK = (txt) => `<span class="kick">${IC.kick}<span>${esc(txt)}</span></span>`;

function show(view) {
  if (view !== 'vRec') { recorder.close(); liveStop(); }
  if (view !== 'vWork') workLoopStop();
  views.forEach(v => { $(v).hidden = v !== view; });
  $('btnHome').hidden = VW ? false : view === 'vHome';
  if (VW) {
    document.body.dataset.view = view;
    document.documentElement.classList.add('vw-ready'); // až teraz je na obrazovke správny obsah (pozri index.html)
    document.querySelector('header').classList.toggle('hide', view === 'vRec' || view === 'vWork');
    // Výber a Natoč: šípka späť (prvá obrazovka Techniku zatvorí), výsledok: krížik zatvorí Techniku
    const close = view === 'vResult' || view === 'vHome' || view === 'vHist' || (view === 'vPick' && !appPick) || (view === 'vNew' && pick && pick.src === 'app');
    const b = $('btnHome');
    b.dataset.mode = close ? 'close' : 'back';
    const ico = view === 'vResult' || view === 'vHome' || view === 'vHist' ? 'x' : 'back';
    if (b.dataset.ico !== ico) { b.dataset.ico = ico; b.innerHTML = ico === 'x' ? ICON_X : ICON_BACK; }
    b.setAttribute('aria-label', close ? 'Zavrieť Techniku' : 'Späť');
    $('hRight').innerHTML = vwDuel ? KICK('SÚBOJ') : view === 'vNew' ? '<button class="hlink" id="btnOther">Iný cvik</button>' : KICK('TECHNIKA');
    on('btnOther', () => go('#/vyber'));
  }
  $('btnNew').hidden = true; // na domove je hlavné tlačidlo priamo v karte
  closeViewer(); closePlayer();
  window.scrollTo(0, 0);
}

// ---------- smerovanie ----------
async function route() {
  const h = location.hash;
  if (h === '#/suboj' && vwDuel) { if (DUEL) { renderDuel(); show('vResult'); } else go('#/nova'); return; }
  if (h === '#/vyber' && vwDuel) { go('#/nova'); return; }
  if (h === '#/vyber' && VW) { renderPick(); show('vPick'); preloadSoon(); loadQuota(); return; }
  if (h === '#/nova') {
    if (VW && !pick) { go('#/vyber'); return; }
    renderNew(); show('vNew'); if (VW) { layoutShot(); if (!vwDuel) loadQuota(); } preloadSoon(); return;
  }
  if (h === '#/nahravanie') { show('vRec'); openRecorder(); return; }
  if (h.startsWith('#/r/')) {
    const item = (current && current.id === h.slice(4)) ? current : await db.get(h.slice(4));
    if (location.hash !== h) return; // medzitým iná obrazovka
    if (item && item.result) { current = item; renderResult(item); show('vResult'); return; }
    if (VW) { await renderHist({ missing: true, eid: vwResultEid, name: vwResultName }); show('vHist'); return; }
  }
  if (h === '#/rozbory' && VW) { await renderHist(histCtx || { eid: vwResultEid, name: vwResultName }); show('vHist'); return; }
  if (h === '#/praca' && current) { show('vWork'); return; }
  if (VW) { // v appke sa začína natáčaním cviku z appky, inak výberom cviku
    if (pick) { renderNew(); show('vNew'); layoutShot(); } else { renderPick(); show('vPick'); }
    preloadSoon(); if (!vwDuel) loadQuota(); return;
  }
  renderHome(); show('vHome');
}
window.addEventListener('hashchange', route);
$('btnHome').onclick = () => {
  if (VW) {
    if ($('btnHome').dataset.mode === 'close') { vwPost('close'); return; }
    const h = location.hash;
    if (h === '#/vyber') { if (appPick) applyPick(appPick); go('#/nova'); return; } // späť na cvik z appky
    go(h === '#/nova' ? '#/vyber' : '#/nova');
    return;
  }
  // z výsledku a výberu cviku späť domov, z nahrávania späť na výber cviku
  go(location.hash === '#/nahravanie' ? '#/nova' : '#/');
};
$('btnNew').onclick = () => { go('#/nova'); };

function selectExercise(id) {
  const e = findExercise(id);
  if (e) { selected = isHold(e) ? AUTO : e; ls.set('vt-ex', selected.id); vwHint = ''; } // výdrže → automatické rozpoznanie
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
  if ($('btnLast')) $('btnLast').onclick = () => { go('#/r/' + last.id); };
  $('btnStart').onclick = () => { go('#/nova'); };

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
  $('hist').querySelectorAll('.vt .open').forEach(b => b.onclick = () => { go('#/r/' + b.dataset.id); });
  // rovnaký cvik ako na videu, rovno na výber s predvoleným cvikom
  $('hist').querySelectorAll('.vt .again').forEach(b => b.onclick = () => { selectExercise(b.dataset.ex); go('#/nova'); });
}

// ---------- nové video: výber cviku ----------
// ikonky cvikov: piktogramy 48×48 – [pomôcky (sivé), hlava [x, y, r], postava]
const EX_PIC = {
  klik: ['<path d="M4 40.5h40"/>', [9, 20.5, 4.2], 'M14 25 28 30.2 42 35.5M14.5 25.5V37'],
  'pritah-hrazda': ['<path d="M5 6.5h38"/>', [24, 15, 4.2], 'M14 6.5l-1 11 6 5M34 6.5l1 11-6 5M19 22.5h10M24 22v11.5M24 33.5l-2.6 10.5M24 33.5l2.6 10.5'],
  drep: ['<path d="M5 44h38"/>', [22.5, 8.5, 4.2], 'M20.5 15 13.5 27 27 28.5l-3 11.5h7M20.5 16.5 36 17.5'],
  vypad: ['<path d="M5 44h38"/>', [24, 6.5, 4.2], 'M24 12.5v12M24 24.5l10 2.5V40.5h5M24 24.5 16.5 36l-8 4.5M24 15.5h9'],
  bench: ['<circle cx="15" cy="9" r="5.5"/><path d="M6 31h28M10 31v10M30 31v10"/>', [7.5, 24.5, 4], 'M12.5 27h15l7.5-5.5 3.5 18.5M15 27V14.5'],
  'tlak-nad-hlavu': ['<path d="M6 6.5h36M8.5 2.5v8M39.5 2.5v8"/>', [24, 16.5, 4.2], 'M15.5 6.5l3.5 16M32.5 6.5 29 22.5M19 22.5h10M24 22v11.5M24 33.5l-3.5 11M24 33.5l3.5 11'],
  'hip-thrust': ['<circle cx="25" cy="14" r="5.5"/><path d="M4 25.5h10M9 25.5V42M4 42h40"/>', [7, 19, 3.8], 'M11.5 22.5 25 20.5l11.5.5V38h5'],
  most: ['<path d="M3 42h42"/>', [7.5, 37.5, 3.8], 'M12.5 39 26 29l10.5-3 2.5 14.5h4.5M13.5 40.5h8'],
  plank: ['<path d="M4 40.5h40"/>', [9, 27.5, 4.2], 'M14 31.5 28 34.2 42 36.8M14.5 32v7.8H7.5'],
};
const picSvg = (id) => {
  const p = EX_PIC[id];
  if (!p) return '';
  return '<svg class="pic" viewBox="0 0 48 48" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + `<g class="eq" stroke="currentColor" stroke-width="3">${p[0]}</g>`
    + `<g class="fig"><circle cx="${p[1][0]}" cy="${p[1][1]}" r="${p[1][2]}" fill="currentColor"/><path d="${p[2]}" stroke="currentColor" stroke-width="4.2"/></g></svg>`;
};
const ICON_AI = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8zM19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9zM5.5 15l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/></svg>';
const ICON_TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
// názov cviku v 4. páde do nadpisu „Natoč …“: Húsenica → húsenicu, Široká stojka → širokú stojku,
// Medvedia chôdza → medvediu chôdzu; mení sa len úvod názvu po prvú predložku alebo zátvorku
const PREP = /^(na|s|so|v|vo|do|z|zo|o|k|ku|pri|za|pod|nad|cez|bez|po|od|pred|medzi)$/i;
function accName(n) {
  const w = String(n || '').split(' ');
  for (let i = 0; i < w.length; i++) {
    const x = w[i];
    if (PREP.test(x) || /[()0-9°]/.test(x)) break;
    // prídavné mená (široká, medvedia) a za nimi podstatné meno; po podstatnom mene koniec (Poloha dieťaťa → polohu dieťaťa)
    if (/á$/.test(x)) { w[i] = x.slice(0, -1) + 'ú'; continue; }
    if (/[^csz]ia$/i.test(x)) { w[i] = x.slice(0, -2) + 'iu'; continue; }
    if (/a$/i.test(x)) w[i] = x.slice(0, -1) + 'u';
    break;
  }
  return w.join(' ');
}
// "Klik" → "klik", "L-sit" ostane
const lowerName = (n) => /^\p{Lu}\p{Ll}/u.test(n) ? n.charAt(0).toLowerCase() + n.slice(1) : n;

function renderNew() {
  if (VW) { renderShoot(); return; }
  const on = (id) => id === selected.id;
  const tick = `<span class="chk">${ICON_TICK}</span>`;
  const tile = (e) => `<button class="tile" data-id="${e.id}" aria-pressed="${on(e.id)}">${on(e.id) ? tick : ''}${picSvg(e.id)}<span class="nm">${esc(e.name)}</span></button>`;
  $('newTitle').textContent = 'Čo natočíš?';
  $('chips').innerHTML = `
    <div class="exgrid">
      <button class="tile ai" data-id="auto" aria-pressed="${on('auto')}">${on('auto') ? tick : ''}<span class="aibox">${ICON_AI}</span><span class="nm">Rozpoznať automaticky</span></button>
      ${EXERCISES.filter(e => !isHold(e)).map(tile).join('')}
    </div>`;
  $('chips').querySelectorAll('[data-id]').forEach(c => c.onclick = () => { selectExercise(c.dataset.id); renderNew(); });
  $('guideText').innerHTML = selected.id === 'auto' ? esc(selected.camera) : `<b>${esc(selected.name)}:</b> ${esc(selected.camera)}`;
  $('guideSub').textContent = selected.id === 'auto'
    ? `Jedna séria alebo výdrž (plank, stojka, front lever…), najviac ${maxSecondsFor(selected)} sekúnd. Celé telo v zábere.`
    : `Jedna séria, najviac ${maxSecondsFor(selected)} sekúnd. Celé telo v zábere.`;
  $('btnRec').innerHTML = `<span class="dot"></span>${selected.id === 'auto' ? 'Nahrávať' : 'Nahrávať ' + esc(selected.acc || lowerName(selected.name))}`;
}

// ---------- v appke: Natoč (návod pred nahrávaním) ----------
const isAutoPick = () => !pick || pick.src === 'auto';
const pickHold = () => !!(pick && pick.guide && isHold(pick.guide));
function renderShoot() {
  if (vwDuel) { renderShootDuel(); return; }
  const g = pick.guide, G = g || AUTO, max = maxSecondsFor(selected);
  const auto = isAutoPick();
  $('newTitle').textContent = auto ? 'Natoč cvik' : 'Natoč ' + lowerName(accName(pick.name));
  $('newSub').textContent = auto ? 'Cvik aj výdrž spoznám automaticky' : `${pick.name} · ${pickHold() ? 'jedna výdrž' : g ? 'jedna séria' : 'séria alebo výdrž'}`;
  const pic = g && EX_PIC[g.id] ? picSvg(g.id).replace('class="pic"', 'class="sh-pic"') : `<span class="sh-pic ai">${ICON_AI}</span>`;
  $('shPrev').innerHTML = `<div class="sh-ph">${pic}</div>`
    + (pick.img ? `<img class="sh-img" alt="Ukážka cviku" decoding="async" fetchpriority="high">` : '')
    + `<div class="sh-vig"></div><svg class="sh-frame" id="shFrame" aria-hidden="true"></svg><span class="sh-ok" id="shOk">${IC.check}Celé telo v zábere</span>`;
  $('shPrev').classList.toggle('loading', !!pick.img);
  const img = $('shPrev').querySelector('.sh-img');
  if (img) {
    // obrázok sa predčítava už v hlavičke stránky; keď je v pamäti, ukáže sa hneď
    const ok = () => { img.classList.add('on'); $('shPrev').classList.remove('loading'); layoutShot(); preloadSoon(300); keepImg(img.src); };
    img.onload = ok;
    img.onerror = () => {
      // náhľad v strednej veľkosti chýba → plný náhľad, inak piktogram
      if (/-mid\.jpg/i.test(img.src)) { pick.box = pick.boxp || null; img.src = img.src.replace(/-mid\.jpg/i, '.jpg'); return; } // plný náhľad má vlastnú polohu postavy
      img.remove(); pick.img = ''; pick.box = null; $('shPrev').classList.remove('loading'); layoutShot(); preloadSoon(300);
    };
    img.src = pick.img;
    if (img.complete && img.naturalWidth) ok();
  }
  const row = (ic, html) => `<div class="sh-tip"><span class="sh-ic">${ic}</span><span>${html}</span></div>`;
  $('shTips').innerHTML = row(IC.phone, `<b>${esc(G.hint)}</b>, ${esc(G.dist)}`)
    + row(IC.tripod, '<b>Mobil opri stabilne</b> alebo daj na statív')
    + row(IC.timer, pickHold() ? `<b>Jedna výdrž</b>, najviac ${max} sekúnd` : g ? `<b>Jedna séria</b>, najviac ${max} sekúnd` : `<b>Jedna séria alebo výdrž</b>, najviac ${max} sekúnd`);
  $('shChecks').innerHTML = (G.checks || []).map(c => `<span>${esc(c)}</span>`).join('');
  // čo treba na 100 bodov (pri známych cvikoch; pri automatickom rozpoznaní ich určí AI)
  const top = !auto && g && Array.isArray(g.top) ? g.top : [];
  hide('sh100', !top.length);
  $('sh100l').innerHTML = top.map(c => `<li>${esc(c)}</li>`).join('');
  $('btnRec').innerHTML = '<span class="dot"></span>Nahrávať';
  renderQuota();
}

// Súboj: natočiť sériu (výdrž) – appka spočíta opakovania (sekundy), ukáže pravidlá a výsledok súpera
function renderShootDuel() {
  const g = pick.guide, hold = isHold(g), D = vwDuel;
  $('newTitle').textContent = pick.name;
  $('newSub').textContent = D.goal ? `${D.who ? D.who + ': ' : 'Na prekonanie: '}${D.goal}${hold ? ' s' : ` ${plural(D.goal, 'opakovanie', 'opakovania', 'opakovaní')}`}${D.who ? ' – prekonaj to' : ''}`
    : hold ? 'Natoč výdrž – appka zmeria sekundy' : 'Natoč sériu – appka spočíta opakovania';
  const pid = g.base || g.id;
  const pic = EX_PIC[pid] ? picSvg(pid).replace('class="pic"', 'class="sh-pic"') : `<span class="sh-pic ai">${ICON_AI}</span>`;
  $('shPrev').innerHTML = `<div class="sh-ph">${pic}</div><div class="sh-vig"></div><svg class="sh-frame" id="shFrame" aria-hidden="true"></svg><span class="sh-ok" id="shOk">${IC.check}Celé telo v zábere</span>`;
  $('shPrev').classList.remove('loading');
  const row = (ic, html) => `<div class="sh-tip"><span class="sh-ic">${ic}</span><span>${html}</span></div>`;
  $('shTips').innerHTML = row(IC.phone, `<b>${esc(g.hint)}</b>, ${esc(g.dist)}`)
    + row(IC.tripod, '<b>Mobil opri stabilne</b> alebo daj na statív')
    + row(IC.timer, hold ? '<b>Jedna výdrž</b>, najviac 5 minút' : '<b>Jedna séria</b> do vyčerpania, najviac 3 minúty');
  $('shCapChecks').textContent = 'PRAVIDLÁ SÚBOJA';
  hide('shCapChecks', !D.rules);
  $('shChecks').innerHTML = D.rules ? `<p class="du-rules">${esc(D.rules)}</p>` : '';
  hide('sh100', true); hide('newQuota', true); hide('newLimit', true); hide('lblFile', true);
  $('btnRec').innerHTML = '<span class="dot"></span>Nahrávať';
  hide('btnRec', false);
}

// výrez obrázka a rámik „Celé telo v zábere“: podľa polohy postavy na náhľade (zistenej vopred na GitHube),
// bez nej podľa piktogramu alebo tvaru cviku (kliky, plank… naležato, ostatné nastojato)
const WIDE = new Set(['klik', 'plank', 'planche', 'hip-thrust', 'most', 'bench', 'front-lever', 'back-lever', 'l-sit']);
function layoutShot() {
  const box = $('shPrev');
  if (!VW || !box || !pick || $('vNew').hidden) return;
  const CW = box.clientWidth, CH = box.clientHeight;
  if (!CW || !CH) return;
  const img = box.querySelector('.sh-img.on');
  let fr = null;
  if (img && img.naturalWidth) {
    const W = img.naturalWidth, H = img.naturalHeight, b = pick.box;
    const cover = Math.max(CW / W, CH / H);
    // postava zaberie väčšinu karty, nad ňou ostane miesto na štítok (najviac 1,35× priblíženie, aby obrázok nebol rozmazaný)
    const fit = b ? Math.min(0.66 * CH / ((b[3] - b[1]) * H), 0.8 * CW / ((b[2] - b[0]) * W)) : cover;
    const s = Math.max(cover, Math.min(1.35 * cover, fit)), DW = W * s, DH = H * s;
    const cx = b ? (b[0] + b[2]) / 2 : 0.5, cy = b ? (b[1] + b[3]) / 2 - 8 / DH : 0.48; // o kúsok nižšie kvôli štítku
    const ox = Math.min(0, Math.max(CW - DW, CW / 2 - cx * DW)), oy = Math.min(0, Math.max(CH - DH, CH / 2 - cy * DH));
    Object.assign(img.style, { left: ox + 'px', top: oy + 'px', width: DW + 'px', height: DH + 'px' });
    if (b) {
      const pad = 0.07 * Math.max((b[2] - b[0]) * DW, (b[3] - b[1]) * DH) + 6;
      fr = { x: ox + b[0] * DW - pad, y: oy + b[1] * DH - pad, w: (b[2] - b[0]) * DW + 2 * pad, h: (b[3] - b[1]) * DH + 2 * pad };
    }
  }
  if (!fr && !img) {
    const svg = box.querySelector('.sh-ph svg.sh-pic');
    if (svg && svg.getBBox) {
      try {
        const bb = svg.getBBox(), r = svg.getBoundingClientRect(), rb = box.getBoundingClientRect(), k = r.width / 48;
        if (bb.width && r.width) fr = { x: r.left - rb.left + bb.x * k - 14, y: r.top - rb.top + bb.y * k - 14, w: bb.width * k + 28, h: bb.height * k + 28 };
      } catch { /* nič */ }
    }
  }
  if (!fr) { // tvar podľa cviku
    const wide = pick.guide && WIDE.has(pick.guide.id);
    const w = wide ? 0.8 * CW : Math.min(0.52 * CW, 0.62 * CH), h = wide ? 0.58 * CH : 0.86 * CH;
    fr = { x: (CW - w) / 2, y: wide ? CH * 0.6 - h / 2 : (CH - h) / 2, w, h };
  }
  // rámik ostane v karte
  const m = 6;
  fr.x = Math.max(m, fr.x); fr.y = Math.max(m, fr.y);
  fr.w = Math.min(CW - m - fr.x, fr.w); fr.h = Math.min(CH - m - fr.y, fr.h);
  $('shFrame').setAttribute('viewBox', `0 0 ${CW} ${CH}`);
  $('shFrame').innerHTML = frameSvg(fr.x, fr.y, fr.w, fr.h);
  const ok = $('shOk'), bw = ok.offsetWidth || 160;
  ok.style.left = Math.max(8 + bw / 2, Math.min(CW - 8 - bw / 2, fr.x + fr.w / 2)) + 'px';
  ok.style.top = Math.max(8, fr.y - 15) + 'px';
}
window.addEventListener('resize', () => layoutShot());
// načítaný náhľad cviku do pamäte zariadenia (service worker ho nabudúce vráti hneď, bez ďalšieho sťahovania)
function keepImg(url) {
  try { navigator.serviceWorker?.controller?.postMessage({ type: 'vt-img-ok', url }); } catch { /* nič */ }
}
// model na rozpoznanie postavy (≈ 20 MB) sťahujeme až po obrázku, aby ho nespomaľoval
let preloadT = 0;
function preloadSoon(ms = 2500) {
  if (!VW) { preload(); return; }
  clearTimeout(preloadT); preloadT = setTimeout(preload, ms);
}

// ---------- v appke: Výber cviku ----------
// ďalšie cviky: len s vlastnou váhou – kalistenika a výdrže (výdrže a dipy rozpozná automatický režim s názvom ako nápovedou)
const PICK_TILES = [
  { n: 'Kliky', c: 'Hrudník', id: 'klik' }, { n: 'Zhyby', c: 'Chrbát', id: 'pritah-hrazda' }, { n: 'Dipy', c: 'Ruky' },
  { n: 'Drepy', c: 'Nohy', id: 'drep' }, { n: 'Výpady', c: 'Nohy', id: 'vypad' }, { n: 'Mostík', c: 'Zadok', id: 'most' },
  { n: 'Stojka', c: 'Výdrž', id: 'stojka' }, { n: 'L-sit', c: 'Výdrž', id: 'l-sit' }, { n: 'Plank', c: 'Výdrž', id: 'plank' },
];
// cviky z tréningu: pri dlhšom tréningu zbalené – prvé dva cviky a riadok s ďalšími (aby bolo vidno, že ich je viac)
let pkDayAll = false;
const PK_SHOW = 2;
const iniOf = (n) => esc((String(n || '').match(/\p{L}/u) || ['C'])[0].toUpperCase());
// miniatúra cviku z náhľadu videa (výrez okolo postavy podľa polohy z náhľadu); kým sa nenačíta, vidno písmeno
const thumbOf = (x, cls = '') => (x.img
  ? `<span class="pk-ini pk-th${cls}">${iniOf(x.n)}<img src="${esc(x.img)}" alt="" loading="lazy" decoding="async"${x.box ? ` data-box="${x.box.join(',')}"` : ''}></span>`
  : `<span class="pk-ini${cls}">${iniOf(x.n)}</span>`);
function fitThumb(img) {
  const b = img.dataset.box ? img.dataset.box.split(',').map(Number) : null;
  const a = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
  const bw = b ? Math.max(0.05, b[2] - b[0]) : 1, bh = b ? Math.max(0.05, b[3] - b[1]) : 1;
  const kMin = Math.max(1, 1 / a); // obrázok musí zakryť celú miniatúru
  const k = b ? Math.min(4, Math.max(kMin, Math.min(0.9 / bh, 0.9 / (bw * a)))) : kMin;
  const h = 0.5 / (k * a), v = 0.5 / k;
  const cx = Math.min(1 - h, Math.max(h, b ? (b[0] + b[2]) / 2 : 0.5));
  const cy = Math.min(1 - v, Math.max(v, b ? (b[1] + b[3]) / 2 : 0.5));
  img.style.height = (k * 100).toFixed(1) + '%';
  img.style.transform = `translate(${(-cx * 100).toFixed(2)}%, ${(-cy * 100).toFixed(2)}%)`;
  img.classList.add('on');
}
function bindThumbs(root) {
  root.querySelectorAll('.pk-th img').forEach(img => {
    if (img.complete && img.naturalWidth) fitThumb(img);
    else { img.onload = () => fitThumb(img); img.onerror = () => img.remove(); }
  });
}
function renderPickDay() {
  const d = vwDay;
  if (!d) { $('pkDay').innerHTML = ''; return; }
  const many = d.x.length > PK_SHOW + 1, open = pkDayAll || !many;
  const rest = d.x.slice(PK_SHOW), n = rest.length;
  const row = (x, i) => {
    const plan = x.t ? `${x.s ? x.s + ' × ' : ''}${x.t} s` : x.r ? `${x.s ? x.s + ' × ' : ''}${x.r} ${plural(x.r, 'opakovanie', 'opakovania', 'opakovaní')}` : '';
    const meta = [plan, x.sc != null ? `naposledy ${x.sc} ${plural(x.sc, 'bod', 'body', 'bodov')}` : ''].filter(Boolean).join(' · ');
    return `<button class="pk-row" data-i="${i}">${thumbOf(x, ' pk-big')}
      <span class="pk-rt"><b>${esc(x.n)}</b>${meta ? `<span>${esc(meta)}</span>` : ''}</span>${IC.chev}</button>`;
  };
  const moreTxt = open ? 'Zobraziť menej' : n === 1 ? 'Ešte 1 cvik z tréningu' : n <= 4 ? `Ďalšie ${n} cviky z tréningu` : `Ďalších ${n} cvikov z tréningu`;
  $('pkDay').innerHTML = `
    <div class="pk-dayh"><span class="vw-cap">${d.d ? 'Z DNEŠNÉHO TRÉNINGU' : 'Z NAJBLIŽŠIEHO TRÉNINGU'}</span><span>${esc(d.l)}</span></div>
    <section class="vw-card pk-list">${(open ? d.x : d.x.slice(0, PK_SHOW)).map(row).join('')}
      ${many ? `<button class="pk-more" id="pkMore" aria-expanded="${open}">
        ${open ? '' : `<span class="pk-stack" aria-hidden="true">${rest.slice(0, 4).map(x => thumbOf(x)).join('')}</span>`}
        <span class="pk-more-t">${moreTxt}</span>
        <svg class="pk-chev${open ? ' up' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </button>` : ''}
    </section>`;
  $('pkDay').querySelectorAll('.pk-row').forEach(b => b.onclick = () => {
    const x = d.x[Number(b.dataset.i)];
    applyPick(makePick('list', x.n, { eid: x.e, img: x.img, box: x.box, boxp: x.boxp })); go('#/nova');
  });
  on('pkMore', () => { pkDayAll = !pkDayAll; renderPickDay(); });
  bindThumbs($('pkDay'));
}
function renderPick() {
  $('pkAuto').onclick = () => { applyPick(makePick('auto', 'Rozpoznať automaticky', { id: 'auto' })); go('#/nova'); };
  renderPickDay();
  $('pkGrid').innerHTML = PICK_TILES.map((t, i) => `<button class="pk-tile" data-i="${i}"><b>${esc(t.n)}</b><span>${esc(t.c)}</span></button>`).join('');
  $('pkGrid').querySelectorAll('.pk-tile').forEach(b => b.onclick = () => {
    const t = PICK_TILES[Number(b.dataset.i)];
    applyPick(makePick('list', t.n, { id: t.id || null })); go('#/nova');
  });
}

for (const id of ['inCam', 'inFile', 'inFilePick']) {
  on(id, (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (id === 'inFilePick') applyPick(makePick('auto', 'Rozpoznať automaticky', { id: 'auto' })); // z výberu: cvik rozpozná appka
    startAnalysis(f);
  }, 'change');
}


// ---------- nahrávanie s odpočtom ----------
let recState = 'off';
const recorder = new Recorder($('recVideo'), {
  onState: (st, n) => {
    recState = st;
    hide('recCd', st !== 'countdown');
    if (st === 'countdown') $('recCdNum').textContent = n;
    hide('recBadge', st !== 'recording');
    hide('btnRecStart', st !== 'ready');
    hide('btnRecStop', st !== 'recording');
    hide('btnRecCancel', st !== 'countdown');
    hide('btnFlip', st !== 'ready');
    if (VW) {
      const b = $('btnRecBig');
      b.className = 'rc-btn' + (st === 'recording' ? ' stop' : st === 'countdown' ? ' cancel' : '');
      b.setAttribute('aria-label', st === 'recording' ? 'Zastaviť a analyzovať' : st === 'countdown' ? 'Zrušiť odpočet' : 'Spustiť nahrávanie');
      $('recHint').textContent = st === 'recording' ? (vwDuel && pickHold() ? 'Ťukni, keď výdrž skončí' : 'Ťukni, keď dokončíš sériu')
        : st === 'countdown' ? 'Zaujmi polohu · ťuknutím odpočet zrušíš' : 'Polož mobil a ťukni – máš 5 sekúnd na prípravu';
      if (st === 'recording') { liveReset(); hide('recCount', false); $('recTime').textContent = '0:00'; }
      else hide('recCount', true);
      liveStatus(true);
      return;
    }
    $('recHint').textContent = st === 'recording'
      ? (selected.id === 'auto' ? `Cvič alebo drž polohu. Potom stlač Zastaviť (najneskôr po ${maxSecondsFor(selected)} s).` : `Cvič. Nahrávanie sa zastaví samo po ${maxSecondsFor(selected)} s.`)
      : st === 'countdown' ? 'Zaujmi polohu…' : 'Polož mobil, zaujmi polohu. Po stlačení máš 5 sekúnd.';
  },
  onTick: (sec, max) => {
    const left = Math.max(0, Math.ceil(max - sec));
    $('recTime').textContent = `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}` + (left <= 5 ? ` · ${left}` : '');
  },
});

// Súboj: video ide súperovi – menšie rozlíšenie a dátový tok (3 min série ≈ 22 MB, 5 min výdrže ≈ 22 MB)
if (vwDuel) { recorder.size = { w: 960, h: 540 }; recorder.bps = isHold(selected) ? 600_000 : 1_000_000; }

$('btnRec').onclick = () => {
  if (!recorderSupported()) { $('inCam').click(); return; } // starší prehliadač: systémová kamera
  go('#/nahravanie');
};

async function openRecorder() {
  if (VW) {
    $('recName').textContent = isAutoPick() ? 'Rozpoznám automaticky' : vwDuel && vwDuel.goal ? `${pick.name} · prekonaj ${vwDuel.goal}${isHold(selected) ? ' s' : ''}` : pick.name;
    hide('recCount', true); recState = 'off'; liveStatus(true);
  }
  clearTimeout(preloadT);
  try { await recorder.open(); preload(); liveStart(); }
  catch (e) {
    console.error(e);
    // bez povolenia kamery → systémová kamera mobilu
    go('#/nova');
    setTimeout(() => $('inCam').click(), 50);
  }
}
async function recStart() {
  try {
    const file = await recorder.start({ countdown: 5, maxSeconds: maxRec() });
    recorder.close(); liveStop();
    startAnalysis(file);
  } catch (e) { if (e) console.error(e); }
}
on('btnFlip', () => recorder.flip().catch(() => {}));
on('btnRecStart', recStart);
on('btnRecStop', () => recorder.stop());
on('btnRecCancel', () => recorder.cancel());
on('btnRecX', () => go('#/nova'));
on('btnRecBig', () => {
  if (recState === 'ready') recStart();
  else if (recState === 'recording') recorder.stop();
  else if (recState === 'countdown') recorder.cancel();
});

// ---------- v appke: živá kostra, „vidím celé telo“ a počítadlo opakovaní počas nahrávania ----------
// Je to len orientačný náhľad – presný počet opakovaní a rozbor príde z analýzy celého videa.
const LIVE = { on: false, model: null, failed: false, busy: false, errs: 0, t0: 0, raf: 0, last: 0, lastSt: 0, lm: null, st: '', cand: '', since: 0, cnt: null, joint: null, hist: [], still0: null, best: 0 };
const JPAIR = { elbow: [13, 14], knee: [25, 26], hip: [23, 24], shoulder: [11, 12], body_line: [23, 24] };
const LIVE_BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32]];
function liveStart() {
  if (!VW || LIVE.on) return;
  Object.assign(LIVE, { on: true, lm: null, st: '', cand: '', busy: false, errs: 0, failed: false, t0: performance.now() });
  // počítadlo opakovaní: ráta až keď sa človek ustáli v polohe cviku a len pohyby, pri ktorých ide aj telo (nie chôdzu, nastavovanie)
  LIVE.cnt = createLiveCounter({ signal: selected.signal || null, posture: selected.posture || null, minAmp: selected.minAmp || 30, start: selected.start || 'top' });
  liveLandmarker().then(m => { LIVE.model = m; LIVE.failed = !m; if (LIVE.on) liveStatus(true); });
  LIVE.raf = requestAnimationFrame(liveTick);
}
function liveStop() {
  if (!LIVE.on) return;
  LIVE.on = false; cancelAnimationFrame(LIVE.raf);
  const c = $('recCanvas'); if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
}
function liveReset() { if (LIVE.cnt) LIVE.cnt.reset(); LIVE.joint = null; LIVE.hist = []; LIVE.still0 = null; LIVE.best = 0; liveCountShow(); }
function liveTick(now) {
  if (!LIVE.on) return;
  LIVE.raf = requestAnimationFrame(liveTick);
  if (!LIVE.model) { if (now - LIVE.lastSt > 500) { LIVE.lastSt = now; liveStatus(false, now); } return; }
  if (LIVE.busy || now - LIVE.last < 80) return; // ~12 snímok za sekundu stačí; ďalšia až po výsledku
  LIVE.last = now; LIVE.busy = true;
  const v = $('recVideo');
  // výpočet beží mimo hlavného vlákna, tlačidlá reagujú aj počas neho
  detectLive(LIVE.model, v).then((lm) => {
    LIVE.busy = false;
    if (!LIVE.on) return;
    if (lm === undefined) { // chyba: po niekoľkých za sebou náhľad vypneme, nahrávať sa dá aj tak
      if (++LIVE.errs >= 5) { LIVE.model = null; LIVE.failed = true; liveDraw(null, v); liveStatus(true); }
      return;
    }
    LIVE.errs = 0;
    const t = performance.now();
    LIVE.lm = lm;
    liveCount(lm, t, v); // poloha sa sleduje už počas odpočtu, opakovania sa rátajú len pri nahrávaní
    liveDraw(lm, v);
    liveStatus(false, t);
  });
}
// celé telo v zábere: stačí jedna strana tela (pohľad zboku) – rameno, bok, koleno aj členok
function bodyState(lm) {
  if (!lm) return 'none';
  const inF = (q) => q && (q.visibility ?? 0) >= 0.5 && q.x > 0.01 && q.x < 0.99 && q.y > 0.01 && q.y < 0.99;
  if ([11, 23, 25, 27].every(i => inF(lm[i])) || [12, 24, 26, 28].every(i => inF(lm[i]))) return 'ok';
  return [0, 11, 12, 23, 24].some(i => (lm[i]?.visibility ?? 0) >= 0.5) ? 'part' : 'none';
}
function liveStatus(force, now = performance.now()) {
  if (!VW || !$('recStatus')) return;
  let st = LIVE.failed ? 'off' : !LIVE.model ? (now - LIVE.t0 > 8000 ? 'slow' : 'load') : bodyState(LIVE.lm);
  if (recState === 'off') st = 'cam';
  // stav meníme až keď vydrží ~0,4 s, aby text neblikal
  if (!force) {
    if (st !== LIVE.cand) { LIVE.cand = st; LIVE.since = now; }
    if (st !== LIVE.st && now - LIVE.since < 400) return;
  }
  LIVE.st = st; LIVE.cand = st;
  const ok = st === 'ok';
  const txt = st === 'cam' ? 'Zapínam kameru…' : st === 'load' ? 'Pripravujem rozpoznávanie postavy…'
    : st === 'slow' ? 'Môžeš nahrávať – kostra sa ešte pripravuje' : st === 'off' ? 'Môžeš nahrávať – kostru uvidíš v rozbore'
    : ok ? (recState === 'recording' ? 'Vidím celé telo – cvič ďalej' : recState === 'countdown' ? 'Vidím celé telo – zaujmi polohu' : 'Vidím celé telo – môžeš začať')
    : st === 'part' ? 'Nevidím celé telo – posuň mobil ďalej' : 'Nevidím ťa – postav sa do záberu';
  $('recStatus').className = 'rc-status' + (ok ? ' ok' : st === 'part' || st === 'none' ? ' warn' : '');
  $('recStatusT').textContent = txt;
}
function liveCount(lm, now, v) {
  const W = v.videoWidth || 1, H = v.videoHeight || 1;
  const rec = recState === 'recording';
  if (pickHold()) { if (rec) { liveHold(lm, now, W, H); liveCountShow(); } return; }
  if (LIVE.cnt) LIVE.cnt.update(lm || null, now, W, H, rec);
  if (!rec) return;
  LIVE.joint = (LIVE.cnt && LIVE.cnt.joint) || selected.signal || null;
  if (!selected.signal && selected.type !== 'reps') liveHold(lm, now, W, H); // automaticky môže ísť aj o výdrž
  liveCountShow();
}
// výdrž: telo sa takmer nehýbe (boky a ramená v rámci ~1 s)
function liveHold(lm, now, W, H) {
  if (!lm) { LIVE.still0 = null; return; }
  const mid = (a, b) => ({ x: (lm[a].x + lm[b].x) / 2 * W, y: (lm[a].y + lm[b].y) / 2 * H });
  const sh = mid(11, 12), hp = mid(23, 24), torso = Math.hypot(sh.x - hp.x, sh.y - hp.y) || 1;
  LIVE.hist.push({ t: now, x: hp.x / torso, y: hp.y / torso, sx: sh.x / torso, sy: sh.y / torso });
  while (LIVE.hist.length && now - LIVE.hist[0].t > 1000) LIVE.hist.shift();
  const rng = (k) => { const a = LIVE.hist.map(h => h[k]); return Math.max(...a) - Math.min(...a); };
  const still = LIVE.hist.length >= 5 && ['x', 'y', 'sx', 'sy'].every(k => rng(k) < 0.12);
  if (still) { if (LIVE.still0 == null) LIVE.still0 = now - 1000; LIVE.best = Math.max(LIVE.best, (now - LIVE.still0) / 1000); }
  else LIVE.still0 = null;
}
function liveCountShow() {
  if (!VW || !$('recCountN')) return;
  const reps = LIVE.cnt ? LIVE.cnt.count : 0;
  const holdS = Math.floor(LIVE.best);
  const asHold = pickHold() || (!selected.signal && selected.type !== 'reps' && !reps && holdS >= 3);
  $('recCountN').textContent = asHold ? holdS : reps;
  $('recCountL').textContent = asHold ? 'S VÝDRŽE' : reps === 1 ? 'OPAKOVANIE' : reps >= 2 && reps <= 4 ? 'OPAKOVANIA' : 'OPAKOVANÍ';
}
// kostra cez živý obraz (video je roztiahnuté cez celú obrazovku – object-fit: cover)
function liveDraw(lm, v) {
  const c = $('recCanvas'); if (!c) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), CW = c.clientWidth, CH = c.clientHeight;
  if (c.width !== Math.round(CW * dpr) || c.height !== Math.round(CH * dpr)) { c.width = Math.round(CW * dpr); c.height = Math.round(CH * dpr); }
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
  if (!lm || !v.videoWidth) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = Math.max(CW / v.videoWidth, CH / v.videoHeight), dx = (CW - v.videoWidth * s) / 2, dy = (CH - v.videoHeight * s) / 2;
  const mir = v.classList.contains('mirror');
  const pts = {};
  for (const i of [0, ...new Set(LIVE_BONES.flat())]) {
    const q = lm[i]; if (!q) continue;
    let x = dx + q.x * v.videoWidth * s; if (mir) x = CW - x;
    pts[i] = [x, dy + q.y * v.videoHeight * s, q.visibility ?? 1];
  }
  drawSkeleton(g, pts, { r: 5.5, lw: 3, hi: LIVE.joint || selected.signal || null });
}
// spoločné kreslenie kostry: pts = { id: [x, y, viditeľnosť] } v pixeloch plátna
function drawSkeleton(g, pts, { r = 5.5, lw = 3, hi = null } = {}) {
  const ok = (i) => pts[i] && pts[i][2] >= 0.35;
  g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = lw; g.strokeStyle = 'rgba(255,255,255,.9)';
  g.beginPath();
  for (const [a, b] of LIVE_BONES) { if (!ok(a) || !ok(b)) continue; g.moveTo(pts[a][0], pts[a][1]); g.lineTo(pts[b][0], pts[b][1]); }
  let head = null;
  if (ok(11) && ok(12) && ok(0)) {
    const mx = (pts[11][0] + pts[12][0]) / 2, my = (pts[11][1] + pts[12][1]) / 2;
    head = [mx + (pts[0][0] - mx) * 0.8, my + (pts[0][1] - my) * 0.8];
    g.moveTo(mx, my); g.lineTo(head[0], head[1]);
  }
  g.stroke();
  const big = hi && JPAIR[hi] ? JPAIR[hi] : [];
  const dot = (x, y, rr, w) => { g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fillStyle = '#FF7A45'; g.fill(); g.lineWidth = w; g.strokeStyle = '#FFFFFF'; g.stroke(); };
  if (head) dot(head[0], head[1], r * 1.1, Math.max(1.5, lw * 0.66));
  for (const i of new Set(LIVE_BONES.flat())) {
    if (!ok(i) || big.includes(i) || i === 31 || i === 32) continue;
    dot(pts[i][0], pts[i][1], r, Math.max(1.5, lw * 0.66));
  }
  for (const i of big) {
    if (!ok(i)) continue;
    g.beginPath(); g.arc(pts[i][0], pts[i][1], r * 2.7, 0, Math.PI * 2); g.lineWidth = Math.max(1.5, lw * 0.66); g.strokeStyle = 'rgba(255,122,69,.6)'; g.stroke();
    dot(pts[i][0], pts[i][1], r * 1.45, Math.max(2, lw * 0.85));
  }
}

// ---------- spracovanie ----------
function setProgress(p, text) {
  if ($('bar')) $('bar').style.width = Math.round(p * 100) + '%';
  if (text && !VW) $('workStatus').textContent = text;
}
// again = má zmysel skúsiť to isté video znova (inak ponúkneme nahrať iné)
function showError(msg, needCode = false, again = true) {
  $('workErr').hidden = false; $('workErrText').textContent = msg;
  hide('btnErrPro', true);
  $('codeBox').hidden = !needCode;
  if (needCode) $('codeInput').value = ls.get('vt-code') || '';
  $('btnRetry').hidden = !again && !needCode;
  $('btnRetry').textContent = needCode ? 'Pokračovať' : 'Skúsiť znova';
  $('btnBack').textContent = again || needCode ? 'Späť' : 'Nahrať iné video';
  if (VW) {
    hide('workBand', true); hide('workBottom', true); $('workSteps').classList.add('stopped'); vwPost('error');
    $('workTitle').textContent = needCode ? 'Chýba prístupový kód' : 'Rozbor sa nepodaril';
    $('workSub').textContent = needCode ? 'Zadaj ho a rozbor pokračuje' : !again ? 'Skús nahrať nové video'
      : current && current.summary ? 'Meranie z videa zostalo, stačí skúsiť znova' : 'Skús to ešte raz';
  }
}
// nadpis obrazovky Analýza (aj po opakovanom pokuse po chybe)
function workHead() {
  $('workTitle').textContent = vwDuel ? (AN.isHold ? 'Meriam tvoju výdrž' : 'Počítam tvoje opakovania') : AN.isHold ? 'Analyzujem tvoju výdrž' : isAutoPick() ? 'Analyzujem tvoje video' : 'Analyzujem tvoju sériu';
  $('workSub').textContent = vwDuel ? 'Video sa spracúva v mobile, nikam sa zatiaľ neposiela' : 'Zvyčajne to trvá do minúty';
}

// ---------- v appke: obrazovka Analýza (kroky, náhľad s kostrou) ----------
// stage: model → scan (prechádzanie videa) → frames (uhly a tempo) → ai (rozbor) → done
const AN = { stage: 'model', p: 0, people: false, measured: false, t: 0, dur: 0, reps: 0, hold: 0, isHold: false, down: null, ai: 0 };
function workReset(stage = 'model') {
  Object.assign(AN, { stage, p: 0, people: stage !== 'model', measured: false, t: 0, dur: 0, reps: 0, hold: 0, isHold: pickHold(), down: null, ai: 0 });
  if (!VW) return;
  const nm = !isAutoPick() ? pick.name : (current?.exercise?.hint || '');
  $('workKick').innerHTML = `${IC.kick}<span>${esc(((vwDuel ? 'SÚBOJ' : 'TECHNIKA') + (nm ? ' · ' + nm : '')).toUpperCase())}</span>`;
  workHead();
  hide('workBand', false); hide('workPill', true); hide('workStatus', true); hide('workErr', true); $('workSteps').classList.remove('stopped');
  hide('workBottom', !!vwDuel); hide('btnWorkBg', !vwEmbedded || !!vwDuel);
  $('btnWorkBg').textContent = vwFrom === 'set' ? 'Pokračovať v tréningu' : 'Pokračovať v appke';
  const c = $('workCanvas'); c.getContext('2d').clearRect(0, 0, c.width, c.height);
  renderSteps();
}
function renderSteps() {
  if (!VW) return;
  const order = ['model', 'scan', 'frames', 'ai', 'done'], at = order.indexOf(AN.stage);
  const done = (title, sub) => `<div class="an-st"><span class="an-ok">${IC.check}</span><span class="an-tx"><b>${esc(title)}</b><span>${esc(sub)}</span></span></div>`;
  const todo = (title, sub) => `<div class="an-st todo"><span class="an-wait"></span><span class="an-tx"><b>${esc(title)}</b><span>${esc(sub)}</span></span></div>`;
  const spin = '<svg class="an-spin" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="11" fill="none" stroke="currentColor" stroke-opacity=".14" stroke-width="3"/><path d="M14 3a11 11 0 0 1 11 11" fill="none" stroke="#FF7A45" stroke-width="3" stroke-linecap="round"/></svg>';
  const act = (title, sub, p) => `<div class="an-st"><span style="color:var(--tx);display:grid">${spin}</span><span class="an-tx">${p != null
    ? `<span class="an-row"><b>${esc(title)}</b><em>${Math.round(p * 100)} %</em></span><span class="an-bar"><span style="width:${Math.round(p * 100)}%"></span></span>`
    : `<b>${esc(title)}</b><span>${esc(sub)}</span>`}</span></div>`;
  const hold = AN.isHold;
  const s1 = AN.people ? done('Telo nájdené', `${CLIP_PTS.length} bodov na tele v každej snímke`)
    : act('Hľadám telo', at === 0 ? 'Načítavam rozpoznávanie postavy' : 'Prechádzam video');
  const s2 = at < 1 ? todo(hold ? 'Meriam výdrž' : 'Počítam opakovania', hold ? 'ako dlho a ako stabilne' : 'každé opakovanie zvlášť')
    : at === 1 || !AN.measured ? act(hold ? 'Meriam výdrž' : selected.id === 'auto' ? 'Meriam pohyb' : 'Počítam opakovania', '', at === 1 ? AN.p : 1)
    : hold ? done('Výdrž zmeraná', AN.hold ? `výdrž ${AN.hold} s` : 'výdrž som nenašiel, rozbor to skúsi aj tak')
    : AN.reps ? done('Opakovania spočítané', `${AN.reps} ${plural(AN.reps, 'opakovanie', 'opakovania', 'opakovaní')} za ${Math.round(AN.dur)} sekúnd`)
    : done('Pohyb zmeraný', 'opakovania som nenašiel, rozbor to skúsi aj tak');
  const s3 = at < 2 ? todo(hold ? 'Meriam líniu tela' : 'Meriam uhly a tempo', hold ? 'línia tela a stabilita' : 'uhly kĺbov v každej snímke')
    : at === 2 || !AN.measured ? act(hold ? 'Meriam líniu tela' : 'Meriam uhly a tempo', 'kľúčové snímky')
    : done(hold ? 'Línia tela zmeraná' : 'Uhly a tempo zmerané', hold ? 'línia tela a stabilita' : AN.down != null ? `spúšťanie ${String(AN.down).replace('.', ',')} s, rozsah každého opakovania` : 'uhly kĺbov v každej snímke');
  const s4 = at < 3 ? todo('Rozbor a skóre', 'čo zlepšiť a ako na 100 bodov')
    : at === 3 ? act('Rozbor a skóre', '', AN.ai) : done('Rozbor a skóre', 'hotovo');
  $('workSteps').innerHTML = vwDuel ? s1 + s2 : s1 + s2 + s3 + s4;
}
function workPill() {
  if (!VW) return;
  const el = $('workPill');
  if (AN.stage === 'scan' && AN.dur) { el.textContent = `${fmtT(AN.t)} / ${fmtT(AN.dur)}`; el.hidden = false; return; }
  if (['frames', 'ai', 'done'].includes(AN.stage)) {
    el.textContent = AN.isHold ? `výdrž ${AN.hold} s` : `${fmtT(AN.dur)}${AN.reps ? ` · ${AN.reps} ${plural(AN.reps, 'opakovanie', 'opakovania', 'opakovaní')}` : ''}`;
    el.hidden = false;
  }
}
// snímka do náhľadu: obraz celý (contain) na stmavenom pozadí z tej istej snímky, cez neho kostra
function drawPoseFrame(c, src, sw, sh, pts, opts = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), CW = c.clientWidth || 1, CH = c.clientHeight || 1;
  if (c.width !== Math.round(CW * dpr) || c.height !== Math.round(CH * dpr)) { c.width = Math.round(CW * dpr); c.height = Math.round(CH * dpr); }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = opts.bg || '#111722'; g.fillRect(0, 0, CW, CH);
  const cs = Math.max(CW / sw, CH / sh), fs = Math.min(CW / sw, CH / sh);
  g.globalAlpha = 0.28; g.drawImage(src, (CW - sw * cs) / 2, (CH - sh * cs) / 2, sw * cs, sh * cs); g.globalAlpha = 1;
  const w = sw * fs, h = sh * fs, x0 = (CW - w) / 2, y0 = (CH - h) / 2;
  g.drawImage(src, x0, y0, w, h);
  g.fillStyle = 'rgba(5,7,11,.18)'; g.fillRect(x0, y0, w, h);
  if (!pts) return null;
  const P = {};
  for (const id in pts) P[id] = [x0 + pts[id][0] * w, y0 + pts[id][1] * h, pts[id][2]];
  drawSkeleton(g, P, opts);
  return { g, P, CW, CH };
}
const rawPts = (lm) => { if (!lm) return null; const o = {}; CLIP_PTS.forEach(i => { const q = lm[i]; if (q) o[i] = [q.x, q.y, q.visibility ?? 1]; }); return o; };
const clipPts = (lm) => { if (!lm) return null; const o = {}; CLIP_PTS.forEach((id, k) => { o[id] = lm[k]; }); return o; };
function workFrame(cc, lm, t, dur) {
  if (!VW || $('vWork').hidden) return;
  if (lm && !AN.people) { AN.people = true; renderSteps(); }
  AN.t = t; AN.dur = dur;
  drawPoseFrame($('workCanvas'), cc, cc.width, cc.height, rawPts(lm), { r: 3.4, lw: 2 });
  workPill();
}
// po meraní: náhľad prehráva zmeraný záznam s kostrou dookola
const WL = { timer: 0, urls: [], imgs: [], i: 0 };
function workLoopStart(clip) {
  workLoopStop();
  if (!VW || !clip || !clip.frames || clip.frames.length < 2) return;
  WL.urls = clip.frames.map(f => URL.createObjectURL(f.img)); WL.imgs = []; WL.i = 0;
  const step = () => {
    const f = clip.frames[WL.i];
    const im = WL.imgs[WL.i] || (WL.imgs[WL.i] = Object.assign(new Image(), { src: WL.urls[WL.i] }));
    const nx = (WL.i + 1) % clip.frames.length;
    if (!WL.imgs[nx]) WL.imgs[nx] = Object.assign(new Image(), { src: WL.urls[nx] });
    if (im.complete && im.naturalWidth) {
      drawPoseFrame($('workCanvas'), im, clip.w, clip.h, clipPts(f.lm), { r: 3.4, lw: 2, hi: clip.joint });
      WL.i = nx;
    }
  };
  WL.timer = setInterval(step, Math.max(40, 1000 / (clip.fps || 8)));
}
function workLoopStop() {
  clearInterval(WL.timer); WL.timer = 0;
  WL.urls.forEach(u => URL.revokeObjectURL(u)); WL.urls = []; WL.imgs = [];
}
on('btnWorkBg', () => vwPost('bg'));

async function startAnalysis(file) {
  if (vwDuel) { duelAnalysis(file); return; }
  pendingFile = file;
  current = { id: String(Date.now()), created: Date.now(), exercise: { id: selected.id, name: selected.name, en: selected.en, type: selected.type || null }, signal: selected.signal };
  if (VW && pick && !isAutoPick()) {
    current.vwName = pick.name; // v appke ukazujeme názov cviku z appky alebo z výberu
    if (pick.eid) current.vwEid = pick.eid;
    if (selected.id === 'auto' && vwHint) Object.assign(current.exercise, { name: vwHint, hint: vwHint });
  }
  $('workErr').hidden = true;
  if (VW) workReset('model');
  else {
    $('workTitle').textContent = 'Analyzujem…';
    const vid = $('workVideo');
    if (vid.src) URL.revokeObjectURL(vid.src);
    vid.src = URL.createObjectURL(file); vid.hidden = false;
    vid.play().catch(() => {});
  }
  // v appke: keď už rozbory došli, ukážeme to na obrazovke Natoč (s ponukou Pro)
  if (VW && QUOTA && QUOTA.left <= 0) { current = null; go('#/nova'); return; }
  go('#/praca'); show('vWork');
  setProgress(0, 'Overujem prístup…');
  // prístup overíme hneď, nie až po minútovej analýze videa
  if (await accessDenied()) {
    showError(needCodeBox() ? 'Táto appka je chránená prístupovým kódom. Zadaj ho a pokračuj.' : 'Rozbor techniky funguje po prihlásení v appke. Zatvor Techniku, prihlás sa a skús to znova.', needCodeBox(), false);
    current = null;
    return;
  }
  setProgress(0, 'Pripravujem…');
  try {
    const onProgress = (p, t) => {
      setProgress(p * 0.5, t);
      if (!VW) return;
      const st = /model/i.test(t || '') ? 'model' : p >= 0.91 ? 'frames' : p > 0 ? 'scan' : AN.stage;
      if (st !== AN.stage || st === 'scan') { AN.stage = st; AN.p = Math.min(1, Math.max(0, (p - 0.05) / 0.85)); renderSteps(); }
    };
    const { summary, keyframes, thumb, clip } = await analyzeVideo(file, { signal: selected.signal, posture: selected.posture ?? null, minAmp: selected.minAmp ?? 25, start: selected.start ?? null, type: selected.type ?? null, target: selected.target ?? null, holdJoint: selected.holdJoint ?? null, maxSeconds: maxSecondsFor(selected), onProgress, onFrame: workFrame });
    Object.assign(current, { summary, keyframes, thumb, clip });
    const maxS = maxSecondsFor(selected);
    if (summary.video.duration_s > maxS) {
      setProgress(0.5, `Video je dlhšie ako ${maxS} s, analyzujem prvých ${maxS} s.`);
      if (VW) { $('workStatus').textContent = `Video je dlhšie ako ${maxS} s, analyzujem prvých ${maxS} s.`; hide('workStatus', false); }
    }
    workMeasured(summary, clip);
  } catch (e) {
    console.error(e);
    showError(e && e.user ? e.message : 'Video sa nepodarilo spracovať. Skús to znova, prípadne s iným videom.', false, !(e && e.again === false));
    current = null;
    return;
  }
  await runAi();
}
// výsledok merania do krokov a náhľadu
function workMeasured(sm, clip) {
  if (!VW || !sm) return;
  const act = sm.active_segment;
  Object.assign(AN, { people: true, measured: true, isHold: sm.exercise_type === 'hold', reps: sm.reps_detected || 0, hold: Math.round(sm.hold?.duration_s || 0),
    dur: act ? Math.max(0, act.end_s - act.start_s) : (sm.video?.analyzed_s || 0), down: sm.tempo?.avg_down_s ?? null });
  if (AN.isHold) $('workTitle').textContent = 'Analyzujem tvoju výdrž';
  AN.stage = 'ai'; renderSteps(); workPill();
  workLoopStart(clip);
}

// ---------- Súboj: spočítanie v mobile (bez rozboru AI) a výsledok s videom pre appku ----------
let DUEL = null; // { file, url, val, cam, hold, adj, dur, live }
function duelClear() { if (DUEL && DUEL.url) URL.revokeObjectURL(DUEL.url); DUEL = null; }
async function duelAnalysis(file) {
  pendingFile = file;
  const hold = isHold(selected);
  const live = hold ? Math.floor(LIVE.best || 0) : (LIVE.cnt ? LIVE.cnt.count : 0);
  current = { id: String(Date.now()), created: Date.now(), exercise: { id: selected.id, name: selected.name, en: selected.en, type: selected.type || null }, signal: selected.signal, vwName: pick.name, duel: true };
  $('workErr').hidden = true;
  workReset('model');
  go('#/praca'); show('vWork');
  const done = (val, sm, note) => {
    duelClear();
    DUEL = { file, url: URL.createObjectURL(file), val, cam: val, hold, adj: false, live, note: note || '',
      dur: Math.round((sm && sm.video && sm.video.duration_s) || 0) };
    go('#/suboj');
  };
  try {
    const onProgress = (p, t) => {
      setProgress(p, t);
      const st = /model/i.test(t || '') ? 'model' : p >= 0.91 ? 'frames' : p > 0 ? 'scan' : AN.stage;
      if (st !== AN.stage || st === 'scan') { AN.stage = st; AN.p = Math.min(1, Math.max(0, (p - 0.05) / 0.85)); renderSteps(); }
    };
    // dlhšia séria → viac snímok (aspoň ~6 za sekundu), aby sa nestratilo ani rýchle opakovanie
    const { summary: sm, clip } = await analyzeVideo(file, { signal: selected.signal, posture: selected.posture ?? null, minAmp: selected.minAmp ?? 25, start: selected.start ?? null,
      type: selected.type ?? null, target: selected.target ?? null, holdJoint: selected.holdJoint ?? null, duel: true, maxSeconds: maxRec(), maxFrames: hold ? 500 : 900, onProgress, onFrame: workFrame });
    workMeasured(sm, clip);
    let val = hold ? Math.round(sm.hold?.duration_s || 0) : (sm.exercise_type === 'hold' ? 0 : (sm.reps_detected || 0));
    if (!val && live) val = live; // celé video nedalo výsledok – počet z nahrávania
    done(val, sm);
  } catch (e) {
    console.error(e);
    if (live > 0) { done(live, null, 'live'); return; } // aspoň počet z nahrávania (kostra počas natáčania)
    showError(e && e.user ? e.message : 'Video sa nepodarilo spracovať. Skús to znova, prípadne natoč sériu znova.', false, !(e && e.again === false));
    $('workTitle').textContent = AN.isHold ? 'Výdrž sa nepodarilo zmerať' : 'Opakovania sa nepodarilo spočítať';
    $('btnBack').textContent = 'Natočiť znova';
    current = null;
  }
}
function renderDuel() {
  const D = DUEL, g = vwDuel, hold = D.hold;
  const unit = (n) => hold ? plural(n, 'sekunda', 'sekundy', 'sekúnd') : plural(n, 'opakovanie', 'opakovania', 'opakovaní');
  const who = g.who || 'súper';
  $('vResult').innerHTML = `
    <div class="du">
      <h1 class="du-h1">${esc(pick.name)}</h1>
      <div class="du-vid"><video id="duVid" playsinline muted loop autoplay controls preload="auto"></video></div>
      <section class="du-card" aria-live="polite">
        <div class="du-row">
          <div class="du-num"><b id="duN"></b><span id="duU"></span></div>
          <div class="du-step" role="group" aria-label="Upraviť počet">
            <button type="button" id="duMinus" aria-label="O jedno menej">−</button>
            <button type="button" id="duPlus" aria-label="O jedno viac">+</button>
          </div>
        </div>
        <div class="du-ver" id="duVer"></div>
        ${g.goal ? '<div class="du-cmp" id="duCmp"></div>' : ''}
      </section>
      <p class="du-note" id="duNote"></p>
      <div class="stickybar vwbar">
        <button class="btn pri" id="btnDuelUse">${ICON_CHECK}Zapísať do výzvy</button>
        <button class="btn sec" id="btnDuelAgain"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>Natočiť znova</button>
      </div>
    </div>`;
  const v = $('duVid'); v.src = D.url; v.play().catch(() => {});
  const upd = () => {
    D.adj = D.val !== D.cam;
    $('duN').textContent = D.val; $('duU').textContent = unit(D.val);
    const ver = $('duVer');
    ver.className = 'du-ver' + (D.adj ? ' adj' : !D.val ? ' none' : '');
    ver.innerHTML = D.adj ? `Upravené ručne · kamera ${hold ? 'namerala' : 'napočítala'} ${D.cam}${hold ? ' s' : ''}`
      : !D.val ? (hold ? 'Výdrž som nenašiel' : 'Opakovania som nenašiel')
      : `${IC.check}<span>${hold ? 'Zmerané kamerou' : 'Spočítané kamerou'}${D.note === 'live' ? ' počas nahrávania' : ''}</span>`;
    if ($('duCmp')) {
      const d0 = D.val - g.goal, n = Math.abs(d0);
      $('duCmp').className = 'du-cmp' + (d0 > 0 ? ' win' : d0 < 0 ? ' lose' : '');
      $('duCmp').textContent = d0 > 0 ? `Vyhrávaš – o ${n}${hold ? ' s' : ''} viac ako ${who} (${g.goal}${hold ? ' s' : ''})`
        : d0 < 0 ? `${who} má ${g.goal}${hold ? ' s' : ''} – ${n === 1 ? 'chýba' : n <= 4 ? 'chýbajú' : 'chýba'} ti ${n}${hold ? ' s' : ''}` : `Remíza – ${who} má tiež ${g.goal}${hold ? ' s' : ''}`;
    }
    $('duNote').textContent = !D.val ? 'Natoč sériu znova – celé telo v zábere, zboku a pri dobrom svetle. Počet môžeš upraviť aj ručne.'
      : `Číslo sa zapíše do výzvy a video uvidí ${who === 'súper' ? 'súper' : who}. Ak počet nesedí, uprav ho – pri výsledku bude vidno, že je upravený.`;
    $('duMinus').disabled = D.val <= 0;
    $('btnDuelUse').disabled = D.val <= 0;
  };
  upd();
  $('duMinus').onclick = () => { if (D.val > 0) { D.val -= 1; upd(); } };
  $('duPlus').onclick = () => { if (D.val < 100000) { D.val += 1; upd(); } };
  $('btnDuelUse').onclick = () => {
    if (D.val <= 0) return;
    $('btnDuelUse').disabled = true;
    vwPost('duel', { val: D.val, cam: D.cam, adj: D.adj, hold: D.hold, dur: D.dur, live: D.note === 'live', file: D.file, mime: D.file.type || '', size: D.file.size || 0 });
  };
  $('btnDuelAgain').onclick = () => { duelClear(); go('#/nova'); };
}

// true = server chce kód a ten uložený nesedí; pri výpadku siete pokračujeme (chyba príde neskôr)
async function accessDenied() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    let res = await fetch('/api/analyze', { headers: await apiHeaders(), cache: 'no-store', signal: ctrl.signal });
    if (res.status === 401 && VW) res = await fetch('/api/analyze', { headers: await apiHeaders(true), cache: 'no-store', signal: ctrl.signal });
    clearTimeout(t);
    return res.status === 401;
  } catch { return false; }
}

// hlavičky pre server: prístupový kód (hrazda) a v appke prihlásenie používateľa (token z appky)
async function apiHeaders(force = false) {
  const h = { 'x-access-code': ls.get('vt-code') || '' };
  if (VW) { const tk = await vwToken(force); if (tk) h.Authorization = 'Bearer ' + tk; }
  return h;
}
// prístupový kód zadáva len hrazda; ostatní v appke používajú prihlásenie
const needCodeBox = () => !VW || vwHz;

// ---------- v appke: počet rozborov (bez Pro 2 spolu, s Pro 10 mesačne; hrazda bez obmedzenia) ----------
let QUOTA = null; // { plan: 'free' | 'pro', used, limit, left, reset?, pro? }
let quotaAt = 0;
async function loadQuota(force = false) {
  if (!VW) return null;
  if (!force && quotaAt && Date.now() - quotaAt < 60000) { renderQuota(); return QUOTA; }
  try {
    let res = await fetch('/api/quota', { headers: await apiHeaders(), cache: 'no-store' });
    if (res.status === 401) res = await fetch('/api/quota', { headers: await apiHeaders(true), cache: 'no-store' });
    if (res.ok) setQuota(await res.json());
  } catch { /* bez siete: obmedzenie overí server pri rozbore */ }
  return QUOTA;
}
function setQuota(j) {
  if (!j || typeof j !== 'object') return;
  QUOTA = (j.plan === 'free' || j.plan === 'pro') && typeof j.left === 'number' ? j : null; // hrazda: bez obmedzenia
  quotaAt = Date.now();
  renderQuota();
}
const zostava = (n) => (n >= 2 && n <= 4 ? 'zostávajú' : 'zostáva');
const resetDay = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${Number(m[3])}. ${Number(m[2])}.` : 'začiatku budúceho mesiaca'; };
function renderQuota() {
  const line = $('newQuota'), box = $('newLimit');
  if (!VW || !line || !box) return;
  const q = QUOTA, out = !!(q && q.left <= 0);
  line.hidden = !q || out;
  if (q && !out) line.textContent = q.plan === 'pro'
    ? `Tento mesiac ti ${zostava(q.left)} ${q.left} z ${q.limit} rozborov techniky.`
    : `Zadarmo ti ${zostava(q.left)} ${q.left} z ${q.limit} rozborov techniky.`;
  box.hidden = !out;
  box.innerHTML = !out ? '' : q.plan === 'pro'
    ? `<b>Tento mesiac si využil všetkých ${q.limit} rozborov</b><span>Ďalšie rozbory techniky budeš mať od ${esc(resetDay(q.reset))}</span>`
    : `<b>Využil si ${q.limit} ${plural(q.limit, 'rozbor', 'rozbory', 'rozborov')} zadarmo</b><span>S Pro máš ${q.pro || 10} rozborov techniky každý mesiac, k tomu všetky plány a štatistiky.</span><button class="btn pri" id="btnGoPro">Odomknúť Pro</button>`;
  on('btnGoPro', () => vwPost('pro'));
  hide('btnRec', out); hide('lblFile', out);
}

// kritériá na 100 bodov pre AI: zo zvoleného cviku, v appke aj z cviku spárovaného s názvom z appky
function criteriaFor(cur) {
  const e = cur.exercise && cur.exercise.id !== 'auto' ? findExercise(cur.exercise.id) : (VW && pick && pick.guide) || null;
  return e && Array.isArray(e.top) ? e.top : [];
}
async function runAi() {
  $('workErr').hidden = true;
  if (VW) { AN.stage = 'ai'; AN.ai = 0; workHead(); hide('workBand', false); hide('workBottom', false); $('workSteps').classList.remove('stopped'); renderSteps(); }
  setProgress(0.55, 'AI porovnáva tvoj pohyb so správnou technikou… (zvyčajne do minúty)');
  let fake = 0.55;
  const tick = setInterval(() => {
    fake = Math.min(0.95, fake + 0.01); setProgress(fake);
    if (VW && AN.stage === 'ai') { AN.ai = Math.min(0.95, (fake - 0.55) / 0.4); renderSteps(); }
  }, 700);
  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(), 150_000); // poistka, aby appka nevisela donekonečna
  try {
    const payload = JSON.stringify({ exercise: current.exercise, summary: current.summary, keyframes: current.keyframes, criteria: criteriaFor(current) });
    const call = async (force) => fetch('/api/analyze', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', ...(await apiHeaders(force)) },
      body: payload,
    });
    let res = await call(false);
    if (res.status === 401 && VW) res = await call(true); // prihlásenie z appky vypršalo – appka ho obnoví
    const data = await res.json().catch(() => ({ error: 'Server teraz neodpovedá. Skús to o chvíľu znova – video netreba nahrávať znova.', detail: `HTTP ${res.status}` }));
    if (data && data.quota) setQuota(data.quota);
    if (!res.ok) {
      if (data.detail) console.warn('Rozbor – detail chyby:', data.detail);
      const err = new Error(data.error || 'Rozbor sa nepodaril. Skús to znova.'); err.code = data.code; err.user = true; throw err;
    }
    current.result = data.result; current.sources = data.sources || [];
    const sv = await db.save(current);
    current.saveSt = sv.st; current.saveErr = sv.err || '';
    db.pruneClips(15);
    if (VW) { vwPost('result', { data: vwSummary(current) }); AN.stage = 'done'; renderSteps(); } // hlavná appka si uloží skóre (domov, profil)
    setProgress(1, 'Hotovo');
    go('#/r/' + current.id);
  } catch (e) {
    console.error(e);
    const msg = e.code === 'auth' ? (needCodeBox() ? 'Táto appka je chránená prístupovým kódom.' : e.message || 'Rozbor techniky funguje po prihlásení v appke.')
      : e.name === 'AbortError' ? 'Server neodpovedal včas. Skontroluj internet a skús to znova – video netreba nahrávať znova.'
      : e.user ? e.message
      : 'Nepodarilo sa spojiť so serverom. Skontroluj internet a skús to znova – video netreba nahrávať znova.';
    if (e.code === 'limit') { // rozbory došli (napr. na inom zariadení medzitým)
      showError(msg, false, false);
      if (VW) { $('workTitle').textContent = 'Rozbory techniky sa minuli'; $('workSub').textContent = QUOTA && QUOTA.plan === 'pro' ? 'Ďalšie budeš mať od ' + resetDay(QUOTA.reset) : 'Ďalšie rozbory sú v Pro'; }
      hide('btnErrPro', !(VW && QUOTA && QUOTA.plan === 'free'));
      $('btnBack').textContent = 'Späť';
      return;
    }
    showError(msg, e.code === 'auth' && needCodeBox(), e.code !== 'auth' || needCodeBox());
  } finally { clearInterval(tick); clearTimeout(killer); }
}

on('btnErrPro', () => vwPost('pro'));
$('btnRetry').onclick = () => {
  if (!$('codeBox').hidden) ls.set('vt-code', $('codeInput').value.trim());
  $('workErr').hidden = true;
  if (current && current.summary && !vwDuel) { go('#/praca'); runAi(); }
  else if (pendingFile) startAnalysis(pendingFile);
};
$('btnBack').onclick = () => { go('#/nova'); };

// krátky súhrn rozboru pre hlavnú appku (domov, profil, zápis do tréningu)
function vwSummary(item) {
  const r = cleanResult(item.result), sm = item.summary || {};
  const isH = sm.exercise_type === 'hold';
  const t = todayOf(r);
  return {
    id: item.id, t: item.created, eid: item.vwEid || '',
    name: item.vwName || r.exercise?.name || item.exercise?.name || 'Cvik',
    score: typeof r.score === 'number' ? Math.max(0, Math.min(100, Math.round(r.score))) : null,
    reps: isH ? 0 : (sm.reps_detected || 0),
    hold: isH ? Math.round(sm.hold?.duration_s || 0) : 0,
    tip: t && !t.good ? String(t.title || '') : '',
  };
}

// skóre ako krúžok v štýle hlavnej appky
function vwScoreHead(score, r, sm, reps, isH, holdS, dur) {
  const C = 2 * Math.PI * 54, pct = score != null ? score / 100 : 0;
  const lab = score == null ? 'Nedá sa ohodnotiť' : score >= 90 ? 'Výborná technika' : score >= 80 ? 'Dobrá technika' : score >= 65 ? 'Solídny základ' : score >= 50 ? 'Je čo zlepšovať' : 'Treba popracovať';
  const down = sm.tempo?.avg_down_s;
  const tl = (v, k) => `<div class="tl"><b>${v}</b><span>${k}</span></div>`;
  const tiles = isH
    ? tl(holdS + ' s', 'výdrž') + tl(dur != null ? Math.round(dur) + ' s' : '–', 'dĺžka videa') + tl(esc(String(r.exercise?.confidence || '–')), 'istota cviku')
    : tl(reps || '–', plural(reps, 'opakovanie', 'opakovania', 'opakovaní')) + tl(down != null ? String(down).replace('.', ',') + ' s' : '–', 'spúšťanie') + tl(dur != null ? Math.round(dur) + ' s' : '–', 'dĺžka série');
  return `<div class="vwscore">
    <div class="top">
      <div class="ring"><svg viewBox="0 0 124 124" role="img" aria-label="Skóre ${score ?? '?'} zo 100">
        <defs><linearGradient id="vwg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF8A5C"/><stop offset=".55" stop-color="#FF5A1F"/><stop offset="1" stop-color="#E8450F"/></linearGradient></defs>
        <circle cx="62" cy="62" r="54" fill="none" stroke="currentColor" stroke-opacity=".1" stroke-width="10"/>
        ${score != null ? `<circle cx="62" cy="62" r="54" fill="none" stroke="url(#vwg)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(C * pct).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 62 62)"/>` : ''}
      </svg><div class="num"><b>${score ?? '?'}</b><span>zo 100</span></div></div>
      <div style="min-width:0"><div class="k">TVOJE SKÓRE</div><div class="lab">${lab}</div>${r.verdict ? `<p class="vd">${esc(r.verdict)}</p>` : ''}${score == null && r.camera_limits ? `<p class="vd tip"><b>Ako natočiť:</b> ${esc(r.camera_limits)}</p>` : ''}</div>
    </div>
    <div class="tiles">${tiles}</div>
  </div>`;
}

// ---------- výsledok ----------
function scoreColor(s) {
  if (s == null) return 'var(--mu)';
  return s >= 80 ? 'var(--ok)' : s >= 55 ? 'var(--warn)' : 'var(--bad)';
}
const plural = (n, one, few, many) => n === 1 ? one : (n >= 2 && n <= 4) ? few : many;
const ckList = (arr, cls = '') => Array.isArray(arr) && arr.length ? `<ul class="ck ${cls}">${arr.map(x => `<li><span>${esc(x)}</span></li>`).join('')}</ul>` : '<p class="mu small" style="margin:0">—</p>';
const sevOrder = { 'vysoká': 0, 'stredná': 1, 'nízka': 2 };
// označenie chyby pre bežného človeka (AI posiela vysoká/stredná/nízka)
const SEV_TXT = { 'vysoká': 'hlavná chyba', 'stredná': 'dôležité', 'nízka': 'drobnosť' };
// Texty pre používateľa bez technických čísel (stupne, percentá dĺžky trupu…). Nové rozbory čistí už server,
// toto platí aj pre staršie uložené rozbory. Jednovetný opis chyby s takým číslom radšej vynechá.
const TECH_PAREN = /\s*\([^()]*(?:°|%)[^()]*\)/g;
const TECH_NUM = /\s*(?:(?:~|cca\.?|asi|okolo|približne|len|až|aspoň|takmer)\s*)*(?:(?:na|do|o|pod|nad)\s+)?~?\d+(?:[.,]\d+)?(?:\s*[–-]\s*~?\d+(?:[.,]\d+)?)?\s*(?:°|%(?:\s*(?:dĺžky|dĺžke)\s+trupu)?)/gi;
const tidyTxt = (t) => t.replace(/\s{2,}/g, ' ').replace(/\s+([.,!?;:])/g, '$1').replace(/\(\s*\)/g, '').trim();
const stripTech = (s) => (typeof s === 'string' ? tidyTxt(s.replace(TECH_PAREN, '').replace(TECH_NUM, '')) : s);
function dropTechSentences(s) {
  if (typeof s !== 'string') return s;
  const parts = s.replace(TECH_PAREN, '').split(/(?<=[.!?])\s+/).filter(Boolean);
  return tidyTxt(parts.filter(x => !/°|\d\s*%/.test(x)).join(' '));
}
function cleanResult(src) {
  let r;
  try { r = JSON.parse(JSON.stringify(src || {})); } catch { return src || {}; }
  const arr = (a) => (Array.isArray(a) ? a.map(x => (typeof x === 'string' ? stripTech(x) : x)).filter(x => x !== '') : a);
  for (const k of ['verdict', 'description', 'camera_limits']) if (typeof r[k] === 'string') r[k] = stripTech(r[k]);
  if (typeof r.summary === 'string') r.summary = dropTechSentences(r.summary) || stripTech(r.summary);
  if (r.today && typeof r.today === 'object') { r.today.title = stripTech(r.today.title); r.today.detail = stripTech(r.today.detail); }
  r.good = arr(r.good); r.watch_out = arr(r.watch_out); r.cues = arr(r.cues);
  if (Array.isArray(r.to_100)) r.to_100.forEach(x => { if (x && typeof x.step === 'string') x.step = stripTech(x.step); });
  if (Array.isArray(r.criteria_100)) r.criteria_100.forEach(x => { if (x && typeof x.text === 'string') x.text = stripTech(x.text); });
  if (Array.isArray(r.score_breakdown)) r.score_breakdown.forEach(b => { if (b && typeof b.note === 'string') b.note = dropTechSentences(b.note); });
  if (Array.isArray(r.issues)) r.issues.forEach(i => {
    if (!i || typeof i !== 'object') return;
    i.title = stripTech(i.title); i.fix = stripTech(i.fix);
    if (typeof i.detail === 'string') i.detail = dropTechSentences(i.detail);
  });
  return fixResultSk(r); // české slová (napr. „ujíždějí“) → slovenské
}

// "Jedna vec na dnes": z poľa today od AI, inak z prvého kroku k 100 bodom alebo najväčšej chyby
function todayOf(r) {
  const steps = (Array.isArray(r.to_100) ? r.to_100 : []).filter(x => x && x.step).sort((a, b) => (Number(b.gain) || 0) - (Number(a.gain) || 0));
  const issues = (Array.isArray(r.issues) ? r.issues : []).slice().sort((a, b) => (sevOrder[a.severity] ?? 1) - (sevOrder[b.severity] ?? 1));
  // bez chýb a bez krokov na 100 bodov je „vec na dnes“ len pochvala (žiadna chyba vo videu)
  const clean = typeof r.score === 'number' && !steps.length && !issues.length;
  if (r.today && r.today.title) return clean ? { good: true, title: r.today.title, detail: r.today.detail || '', gain: 0 }
    : { title: r.today.title, detail: r.today.detail || issues[0]?.fix || '', gain: Number(r.today.gain) || Number(steps[0]?.gain) || 0, frame: r.today.frame };
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
const JOINT_PTS = { knee: [25, 26], hip: [23, 24], elbow: [13, 14], shoulder: [11, 12], body_line: [23, 24] };
const JOINT_SK = { knee: 'koleno', hip: 'bok', elbow: 'lakeť', shoulder: 'rameno', body_line: 'línia' };
const P = { clip: null, urls: [], imgs: [], t: 0, playing: false, speed: 1, raf: 0, last: 0, cur: -1 };

const SPEED_TXT = (s) => VW ? (s === 1 ? '1×' : s === 0.5 ? '0,5×' : '0,25×') : (s === 1 ? '1×' : s === 0.5 ? '½×' : '¼×');
function openPlayer(clip, jumpT, tip) {
  closePlayer();
  frReset();
  Object.assign(P, { clip, urls: [], imgs: [], t: 0, playing: false, speed: 1, cur: -1 });
  hide('pErr', true);
  if (VW) { openPlayerVW(clip, jumpT, tip); return; }
  const c = $('pCanvas');
  c.width = clip.w * 2; c.height = clip.h * 2;
  c.style.aspectRatio = `${clip.w} / ${clip.h}`;
  $('pSpeed').textContent = '1×';
  if (jumpT != null && jumpT <= clip.duration) {
    $('pMark').hidden = false; $('pMark').style.left = `${(100 * jumpT / clip.duration).toFixed(2)}%`;
    $('pJump').hidden = false; $('pJump').textContent = `Skočiť na chybu (${fmtT(jumpT)})`;
    $('pJump').onclick = () => { pause(); seekTo(Math.max(0, jumpT - 0.6)); P.speed = 0.5; $('pSpeed').textContent = SPEED_TXT(0.5); play(); };
  } else { $('pMark').hidden = true; $('pJump').hidden = true; }
  $('player').hidden = false;
  seekTo(0);
  play();
}
function closePlayer() {
  if (!P.clip) return;
  pause();
  frReset();
  Object.assign(P, { clip: null, urls: [], imgs: [] });
  $('player').hidden = true;
}
// Snímky prehrávača sú JPEG Bloby (pri staršom rozbore z IndexedDB). Na iPhone sa niekedy nenačítajú
// cez blob: URL a pri veľa naraz dekódovaných snímkach dôjde pamäť – video ostane prázdne. Preto:
// ImageBitmap priamo z Blobu, pri chybe <img>, potom kópia dát do pamäte a nový pokus; v pamäti
// držíme len snímky okolo práve prehrávanej a kým sa snímka načíta, ukážeme najbližšiu načítanú.
const FR = { cache: new Map(), pend: new Set(), ok: 0, fail: 0, gen: 0 };
function frReset() {
  FR.gen++;
  FR.cache.forEach(d => { try { if (d.close) d.close(); } catch { /* nič */ } });
  FR.cache.clear(); FR.pend.clear(); FR.ok = 0; FR.fail = 0; FR.shown = false;
}
function imgFromBlob(b) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(b), im = new Image();
    im.onload = () => { URL.revokeObjectURL(u); if (im.naturalWidth) res(im); else rej(new Error('prázdna snímka')); };
    im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('snímka sa nenačítala')); };
    im.src = u;
  });
}
async function decodeFrame(blob) {
  if (!blob) throw new Error('chýba snímka');
  if (window.createImageBitmap) { try { return await createImageBitmap(blob); } catch { /* ďalší spôsob */ } }
  try { return await imgFromBlob(blob); } catch { /* ďalší spôsob */ }
  const copy = new Blob([await blob.arrayBuffer()], { type: blob.type || 'image/jpeg' }); // Blob z IndexedDB → pamäť
  if (window.createImageBitmap) { try { return await createImageBitmap(copy); } catch { /* ďalší spôsob */ } }
  return imgFromBlob(copy);
}
function frLoad(i) {
  const clip = P.clip;
  if (!clip || i < 0 || i >= clip.frames.length || FR.cache.has(i) || FR.pend.has(i) || FR.pend.size >= 4) return;
  const gen = FR.gen;
  FR.pend.add(i);
  decodeFrame(clip.frames[i].img).then((d) => {
    if (gen !== FR.gen) { try { if (d.close) d.close(); } catch { /* nič */ } return; }
    FR.pend.delete(i); FR.cache.set(i, d); FR.ok++;
    hide('pErr', true);
    frTrim();
    if (P.clip && !FR.shown) drawFrame(P.cur); // prvá snímka
    else if (P.clip && P.cur === i) drawFrame(i);
    frPrefetch(P.cur);
  }, (e) => {
    if (gen !== FR.gen) return;
    FR.pend.delete(i); FR.cache.set(i, null); FR.fail++;
    console.warn('Technika: snímka videa sa nenačítala', i, e && e.message);
    if (!FR.ok && FR.fail >= 3) hide('pErr', false); // ani jedna snímka sa nedá zobraziť
    frPrefetch(P.cur);
  });
}
function frPrefetch(i) {
  if (!P.clip || i < 0) return;
  for (const k of [i, i + 1, i + 2, i - 1, i + 3, i + 4, i + 6, i + 8, i + 10, i + 12]) frLoad(k);
}
function frTrim() {
  if (FR.cache.size <= 70) return;
  for (const [k, d] of FR.cache) {
    if (Math.abs(k - P.cur) <= 30) continue;
    try { if (d && d.close) d.close(); } catch { /* nič */ }
    FR.cache.delete(k);
  }
}
// snímka na kreslenie: požadovaná, inak najbližšia už načítaná (index snímky + obraz)
function frPick(i) {
  frPrefetch(i);
  const d = FR.cache.get(i);
  if (d) return [i, d];
  for (let k = 1; k <= 20; k++) {
    const a = FR.cache.get(i - k); if (a) return [i - k, a];
    const b = FR.cache.get(i + k); if (b) return [i + k, b];
  }
  return null;
}
function idxAt(t) {
  const fr = P.clip.frames;
  let i = Math.min(fr.length - 1, Math.max(0, Math.round(t * P.clip.fps)));
  while (i > 0 && fr[i].t > t) i--;
  while (i < fr.length - 1 && fr[i + 1].t <= t) i++;
  return i;
}
// ---------- v appke: Video analýzy podľa návrhu ----------
const JTRI = { knee: [[23, 25, 27], [24, 26, 28]], hip: [[11, 23, 25], [12, 24, 26]], elbow: [[11, 13, 15], [12, 14, 16]], shoulder: [[13, 11, 23], [14, 12, 24]], body_line: [[11, 23, 27], [12, 24, 28]] };
function openPlayerVW(clip, jumpT, tip) {
  const reps = clip.reps || [];
  // úsek s chybou: opakovanie, v ktorom je snímka s chybou (pri výdrži ±1 s okolo nej)
  let prob = null, probRep = -1;
  if (jumpT != null && jumpT <= clip.duration + 0.5) {
    probRep = reps.findIndex(r => jumpT >= r.s - 0.25 && jumpT <= r.e + 0.25);
    if (probRep < 0 && reps.length) probRep = reps.reduce((a, r, k) => (Math.abs(r.b - jumpT) < Math.abs(reps[a].b - jumpT) ? k : a), 0);
    prob = probRep >= 0 ? { s: reps[probRep].s, e: reps[probRep].e } : { s: Math.max(0, jumpT - 1), e: Math.min(clip.duration, jumpT + 1) };
  }
  P.prob = prob; P.probRep = probRep; P.tip = tip && !tip.good && tip.title ? tip : null;
  const D = clip.duration || 1, pc = (t) => `${(100 * Math.max(0, Math.min(D, t)) / D).toFixed(2)}%`;
  hide('pProb', !prob);
  if (prob) { $('pProb').style.left = pc(prob.s); $('pProb').style.width = `${(100 * (prob.e - prob.s) / D).toFixed(2)}%`; }
  $('pRepLbl').textContent = probRep >= 0 ? `opak. ${probRep + 1}` : prob ? 'chyba' : '';
  $('pReps').innerHTML = reps.map((r, k) => `<button data-k="${k}" style="left:${pc(r.b)}" class="${k === probRep ? 'bad' : ''}">${k + 1}</button>`).join('');
  $('pReps').querySelectorAll('button').forEach(b => b.onclick = () => { seekTo(Math.max(0, reps[Number(b.dataset.k)].s - 0.15)); });
  $('pTipT').textContent = P.tip ? P.tip.title : ''; $('pTipD').textContent = P.tip ? (P.tip.detail || '') : '';
  hide('pPrev', false); hide('pNext', false);
  $('pPrev').setAttribute('aria-label', reps.length ? 'Predchádzajúce opakovanie' : 'O sekundu späť');
  $('pNext').setAttribute('aria-label', reps.length ? 'Ďalšie opakovanie' : 'O sekundu ďalej');
  $('player').hidden = false;
  P.speed = prob ? 0.5 : 1; $('pSpeed').textContent = SPEED_TXT(P.speed);
  seekTo(prob ? Math.max(0, prob.s - 0.4) : 0);
  play();
}
function vpUpdate(t) {
  if (!VW || !P.clip) return;
  const clip = P.clip, D = clip.duration || 1, reps = clip.reps || [], pc = `${(100 * t / D).toFixed(2)}%`;
  $('pFill').style.width = pc; $('pThumb').style.left = pc;
  $('pTime').textContent = `${fmtT(t)} / ${fmtT(D)}`;
  const k = reps.findIndex(r => t >= r.s && t <= r.e), done = reps.filter(r => r.e < t).length, hold = clip.hold;
  $('pSub').textContent = hold ? (t < hold.s ? 'Príprava' : t <= hold.e ? `Výdrž ${fmtT(t - hold.s)}` : `Výdrž ${fmtT(hold.e - hold.s)} · koniec`)
    : k >= 0 ? `Opakovanie ${k + 1} z ${reps.length}` : reps.length && done === reps.length ? `Hotovo · ${reps.length} ${plural(reps.length, 'opakovanie', 'opakovania', 'opakovaní')}`
    : reps.length ? (done ? `Opakovanie ${done} z ${reps.length}` : 'Príprava') : 'Celé video';
  $('pReps').querySelectorAll('button').forEach((b, j) => b.classList.toggle('cur', j === k));
  hide('pTip', !(P.tip && P.prob && t >= P.prob.s - 0.25 && t <= P.prob.e + 0.25));
}
function drawFrameVW(i) {
  const clip = P.clip, c = $('pCanvas');
  const got = frPick(i);
  if (!got) return; // ešte sa nenačítala žiadna snímka – nakreslí sa po načítaní
  if (!c.clientWidth || !c.clientHeight) { requestAnimationFrame(() => { if (P.clip && P.cur === i) drawFrameVW(i); }); return; }
  const [fi, im] = got, f = clip.frames[fi];
  FR.shown = true;
  const out = drawPoseFrame(c, im, clip.w, clip.h, clipPts(f.lm), { r: 5.5, lw: 3, hi: clip.joint, bg: '#0B101D' });
  // uhol hlavného kĺbu: oblúk a štítok (napr. „Lakeť 87°“)
  const tri = JTRI[clip.joint]?.[clip.side === 'L' ? 0 : 1];
  if (!out || !tri || f.a == null) return;
  const [A, B, C] = tri.map(id => out.P[id]);
  if (![A, B, C].every(q => q && q[2] >= 0.35)) return;
  const g = out.g, a1 = Math.atan2(A[1] - B[1], A[0] - B[0]);
  let d = Math.atan2(C[1] - B[1], C[0] - B[0]) - a1;
  while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  g.beginPath(); g.arc(B[0], B[1], 20, a1, a1 + d, d < 0); g.lineWidth = 3.5; g.lineCap = 'round'; g.strokeStyle = '#FFB547'; g.stroke();
  const name = JOINT_SK[clip.joint] || ''; const txt = `${name.charAt(0).toUpperCase() + name.slice(1)} ${f.a}°`;
  g.font = '900 13px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif';
  const tw = g.measureText(txt).width, bw = tw + 18, bh = 26;
  const left = B[0] < out.CW / 2;
  let bx = left ? B[0] - 28 - bw : B[0] + 28, by = B[1] + 14;
  bx = Math.max(8, Math.min(out.CW - bw - 8, bx)); by = Math.max(8, Math.min(out.CH - bh - 8, by));
  g.beginPath(); g.roundRect ? g.roundRect(bx, by, bw, bh, 10) : g.rect(bx, by, bw, bh);
  g.fillStyle = 'rgba(11,16,29,.78)'; g.fill(); g.lineWidth = 1; g.strokeStyle = 'rgba(255,181,71,.55)'; g.stroke();
  g.fillStyle = '#FFB547'; g.textBaseline = 'middle'; g.fillText(txt, bx + 9, by + bh / 2 + 0.5); g.textBaseline = 'alphabetic';
}
function playerStep(dir) {
  if (!P.clip) return;
  const reps = P.clip.reps || [];
  if (!reps.length) { seekTo(P.t + dir); return; }
  const i = reps.findIndex(r => P.t >= r.s - 0.05 && P.t <= r.e);
  let k;
  if (dir > 0) k = reps.findIndex(r => r.s > P.t + 0.05);
  else { const cur = i >= 0 ? i : reps.filter(r => r.e < P.t).length - 1; k = i >= 0 && P.t - reps[i].s > 0.4 ? i : cur - (i >= 0 ? 1 : 0); }
  if (k == null || k < 0 || k >= reps.length) { if (dir < 0) seekTo(0); return; }
  seekTo(Math.max(0, reps[k].s - 0.15));
}
on('pPrev', () => playerStep(-1));
on('pNext', () => playerStep(1));
window.addEventListener('resize', () => { if (VW && P.clip && P.cur >= 0) drawFrameVW(P.cur); });
// prehrávač sa môže zobraziť skôr, než má plocha rozmery (animácia, otočenie) – po zmene veľkosti prekresliť
if (window.ResizeObserver && $('pStage')) new ResizeObserver(() => { if (VW && P.clip && P.cur >= 0) drawFrameVW(P.cur); }).observe($('pStage'));

function drawFrame(i) {
  if (!P.clip) return;
  if (VW) { drawFrameVW(i); return; }
  const clip = P.clip, got = frPick(i);
  if (!got) return;
  const [fi, im] = got, f = clip.frames[fi];
  FR.shown = true;
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
  const hold = clip.hold;
  const label = hold ? (t < hold.s ? 'Príprava' : t <= hold.e ? `Výdrž ${fmtT(t - hold.s)}` : `Výdrž ${fmtT(hold.e - hold.s)} · koniec`)
    : k >= 0 ? `Opakovanie ${k + 1} / ${reps.length}` : reps.length && done === reps.length ? `Hotovo · ${reps.length} opak.` : reps.length ? (done ? `Opakovanie ${done} / ${reps.length}` : 'Príprava') : '';
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
  vpUpdate(P.t);
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
  vpUpdate(t);
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
$('pSpeed').onclick = () => { P.speed = P.speed === 1 ? 0.5 : P.speed === 0.5 ? 0.25 : 1; $('pSpeed').textContent = SPEED_TXT(P.speed); };
$('btnPlayerClose').onclick = closePlayer;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && P.clip) closePlayer(); });

function renderResult(item) {
  const r = cleanResult(item.result);
  const ex = r.exercise || {};
  const score = typeof r.score === 'number' ? Math.max(0, Math.min(100, Math.round(r.score))) : null;
  // upozornenie na iný cvik len keď ho AI naozaj rozpoznala a ohodnotila (pri nepoužiteľnom videe nie)
  const mismatch = item.exercise.id !== 'auto' && ex.matches_selected === false && score != null;
  const chosenName = (VW && item.vwName) || item.exercise.name;
  const sm = item.summary || {};
  const reps = sm.reps_detected || 0;
  const isH = sm.exercise_type === 'hold';
  const holdS = isH ? Math.round(sm.hold?.duration_s || 0) : 0;
  const holdKey = sm.hold?.joint || 'body_line';
  const holdAngle = isH ? sm.hold_metrics?.[holdKey]?.median : null;
  const act = sm.active_segment;
  const dur = act ? Math.max(0, act.end_s - act.start_s) : sm.video?.analyzed_s;
  const view = (sm.camera_view_estimate || '').replace(' alebo zozadu', '').replace(' (asi 45°)', '');
  const issues = (Array.isArray(r.issues) ? r.issues : []).slice().sort((a, b) => (sevOrder[a.severity] ?? 1) - (sevOrder[b.severity] ?? 1));
  const prim = r.muscles?.primary || [], sec = r.muscles?.secondary || [];
  const breakdown = Array.isArray(r.score_breakdown) ? r.score_breakdown : [];
  const to100 = (Array.isArray(r.to_100) ? r.to_100 : []).filter(x => x && x.step).sort((a, b) => (Number(b.gain) || 0) - (Number(a.gain) || 0));
  const missing = score != null ? 100 - score : null;
  const crit = (Array.isArray(r.criteria_100) ? r.criteria_100 : []).filter(c => c && typeof c.text === 'string' && c.text);
  const critOk = crit.filter(c => c.met === true).length;
  const today = todayOf(r);
  const frame = focusFrame(item, today);
  const after = today && today.gain && score != null ? Math.min(100, score + today.gain) : null;
  const hasClip = !!(item.clip && item.clip.frames && item.clip.frames.length);
  const errT = today && !today.good && frame ? Number(frame.t) : null;

  // v appke: zápis do tréningu (z rozbehnutej série) alebo návrat do appky
  const vwUse = VW && vwFrom === 'set' ? (isH ? (holdS > 0 ? { hold: holdS, label: `Zapísať ${holdS} s do tréningu` } : null)
    : (reps > 0 ? { reps, label: `Zapísať ${reps} ${plural(reps, 'opakovanie', 'opakovania', 'opakovaní')} do tréningu` } : null)) : null;

  $('vResult').innerHTML = `
    <div class="rmeta">${esc((VW && item.vwName) || ex.name || item.exercise.name)}${isH ? ` · výdrž ${holdS} s` : reps ? ` · ${reps} ${plural(reps, 'opakovanie', 'opakovania', 'opakovaní')}` : ''}</div>
    ${mismatch ? `<div class="card err mismatch"><b>Pozor:</b> ${ex.name && ex.name !== chosenName ? `Podľa AI je na videu skôr ${esc(ex.name)}, nie ${esc(chosenName)}.` : `AI si myslí, že na videu je iný cvik, než si vybral (${esc(chosenName)}).`} Ak to nesedí, vyber správny cvik v celom rozbore dole.</div>` : ''}
    ${VW ? vwScoreHead(score, r, sm, reps, isH, holdS, dur) : `<div class="bigscore"><span class="n" style="color:${scoreColor(score)}">${score ?? '?'}</span><span class="of">/100</span></div>
    <p class="rverdict">${esc(r.verdict || '')}</p>`}

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

    ${item.saveSt === '' && item.saveErr ? `<div class="card err savewarn"><b>Rozbor sa nepodarilo uložiť do telefónu.</b> Teraz ho vidíš, ale po zatvorení sa k nemu už nevrátiš. Skús uvoľniť miesto v telefóne.<small>${esc(item.saveErr)}</small></div>`
      : (item.saveSt === 'lite' || item.saveSt === 'noclip') && item.saveErr ? `<p class="savenote">Video tejto série sa do telefónu neuložilo, rozbor áno.<small>${esc(item.saveErr)}</small></p>` : ''}

    <button class="fullbtn" id="btnFull" aria-expanded="false" aria-controls="full">
      <span class="fi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg></span>
      <span class="ft"><b id="btnFullT">Zobraziť celý rozbor</b><span id="btnFullS">Cesta k 100 bodom, chyby, svaly a snímky</span></span>
      <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
    </button>

    <div class="full" id="full" hidden>
      <div class="stats">
        ${isH ? `<div class="stat"><b>${holdS} s</b><span>výdrž</span></div>
        <div class="stat"><b>${holdAngle != null ? holdAngle + '°' : '–'}</b><span>${holdKey === 'hip' ? 'uhol v bokoch' : 'línia tela'}</span></div>`
        : `<div class="stat"><b>${reps || '–'}</b><span>${plural(reps, 'opakovanie', 'opakovania', 'opakovaní')}</span></div>
        <div class="stat"><b>${dur != null ? Math.round(dur) + ' s' : '–'}</b><span>dĺžka série</span></div>`}
        <div class="stat"><b style="font-size:17px;line-height:29px">${esc(view || '–')}</b><span>pohľad kamery</span></div>
      </div>
      ${r.summary ? `<p class="sum">${esc(r.summary)}</p>` : ''}

      ${score != null && (breakdown.length || to100.length || crit.length) ? `
      <div class="card">
        <div class="sec"><div class="ic acc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg></div><h2>${missing === 0 ? 'Plný počet – 100 bodov' : 'Cesta k 100 bodom'}</h2>${missing ? `<span class="cnt">chýba ${missing} b.</span>` : ''}</div>
        ${crit.length ? `<div class="c100h"><span>Kritériá na 100 bodov</span><span><b>${critOk}</b> z ${crit.length} splnených</span></div>
        <ul class="ck">${crit.map(c => `<li class="${c.met === false ? 'no' : c.met == null ? 'na' : ''}"><span>${esc(c.text)}${c.met == null ? '<small> · z tohto videa sa nedá posúdiť</small>' : ''}</span></li>`).join('')}</ul>` : ''}
        ${breakdown.length ? `<div class="bd"${crit.length ? ' style="margin-top:14px"' : ''}>${breakdown.map(b => {
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
            <div class="tt">${esc(i.title)}${i.severity ? `<span class="sev">${esc(SEV_TXT[i.severity] || i.severity)}</span>` : ''}</div>
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
    ${VW && vwHz ? '<div id="cmpBox"></div>' : ''}
    ${VW ? '<div id="resHist"></div>' : ''}

    ${VW ? `<div class="stickybar vwbar">
      <button class="btn pri" id="btnVwMain">${vwUse ? `${ICON_CHECK}${esc(vwUse.label)}` : 'Hotovo'}</button>
      <button class="btn sec" id="btnAgain"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>${score == null ? 'Natočiť znova' : 'Skúsiť znova lepšie'}</button>
    </div>` : `<div class="stickybar"><button class="btn pri" id="btnAgain">${score == null ? 'Natočiť znova' : today && !today.good ? 'Skúsiť to opraviť' : 'Natočiť ďalšiu sériu'}</button></div>`}
  `;
  if ($('btnVwMain')) $('btnVwMain').onclick = () => { if (vwUse) vwPost('use', { reps: vwUse.reps || 0, hold: vwUse.hold || 0 }); else vwPost('close'); };
  if (VW) fillResHist(item);
  if (VW && vwHz) fillCmp(item);

  if ($('btnSee')) $('btnSee').onclick = () => hasClip ? openPlayer(item.clip, errT, today) : openViewer(frame);
  $('vResult').querySelectorAll('.frames button').forEach(b => b.onclick = () => openViewer(item.keyframes[Number(b.dataset.k)]));
  $('btnFull').onclick = () => {
    const open = $('full').hidden;
    $('full').hidden = !open;
    $('btnFullT').textContent = open ? 'Skryť celý rozbor' : 'Zobraziť celý rozbor';
    $('btnFullS').textContent = open ? 'Zbaliť podrobnosti' : 'Cesta k 100 bodom, chyby, svaly a snímky';
    $('btnFull').setAttribute('aria-expanded', String(open));
  };
  $('btnAgain').onclick = () => {
    const exId = item.exercise.id !== 'auto' ? item.exercise.id : (matchExercise(ex.name)?.id || 'auto');
    // v appke ostáva cvik z appky (napr. „Zhyby nadhmatom“), mimo appky sa vyberie zodpovedajúci cvik
    if (VW) { // v appke ostáva cvik z appky alebo z výberu (napr. „Zhyby nadhmatom“)
      const nm = item.vwName || '';
      if (!pick || (nm && pick.name !== nm)) applyPick(nm ? makePick('list', nm, { eid: item.vwEid || '' }) : makePick('list', ex.name || item.exercise.name, { id: exId === 'auto' ? null : exId }));
      go('#/nova'); return;
    }
    selectExercise(exId);
    go('#/nova');
  };
  $('btnDel').onclick = async () => {
    await db.remove(item.id);
    if (VW) { histCtx = { eid: item.vwEid || '', name: itemName(item) }; go('#/rozbory'); } else go('#/');
  };
  $('btnRe').onclick = () => {
    const e = findExercise($('reEx').value);
    current = { ...item, id: String(Date.now()), created: Date.now(), exercise: { id: e.id, name: e.name, en: e.en }, result: null, vwName: undefined, vwEid: undefined };
    if (VW) { applyPick(makePick('list', e.name, { id: e.id })); workReset('ai'); workMeasured(item.summary, item.clip); $('workSub').textContent = 'Opakujem rozbor pre ' + lowerName(e.name); }
    else { $('workTitle').textContent = 'Opakujem rozbor…'; $('workVideo').removeAttribute('src'); $('workVideo').hidden = true; }
    go('#/praca'); show('vWork'); runAi();
  };
}

// ---------- v appke: moje rozbory (predošlé natáčania) ----------
// Z profilu v appke sa otvára uložený rozbor. Keď sa v telefóne nenájde (staršie rozbory sa na iPhone niekedy
// neuložili), ukážeme rozbory, ktoré v telefóne sú – najprv tohto cviku. Pod každým rozborom sú predošlé rozbory
// toho istého cviku a odkaz na všetky.
let histCtx = null; // { eid, name } cviku pre zoznam „Všetky“
const normNm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
const itemName = (it) => (VW && it.vwName) || it.result?.exercise?.name || it.exercise?.name || 'Cvik';
const sameEx = (it, eid, nm) => !!((eid && it.vwEid === eid) || (nm && normNm(itemName(it)) === nm));
function whenLabel(ts) {
  const d = new Date(ts || 0);
  return `${dayLabel(ts)} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
const THUMB_OK = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
function histRow(it) {
  const s = typeof it.result?.score === 'number' ? Math.max(0, Math.min(100, Math.round(it.result.score))) : null;
  const th = typeof it.thumb === 'string' && THUMB_OK.test(it.thumb) ? it.thumb : '';
  const sm = it.summary || {};
  const what = sm.exercise_type === 'hold' ? (sm.hold?.duration_s ? `výdrž ${Math.round(sm.hold.duration_s)} s` : '')
    : sm.reps_detected ? `${sm.reps_detected} ${plural(sm.reps_detected, 'opakovanie', 'opakovania', 'opakovaní')}` : '';
  const name = itemName(it);
  return `<button class="pk-row hs-row" data-id="${esc(it.id)}" aria-label="Otvoriť rozbor: ${esc(name)}, ${esc(whenLabel(it.created))}${s != null ? `, ${s} ${plural(s, 'bod', 'body', 'bodov')}` : ''}">
    <span class="pk-ini hs-th"${th ? ` style="background-image:url('${th}')"` : ''}>${th ? '' : esc((name.match(/\p{L}/u) || ['C'])[0].toUpperCase())}</span>
    <span class="pk-rt"><b>${esc(name)}</b><span>${esc([whenLabel(it.created), what].filter(Boolean).join(' · '))}</span></span>
    <span class="hs-sc" style="color:${scoreColor(s)}">${s ?? '–'}</span>${IC.chev}</button>`;
}
function bindHist(root) {
  root.querySelectorAll('.hs-row').forEach(b => b.onclick = () => go('#/r/' + b.dataset.id));
}
async function renderHist({ missing = false, eid = '', name = '' } = {}) {
  const all = (await db.list()).filter(it => it && it.result);
  const nm = normNm(name);
  const mine = eid || nm ? all.filter(it => sameEx(it, eid, nm)) : [];
  const rest = all.filter(it => !mine.includes(it)).slice(0, 40);
  $('vHist').innerHTML = `
    <h1 class="pk-h1">Moje rozbory</h1>
    ${missing ? `<div class="vw-card hs-miss" role="status"><b>Tento rozbor sa nepodarilo otvoriť</b>
      <span>V telefóne sa nenašiel – starší rozbor sa pravdepodobne neuložil. Nové rozbory sa už ukladajú správne.</span></div>` : ''}
    ${mine.length ? `<div class="vw-cap">${esc(name.toUpperCase())}</div><section class="vw-card pk-list">${mine.map(histRow).join('')}</section>` : ''}
    ${rest.length ? `<div class="vw-cap${mine.length ? ' hs-cap2' : ''}">${mine.length ? 'OSTATNÉ CVIKY' : 'VŠETKY ROZBORY'}</div><section class="vw-card pk-list">${rest.map(histRow).join('')}</section>` : ''}
    ${!all.length ? '<p class="hs-empty">Zatiaľ tu nemáš žiadne uložené rozbory.</p>' : ''}
    <div class="vw-bottom"><button class="btn pri" id="btnHistNew"><span class="dot"></span>${name ? 'Natočiť ' + esc(lowerName(name)) : 'Natočiť cvik'}</button></div>`;
  bindHist($('vHist'));
  $('btnHistNew').onclick = () => {
    if (name) { applyPick(makePick('list', name, { eid })); go('#/nova'); } else go('#/vyber');
  };
}
async function fillResHist(item) {
  const box = $('resHist');
  if (!box) return;
  const all = (await db.list()).filter(it => it && it.result && it.id !== item.id);
  if (!box.isConnected || current !== item || !all.length) return;
  const eid = item.vwEid || '', name = itemName(item);
  const same = all.filter(it => sameEx(it, eid, normNm(name)));
  box.innerHTML = `<div class="vw-cap rh-cap"><span>${same.length ? 'PREDOŠLÉ ROZBORY TOHTO CVIKU' : 'MOJE ROZBORY'}</span><button class="rh-all" id="btnHistAll">Všetky ›</button></div>
    ${same.length ? `<section class="vw-card pk-list">${same.slice(0, 3).map(histRow).join('')}</section>` : ''}`;
  bindHist(box);
  $('btnHistAll').onclick = () => { histCtx = { eid, name }; go('#/rozbory'); };
}

// ---------- v appke, len hrazda: porovnanie modelov AI ----------
// Tie isté údaje a snímky z videa vyhodnotí Sonnet aj Haiku naraz; ukáže skóre, čas, cenu a celé rozbory vedľa seba.
// Výsledok sa uloží v tomto zariadení (aby sa porovnanie neplatilo znova), do profilu ani do appky nejde.
const CMP_KEY = 'vt-porovnania';
const CMP_MODELS = [['claude-sonnet-5-5', 'Sonnet 5.5', {}], ['claude-haiku-5-5', 'Haiku 5.5', { noSearch: true }]];
function cmpAll() { try { const o = JSON.parse(ls.get(CMP_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } }
function cmpSave(id, rec) {
  const all = cmpAll(); all[id] = rec;
  const out = {};
  Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0)).slice(0, 15).forEach(k => { out[k] = all[k]; });
  ls.set(CMP_KEY, JSON.stringify(out));
}
function slimRes(r) {
  const c = cleanResult(r || {});
  return { score: typeof c.score === 'number' ? Math.round(c.score) : null, verdict: c.verdict || '', today: c.today || null,
    issues: (Array.isArray(c.issues) ? c.issues : []).slice(0, 4), good: (Array.isArray(c.good) ? c.good : []).slice(0, 4),
    to_100: (Array.isArray(c.to_100) ? c.to_100 : []).slice(0, 5) };
}
function criteriaOfItem(it) {
  const e = it.exercise && it.exercise.id !== 'auto' ? findExercise(it.exercise.id) : matchExercise(itemName(it));
  return e && e.id !== 'auto' && Array.isArray(e.top) ? e.top : [];
}
const fmtX = (x) => String(x >= 10 ? Math.round(x) : Math.round(x * 10) / 10).replace('.', ',');
function cmpSummary(S, H, orig) {
  const a = S.res.score, b = H.res.score, parts = [];
  if (typeof a === 'number' && typeof b === 'number') {
    const d = b - a;
    parts.push(d === 0 ? 'Haiku dal rovnaké skóre' : `Haiku dal o ${Math.abs(d)} ${plural(Math.abs(d), 'bod', 'body', 'bodov')} ${d > 0 ? 'viac' : 'menej'}`);
  }
  if (S.ms && H.ms) parts.push(S.ms >= H.ms ? `bol ${fmtX(S.ms / H.ms)}× rýchlejší` : `bol ${fmtX(H.ms / S.ms)}× pomalší`);
  if (S.usd && H.usd) parts.push(S.usd >= H.usd ? `${fmtX(S.usd / H.usd)}× lacnejší` : `${fmtX(H.usd / S.usd)}× drahší`);
  let t = parts.length ? parts.join(', ') + '.' : '';
  if (typeof orig === 'number') t += ` Pôvodný rozbor mal ${orig} ${plural(orig, 'bod', 'body', 'bodov')}.`;
  return t.trim();
}
function cmpDetails(label, r) {
  const li = (arr, f) => (arr.length ? `<ul>${arr.map(f).join('')}</ul>` : '<p class="mu">—</p>');
  return `<details class="cmp-d"><summary>${esc(label)} – celý rozbor</summary>
    ${r.verdict ? `<p class="cmp-v">${esc(r.verdict)}</p>` : ''}
    ${r.today && r.today.title ? `<h4>JEDNA VEC NA DNES</h4><p>${esc(r.today.title)}${r.today.detail ? ` – ${esc(r.today.detail)}` : ''}</p>` : ''}
    <h4>ČO ZLEPŠIŤ</h4>${li(r.issues || [], i => `<li><b>${esc(i.title || '')}</b>${i.severity ? ` <small>(${esc(SEV_TXT[i.severity] || i.severity)})</small>` : ''}${i.fix ? `<br>${esc(i.fix)}` : ''}</li>`)}
    <h4>ČO ROBÍŠ DOBRE</h4>${li(r.good || [], g => `<li>${esc(g)}</li>`)}
    ${(r.to_100 || []).length ? `<h4>CESTA K 100 BODOM</h4>${li(r.to_100, x => `<li>${esc(x.step || '')}${Number(x.gain) ? ` <b>+${Math.round(Number(x.gain))}</b>` : ''}</li>`)}` : ''}
  </details>`;
}
function renderCmp(box, item, rec, live) {
  const runs = live || (rec && rec.runs) || null;
  const usd = (v) => (v == null ? '–' : v.toFixed(3).replace('.', ',') + ' $');
  const sec = (ms) => (ms == null ? '–' : Math.max(1, Math.round(ms / 1000)) + ' s');
  const cell = (m, f) => { const r = runs && runs[m]; return r && r.busy ? '<i class="cmp-spin" aria-label="Pracuje"></i>' : r && r.err ? '<span class="cmp-err">chyba</span>' : r && r.res ? f(r) : '–'; };
  const [mS, mH] = CMP_MODELS.map(x => x[0]);
  let h = '<div class="vw-cap">POROVNANIE MODELOV AI · LEN PRE TEBA</div><section class="vw-card cmp">';
  if (!runs) {
    h += `<p class="cmp-note">Tie isté údaje a snímky z tohto videa vyhodnotí Sonnet 5.5 (teraz v appke) aj lacnejší Haiku 5.5. Uvidíš skóre, čas, cenu a oba rozbory vedľa seba. Spolu to stojí asi 5 centov.</p>
      <button class="btn sec" id="btnCmp">Porovnať Haiku a Sonnet</button>`;
  } else {
    h += `<div class="cmp-grid">
      <span class="k"></span><b>Sonnet 5.5</b><b>Haiku 5.5</b>
      <span class="k">Skóre</span><span class="cmp-sc">${cell(mS, r => r.res.score ?? '?')}</span><span class="cmp-sc">${cell(mH, r => r.res.score ?? '?')}</span>
      <span class="k">Čas</span><span>${cell(mS, r => sec(r.ms))}</span><span>${cell(mH, r => sec(r.ms))}</span>
      <span class="k">Cena</span><span>${cell(mS, r => usd(r.usd))}</span><span>${cell(mH, r => usd(r.usd))}</span>
    </div>`;
    const S = runs[mS], H = runs[mH];
    if (!live && S && S.res && H && H.res) h += `<p class="cmp-sum">${esc(cmpSummary(S, H, rec && rec.orig))}</p>`;
    for (const [m, label] of CMP_MODELS) {
      const r = runs[m];
      if (r && r.err) h += `<p class="cmp-errline">${esc(label)}: ${esc(r.err)}</p>`;
      if (r && r.res) h += cmpDetails(label, r.res);
    }
    if (live) h += '<p class="cmp-when">Oba modely pracujú, zvyčajne to trvá do minúty…</p>';
    else h += `<button class="btn ghost cmp-again" id="btnCmp">Porovnať znova</button><p class="cmp-when">Porovnané ${esc(whenLabel(rec.at))}</p>`;
  }
  box.innerHTML = h + '</section>';
  on('btnCmp', () => runCmp(item));
}
function fillCmp(item) {
  const box = $('cmpBox');
  if (box) renderCmp(box, item, cmpAll()[item.id] || null, null);
}
async function runCmp(item) {
  const box = $('cmpBox');
  if (!box || box.dataset.busy) return;
  box.dataset.busy = '1';
  const st = {};
  CMP_MODELS.forEach(([m]) => { st[m] = { busy: true }; });
  renderCmp(box, item, null, st);
  const body = { exercise: item.exercise, summary: item.summary, keyframes: item.keyframes || [], criteria: criteriaOfItem(item) };
  await Promise.all(CMP_MODELS.map(async ([model, , extra]) => {
    const t0 = Date.now(), ctrl = new AbortController(), kill = setTimeout(() => ctrl.abort(), 150_000);
    try {
      const res = await fetch('/api/analyze', { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json', ...(await apiHeaders()) }, body: JSON.stringify({ ...body, model, ...extra }) });
      const d = await res.json().catch(() => ({}));
      st[model] = res.ok && d.result ? { res: slimRes(d.result), usd: d.cost ? d.cost.usd : null, ms: d.ms || (Date.now() - t0) } : { err: d.error || 'Chyba ' + res.status };
    } catch (e) {
      st[model] = { err: e.name === 'AbortError' ? 'Neodpovedal včas' : 'Bez spojenia so serverom' };
    } finally { clearTimeout(kill); }
    if (box.isConnected) renderCmp(box, item, null, st);
  }));
  delete box.dataset.busy;
  const rec = { at: Date.now(), orig: typeof item.result?.score === 'number' ? Math.round(item.result.score) : null, runs: st };
  cmpSave(item.id, rec);
  if (box.isConnected) renderCmp(box, item, rec, null);
}

// ---------- štart ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (VW && vwResultId && !location.hash) location.replace('#/r/' + vwResultId); // z appky: otvoriť uložený rozbor
route();
if (VW) vwPost('ready');
