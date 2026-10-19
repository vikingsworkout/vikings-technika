// Režim „v appke Viking's Workout“: Technika je otvorená v hlavnej appke (iframe).
// Parametre: ?vw=1&ex=<názov cviku z appky>&from=detail|set|home&theme=dark|light&po=<origin appky>&r=<id rozboru>
//   &img=<cesta k náhľadu cviku na videa.vikingsworkout.com>&day=<JSON dnešného tréningu z plánu>
const q = new URLSearchParams(location.search);

export const VW = q.get('vw') === '1';
export const vwFrom = ['detail', 'set', 'home'].includes(q.get('from')) ? q.get('from') : 'home';
export const vwExName = (q.get('ex') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
export const vwResultId = (q.get('r') || '').slice(0, 40);

// náhľad cviku z appky (ukážka záberu na obrazovke Natoč) – len obrázky z videa.vikingsworkout.com
const IMG_PATH = /^[A-Za-z0-9._~%\/-]{1,200}\.(jpg|jpeg|webp|png)(\?[A-Za-z0-9._~%=&-]{0,80})?$/i;
export const vwImgUrl = (path) => {
  const x = String(path || '').replace(/^https:\/\/videa\.vikingsworkout\.com\//, '');
  return IMG_PATH.test(x) && !x.includes('..') ? 'https://videa.vikingsworkout.com/' + x : '';
};
export const vwImg = vwImgUrl(q.get('img'));

// dnešný (alebo najbližší) tréning z plánu: { l: 'Deň 1 — Ťahy', d: 1 = dnes, x: [{ n, e, s, r, t, sc, p }] }
function parseDay(raw) {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    const num = (v, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0; };
    const x = (Array.isArray(o.x) ? o.x : []).slice(0, 14).map(e => ({
      n: String(e.n || '').replace(/\s+/g, ' ').trim().slice(0, 80), e: String(e.e || '').slice(0, 60),
      s: num(e.s, 20), r: num(e.r, 500), t: num(e.t, 3600), sc: e.sc == null ? null : Math.max(0, Math.min(100, num(e.sc, 100))),
      img: vwImgUrl(e.p),
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
