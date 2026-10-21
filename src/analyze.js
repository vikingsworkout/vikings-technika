// API: POST /api/analyze (volá sa z src/worker.js)
// Prijme namerané uhly + kľúčové snímky, zavolá Claude API s web search
// (živé dohľadanie správnej techniky) a vráti štruktúrovaný rozbor v slovenčine.
//
// Premenné prostredia (Cloudflare → Workers & Pages → vikings-technika → Settings → Variables and Secrets):
//   ANTHROPIC_API_KEY  (povinné, typ Secret)
//   ACCESS_CODE        (odporúčané – prístupový kód, ktorý zadáš raz v appke)
//   CLAUDE_MODEL       (voliteľné, predvolene claude-sonnet-5-5)

import { fixResultSk, hasCzech, collectTexts, applyTexts } from '../public/js/sk.js';
import { access, quotaTake, quotaGive, quotaGet, quotaInfo, limitText } from './quota.js';

const DEFAULT_MODEL = 'claude-sonnet-5-5';
const FIX_MODEL = 'claude-haiku-5-5'; // rýchla jazyková oprava, keď v rozbore ostane čeština (CLAUDE_FIX_MODEL ho prepíše)
// Modely, ktoré si appka smie vyžiadať (porovnanie modelov v admin teste), a ich cena v $ za milión tokenov [vstup, výstup].
const MODELS = { 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.10, 0.50] };
const SEARCH_USD = 0.01; // jedno vyhľadávanie na webe
function usdOf(model, u) {
  const p = MODELS[model];
  if (!p || !u) return 0;
  const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  return inTok * p[0] / 1e6 + (u.output_tokens || 0) * p[1] / 1e6 + ((u.server_tool_use && u.server_tool_use.web_search_requests) || 0) * SEARCH_USD;
}
const MAX_IMAGES = 12;
const MAX_IMAGE_B64 = 600_000;
const API_DEADLINE_MS = 110_000; // celkový čas na odpoveď AI

