// Živé počítadlo opakovaní počas nahrávania. Je orientačné – presný počet príde z rozboru celého videa.
//
// Opakovanie sa započíta, len keď:
//  - sa človek najprv ustáli (asi 0,5 s skoro bez pohybu) v polohe cviku – príchod pred kameru, nastavovanie
//    alebo vykladanie nohy na lavičku sa preto nerátajú,
//  - je v polohe, akú cvik vyžaduje (kliky vodorovne, zhyby vo visení, drepy v stoji) a nekráča,
//  - hlavný kĺb sa ohne a zase vystrie o dostatočný uhol a spolu s ním sa pohne aj telo:
//    pri drepoch a výpadoch idú boky dole, pri klikoch a zhyboch ramená (pokrčenie nohy pri chôdzi nie je drep),
//  - opakovanie trvá aspoň asi 0,45 s.
//
// update(lm, t, W, H, counting): lm = 33 bodov tela z MediaPipe (x, y v rozsahu 0–1), t = čas v ms,
// W × H = rozmery videa (kvôli pomeru strán), counting = či práve beží nahrávanie.

const JT = { elbow: [[11, 13, 15], [12, 14, 16]], knee: [[23, 25, 27], [24, 26, 28]], hip: [[11, 23, 25], [12, 24, 26]] };
const VIS = 0.45;

function angleAt(lm, a, b, c, W, H) {
  const p = [lm[a], lm[b], lm[c]];
  if (p.some(q => !q || (q.visibility ?? 1) < VIS)) return null;
  const v1x = (p[0].x - p[1].x) * W, v1y = (p[0].y - p[1].y) * H, v2x = (p[2].x - p[1].x) * W, v2y = (p[2].y - p[1].y) * H;
  const d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  return d ? Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / d))) * 180 / Math.PI : null;
}

