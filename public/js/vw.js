// Režim „v appke Viking's Workout“: Technika je otvorená v hlavnej appke (iframe).
// Parametre: ?vw=1&ex=<názov cviku z appky>&from=detail|set|home&theme=dark|light&po=<origin appky>&r=<id rozboru>
const q = new URLSearchParams(location.search);

export const VW = q.get('vw') === '1';
export const vwFrom = ['detail', 'set', 'home'].includes(q.get('from')) ? q.get('from') : 'home';
export const vwExName = (q.get('ex') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
export const vwResultId = (q.get('r') || '').slice(0, 40);

// výsledky posielame len hlavnej appke (a lokálnemu vývoju), nikomu inému
const ALLOWED = /^https:\/\/(www\.)?vikingsworkout\.com$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const po = q.get('po') || '';
const parentOrigin = VW && ALLOWED.test(po) && window.parent !== window ? po : null;

export function vwPost(action, extra = {}) {
  if (!parentOrigin) return;
  try { window.parent.postMessage({ type: 'vw-technika', action, ...extra }, parentOrigin); } catch { /* appka zatvorená */ }
}

// cviky z appky, ktoré sa len podobajú názvom, ale meria sa ich pohyb inak → automatické rozpoznanie
// (austrálske príťahy ≠ zhyb, kliky na bradlách ≠ klik, negatívy, výdrže, skoky…)
const NO_MAP = /austr|bradl|\bdip|negat|pike|muscle|výskok|vyskok|skok|burpee|angli[cč]ák|výdrž|vydrz|lukostrel|archer|jednoru[cč]|kruhoch|trx|predklon/i;
export function vwPick(matchExercise) {
  if (!vwExName || NO_MAP.test(vwExName)) return null;
  return matchExercise(vwExName);
}

if (VW) {
  const h = document.documentElement;
  h.classList.add('vw');
  if (q.get('theme') === 'light') h.classList.add('vw-light');
}
