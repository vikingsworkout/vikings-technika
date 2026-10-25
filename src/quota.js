// Prístup k rozboru techniky a počet rozborov.
//
// - Hrazda (prístupový kód ACCESS_CODE alebo účet, ktorý určí databáza Supabase cez vw_flags – len s čerstvým
//   dvojstupňovým overením): bez obmedzenia. V kóde nie je žiadny e-mail ani zoznam účtov.
// - Prihlásený používateľ appky Viking's Workout (token zo Supabase, ktorý Technike pošle appka):
//     bez Pro 3 rozbory spolu, s Pro 10 rozborov každý mesiac (kalendárny mesiac v UTC).
// - Počíta sa len ohodnotený rozbor; keď AI zlyhá alebo sa video nedá ohodnotiť, rozbor sa vráti.
// Počty sú na serveri (Durable Object Quota, jeden na používateľa), aby sa nedali obísť vymazaním appky.

export const LIMITS = { free: 3, pro: 10 };
// verejné údaje appky (rovnaké sú v appke); dajú sa prepísať premennými SB_URL, SB_KEY, PAY_URL
const SB_URL = 'https://cehbqshhjwahfxbzcpdl.supabase.co';
const SB_KEY = 'sb_publishable_9jpWzOvaa2SbG2FNwgfvOQ_5GCDAguJ';
const PAY_URL = 'https://vikings-platby.kurcik-michal.workers.dev';

async function getJson(url, headers, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    return r.ok ? await r.json().catch(() => null) : null;
  } catch { return null; } finally { clearTimeout(t); }
}

async function postJson(url, headers, body, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal });
    return r.ok ? await r.json().catch(() => null) : null;
  } catch { return null; } finally { clearTimeout(t); }
}