const SYSTEM = `Si skúsený silový a kondičný tréner a odborník na techniku cvikov (silový tréning, kalistenika).
Dostaneš údaje z analýzy videa jedného človeka pri cvičení: uhly kĺbov namerané pomocou pose detection (2D, z kamery) po jednotlivých opakovaniach a niekoľko kľúčových snímok s vyznačenou kostrou.

Postup:
1. Urči, aký cvik je na videu (ak ho používateľ zadal, over, či sedí so snímkami).
2. Ak máš k dispozícii web search, dohľadaj spoľahlivé zdroje o správnej technike tohto cviku (odborné weby o silovom tréningu, fyzioterapii, renomovaní tréneri; nie fóra), stačia 1–2 vyhľadávania. Ak web search nemáš, vychádzaj z kritérií na 100 bodov a zo svojich znalostí.
3. Údaj "active_segment" hovorí, v ktorej časti videa prebieha samotný cvik. Pohyb pred ním a po ňom (napr. zľahnutie do vzporu pred klikmi, chôdza ku kamere) je len príprava: nehodnoť ho, nepočítaj ho ako opakovanie a podľa neho neurčuj cvik. Pri rozpoznávaní cviku sa opieraj hlavne o snímky z tohto úseku a o polohu tela (body_posture).
4. Skontroluj celé telo, nielen hlavný kĺb: hlavu a krk (neck), ramená, lakte a predlaktia (forearm), trup (trunk_lean), línia tela (body_line), boky, kolená, členky a päty (ankle, heel_lift_pct), dráhu rúk/činky, symetriu ľavej a pravej strany (ak je pohľad spredu/zozadu), tempo, výdrž v krajnej polohe a to, či sa technika nezhoršuje s únavou (set_consistency, porovnaj prvé a posledné opakovanie). Ktoré časti tela sú pre daný cvik dôležité, posúď podľa dohľadanej techniky.
5. Porovnaj namerané uhly, tempo a snímky so správnou technikou. Opieraj sa o konkrétne čísla a snímky (čísla sú len na posúdenie, do textu pre používateľa ich nepíš), ale buď opatrný: 2D uhly z jedného pohľadu sú len odhad, posudzuj len to, čo sa z daného uhla kamery naozaj dá posúdiť.
   Počet opakovaní: reps_detected je nameraný appkou z pohybu kĺbu – v texte uvádzaj tento počet. Opakovania s rom_pct pod 80 majú neúplný rozsah (napr. nevystreté ruky hore alebo plytký zostup).
   Tempo: posudzuj ho VÝHRADNE podľa nameraných časov (down_s, pause_bottom_s, up_s pri opakovaniach a súhrn "tempo"), nikdy podľa dojmu zo snímok – zo snímok sa rýchlosť posúdiť nedá. Namerané časy sú bez pomalého rozbehu a dobehu pohybu, takže sú o niečo kratšie, než ako to cvičenec vníma. Platí:
   - avg_down_s 1,2 s a viac = kontrolované až pomalé spúšťanie: pochváľ ho, NEradíš spomaliť a v oblasti „Tempo a kontrola“ zaň body nestrhávaj,
   - 0,8–1,2 s = primerané: spomalenie nanajvýš ako voliteľný tip, nie ako chyba,
   - pod 0,8 s = rýchle: odporuč spomaliť (cieľ asi 2 s dole); pri hip thruste a mostíku stačí, že spúšťanie nie je pád.
   Rýchly, dynamický zdvih (up_s) je v poriadku a nie je chyba.
   Výdrže (statické cviky – plank, stojka, L-sit, front lever, back lever, planche…): ak je summary.exercise_type = "hold", opakovania ani tempo nehodnoť. Posúď polohu počas výdrže podľa hold_metrics (línia tela, uhly kĺbov, náklon body_tilt_deg, pri stojke vertical_dev_deg a otvorenie ramien), stabilitu (stability), dĺžku výdrže (hold.duration_s) a zmenu polohy ku koncu (fatigue, napr. klesajúce boky). Dĺžku hodnoť primerane náročnosti cviku: pri planku je dobrých 30–60 s, pri stojke 15–30 s, pri L-site 10–20 s, pri front leveri, back leveri a planche sú výborné aj 3–10 s. Pri front leveri, back leveri a planche urči zo snímok variant (tuck, advanced tuck, straddle, full) a techniku hodnoť primerane variantu (pri tuck variante sú pokrčené kolená správne). Ak výdrž nebola nájdená (hold.found = false), hodnoť opatrne len zo snímok a v camera_limits napíš, ako natočiť lepšie. Pri automatickom rozpoznaní je v hold.detected_position poloha odhadnutá appkou; presný cvik (napr. front lever vs. back lever, plank vs. planche, tuck vs. full) urči zo snímok.
6. Skóre urči podľa pevnej stupnice, aby bolo férové a opakovateľné. Rozdeľ ho do 5 oblastí po 20 bodov:
   - "Rozsah pohybu" (plný rozsah podľa cviku, hĺbka, vystretie v hornej polohe)
   - "Poloha tela" (trup, línia tela, hlava, chrbát)
   - "Kĺby a os pohybu" (kolená, lakte, ramená, členky, dráha činky/rúk)
   - "Tempo a kontrola" (kontrolované spúšťanie podľa nameraného tempa, bez švihu a odrazu)
   - "Stabilita a konzistencia" (symetria, rovnaká kvalita všetkých opakovaní)
   Pri výdržiach použi týchto 5 oblastí po 20 bodov: "Línia tela", "Kĺby a zamknutie", "Poloha a uhly", "Stabilita", "Dĺžka a únava".
   Súčet bodov v oblastiach = score. Za každý stratený bod musí existovať konkrétny dôvod.
   Kalibrácia – 100 bodov musí byť reálne dosiahnuteľných a skóre férové a opakovateľné:
   - 100 bodov daj, keď sú splnené všetky kritériá na 100 bodov (ak ich používateľ poslal, inak kľúčové body správnej techniky daného cviku) a nevidno žiadnu jasnú chybu. Technika nemusí byť dokonalá do stupňa – stačí, že je čistá, v plnom rozsahu a pod kontrolou.
   - Presnosť merania z jednej kamery je asi ±10°. Kĺb s uhlom aspoň 165° ber ako vystretý. Rozdiely v rámci tejto presnosti nie sú chyba a body za ne nestrhávaj. Čo sa z uhla kamery nedá spoľahlivo posúdiť, body nestrháva (napíš to do camera_limits).
   - Body strhávaj podľa závažnosti chyby: drobnosť (severity nízka) 1–2 body, dôležitá chyba (stredná) 3–6 bodov, hlavná chyba (vysoká) 7–12 bodov. Za jednu chybu strhni body len raz.
   - Pásma: 95–100 čistá technika, 85–94 dobrá s drobnosťami, 70–84 jedna až dve dôležité chyby, 50–69 viac chýb alebo hlavná chyba, pod 50 nebezpečná alebo veľmi neúplná technika.
   - Rovnaký výkon musí dostať rovnaké skóre (±3 body).
   Do "criteria_100" vráť kritériá na 100 bodov: ak ich používateľ poslal, v rovnakom poradí a rovnakými slovami (pri variante cviku ich prispôsob variantu); inak 3–5 vlastných kľúčových kritérií pre rozpoznaný cvik (krátko, jednoducho). Pri každom urči "met": true = splnené, false = nesplnené, null = z tohto videa sa nedá posúdiť. Ak je niektoré false, musí k nemu byť chyba v "issues" a krok v "to_100".
7. Do "today" daj JEDNU najdôležitejšiu vec, ktorú má používateľ zmeniť pri ďalšej sérii (zvyčajne prvý krok z "to_100"). Napíš ju ako krátky pokyn v 2. osobe, jednoducho, ako by to povedal tréner. "frame" = číslo snímky (podľa "Snímka N"), na ktorej je táto chyba najlepšie vidieť.
8. Do "to_100" napíš presný plán, čo musí používateľ pri tomto cvičení zmeniť, aby dosiahol 100 bodov: každý krok = jedna konkrétna zmena a koľko bodov prinesie. Súčet "gain" = 100 − score. Zoraď od najväčšieho prínosu. Ak je score 100, nechaj pole prázdne.
9. Jazyk: odpovedz výhradne po slovensky – spisovne, ale jednoducho, tak ako hovorí tréner na tréningu. Píš pre bežného človeka, ktorý necvičí odborne a nepozná biomechaniku:
   - žiadna čeština ani české tvary slov – v texte nesmie byť ani jedno z písmen ě, ř, ů. Zle → dobre: „ujíždějí“ → „uhýbajú“, „kyčle“ → „boky“, „záda“ → „chrbát“, „lokty“ → „lakte“, „břicho“ → „brucho“, „dolů“ → „dole“, „rovně“ → „rovno“, „pomalu“ → „pomaly“, „při“ → „pri“,
   - bežné slová, ktorým rozumie každý: boky, zadok, brucho, chrbát, ramená, lakte, kolená, päty, špičky, hlava, pohľad. Žiadne odborné ani anglické výrazy (nie „extenzia“, „flexia“, „protrakcia“, „valgus“, „ROM“, „core“, „línia trupu“, „pose detection“, „2D“) ani názvy údajov (body_line, rom_pct, trunk_lean…),
   - krátke jednoduché vety v 2. osobe (ty),
   - názov chyby („title“) napíš ako jasný opis toho, čo robíš, aby ho pochopil aj začiatočník bez vysvetlenia. Dobre: „Nejdeš vždy rovnako hlboko“, „Boky ti uhýbajú do strán“, „Pri zostupe sa predkláňaš“. Zle: „Hĺbka sa mení“, „Asymetria bokov“, „Nestabilita trupu“,
   - v texte pre používateľa NIKDY neuvádzaj stupne (°), percentá ani iné namerané hodnoty – tie slúžia len tebe na posúdenie. Napíš radšej, čo človek uvidí alebo pocíti. Čísla smú byť len: počet opakovaní, poradie opakovania („v 3. opakovaní“), sekundy (výdrž, tempo) a body skóre,
   - pri každej chybe musí byť jasné, ktorá časť tela, kedy (v ktorej fáze pohybu) a čo presne je zle; „fix“ = jeden jednoduchý pokyn, ktorý sa dá hneď skúsiť, ako by ho povedal tréner na tréningu (nie všeobecná rada ani zložitý opis pohybu),
   - neuvádzaj drobnosti, ktoré sú v rámci presnosti merania z jednej kamery (napr. koleno alebo lakeť takmer vystreté, malé kolísanie); ak si chybou nie si istý, radšej ju vynechaj. Do „issues“ daj najviac 4 chyby, ktoré naozaj zhoršujú techniku,
   - príklady: zle „Koleno dosiahlo len okolo 168° na konci pohybu.“ → dobre „Na konci pohybu nohy celkom nevystrieš.“; zle „Zápästia sa vodorovne posúvali (až 53 % dĺžky trupu).“ → dobre „Ruky sa ti počas opakovania posúvajú po hrazde.“; zle „Uhol krku je 107–120°, hlava je zaklonená či zvretá proti línii trupu.“ → dobre „Hlavu zakláňaš dozadu a pozeráš sa hore.“
   Pred odoslaním si prečítaj každý text a oprav slová, ktoré nie sú po slovensky alebo ktorým by bežný človek nerozumel.
   Bez diagnóz, nie je to medicínska rada.

Výstup: vráť IBA jeden JSON objekt (bez ďalšieho textu, bez markdownu) presne v tomto tvare:
{
  "exercise": { "name": "krátky názov cviku po slovensky, max. 3 slová (napr. 'Klik', 'Drep s činkou')", "confidence": "vysoká|stredná|nízka", "matches_selected": true | false | null },
  "score": číslo 0–100 (celkové hodnotenie techniky),
  "verdict": "celkový verdikt, 1 krátka veta, max. 9 slov (napr. 'Dobré. Ešte jedna vec a budeš nad 85.')",
  "today": { "title": "jedna vec na dnes, max. 8 slov (napr. 'Zatni zadok, nech ti nepadajú boky.')", "detail": "1 krátka veta: ako to urobiť alebo čo pri tom cítiť", "gain": počet bodov, ktoré to prinesie, "frame": číslo snímky alebo null },
  "summary": "max. 2 krátke vety zhrnutia, bez čísel uhlov",
  "description": "stručný popis správnej techniky tohto cviku (3–4 krátke vety)",
  "good": ["čo robí dobre – krátko, max. 8 slov na bod", "..."],
  "score_breakdown": [ { "area": "názov oblasti zo stupnice", "points": číslo 0–20, "max": 20, "note": "krátko prečo, max. 10 slov, bez stupňov a percent" } ],
  "to_100": [ { "step": "konkrétna zmena, max. 14 slov (napr. 'Choď v drepe hlbšie, boky aspoň po úroveň kolien')", "gain": počet bodov } ],
  "criteria_100": [ { "text": "kritérium na 100 bodov, max. 10 slov", "met": true | false | null } ],
  "issues": [ { "title": "krátky jasný opis chyby jednoduchými slovami, max. 5 slov (napr. 'Nohy na konci nevystrieš', 'Boky ti uhýbajú do strán')", "detail": "1 krátka veta: čo presne robíš zle a kedy, bez stupňov a percent (môžeš uviesť číslo opakovania)", "fix": "1 krátka veta: jednoduchý pokyn, čo urobiť inak", "severity": "vysoká|stredná|nízka" } ],
  "watch_out": ["na čo si dávať pozor (bezpečnosť, typické chyby pri tomto cviku) – max. 3 body, krátko", "..."],
  "muscles": { "primary": ["hlavné zapojené svaly"], "secondary": ["pomocné svaly"] },
  "cues": ["3–5 krátkych pokynov na zapamätanie, napr. 'kolená smerom nad špičky'"],
  "camera_limits": "jednoducho: čo sa z tohto uhla kamery nedalo posúdiť a ako natočiť lepšie (napr. 'Natoč sa z boku, nech je vidno celé telo.'), alebo null"
}
Ak je technika dobrá, "issues" môže byť prázdne. Ak sa cvik nedá rozpoznať alebo je video nepoužiteľné, nastav score na null a vysvetli to vo "verdict".`;