export function createLiveCounter({ signal = null, posture = null, minAmp = 30, start = 'top' } = {}) {
  const joints = signal ? [signal] : ['elbow', 'knee', 'hip'];
  const delta = Math.max(20, 0.5 * (minAmp || 30));
  const S = { T: 0, mot: [], armed: false, bad: null, lost: null, tr: {}, n: {}, rng: {}, joint: signal || null };

  // poloha tela v pixeloch; dĺžka trupu (rameno–bok) je mierka na pohyb
  function body(lm, W, H) {
    if (!lm) return null;
    const ok = (i) => lm[i] && (lm[i].visibility ?? 1) >= VIS;
    if (![11, 12, 23, 24].some(ok) || !(ok(11) || ok(12)) || !(ok(23) || ok(24))) return null;
    const pt = (ids) => { const v = ids.filter(ok); if (!v.length) return null; return { x: v.reduce((s, i) => s + lm[i].x, 0) / v.length * W, y: v.reduce((s, i) => s + lm[i].y, 0) / v.length * H }; };
    const sh = pt([11, 12]), hp = pt([23, 24]), an = pt([27, 28]), wr = pt([15, 16]);
    const T = Math.hypot(sh.x - hp.x, sh.y - hp.y);
    if (!(T > 1)) return null;
    const legs = an ? Math.atan2(Math.abs(hp.x - an.x), an.y - hp.y) * 180 / Math.PI : null; // 0 = nohy zvislo, ~90 = vodorovne
    const post = legs != null && legs > 55 ? 'H' : wr && wr.y < sh.y - 0.15 * T ? 'P' : 'V';
    return { T, post, hx: hp.x, hy: hp.y, sx: sh.x, sy: sh.y, wy: wr ? wr.y : null, ax: an ? an.x : null, ay: an ? an.y : null };
  }
  const postOk = (b) => !!b && (!posture || (posture === 'V' ? b.post !== 'H' : b.post === posture));
  const span = (k, from) => {
    let lo = Infinity, hi = -Infinity;
    for (const m of S.mot) if (m.t >= from && m[k] != null) { lo = Math.min(lo, m[k]); hi = Math.max(hi, m[k]); }
    return hi >= lo ? (hi - lo) / (S.T || 1) : 0;
  };
  // ustálený: za posledných 0,5 s sa boky, ramená ani chodidlá skoro nepohli
  function still(t) {
    const w = S.mot.filter(m => m.t >= t - 500);
    if (w.length < 4 || w[w.length - 1].t - w[0].t < 380) return false;
    return ['hx', 'hy', 'sx', 'sy', 'ax', 'ay'].every(k => span(k, t - 500) < 0.15);
  }
  // kráča: boky sa za poslednú sekundu posunuli do strany o viac ako dĺžku trupu
  function walking(t) {
    const w = S.mot.filter(m => m.t >= t - 1000);
    return w.length >= 4 && Math.abs(w[w.length - 1].hx - w[0].hx) / (S.T || 1) > 0.8;
  }
  const newRep = (t0) => ({ t0, from: t0 });
  // telo sa pri opakovaní naozaj pohlo (boky dole pri drepe, ramená pri kliku/zhybe)
  function moved(j, rep) {
    const hy = span('hy', rep.from), sy = span('sy', rep.from), wy = span('wy', rep.from), ay = span('ay', rep.from);
    if (j === 'knee') return hy >= 0.2;
    // mostík/hip thrust: boky hore; pri automatickom rozpoznaní aj zdvíhanie nôh alebo trupu (napr. skracovačky)
    if (j === 'hip') return signal ? hy >= 0.12 : hy >= 0.12 || sy >= 0.12 || ay >= 0.25;
    if (posture === 'P') return sy >= 0.25;
    if (posture === 'H') return sy >= 0.12;
    return sy >= 0.12 || wy >= 0.35;
  }

  function update(lm, t, W = 1, H = 1, counting = true) {
    const b = body(lm, W, H);
    if (b) {
      S.T = S.T ? S.T * 0.9 + b.T * 0.1 : b.T;
      S.mot.push({ t, ...b });
    }
    while (S.mot.length && t - S.mot[0].t > 3000) S.mot.shift();
    if (!b) { if (S.lost == null) S.lost = t; } else S.lost = null;
    if (!postOk(b)) { if (S.bad == null) S.bad = t; } else S.bad = null;
    if (S.armed && ((S.lost != null && t - S.lost > 1000) || (S.bad != null && t - S.bad > 600) || walking(t))) { S.armed = false; S.tr = {}; }
    if (!S.armed && postOk(b) && still(t)) { S.armed = true; S.tr = {}; }
    if (!counting || !S.armed || !b) return;

    for (const j of joints) {
      const a = JT[j].map(q => angleAt(lm, q[0], q[1], q[2], W, H)).filter(x => x != null);
      if (!a.length) continue;
      const x = a.reduce((s, y) => s + y, 0) / a.length;
      const r = S.rng[j] || (S.rng[j] = { lo: x, hi: x });
      let tr = S.tr[j];
      if (!tr) tr = S.tr[j] = { ema: x, st: start === 'bottom' ? 'down' : 'up', ext: x, extT: t, rep: start === 'bottom' ? newRep(t) : null };
      tr.ema = tr.ema * 0.5 + x * 0.5;
      r.lo = Math.min(r.lo, tr.ema); r.hi = Math.max(r.hi, tr.ema);
      if (tr.st === 'up') {
        if (tr.ema >= tr.ext) { tr.ext = tr.ema; tr.extT = t; }
        if (tr.ext - tr.ema >= delta) { tr.st = 'down'; tr.rep = tr.rep || newRep(tr.extT); tr.ext = tr.ema; tr.extT = t; }
      } else {
        if (tr.ema <= tr.ext) { tr.ext = tr.ema; tr.extT = t; }
        if (tr.ema - tr.ext >= delta) {
          tr.st = 'up';
          if (tr.rep && t - tr.rep.t0 >= 450 && moved(j, tr.rep)) S.n[j] = (S.n[j] || 0) + 1;
          tr.ext = tr.ema; tr.extT = t;
          tr.rep = start === 'bottom' ? newRep(t) : null;
        }
      }
    }
    // pri automatickom rozpoznaní počítame podľa kĺbu s najväčším pohybom
    if (!signal) {
      let best = null;
      for (const j of joints) { const r = S.rng[j]; if (r && r.hi - r.lo >= 35 && (!best || r.hi - r.lo > S.rng[best].hi - S.rng[best].lo)) best = j; }
      S.joint = best;
    }
  }
  function reset() { S.tr = {}; S.n = {}; S.rng = {}; S.joint = signal || null; } // poloha a „ustálenie“ ostávajú (z odpočtu)
  return {
    update, reset,
    get count() { return S.joint ? S.n[S.joint] || 0 : 0; },
    get joint() { return S.joint; },
    get armed() { return S.armed; },
  };
}
