// História rozborov v prehliadači (IndexedDB): výsledok, náhľad, namerané dáta (aby sa dal rozbor zopakovať
// pre iný cvik) a krátke video s kostrou (snímky), nie celé video.
//
// Prečo takto: Safari na iPhone má s Blobmi v IndexedDB opakované chyby (uloženie zlyhá alebo čítanie spadne)
// a keď sa rozbor ukladal naraz aj s videom, pri chybe sa neuložilo nič – v appke sa potom nedal znova otvoriť.
// Preto: 1) rozbor sa uloží vždy prvý a sám, 2) video ide do samostatného úložiska ako ArrayBuffer (obyčajné
// dáta, nie Blob), 3) keď IndexedDB nefunguje vôbec, ostane aspoň zjednodušený záznam v localStorage (bez videa).
// Staršie záznamy (video priamo v zázname, ako Blob) sa čítajú ďalej.

const DB = 'vikings-technika', STORE = 'analyzy', CLIPS = 'klipy';
const LITE = 'vt-rozbory-lite', LITE_MAX = 12;

function withTimeout(p, ms, what) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(what + ': čas vypršal')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function open() {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB, 2); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(CLIPS)) d.createObjectStore(CLIPS, { keyPath: 'id' });
    };
    req.onsuccess = () => { const d = req.result; d.onversionchange = () => d.close(); resolve(d); };
    req.onerror = () => reject(req.error || new Error('IndexedDB sa nedá otvoriť'));
  });
}

// jedna transakcia; fn(t) vráti požiadavku, ktorej výsledok chceme (alebo nič)
async function tx(stores, mode, fn, ms = 10000) {
  const d = await withTimeout(open(), 6000, 'otvorenie');
  try {
    return await withTimeout(new Promise((resolve, reject) => {
      const t = d.transaction(stores, mode);
      const req = fn(t);
      t.oncomplete = () => resolve(req && typeof req === 'object' && 'readyState' in req ? req.result : undefined);
      t.onerror = () => reject(t.error || new Error('chyba IndexedDB'));
      t.onabort = () => reject(t.error || new Error('zápis sa prerušil'));
    }), ms, mode === 'readonly' ? 'čítanie' : 'zápis');
  } finally { try { d.close(); } catch { /* nič */ } }
}

const errText = (e) => String((e && ((e.name && e.name !== 'Error' ? e.name + ': ' : '') + (e.message || ''))) || e || 'neznáma chyba').slice(0, 160);

// ---------- video: Blob ↔ ArrayBuffer ----------
const isBlob = (x) => typeof Blob !== 'undefined' && x instanceof Blob;
const toBuf = (b) => (typeof b.arrayBuffer === 'function' ? b.arrayBuffer() : new Response(b).arrayBuffer());
async function packClip(clip) {
  const frames = await Promise.all((clip.frames || []).map(async (f) => {
    if (!f || !isBlob(f.img)) return f;
    const { img, ...rest } = f;
    return { ...rest, img: null, ab: await toBuf(img), mt: img.type || 'image/jpeg' };
  }));
  return { ...clip, frames };
}
function unpackClip(clip) {
  if (!clip || !Array.isArray(clip.frames)) return clip;
  return {
    ...clip,
    frames: clip.frames.map((f) => {
      if (!f || !f.ab) return f;
      const { ab, mt, ...rest } = f;
      return { ...rest, img: new Blob([ab], { type: mt || 'image/jpeg' }) };
    }),
  };
}

// ---------- záloha v localStorage (bez videa a snímok) ----------
function liteAll() {
  try { const v = JSON.parse(localStorage.getItem(LITE) || '[]'); return Array.isArray(v) ? v.filter(x => x && x.id) : []; } catch { return []; }
}
function liteSave(it) {
  const rec = { id: it.id, created: it.created, exercise: it.exercise, vwName: it.vwName, vwEid: it.vwEid, signal: it.signal,
    result: it.result, sources: it.sources, summary: it.summary, thumb: it.thumb, lite: true };
  let all = [rec, ...liteAll().filter(x => x.id !== rec.id)].slice(0, LITE_MAX);
  for (;;) {
    try { localStorage.setItem(LITE, JSON.stringify(all)); return true; } catch {
      if (all.length > 1) { all = all.slice(0, Math.ceil(all.length / 2)); continue; }
      if (rec.summary) { delete rec.summary; delete rec.thumb; all = [rec]; continue; } // aspoň samotný výsledok
      return false;
    }
  }
}
function liteDrop(id) {
  try { const all = liteAll(); const rest = all.filter(x => x.id !== id); if (rest.length !== all.length) localStorage.setItem(LITE, JSON.stringify(rest)); } catch { /* nič */ }
}

