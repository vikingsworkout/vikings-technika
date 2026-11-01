// Rozbory uložené aj k účtu (Supabase, tabuľka tech_rozbory – vytvára ju supabase/technika-rozbory.sql vo webe).
// Ukladá sa len výsledok (skóre, namerané údaje, rady) – bez videa, bez snímok a bez náhľadu. Vďaka tomu sa rozbor
// otvorí na každom zariadení a nestratí sa, keď telefón (najmä iPhone) vymaže dáta Techniky.
// Funguje len v appke (prihlásenie z appky); kým tabuľka v databáze nie je, ticho sa nič nerobí.
import { VW, vwEmbedded, vwToken } from './vw.js';

const SB = 'https://cehbqshhjwahfxbzcpdl.supabase.co';
const KEY = 'sb_publishable_9jpWzOvaa2SbG2FNwgfvOQ_5GCDAguJ';
const T = SB + '/rest/v1/tech_rozbory';
const DONE = 'vt-zaloha-v1'; // id rozborov z tohto zariadenia, ktoré už sú pri účte
const MAX = 300000;
let off = false;

const on = () => VW && vwEmbedded && !off;
const subOf = (tk) => { try { return JSON.parse(atob(tk.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub || ''; } catch { return ''; } };

async function call(path, opt = {}, ms = 9000) {
  if (!on()) return null;
  let tk = await vwToken();
  if (!tk) return null;
  for (let i = 0; i < 2; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(T + path, { ...opt, signal: ctrl.signal, cache: 'no-store',
        headers: { apikey: KEY, Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json', ...(opt.headers || {}) } });
      if (r.status === 401 && i === 0) { tk = await vwToken(true); if (tk) continue; return null; }
      if (r.status === 404) { off = true; return null; } // tabuľka v databáze ešte nie je
      if (!r.ok) return null;
      if ((opt.method || 'GET') !== 'GET') return { ok: true };
      return await r.json().catch(() => null);
    } catch { return null; } finally { clearTimeout(t); }
  }
  return null;
}

// čo ide na server: bez videa (clip), snímok pre AI (keyframes) a náhľadu (thumb)
function pack(it) {
  const d = { id: String(it.id), created: Number(it.created) || Date.now(), exercise: it.exercise || null, signal: it.signal || null,
    vwName: it.vwName || '', vwEid: it.vwEid || '', result: it.result || null, sources: it.sources || [], summary: it.summary || null };
  let s = JSON.stringify(d);
  if (s.length > MAX) { d.sources = []; s = JSON.stringify(d); }
  if (s.length > MAX) { d.summary = null; s = JSON.stringify(d); }
  return s.length > MAX ? null : d;
}

const doneAll = () => { try { const v = JSON.parse(localStorage.getItem(DONE) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const doneAdd = (id) => { try { localStorage.setItem(DONE, JSON.stringify([String(id), ...doneAll().filter(x => x !== String(id))].slice(0, 300))); } catch { /* nič */ } };

export async function save(it) {
  if (!on() || !it || !it.id || !it.result) return false;
  const d = pack(it);
  if (!d) return false;
  const tk = await vwToken();
  const uid = tk ? subOf(tk) : '';
  if (!uid) return false;
  const ok = await call('?on_conflict=user_id,id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: uid, id: d.id, created_at: new Date(d.created).toISOString(), data: d }) });
  if (ok) doneAdd(d.id);
  return !!ok;
}

export async function get(id) {
  id = String(id || '').slice(0, 40);
  if (!id) return null;
  const rows = await call('?select=data&id=eq.' + encodeURIComponent(id) + '&limit=1');
  const d = Array.isArray(rows) && rows[0] && rows[0].data;
  return d && d.result ? { ...d, remote: true } : null;
}

// zoznam pre „Moje rozbory“ – len to, čo treba na riadok (rozbor sa načíta celý až po ťuknutí)
export async function list() {
  const rows = await call('?select=id,created:data->created,vwName:data->vwName,vwEid:data->vwEid,exercise:data->exercise,'
    + 'score:data->result->score,rex:data->result->exercise,et:data->summary->exercise_type,rd:data->summary->reps_detected,hd:data->summary->hold'
    + '&order=created_at.desc&limit=60');
  if (!Array.isArray(rows)) return [];
  return rows.filter(r => r && r.id).map(r => ({ id: r.id, created: Number(r.created) || 0, vwName: r.vwName || '', vwEid: r.vwEid || '', exercise: r.exercise || null,
    result: { score: r.score, exercise: r.rex || null }, summary: { exercise_type: r.et, reps_detected: r.rd, hold: r.hd }, remote: true }));
}

export async function remove(id) {
  if (!id) return;
  await call('?id=eq.' + encodeURIComponent(String(id)), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}

// rozbory, ktoré sú zatiaľ len v tomto zariadení, sa raz dozálohujú k účtu
export async function backfill(items) {
  if (!on()) return;
  const done = new Set(doneAll());
  const todo = (items || []).filter(it => it && it.id && it.result && !it.remote && !done.has(String(it.id))).slice(0, 40);
  for (const it of todo) { if (!(await save(it)) && off) return; }
}