// hrazda: rozhodne databáza podľa tokenu (vyžaduje aj čerstvé dvojstupňové overenie)
async function isHz(env, token) {
  const f = await postJson((env.SB_URL || SB_URL) + '/rest/v1/rpc/vw_flags',
    { apikey: env.SB_KEY || SB_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, '{}');
  return !!(f && f.h === true);
}

// porovnanie kódu bez úniku informácie cez čas odpovede
function sameCode(a, b) {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}
// skúšanie kódov: najviac 20 nesprávnych za hodinu z jednej IP adresy, potom sa kód z nej neberie do úvahy
async function codeFails(env, ip, add) {
  try {
    const stub = env.QUOTA.get(env.QUOTA.idFromName('ip:' + ip));
    const r = await stub.fetch('https://quota/', { method: 'POST', body: JSON.stringify({ op: add ? 'fail' : 'fails' }) });
    return Number((await r.json()).n) || 0;
  } catch { return 0; }
}

// používateľ podľa tokenu zo Supabase
async function whoAmI(env, token) {
  const u = await getJson((env.SB_URL || SB_URL) + '/auth/v1/user', { apikey: env.SB_KEY || SB_KEY, Authorization: 'Bearer ' + token });
  return u && u.id && u.email ? { id: String(u.id), email: String(u.email).trim().toLowerCase() } : null;
}

// Pro: zaplatené cez Stripe (služba platieb) alebo Pro v appke (skúšobná doba, odcvičený mesiac zadarmo)
async function planOf(env, token, user) {
  if (await isHz(env, token)) return 'hz';
  const auth = { Authorization: 'Bearer ' + token };
  const [paid, rows] = await Promise.all([
    getJson((env.PAY_URL || PAY_URL) + '/pro', auth),
    getJson(`${env.SB_URL || SB_URL}/rest/v1/user_state?user_id=eq.${encodeURIComponent(user.id)}&select=pro:data->proLocal`, { apikey: env.SB_KEY || SB_KEY, ...auth }),
  ]);
  const p = Array.isArray(rows) && rows[0] && rows[0].pro;
  const local = !!(p && typeof p === 'object' && (p.tier === 'once' || (Number(p.until) || 0) > Date.now()));
  return (paid && paid.active) || local ? 'pro' : 'free';
}

// Kto volá: { ok, plan: 'hz' | 'pro' | 'free', user } alebo { ok: false, error }
export async function access(env, req) {
  const code = req.headers.get('x-access-code') || '';
  if (code && env.ACCESS_CODE) {
    const ip = req.headers.get('cf-connecting-ip') || 'x';
    if ((await codeFails(env, ip, false)) < 20) {
      if (sameCode(code, env.ACCESS_CODE)) return { ok: true, plan: 'hz' };
      await codeFails(env, ip, true);
    }
  }
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (token) {
    const user = await whoAmI(env, token);
    if (!user) return { ok: false, error: 'Prihlásenie v appke vypršalo. Zatvor Techniku a otvor ju znova.' };
    return { ok: true, plan: await planOf(env, token, user), user };
  }
  // bez tokenu a bez správneho kódu nič (ani keď ACCESS_CODE nie je nastavený)
  return { ok: false, error: 'Nesprávny alebo chýbajúci prístupový kód.' };
}

const monthKey = (d = new Date()) => 'm:' + d.toISOString().slice(0, 7);
async function call(env, uid, data) {
  const stub = env.QUOTA.get(env.QUOTA.idFromName('u:' + uid));
  const r = await stub.fetch('https://quota/', { method: 'POST', body: JSON.stringify(data) });
  return r.json();
}

// Rezervuje jeden rozbor. { ok, used, key } – ok: false, keď je limit vyčerpaný.
// Keď počítadlo nefunguje, rozbor pustí (radšej než zablokovať všetkých) a nič nezapíše.
export async function quotaTake(env, uid, plan) {
  try { return await call(env, uid, { op: 'take', key: plan === 'pro' ? monthKey() : 'free', limit: LIMITS[plan] || 0 }); }
  catch (e) { console.error('quota take', e); return { ok: true, used: null, key: null }; }
}
export async function quotaGive(env, uid, key) {
  if (!key) return { used: null };
  try { return await call(env, uid, { op: 'give', key }); } catch (e) { console.error('quota give', e); return { used: null }; }
}
export async function quotaGet(env, uid, plan) {
  try { return await call(env, uid, { op: 'get', key: plan === 'pro' ? monthKey() : 'free' }); } catch (e) { console.error('quota get', e); return { used: null }; }
}

// stav pre appku: koľko rozborov zostáva (pri Pro aj kedy sa počet obnoví)
export function quotaInfo(plan, used) {
  const limit = LIMITS[plan] || 0;
  if (used == null) return { plan, limit };
  const u = Math.max(0, Number(used) || 0);
  const now = new Date();
  const reset = plan === 'pro' ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10) : null;
  return { plan, used: u, limit, left: Math.max(0, limit - u), ...(reset ? { reset } : {}), ...(plan === 'free' ? { pro: LIMITS.pro } : {}) };
}
export function limitText(plan) {
  return plan === 'pro'
    ? `Tento mesiac si využil všetkých ${LIMITS.pro} rozborov techniky. Ďalšie budeš mať od prvého dňa budúceho mesiaca.`
    : `Využil si ${LIMITS.free} rozbory techniky zadarmo. S Pro máš ${LIMITS.pro} rozborov každý mesiac.`;
}

// Durable Object: počty rozborov jedného používateľa (kľúč 'free' = spolu, 'm:RRRR-MM' = Pro za mesiac)
export class Quota {
  constructor(state) { this.state = state; }
  async fetch(req) {
    const d = await req.json().catch(() => ({}));
    const st = this.state.storage;
    // nesprávne prístupové kódy z jednej IP adresy (posledná hodina)
    if (d.op === 'fail' || d.op === 'fails') {
      const now = Date.now();
      const arr = ((await st.get('fails')) || []).filter(t => now - t < 3600e3);
      if (d.op === 'fail') { arr.push(now); await st.put('fails', arr.slice(-60)); }
      return Response.json({ n: arr.length });
    }
    const key = typeof d.key === 'string' && /^(free|m:\d{4}-\d{2})$/.test(d.key) ? d.key : null;
    if (!key) return Response.json({ error: 'kľúč' }, { status: 400 });
    const used = Number(await st.get(key)) || 0;
    if (d.op === 'get') return Response.json({ used, key });
    if (d.op === 'take') {
      if (used >= (Number(d.limit) || 0)) return Response.json({ ok: false, used, key });
      await st.put(key, used + 1);
      return Response.json({ ok: true, used: used + 1, key });
    }
    if (d.op === 'give') {
      const n = Math.max(0, used - 1);
      await st.put(key, n);
      return Response.json({ ok: true, used: n, key });
    }
    return Response.json({ error: 'op' }, { status: 400 });
  }
}