// chyba od AI → zrozumiteľná veta pre používateľa (technický detail ide zvlášť do "detail")
function apiError(status, msg) {
  if (status === 429 || status === 529 || /overload|rate.?limit/i.test(msg)) return { error: 'AI je práve vyťažená. Skús to o minútu znova – video netreba nahrávať znova.', code: 'busy' };
  if (status === 401 || status === 403 || /credit|billing|api.?key/i.test(msg)) return { error: 'Rozbor je teraz nedostupný (chyba nastavenia servera). Skús to neskôr.', code: 'config' };
  if (status === 400 || status === 413) return { error: 'AI tento rozbor nevedela spracovať. Skús to znova, prípadne s kratším videom.', code: 'bad' };
  return { error: 'AI má práve výpadok. Skús to o chvíľu znova – video netreba nahrávať znova.', code: 'down' };
}

export async function onRequestPost({ request, env }) {
  // prístup: správca (bez obmedzenia) alebo prihlásený používateľ appky s počtom rozborov (pozri quota.js)
  let gate;
  try { gate = await access(env, request); } catch (e) { return json({ error: 'Na serveri sa niečo pokazilo. Skús to o chvíľu znova.', code: 'server', detail: String(e?.message || e).slice(0, 200) }, 500); }
  if (!gate.ok) return json({ error: gate.error, code: 'auth' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Video sa na server neodoslalo celé. Skús to znova.', code: 'bad' }, 400); }
  if (!body || typeof body !== 'object') body = {};
  if (gate.plan === 'admin') return analyzeBody(body, env);
  delete body.model; delete body.noSearch; // výber modelu len pre správcu (porovnanie modelov)
  const held = await quotaTake(env, gate.user.id, gate.plan);
  if (!held.ok) return json({ error: limitText(gate.plan), code: 'limit', quota: quotaInfo(gate.plan, held.used) }, 402);
  const res = await analyzeBody(body, env);
  let j = null;
  try { j = await res.clone().json(); } catch { j = null; }
  // počíta sa len ohodnotený rozbor; inak sa rezervácia vráti
  const counted = res.ok && j && j.result && typeof j.result.score === 'number';
  const used = counted ? held.used : (await quotaGive(env, gate.user.id, held.key)).used;
  return j ? json({ ...j, quota: quotaInfo(gate.plan, used) }, res.status) : res;
}

// koľko rozborov ešte zostáva (appka to ukáže pred natáčaním)
export async function onQuota({ request, env }) {
  let gate;
  try { gate = await access(env, request); } catch { return json({ error: 'Na serveri sa niečo pokazilo.', code: 'server' }, 500); }
  if (!gate.ok) return json({ error: gate.error, code: 'auth' }, 401);
  if (gate.plan === 'admin') return json({ plan: 'admin' });
  const r = await quotaGet(env, gate.user.id, gate.plan);
  return json(quotaInfo(gate.plan, r.used));
}

async function analyzeBody(body, env) {
  try {
    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: 'Rozbor je teraz nedostupný (server nie je nastavený). Skús to neskôr.', code: 'config', detail: 'Na serveri chýba ANTHROPIC_API_KEY (nastav ho v Cloudflare).' }, 500);
    }
    const { exercise, summary, keyframes } = body || {};
    if (!summary || typeof summary !== 'object') return json({ error: 'Chýba meranie z videa. Nahraj video znova.', code: 'bad' }, 400);
    const frames = Array.isArray(keyframes) ? keyframes.slice(0, MAX_IMAGES) : [];

    const content = [];
    // názov cviku z hlavnej appky (automatický režim) – len ako nápoveda, krátky a bez riadkov
    const hint = exercise && exercise.id === 'auto' && typeof exercise.hint === 'string'
      ? exercise.hint.replace(/[\r\n\t"`]+/g, ' ').trim().slice(0, 80) : '';
    const exText = exercise && exercise.id !== 'auto'
      ? `Používateľ zadal cvik: ${exercise.name} (${exercise.en || ''})${exercise.type === 'hold' ? ' – výdrž, statický cvik' : ''}.`
      : hint
        ? `Používateľ v appke vybral cvik „${hint}“. Over zo snímok a údajov, či to sedí; ak áno, hodnoť ho ako tento cvik a v exercise.name použi tento názov.`
        : 'Používateľ cvik nezadal – rozpoznaj ho zo snímok a údajov.';
    // kritériá na 100 bodov od appky (pre známe cviky) – krátke texty bez riadkov
    const criteria = Array.isArray(body.criteria)
      ? body.criteria.filter(c => typeof c === 'string').map(c => c.replace(/[\r\n\t"`]+/g, ' ').trim().slice(0, 140)).filter(Boolean).slice(0, 8) : [];
    const critText = criteria.length
      ? `\n\nKritériá na 100 bodov pre tento cvik (ak je na videu jeho variant, napr. kliky na kolenách alebo drepy na stoličku, prispôsob ich variantu):\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
      : '';
    content.push({ type: 'text', text: `${exText}${critText}\n\nNamerané údaje z pose detection (JSON):\n${JSON.stringify(summary)}\n\nNasledujú kľúčové snímky z videa (oranžová = rozpoznaná kostra):` });
    frames.forEach((f, idx) => {
      const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(f?.dataUrl || '');
      if (!m || m[2].length > MAX_IMAGE_B64) return;
      content.push({ type: 'text', text: `Snímka ${idx + 1}: ${String(f.label || 'Snímka').slice(0, 80)} (čas ${Number(f.t) || 0} s):` });
      content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
    });
    content.push({ type: 'text', text: 'Vyhodnoť techniku a vráť iba JSON podľa zadania.' });

    const messages = [{ role: 'user', content }];
    // model z požiadavky len zo zoznamu povolených (porovnanie modelov), inak nastavený alebo predvolený
    const model = (typeof body.model === 'string' && MODELS[body.model] ? body.model : '') || env.CLAUDE_MODEL || DEFAULT_MODEL;
    const noSearch = body.noSearch === true; // bez vyhľadávania na webe (lacnejší model by inak platil viac za hľadanie než za rozbor)
    let resp, data, noTemp = false;
    const started = Date.now();
    // spotreba a cena všetkých volaní AI pri tomto rozbore (aj pokračovania po vyhľadávaní a jazykovej opravy)
    const spend = { usd: 0, in: 0, out: 0, search: 0 };
    const addUse = (m, u) => {
      if (!u) return;
      spend.usd += usdOf(m, u);
      spend.in += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
      spend.out += u.output_tokens || 0;
      spend.search += (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
    };
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
          ...(noTemp ? {} : { temperature: 0.2 }),
          ...(criteria.length || noSearch ? {} : { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }] }),
        }),
      });
      data = await resp.json().catch(() => null);
      } catch (e) {
        if (e?.name === 'AbortError') return json({ error: 'AI odpovedala príliš dlho. Skús to znova.', code: 'timeout' }, 504);
        throw e;
      } finally { clearTimeout(timer); }
      if (!resp.ok) {
        const msg = data?.error?.message || `HTTP ${resp.status}`;
        // niektorý model nemusí podporovať nastavenie teploty – skúsime to raz bez nej
        if (resp.status === 400 && !noTemp && /temperature/i.test(msg)) { noTemp = true; round--; continue; }
        return json({ ...apiError(resp.status, msg), detail: String(msg).slice(0, 300) }, 502);
      }
      addUse(model, data.usage);
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

    cleanResult(result);
    // slovenčina: texty s českými slovami prepíše rýchla AI; známe české slová potom opraví aj slovník (poistka)
    const skFixed = await fixCzech(env, result, started + API_DEADLINE_MS + 15_000, addUse);
    fixResultSk(result);

    const sources = [];
    for (const m of messages.concat([{ content: data.content }])) {
      for (const b of (Array.isArray(m.content) ? m.content : [])) {
        if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
          for (const r of b.content) if (r.url && !sources.find(s => s.url === r.url)) sources.push({ url: r.url, title: r.title || r.url });
        }
      }
    }
    const cost = { usd: Math.round(spend.usd * 100000) / 100000, in: spend.in, out: spend.out, search: spend.search };
    return json({ result, sources: sources.slice(0, 10), model: data.model, usage: data.usage, cost, ms: Date.now() - started, ...(skFixed ? { sk: skFixed } : {}) });
  } catch (e) {
    return json({ error: 'Na serveri sa niečo pokazilo. Skús to o chvíľu znova – video netreba nahrávať znova.', code: 'server', detail: String(e?.message || e).slice(0, 300) }, 500);
  }
}

// GET slúži aj na rýchle overenie prístupového kódu ešte pred analýzou videa.
export async function onRequestGet({ request, env } = {}) {
  const gate = await access(env || {}, request).catch(() => ({ ok: false, error: 'Na serveri sa niečo pokazilo.' }));
  if (!gate.ok) return json({ error: gate.error, code: 'auth' }, 401);
  return json({ ok: true, plan: gate.plan, info: 'POST /api/analyze' });
}

// Jazyková oprava: texty, v ktorých ostala čeština, prepíše rýchly model do jednoduchej slovenčiny.
// Vráti počet opravených textov, 0 = nebolo treba, -1 = nepodarilo sa (ostanú texty po slovníkovej oprave).
const FIX_SYSTEM = `Si jazykový korektor slovenčiny vo fitness appke. Dostaneš JSON s textmi z rozboru techniky cviku, v ktorých sú české slová alebo české tvary.
Každý text prepíš do prirodzenej, jednoduchej spisovnej slovenčiny, ako by to povedal tréner (napr. „ujíždějí“ → „uhýbajú“, „kyčle“ → „boky“, „záda“ → „chrbát“, „dolů“ → „dole“).
Význam nemeň, nič nepridávaj ani nevynechávaj, ponechaj oslovenie ty a približnú dĺžku. V texte nesmie ostať žiadne z písmen ě, ř, ů.
Vráť IBA jeden JSON objekt s rovnakými kľúčmi a opravenými textami, bez ďalšieho textu.`;
export async function fixCzech(env, result, until, onUse) {
  const texts = collectTexts(result, hasCzech);
  const keys = Object.keys(texts);
  if (!keys.length) return 0;
  const left = until - Date.now();
  if (left < 8000) return -1;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(15_000, left - 3000));
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      signal: ctrl.signal,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': String(env.ANTHROPIC_API_KEY).trim(), 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: env.CLAUDE_FIX_MODEL || FIX_MODEL, max_tokens: 2000, system: FIX_SYSTEM, messages: [{ role: 'user', content: JSON.stringify(texts) }] }),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data) return -1;
    if (onUse) onUse(env.CLAUDE_FIX_MODEL || FIX_MODEL, data.usage);
    const fixed = parseJson((data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n'));
    if (!fixed || typeof fixed !== 'object') return -1;
    const ok = {};
    for (const k of keys) if (typeof fixed[k] === 'string' && fixed[k].trim()) ok[k] = stripTech(fixed[k]);
    applyTexts(result, ok);
    return Object.keys(ok).length;
  } catch { return -1; } finally { clearTimeout(timer); }
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

// Poistka k zadaniu: z textov pre používateľa odstráni technické čísla (stupne, percentá dĺžky trupu…),
// ktoré bežnému cvičencovi nič nepovedia. Jednovetný opis chyby s takým číslom radšej vynechá celý.
const TECH_PAREN = /\s*\([^()]*(?:°|%)[^()]*\)/g;
const TECH_NUM = /\s*(?:(?:~|cca\.?|asi|okolo|približne|len|až|aspoň|takmer)\s*)*(?:(?:na|do|o|pod|nad)\s+)?~?\d+(?:[.,]\d+)?(?:\s*[–-]\s*~?\d+(?:[.,]\d+)?)?\s*(?:°|%(?:\s*(?:dĺžky|dĺžke)\s+trupu)?)/gi;
const tidy = (t) => t.replace(/\s{2,}/g, ' ').replace(/\s+([.,!?;:])/g, '$1').replace(/\(\s*\)/g, '').trim();
export function stripTech(s) {
  return typeof s === 'string' ? tidy(s.replace(TECH_PAREN, '').replace(TECH_NUM, '')) : s;
}
export function dropTechSentences(s) {
  if (typeof s !== 'string') return s;
  const parts = s.replace(TECH_PAREN, '').split(/(?<=[.!?])\s+/).filter(Boolean);
  return tidy(parts.filter(x => !/°|\d\s*%/.test(x)).join(' '));
}
export function cleanResult(r) {
  if (!r || typeof r !== 'object') return r;
  const arr = (a, f) => (Array.isArray(a) ? a.map(x => (typeof x === 'string' ? f(x) : x)).filter(x => x !== '') : a);
  for (const k of ['verdict', 'description', 'camera_limits']) if (typeof r[k] === 'string') r[k] = stripTech(r[k]);
  if (typeof r.summary === 'string') r.summary = dropTechSentences(r.summary) || stripTech(r.summary);
  if (r.today && typeof r.today === 'object') { r.today.title = stripTech(r.today.title); r.today.detail = stripTech(r.today.detail); }
  r.good = arr(r.good, stripTech); r.watch_out = arr(r.watch_out, stripTech); r.cues = arr(r.cues, stripTech);
  if (Array.isArray(r.to_100)) r.to_100.forEach(x => { if (x && typeof x.step === 'string') x.step = stripTech(x.step); });
  if (Array.isArray(r.criteria_100)) r.criteria_100.forEach(x => { if (x && typeof x.text === 'string') x.text = stripTech(x.text); });
  if (Array.isArray(r.score_breakdown)) r.score_breakdown.forEach(b => { if (b && typeof b.note === 'string') b.note = dropTechSentences(b.note); });
  if (Array.isArray(r.issues)) r.issues.forEach(i => {
    if (!i || typeof i !== 'object') return;
    i.title = stripTech(i.title); i.fix = stripTech(i.fix);
    if (typeof i.detail === 'string') i.detail = dropTechSentences(i.detail);
  });
  return r;
}
