import { EXERCISES, AUTO, findExercise, matchExercise, isHold, maxSecondsFor } from './exercises.js';
import { analyzeVideo, preload, CLIP_PTS, CLIP_BONES, liveLandmarker, detectLive, liveAngle } from './pose.js';
import * as db from './db.js';
import { Recorder, recorderSupported } from './recorder.js';
import { VW, vwFrom, vwExName, vwResultId, vwPost, vwImg, vwBox, vwDay, vwEmbedded, vwNoMap } from './vw.js';
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
const views = ['vHome', 'vPick', 'vNew', 'vRec', 'vWork', 'vResult'];
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
let pick = null;           // { src: 'app' | 'list' | 'auto', name, eid, img, box, guide, measure }
function makePick(src, name, { id = null, eid = '', img = '', box = null } = {}) {
  const e = id ? findExercise(id) : (name && !vwNoMap(name) ? matchExercise(name) : null);
  const guide = e && e.id !== 'auto' ? e : null;
  return { src, name, eid, img, box: img ? box : null, guide, measure: guide && !isHold(guide) ? guide : AUTO };
}
function applyPick(p) {
  pick = p; selected = p.measure;
  vwHint = selected.id === 'auto' && p.src !== 'auto' ? p.name : '';
}
const appPick = VW && vwExName ? makePick('app', vwExName, { img: vwImg, box: vwBox }) : null;
if (appPick) applyPick(appPick);
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
    document.querySelector('header').classList.toggle('hide', view === 'vRec' || view === 'vWork');
    // Výber a Natoč: šípka späť (prvá obrazovka Techniku zatvorí), výsledok: krížik zatvorí Techniku
    const close = view === 'vResult' || view === 'vHome' || (view === 'vPick' && !appPick) || (view === 'vNew' && pick && pick.src === 'app');
    const b = $('btnHome');
    b.dataset.mode = close ? 'close' : 'back';
    const ico = view === 'vResult' || view === 'vHome' ? 'x' : 'back';
    if (b.dataset.ico !== ico) { b.dataset.ico = ico; b.innerHTML = ico === 'x' ? ICON_X : ICON_BACK; }
    b.setAttribute('aria-label', close ? 'Zavrieť Techniku' : 'Späť');
    $('hRight').innerHTML = view === 'vNew' ? '<button class="hlink" id="btnOther">Iný cvik</button>' : KICK('TECHNIKA');
    on('btnOther', () => go('#/vyber'));
  }
  $('btnNew').hidden = true; // na domove je hlavné tlačidlo priamo v karte
  closeViewer(); closePlayer();
  window.scrollTo(0, 0);
}

