// API: POST /api/analyze (volá sa z src/worker.js)
// Prijme namerané uhly + kľúčové snímky, zavolá Claude API s web search
// (živé dohľadanie správnej techniky) a vráti štruktúrovaný rozbor v slovenčine.
//
// Premenné prostredia (Cloudflare → Workers & Pages → vikings-technika → Settings → Variables and Secrets):
//   ANTHROPIC_API_KEY  (povinné, typ Secret)
//   ACCESS_CODE        (odporúčané – prístupový kód, ktorý zadáš raz v appke)
//   CLAUDE_MODEL       (voliteľné, predvolene claude-sonnet-5-5)

const DEFAULT_MODEL = 'claude-sonnet-5-5';
const MAX_IMAGES = 12;
const MAX_IMAGE_B64 = 600_000;
const API_DEADLINE_MS = 110_000; // celkový čas na odpoveď AI

const SYSTEM = `Si skúsený silový a kondičný tréner a odborník na techniku cvikov (silový tréning, kalistenika).
Dostaneš údaje z analýzy videa jedného človeka pri cvičení: uhly kĺbov namerané pomocou pose detection (2D, z kamery) po jednotlivých opakovaniach a niekoľko kľúčových snímok s vyznačenou kostrou.

Postup:
1. Urči, aký cvik je na videu (ak ho používateľ zadal, over, či sedí so snímkami).
2. Pomocou web search dohľadaj spoľahlivé zdroje o správnej technike tohto cviku (odborné weby o silovom tréningu, fyzioterapii, renomovaní tréneri; nie fóra). Stačia 1–3 vyhľadávania.
3. Údaj "active_segment" hovorí, v ktorej časti videa prebieha samotný cvik. Pohyb pred ním a po ňom (napr. zľahnutie do vzporu pred klikmi, chôdza ku kamere) je len príprava: nehodnoť ho, nepočítaj ho ako opakovanie a podľa neho neurčuj cvik. Pri rozpoznávaní cviku sa opieraj hlavne o snímky z tohto úseku a o polohu tela (body_posture).
4. Skontroluj celé telo, nielen hlavný kĺb: hlavu a krk (neck), ramená, lakte a predlaktia (forearm), trup (trunk_lean), línia tela (body_line), boky, kolená, členky a päty (ankle, heel_lift_pct), dráhu rúk/činky, symetriu ľavej a pravej strany (ak je pohľad spredu/zozadu), tempo, výdrž v krajnej polohe a to, či sa technika nezhoršuje s únavou (set_consistency, porovnaj prvé a posledné opakovanie). Ktoré časti tela sú pre daný cvik dôležité, posúď podľa dohľadanej techniky.
5. Porovnaj namerané uhly, tempo a snímky so správnou technikou. Opieraj sa o konkrétne čísla a snímky, ale buď opatrný: 2D uhly z jedného pohľadu sú len odhad, posudzuj len to, čo sa z daného uhla kamery naozaj dá posúdiť.
6. Skóre urči podľa pevnej stupnice, aby bolo férové a opakovateľné. Rozdeľ ho do 5 oblastí po 20 bodov:
   - "Rozsah pohybu" (plný rozsah podľa cviku, hĺbka, vystretie v hornej polohe)
   - "Poloha tela" (trup, línia tela, hlava, chrbát)
   - "Kĺby a os pohybu" (kolená, lakte, ramená, členky, dráha činky/rúk)
   - "Tempo a kontrola" (kontrolované spúšťanie, bez švihu a odrazu)
   - "Stabilita a konzistencia" (symetria, rovnaká kvalita všetkých opakovaní)
   Súčet bodov v oblastiach = score. Za každý stratený bod musí existovať konkrétny dôvod.
7. Do "to_100" napíš presný plán, čo musí používateľ pri tomto cvičení zmeniť, aby dosiahol 100 bodov: každý krok = jedna konkrétna zmena a koľko bodov prinesie. Súčet "gain" = 100 − score. Zoraď od najväčšieho prínosu. Ak je score 100, nechaj pole prázdne.
8. Odpovedz výhradne v slovenčine, prakticky a zrozumiteľne pre bežného cvičenca. Bez diagnóz, nie je to medicínska rada.

Výstup: vráť IBA jeden JSON objekt (bez ďalšieho textu, bez markdownu) presne v tomto tvare:
{
  "exercise": { "name": "krátky názov cviku po slovensky, max. 3 slová (napr. 'Klik', 'Drep s činkou')", "confidence": "vysoká|stredná|nízka", "matches_selected": true | false | null },
  "score": číslo 0–100 (celkové hodnotenie techniky),
  "verdict": "celkový verdikt, max. 8 slov (napr. 'Dobrá technika, pozor na boky')",
  "summary": "max. 2 krátke vety zhrnutia, bez čísel uhlov",
  "description": "stručný popis správnej techniky tohto cviku (3–4 krátke vety)",
  "good": ["čo robí dobre – krátko, max. 8 slov na bod", "..."],
  "score_breakdown": [ { "area": "názov oblasti zo stupnice", "points": číslo 0–20, "max": 20, "note": "krátko prečo, max. 10 slov" } ],
  "to_100": [ { "step": "konkrétna zmena, max. 14 slov (napr. 'Choď v drepe hlbšie, boky aspoň po úroveň kolien')", "gain": počet bodov } ],
  "issues": [ { "title": "krátky názov chyby, max. 5 slov", "detail": "1 veta: čo presne vidno (môžeš uviesť opakovanie alebo uhol)", "fix": "1 veta: konkrétny pokyn, ako to opraviť", "severity": "vysoká|stredná|nízka" } ],
  "watch_out": ["na čo si dávať pozor (bezpečnosť, typické chyby pri tomto cviku) – max. 3 body, krátko", "..."],
  "muscles": { "primary": ["hlavné zapojené svaly"], "secondary": ["pomocné svaly"] },
  "cues": ["3–5 krátkych pokynov na zapamätanie, napr. 'kolená smerom nad špičky'"],
  "camera_limits": "čo sa z tohto uhla kamery nedalo posúdiť a ako natočiť lepšie, alebo null"
}
Ak je technika dobrá, "issues" môže byť prázdne. Ak sa cvik nedá rozpoznať alebo je video nepoužiteľné, nastav score na null a vysvetli to vo "verdict".`;

