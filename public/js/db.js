// História analýz v prehliadači (IndexedDB). Ukladá sa výsledok, náhľad a namerané
// dáta (aby sa dala analýza zopakovať pre iný cvik), nie celé video.

const DB = 'vikings-technika', STORE = 'analyzy';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out.result ?? out);
    t.onerror = () => reject(t.error);
  });
}

export async function save(item) {
  try { await tx('readwrite', s => s.put(item)); return true; } catch { return false; }
}
export async function list() {
  try {
    const all = await tx('readonly', s => s.getAll());
    return (all || []).sort((a, b) => b.created - a.created);
  } catch { return []; }
}
export async function get(id) {
  try { return await tx('readonly', s => s.get(id)); } catch { return null; }
}
export async function remove(id) {
  try { await tx('readwrite', s => s.delete(id)); } catch { /* nič */ }
}