// ---------- smerovanie ----------
async function route() {
  const h = location.hash;
  if (h === '#/vyber' && VW) { renderPick(); show('vPick'); preloadSoon(); return; }
  if (h === '#/nova') {
    if (VW && !pick) { go('#/vyber'); return; }
    renderNew(); show('vNew'); if (VW) layoutShot(); preloadSoon(); return;
  }
  if (h === '#/nahravanie') { show('vRec'); openRecorder(); return; }
  if (h.startsWith('#/r/')) {
    const item = (current && current.id === h.slice(4)) ? current : await db.get(h.slice(4));
    if (item && item.result) { current = item; renderResult(item); show('vResult'); return; }
  }
  if (h === '#/praca' && current) { show('vWork'); return; }
  if (VW) { // v appke sa začína natáčaním cviku z appky, inak výberom cviku
    if (pick) { renderNew(); show('vNew'); layoutShot(); } else { renderPick(); show('vPick'); }
    preloadSoon(); return;
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
  'mrtvy-tah': ['<circle cx="25.5" cy="30" r="7.5"/><path d="M5 44h38"/>', [31, 10, 4.2], 'M14 22 26 14.5M26 15v15M14 22l7.5 9-3 9.5h7'],
  bench: ['<circle cx="15" cy="9" r="5.5"/><path d="M6 31h28M10 31v10M30 31v10"/>', [7.5, 24.5, 4], 'M12.5 27h15l7.5-5.5 3.5 18.5M15 27V14.5'],
  'tlak-nad-hlavu': ['<path d="M6 6.5h36M8.5 2.5v8M39.5 2.5v8"/>', [24, 16.5, 4.2], 'M15.5 6.5l3.5 16M32.5 6.5 29 22.5M19 22.5h10M24 22v11.5M24 33.5l-3.5 11M24 33.5l3.5 11'],
  'hip-thrust': ['<circle cx="25" cy="14" r="5.5"/><path d="M4 25.5h10M9 25.5V42M4 42h40"/>', [7, 19, 3.8], 'M11.5 22.5 25 20.5l11.5.5V38h5'],
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
  const g = pick.guide, G = g || AUTO, max = maxSecondsFor(selected);
  const auto = isAutoPick();
  $('newTitle').textContent = auto ? 'Natoč cvik' : 'Natoč ' + lowerName(pick.name);
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
      if (/-mid\.jpg/i.test(img.src)) { img.src = img.src.replace(/-mid\.jpg/i, '.jpg'); return; }
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
  $('btnRec').innerHTML = '<span class="dot"></span>Nahrávať';
}

// výrez obrázka a rámik „Celé telo v zábere“: podľa polohy postavy na náhľade (zistenej vopred na GitHube),
// bez nej podľa piktogramu alebo tvaru cviku (kliky, plank… naležato, ostatné nastojato)
const WIDE = new Set(['klik', 'plank', 'planche', 'hip-thrust', 'bench', 'front-lever', 'back-lever', 'l-sit']);
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
    // postava zaberie väčšinu výšky karty (najviac 1,6× priblíženie, aby obrázok nebol rozmazaný)
    const fit = b ? Math.min(0.74 * CH / ((b[3] - b[1]) * H), 0.84 * CW / ((b[2] - b[0]) * W)) : cover;
    const s = Math.max(cover, Math.min(1.6 * cover, fit)), DW = W * s, DH = H * s;
    const cx = b ? (b[0] + b[2]) / 2 : 0.5, cy = b ? (b[1] + b[3]) / 2 : 0.48;
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
// ďalšie cviky: kalistenika a výdrže (výdrže a dipy rozpozná automatický režim s názvom ako nápovedou)
const PICK_TILES = [
  { n: 'Kliky', c: 'Hrudník', id: 'klik' }, { n: 'Zhyby', c: 'Chrbát', id: 'pritah-hrazda' }, { n: 'Dipy', c: 'Ruky' },
  { n: 'Drepy', c: 'Nohy', id: 'drep' }, { n: 'Výpady', c: 'Nohy', id: 'vypad' }, { n: 'Mŕtvy ťah', c: 'Chrbát', id: 'mrtvy-tah' },
  { n: 'Stojka', c: 'Výdrž', id: 'stojka' }, { n: 'L-sit', c: 'Výdrž', id: 'l-sit' }, { n: 'Plank', c: 'Výdrž', id: 'plank' },
];
function renderPick() {
  $('pkAuto').onclick = () => { applyPick(makePick('auto', 'Rozpoznať automaticky', { id: 'auto' })); go('#/nova'); };
  const d = vwDay;
  $('pkDay').innerHTML = d ? `
    <div class="pk-dayh"><span class="vw-cap">${d.d ? 'Z DNEŠNÉHO TRÉNINGU' : 'Z NAJBLIŽŠIEHO TRÉNINGU'}</span><span>${esc(d.l)}</span></div>
    <section class="vw-card pk-list">${d.x.map((x, i) => {
      const plan = x.t ? `${x.s ? x.s + ' × ' : ''}${x.t} s` : x.r ? `${x.s ? x.s + ' × ' : ''}${x.r} ${plural(x.r, 'opakovanie', 'opakovania', 'opakovaní')}` : '';
      const meta = [plan, x.sc != null ? `naposledy ${x.sc} ${plural(x.sc, 'bod', 'body', 'bodov')}` : ''].filter(Boolean).join(' · ');
      return `<button class="pk-row" data-i="${i}"><span class="pk-ini">${esc((x.n.match(/\p{L}/u) || ['C'])[0].toUpperCase())}</span>
        <span class="pk-rt"><b>${esc(x.n)}</b>${meta ? `<span>${esc(meta)}</span>` : ''}</span>${IC.chev}</button>`;
    }).join('')}</section>` : '';
  $('pkDay').querySelectorAll('.pk-row').forEach(b => b.onclick = () => {
    const x = d.x[Number(b.dataset.i)];
    applyPick(makePick('list', x.n, { eid: x.e, img: x.img, box: x.box })); go('#/nova');
  });
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
      $('recHint').textContent = st === 'recording' ? 'Ťukni, keď dokončíš sériu'
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

$('btnRec').onclick = () => {
  if (!recorderSupported()) { $('inCam').click(); return; } // starší prehliadač: systémová kamera
  go('#/nahravanie');
};

async function openRecorder() {
  if (VW) {
    $('recName').textContent = isAutoPick() ? 'Rozpoznám automaticky' : pick.name;
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
    const file = await recorder.start({ countdown: 5, maxSeconds: maxSecondsFor(selected) });
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
const LIVE = { on: false, model: null, raf: 0, last: 0, lm: null, st: '', cand: '', since: 0, tr: {}, joint: null, hist: [], still0: null, best: 0 };
const JT = { elbow: [[11, 13, 15], [12, 14, 16]], knee: [[23, 25, 27], [24, 26, 28]], hip: [[11, 23, 25], [12, 24, 26]] };
const JPAIR = { elbow: [13, 14], knee: [25, 26], hip: [23, 24], shoulder: [11, 12], body_line: [23, 24] };
const LIVE_BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32]];
function liveStart() {
  if (!VW || LIVE.on) return;
  LIVE.on = true; LIVE.lm = null; LIVE.st = ''; LIVE.cand = '';
  liveLandmarker().then(m => { LIVE.model = m; liveStatus(true); });
  LIVE.raf = requestAnimationFrame(liveTick);
}
function liveStop() {
  if (!LIVE.on) return;
  LIVE.on = false; cancelAnimationFrame(LIVE.raf);
  const c = $('recCanvas'); if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
}
function liveReset() { LIVE.tr = {}; LIVE.joint = null; LIVE.hist = []; LIVE.still0 = null; LIVE.best = 0; liveCountShow(); }
function liveTick(now) {
  if (!LIVE.on) return;
  LIVE.raf = requestAnimationFrame(liveTick);
  if (!LIVE.model || now - LIVE.last < 80) return; // ~12 snímok za sekundu stačí
  LIVE.last = now;
  const v = $('recVideo');
  const lm = detectLive(LIVE.model, v);
  LIVE.lm = lm;
  if (recState === 'recording') liveCount(lm, now, v);
  liveDraw(lm, v);
  liveStatus(false, now);
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
  let st = !LIVE.model ? 'load' : bodyState(LIVE.lm);
  if (recState === 'off') st = 'cam';
  // stav meníme až keď vydrží ~0,4 s, aby text neblikal
  if (!force) {
    if (st !== LIVE.cand) { LIVE.cand = st; LIVE.since = now; }
    if (st !== LIVE.st && now - LIVE.since < 400) return;
  }
  LIVE.st = st; LIVE.cand = st;
  const ok = st === 'ok';
  const txt = st === 'cam' ? 'Zapínam kameru…' : st === 'load' ? 'Pripravujem rozpoznávanie postavy…'
    : ok ? (recState === 'recording' ? 'Vidím celé telo – cvič ďalej' : recState === 'countdown' ? 'Vidím celé telo – zaujmi polohu' : 'Vidím celé telo – môžeš začať')
    : st === 'part' ? 'Nevidím celé telo – posuň mobil ďalej' : 'Nevidím ťa – postav sa do záberu';
  $('recStatus').className = 'rc-status' + (ok ? ' ok' : st === 'part' || st === 'none' ? ' warn' : '');
  $('recStatusT').textContent = txt;
}
function liveCount(lm, now, v) {
  const W = v.videoWidth || 1, H = v.videoHeight || 1;
  if (pickHold()) { liveHold(lm, now, W, H); liveCountShow(); return; }
  const joints = selected.signal ? [selected.signal] : ['elbow', 'knee', 'hip'];
  const delta = Math.max(20, 0.5 * (selected.minAmp || 30));
  for (const j of joints) {
    if (!lm || !JT[j]) continue;
    const a = JT[j].map(t => liveAngle(lm, t[0], t[1], t[2], W, H)).filter(x => x != null);
    if (!a.length) continue;
    const x = a.reduce((s, y) => s + y, 0) / a.length;
    const tr = LIVE.tr[j] || (LIVE.tr[j] = { ema: x, st: selected.start === 'bottom' ? 'down' : 'up', ext: x, n: 0, lo: x, hi: x });
    tr.ema = tr.ema * 0.5 + x * 0.5;
    tr.lo = Math.min(tr.lo, tr.ema); tr.hi = Math.max(tr.hi, tr.ema);
    if (tr.st === 'up') { tr.ext = Math.max(tr.ext, tr.ema); if (tr.ext - tr.ema >= delta) { tr.st = 'down'; tr.ext = tr.ema; } }
    else { tr.ext = Math.min(tr.ext, tr.ema); if (tr.ema - tr.ext >= delta) { tr.st = 'up'; tr.ext = tr.ema; tr.n++; } }
  }
  // pri automatickom režime počítame podľa kĺbu s najväčším pohybom
  let best = null;
  for (const j of joints) { const tr = LIVE.tr[j]; if (tr && tr.hi - tr.lo >= 35 && (!best || tr.hi - tr.lo > LIVE.tr[best].hi - LIVE.tr[best].lo)) best = j; }
  LIVE.joint = best || selected.signal || null;
  if (!selected.signal) liveHold(lm, now, W, H); // automaticky môže ísť aj o výdrž
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
  const reps = LIVE.joint && LIVE.tr[LIVE.joint] ? LIVE.tr[LIVE.joint].n : 0;
  const holdS = Math.floor(LIVE.best);
  const asHold = pickHold() || (!selected.signal && !reps && holdS >= 3);
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
function showError(msg, needCode = false) {
  $('workErr').hidden = false; $('workErrText').textContent = msg;
  $('codeBox').hidden = !needCode;
  if (needCode) $('codeInput').value = ls.get('vt-code') || '';
  if (VW) { hide('workBand', true); hide('workBottom', true); $('workSteps').classList.add('stopped'); vwPost('error'); }
}

// ---------- v appke: obrazovka Analýza (kroky, náhľad s kostrou) ----------
// stage: model → scan (prechádzanie videa) → frames (uhly a tempo) → ai (rozbor) → done
const AN = { stage: 'model', p: 0, people: false, t: 0, dur: 0, reps: 0, hold: 0, isHold: false, down: null, ai: 0 };
function workReset(stage = 'model') {
  Object.assign(AN, { stage, p: 0, people: stage !== 'model', t: 0, dur: 0, reps: 0, hold: 0, isHold: pickHold(), down: null, ai: 0 });
  if (!VW) return;
  const nm = !isAutoPick() ? pick.name : (current?.exercise?.hint || '');
  $('workKick').innerHTML = `${IC.kick}<span>${esc(('TECHNIKA' + (nm ? ' · ' + nm : '')).toUpperCase())}</span>`;
  $('workTitle').textContent = pickHold() ? 'Analyzujem tvoju výdrž' : isAutoPick() ? 'Analyzujem tvoje video' : 'Analyzujem tvoju sériu';
  $('workSub').textContent = 'Zvyčajne to trvá do minúty';
  hide('workBand', false); hide('workPill', true); hide('workStatus', true); hide('workErr', true); $('workSteps').classList.remove('stopped');
  hide('workBottom', false); hide('btnWorkBg', !vwEmbedded);
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
    : at === 1 ? act(hold ? 'Meriam výdrž' : selected.id === 'auto' ? 'Meriam pohyb' : 'Počítam opakovania', '', AN.p)
    : hold ? done('Výdrž zmeraná', AN.hold ? `výdrž ${AN.hold} s` : 'výdrž som nenašiel, rozbor to skúsi aj tak')
    : AN.reps ? done('Opakovania spočítané', `${AN.reps} ${plural(AN.reps, 'opakovanie', 'opakovania', 'opakovaní')} za ${Math.round(AN.dur)} sekúnd`)
    : done('Pohyb zmeraný', 'opakovania som nenašiel, rozbor to skúsi aj tak');
  const s3 = at < 2 ? todo(hold ? 'Meriam líniu tela' : 'Meriam uhly a tempo', hold ? 'línia tela a stabilita' : 'uhly kĺbov v každej snímke')
    : at === 2 ? act(hold ? 'Meriam líniu tela' : 'Meriam uhly a tempo', 'kľúčové snímky')
    : done(hold ? 'Línia tela zmeraná' : 'Uhly a tempo zmerané', hold ? 'línia tela a stabilita' : AN.down != null ? `spúšťanie ${String(AN.down).replace('.', ',')} s, rozsah každého opakovania` : 'uhly kĺbov v každej snímke');
  const s4 = at < 3 ? todo('Rozbor a skóre', 'čo zlepšiť a ako na 100 bodov')
    : at === 3 ? act('Rozbor a skóre', '', AN.ai) : done('Rozbor a skóre', 'hotovo');
  $('workSteps').innerHTML = s1 + s2 + s3 + s4;
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
  go('#/praca'); show('vWork');
  setProgress(0, 'Overujem prístup…');
  // kód overíme hneď, nie až po minútovej analýze videa
  if (await accessDenied()) {
    showError('Táto appka je chránená prístupovým kódom. Zadaj ho a pokračuj.', true);
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
    showError(e.message || 'Analýza videa zlyhala.');
    current = null;
    return;
  }
  await runAi();
}
// výsledok merania do krokov a náhľadu
function workMeasured(sm, clip) {
  if (!VW || !sm) return;
  const act = sm.active_segment;
  Object.assign(AN, { people: true, isHold: sm.exercise_type === 'hold', reps: sm.reps_detected || 0, hold: Math.round(sm.hold?.duration_s || 0),
    dur: act ? Math.max(0, act.end_s - act.start_s) : (sm.video?.analyzed_s || 0), down: sm.tempo?.avg_down_s ?? null });
  if (AN.isHold) $('workTitle').textContent = 'Analyzujem tvoju výdrž';
  AN.stage = 'ai'; renderSteps(); workPill();
  workLoopStart(clip);
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
  if (VW) { AN.stage = 'ai'; AN.ai = 0; hide('workBand', false); hide('workBottom', false); $('workSteps').classList.remove('stopped'); renderSteps(); }
  setProgress(0.55, 'AI hľadá správnu techniku a vyhodnocuje tvoj pohyb… (zvyčajne 20–60 s)');
  let fake = 0.55;
  const tick = setInterval(() => {
    fake = Math.min(0.95, fake + 0.01); setProgress(fake);
    if (VW && AN.stage === 'ai') { AN.ai = Math.min(0.95, (fake - 0.55) / 0.4); renderSteps(); }
  }, 700);
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
    if (VW) { vwPost('result', { data: vwSummary(current) }); AN.stage = 'done'; renderSteps(); } // hlavná appka si uloží skóre (domov, profil)
    setProgress(1, 'Hotovo');
    go('#/r/' + current.id);
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
  if (current && current.summary) { go('#/praca'); runAi(); }
  else if (pendingFile) startAnalysis(pendingFile);
};
$('btnBack').onclick = () => { go('#/nova'); };

// krátky súhrn rozboru pre hlavnú appku (domov, profil, zápis do tréningu)
function vwSummary(item) {
  const r = item.result || {}, sm = item.summary || {};
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
  const lab = score == null ? 'Rozbor' : score >= 90 ? 'Výborná technika' : score >= 80 ? 'Dobrá technika' : score >= 65 ? 'Solídny základ' : score >= 50 ? 'Je čo zlepšovať' : 'Treba popracovať';
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
        <circle cx="62" cy="62" r="54" fill="none" stroke="url(#vwg)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(C * pct).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 62 62)"/>
      </svg><div class="num"><b>${score ?? '?'}</b><span>zo 100</span></div></div>
      <div style="min-width:0"><div class="k">TVOJE SKÓRE</div><div class="lab">${lab}</div>${r.verdict ? `<p class="vd">${esc(r.verdict)}</p>` : ''}</div>
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
const JOINT_PTS = { knee: [25, 26], hip: [23, 24], elbow: [13, 14], shoulder: [11, 12], body_line: [23, 24] };
const JOINT_SK = { knee: 'koleno', hip: 'bok', elbow: 'lakeť', shoulder: 'rameno', body_line: 'línia' };
const P = { clip: null, urls: [], imgs: [], t: 0, playing: false, speed: 1, raf: 0, last: 0, cur: -1 };

const SPEED_TXT = (s) => VW ? (s === 1 ? '1×' : s === 0.5 ? '0,5×' : '0,25×') : (s === 1 ? '1×' : s === 0.5 ? '½×' : '¼×');
function openPlayer(clip, jumpT, tip) {
  closePlayer();
  Object.assign(P, { clip, urls: clip.frames.map(f => URL.createObjectURL(f.img)), imgs: [], t: 0, playing: false, speed: 1, cur: -1 });
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
  const clip = P.clip, f = clip.frames[i], im = getImg(i);
  for (let k = 1; k <= 6; k++) getImg(i + k); // prednačítanie
  if (!im || !im.complete || !im.naturalWidth) { if (im) im.onload = () => { if (P.clip && P.cur === i) drawFrameVW(i); }; return; }
  const out = drawPoseFrame($('pCanvas'), im, clip.w, clip.h, clipPts(f.lm), { r: 5.5, lw: 3, hi: clip.joint, bg: '#0B101D' });
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

function drawFrame(i) {
  if (VW) { drawFrameVW(i); return; }
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
  const r = item.result || {};
  const ex = r.exercise || {};
  const score = typeof r.score === 'number' ? Math.max(0, Math.min(100, Math.round(r.score))) : null;
  const mismatch = item.exercise.id !== 'auto' && ex.matches_selected === false;
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
    ${mismatch ? `<div class="card err mismatch"><b>Pozor:</b> AI si myslí, že na videu je iný cvik, než si vybral (${esc(item.exercise.name)}). Ak to nesedí, zmeň cvik v celom rozbore dole.</div>` : ''}
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

    ${VW ? `<div class="stickybar vwbar">
      <button class="btn pri" id="btnVwMain">${vwUse ? `${ICON_CHECK}${esc(vwUse.label)}` : 'Hotovo'}</button>
      <button class="btn sec" id="btnAgain"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>Skúsiť znova lepšie</button>
    </div>` : `<div class="stickybar"><button class="btn pri" id="btnAgain">${today && !today.good ? 'Skúsiť to opraviť' : 'Natočiť ďalšiu sériu'}</button></div>`}
  `;
  if ($('btnVwMain')) $('btnVwMain').onclick = () => { if (vwUse) vwPost('use', { reps: vwUse.reps || 0, hold: vwUse.hold || 0 }); else vwPost('close'); };

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
  $('btnDel').onclick = async () => { await db.remove(item.id); go('#/'); };
  $('btnRe').onclick = () => {
    const e = findExercise($('reEx').value);
    current = { ...item, id: String(Date.now()), created: Date.now(), exercise: { id: e.id, name: e.name, en: e.en }, result: null, vwName: undefined, vwEid: undefined };
    if (VW) { applyPick(makePick('list', e.name, { id: e.id })); workReset('ai'); workMeasured(item.summary, item.clip); $('workSub').textContent = 'Opakujem rozbor pre ' + lowerName(e.name); }
    else { $('workTitle').textContent = 'Opakujem rozbor…'; $('workVideo').removeAttribute('src'); $('workVideo').hidden = true; }
    go('#/praca'); show('vWork'); runAi();
  };
}

// ---------- štart ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (VW && vwResultId && !location.hash) location.replace('#/r/' + vwResultId); // z appky: otvoriť uložený rozbor
route();
if (VW) vwPost('ready');