export async function onRequestPost({ request, env }) {
  try {
    if (env.ACCESS_CODE && request.headers.get('x-access-code') !== env.ACCESS_CODE) {
      return json({ error: 'Nesprávny alebo chýbajúci prístupový kód.', code: 'auth' }, 401);
    }
    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: 'Na serveri chýba ANTHROPIC_API_KEY (nastav ho v Cloudflare).' }, 500);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: 'Neplatná požiadavka.' }, 400); }
    const { exercise, summary, keyframes } = body || {};
    if (!summary || typeof summary !== 'object') return json({ error: 'Chýbajú namerané údaje.' }, 400);
    const frames = Array.isArray(keyframes) ? keyframes.slice(0, MAX_IMAGES) : [];

    const content = [];
    const exText = exercise && exercise.id !== 'auto'
      ? `Používateľ zadal cvik: ${exercise.name} (${exercise.en || ''}).`
      : 'Používateľ cvik nezadal – rozpoznaj ho zo snímok a údajov.';
    content.push({ type: 'text', text: `${exText}\n\nNamerané údaje z pose detection (JSON):\n${JSON.stringify(summary)}\n\nNasledujú kľúčové snímky z videa (oranžová = rozpoznaná kostra):` });
    for (const f of frames) {
      const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(f?.dataUrl || '');
      if (!m || m[2].length > MAX_IMAGE_B64) continue;
      content.push({ type: 'text', text: `${String(f.label || 'Snímka').slice(0, 80)} (čas ${Number(f.t) || 0} s):` });
      content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
    }
    content.push({ type: 'text', text: 'Vyhodnoť techniku a vráť iba JSON podľa zadania.' });

    const messages = [{ role: 'user', content }];
    const model = env.CLAUDE_MODEL || DEFAULT_MODEL;
    let resp, data;
    const started = Date.now();
    // web search môže vrátiť pause_turn – vtedy pokračujeme, ale len kým neprekročíme časový limit,
    // aby používateľ nečakal donekonečna
    for (let round = 0; round < 4; round++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Math.max(15_000, API_DEADLINE_MS - (Date.now() - started)));
      try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        signal: ctrl.signal,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': String(env.ANTHROPIC_API_KEY).trim(),
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model, max_tokens: 6000, system: SYSTEM, messages,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
        }),
      });
      data = await resp.json().catch(() => null);
      } catch (e) {
        if (e?.name === 'AbortError') return json({ error: 'AI odpovedala príliš dlho. Skús to znova.', code: 'timeout' }, 504);
        throw e;
      } finally { clearTimeout(timer); }
      if (!resp.ok) {
        const msg = data?.error?.message || `HTTP ${resp.status}`;
        return json({ error: `Chyba Claude API: ${msg}` }, 502);
      }
      if (data.stop_reason !== 'pause_turn') break;
      if (Date.now() - started > API_DEADLINE_MS - 20_000) break; // už nestihneme ďalšie kolo
      messages.push({ role: 'assistant', content: data.content });
    }

    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const result = parseJson(text);
    if (!result) return json({ error: 'AI nevrátila čitateľný výsledok. Skús to znova.', raw: text.slice(0, 2000) }, 502);
    // skóre = súčet bodov v oblastiach (aby sedelo s rozpisom)
    if (Array.isArray(result.score_breakdown) && result.score_breakdown.length && typeof result.score === 'number') {
      const sum = result.score_breakdown.reduce((t, b) => t + (Number(b.points) || 0), 0);
      if (sum > 0 && sum <= 100) result.score = Math.round(sum);
    }

    const sources = [];
    for (const m of messages.concat([{ content: data.content }])) {
      for (const b of (Array.isArray(m.content) ? m.content : [])) {
        if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
          for (const r of b.content) if (r.url && !sources.find(s => s.url === r.url)) sources.push({ url: r.url, title: r.title || r.url });
        }
      }
    }
    return json({ result, sources: sources.slice(0, 10), model: data.model, usage: data.usage });
  } catch (e) {
    return json({ error: `Neočakávaná chyba servera: ${e?.message || e}` }, 500);
  }
}

// GET slúži aj na rýchle overenie prístupového kódu ešte pred analýzou videa.
export function onRequestGet({ request, env } = {}) {
  if (env?.ACCESS_CODE && request?.headers.get('x-access-code') !== env.ACCESS_CODE) {
    return json({ error: 'Nesprávny alebo chýbajúci prístupový kód.', code: 'auth' }, 401);
  }
  return json({ ok: true, info: 'POST /api/analyze' });
}

function parseJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/```(?:json)?/g, '');
  const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
