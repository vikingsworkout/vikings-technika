// Režim „v appke Viking's Workout“: Technika je otvorená v hlavnej appke (iframe).
// Parametre: ?vw=1&ex=<názov cviku z appky>&from=detail|set|home|duel&theme=dark|light&po=<origin appky>&r=<id rozboru>&n=<názov>&e=<id cviku>
//   &img=<cesta k náhľadu cviku na videa.vikingsworkout.com>&box=<poloha postavy na náhľade>&boxp=<na plnom náhľade>&day=<JSON dnešného tréningu z plánu>
const q = new URLSearchParams(location.search);

export const VW = q.get('vw') === '1';
export const vwFrom = ['detail', 'set', 'home', 'duel'].includes(q.get('from')) ? q.get('from') : 'home';
export const vwExName = (q.get('ex') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
// Súboj 1 na 1 z appky (?from=duel&dx=zhyby|kliky|drepy|plank&goal=<výsledok súpera>&who=<meno>&rl=<pravidlá>):
// natočí sa jedna séria (výdrž), appka spočíta opakovania (zmeria sekundy) priamo v mobile, bez rozboru AI,
// a výsledok aj s videom vráti appke do výzvy.
const DUEL_EX = { zhyby: 'pritah-hrazda', kliky: 'klik', drepy: 'drep', plank: 'plank' };
const num0 = (v, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0; };
export const vwDuel = VW && vwFrom === 'duel' && DUEL_EX[q.get('dx')] ? {
  dx: q.get('dx'), id: DUEL_EX[q.get('dx')],
  goal: num0(q.get('goal'), 100000),
  who: (q.get('who') || '').replace(/\s+/g, ' ').trim().slice(0, 40),
  rules: (q.get('rl') || '').replace(/\s+/g, ' ').trim().slice(0, 400),
} : null;
export const vwResultId = (q.get('r') || '').slice(0, 40);
// k uloženému rozboru aj názov a id cviku z appky – keď sa rozbor v telefóne nenájde, ukážeme ostatné rozbory tohto cviku
export const vwResultName = (q.get('n') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
export const vwResultEid = (q.get('e') || '').slice(0, 60);
// správca appky (porovnanie modelov AI, prístupový kód); ostatní používajú prihlásenie z appky
export const vwAdmin = VW && q.get('adm') === '1';

// náhľad cviku z appky (ukážka záberu na obrazovke Natoč) – len obrázky z videa.vikingsworkout.com
const IMG_PATH = /^[A-Za-z0-9._~%\/-]{1,200}\.(jpg|jpeg|webp|png)(\?[A-Za-z0-9._~%=&-]{0,80})?$/i;
export const vwImgUrl = (path) => {
  const x = String(path || '').replace(/^https:\/\/videa\.vikingsworkout\.com\//, '');
  return IMG_PATH.test(x) && !x.includes('..') ? 'https://videa.vikingsworkout.com/' + x : '';
};
export const vwImg = vwImgUrl(q.get('img'));
// poloha postavy na náhľade (x0,y0,x1,y1 v 0–1) – podľa nej sa obrázok vycentruje a nakreslí rámik
export function vwBoxOf(v) {
  const a = (Array.isArray(v) ? v : String(v || '').split(',')).slice(0, 4).map(Number);
  return a.length === 4 && a.every(x => Number.isFinite(x) && x >= 0 && x <= 1) && a[2] - a[0] > 0.03 && a[3] - a[1] > 0.03 ? a : null;
}
export const vwBox = vwBoxOf(q.get('box'));
export const vwBoxP = vwBoxOf(q.get('boxp')); // na plnom náhľade, keď stredný chýba

// dnešný (alebo najbližší) tréning z plánu: { l: 'Deň 1 — Ťahy', d: 1 = dnes, x: [{ n, e, s, r, t, sc, p, b }] }
function parseDay(raw) {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    const num = (v, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0; };
    const x = (Array.isArray(o.x) ? o.x : []).slice(0, 14).map(e => ({
      n: String(e.n || '').replace(/\s+/g, ' ').trim().slice(0, 80), e: String(e.e || '').slice(0, 60),
      s: num(e.s, 20), r: num(e.r, 500), t: num(e.t, 3600), sc: e.sc == null ? null : Math.max(0, Math.min(100, num(e.sc, 100))),
      img: vwImgUrl(e.p), box: vwBoxOf(e.b), boxp: vwBoxOf(e.bp),
    })).filter(e => e.n);
    return x.length ? { l: String(o.l || '').slice(0, 60), d: !!o.d, x } : null;
  } catch { return null; }
}
export const vwDay = VW ? parseDay(q.get('day')) : null;

// výsledky posielame len hlavnej appke (a lokálnemu vývoju), nikomu inému
const ALLOWED = /^https:\/\/(www\.)?vikingsworkout\.com$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const po = q.get('po') || '';
const parentOrigin = VW && ALLOWED.test(po) && window.parent !== window ? po : null;

export const vwEmbedded = !!parentOrigin;

// Prihlásenie používateľa: token (Supabase) pošle hlavná appka na požiadanie. Držíme ho, kým neexpiruje
// (s rezervou 2 minúty); force = appka ho má obnoviť (server ho odmietol).
let tokC = { v: '', exp: 0 };
const jwtExp = (t) => { try { return (JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp || 0) * 1000; } catch { return 0; } };
export function vwToken(force = false) {
  if (!parentOrigin) return Promise.resolve('');
  if (!force && tokC.v && Date.now() < tokC.exp - 120000) return Promise.resolve(tokC.v);
  return new Promise((resolve) => {
    const done = (v) => {
      clearTimeout(t); window.removeEventListener('message', onMsg);
      if (v) tokC = { v, exp: jwtExp(v) || Date.now() + 10 * 60000 };
      resolve(v || '');
    };
    const onMsg = (ev) => {
      if (ev.origin !== parentOrigin || ev.source !== window.parent) return;
      const m = ev.data;
      if (m && m.type === 'vw-technika' && m.action === 'token') done(typeof m.token === 'string' ? m.token.slice(0, 4000) : '');
    };
    const t = setTimeout(() => done(''), 5000); // staršia appka neodpovie
    window.addEventListener('message', onMsg);
    vwPost('token', { force: !!force });
  });
}
export function vwPost(action, extra = {}) {
  if (!parentOrigin) return;
  try { window.parent.postMessage({ type: 'vw-technika', action, ...extra }, parentOrigin); } catch { /* appka zatvorená */ }
}

// cviky z appky, ktoré sa len podobajú názvom, ale meria sa ich pohyb inak → automatické rozpoznanie
// (austrálske príťahy ≠ zhyb, kliky na bradlách ≠ klik, negatívy, výdrže, skoky…)
const NO_MAP = /austr|bradl|\bdip|negat|pike|muscle|výskok|vyskok|skok|burpee|angli[cč]ák|výdrž|vydrz|lukostrel|archer|jednoru[cč]|kruhoch|trx|predklon/i;
export const vwNoMap = (name) => NO_MAP.test(name || '');
export function vwPick(matchExercise) {
  if (!vwExName || NO_MAP.test(vwExName)) return null;
  return matchExercise(vwExName);
}

if (VW) {
  const h = document.documentElement;
  h.classList.add('vw');
  if (q.get('theme') === 'light') h.classList.add('vw-light');
}