// Uloží rozbor. Vráti { ok, st, err }: st = 'full' (aj s videom), 'noclip' (bez videa), 'lite' (len záloha
// v localStorage) alebo '' (neuložilo sa nič); err = popis chyby (na diagnostiku).
export async function save(item) {
  if (!item || !item.id) return { ok: false, st: '', err: 'rozbor bez id' };
  const { clip, saveSt, saveErr, ...rest } = item; // stav uloženia je len v pamäti
  const hasFrames = !!(clip && Array.isArray(clip.frames) && clip.frames.length);
  try {
    await tx(STORE, 'readwrite', t => t.objectStore(STORE).put({ ...rest, hasClip: false }));
    const back = await tx(STORE, 'readonly', t => t.objectStore(STORE).get(rest.id));
    if (!back) throw new Error('záznam sa po uložení nenašiel');
  } catch (e) {
    const ok = liteSave(rest);
    return { ok, st: ok ? 'lite' : '', err: errText(e) };
  }
  liteDrop(rest.id);
  if (!hasFrames) return { ok: true, st: 'noclip', err: '' };
  try {
    const packed = await packClip(clip);
    await tx(CLIPS, 'readwrite', t => t.objectStore(CLIPS).put({ ...packed, id: rest.id }), 20000);
    await tx(STORE, 'readwrite', t => t.objectStore(STORE).put({ ...rest, hasClip: true }));
    return { ok: true, st: 'full', err: '' };
  } catch (e) {
    return { ok: true, st: 'noclip', err: errText(e) };
  }
}

// všetky rozbory (bez videa), od najnovšieho
export async function list() {
  let all = [];
  try { all = (await tx(STORE, 'readonly', t => t.objectStore(STORE).getAll())) || []; } catch { all = []; }
  const ids = new Set(all.map(x => x.id));
  for (const x of liteAll()) if (!ids.has(x.id)) all.push(x);
  return all.sort((a, b) => (b.created || 0) - (a.created || 0));
}

// jeden rozbor aj s videom (ak je uložené)
export async function get(id) {
  id = String(id || '');
  if (!id) return null;
  let it = null;
  try { it = await tx(STORE, 'readonly', t => t.objectStore(STORE).get(id), 8000); } catch { it = null; }
  if (!it) return liteAll().find(x => x.id === id) || null;
  if (it.clip) return { ...it, clip: unpackClip(it.clip) }; // starší záznam: video priamo v ňom
  if (it.hasClip) {
    try {
      const c = await tx(CLIPS, 'readonly', t => t.objectStore(CLIPS).get(id), 12000);
      if (c) { const { id: _id, ...clip } = c; it.clip = unpackClip(clip); }
    } catch { /* rozbor ukážeme aj bez videa */ }
  }
  return it;
}

export async function remove(id) {
  try { await tx([STORE, CLIPS], 'readwrite', t => { t.objectStore(CLIPS).delete(id); return t.objectStore(STORE).delete(id); }); } catch { /* nič */ }
  liteDrop(id);
}

// videá zaberajú miesto – necháme ich len pri posledných `keep` rozboroch
export async function pruneClips(keep = 15) {
  try {
    const all = (await list()).filter(x => !x.lite);
    for (const it of all.slice(keep)) {
      if (it.clip) {
        const { clip, ...rest } = it;
        await tx(STORE, 'readwrite', t => t.objectStore(STORE).put({ ...rest, hasClip: false }));
      } else if (it.hasClip) {
        await tx([STORE, CLIPS], 'readwrite', t => { t.objectStore(CLIPS).delete(it.id); return t.objectStore(STORE).put({ ...it, hasClip: false }); });
      }
    }
  } catch { /* nič */ }
}
