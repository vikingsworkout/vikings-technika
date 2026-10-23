// Zoznam cvikov. Technika sa dohľadáva živo na webe, tento zoznam slúži na výber/potvrdenie cviku,
// návod na natočenie a nastavenie merania.
//
// Cviky s opakovaniami:
//   signal  = ktorý uhol kĺbu sa pri cviku najviac mení (opakovanie = jeho minimum)
//   posture = očakávaná poloha tela počas série (V stoj, H vodorovne, P visenie, null = hocijaká)
//   minAmp  = minimálny rozsah hlavného uhla v stupňoch, aby sa pohyb rátal ako opakovanie
//   start   = kde séria začína: 'top' (hore, napr. kliky) alebo 'bottom' (dole, napr. mostík)
// Výdrže (type: 'hold'):
//   target    = poloha, ktorú appka hľadá (plank, handstand, lsit, lever, planche)
//   holdJoint = hlavný sledovaný uhol (body_line = rameno–bok–členok, hip = rameno–bok–koleno)
//   maxSeconds = najdlhšie nahrávanie
// acc = tvar názvu v 4. páde, ak sa líši (Nahrávať stojku)
// dist = vzdialenosť kamery (obrazovka Natoč), checks = čo appka pri cviku kontroluje
// top = čo treba splniť na 100 bodov (ukáže sa pred natáčaním a AI podľa toho hodnotí)

export const EXERCISES = [
  {
    id: 'klik', top: ['Telo v jednej rovnej línii, boky neklesajú ani netrčia', 'Hrudník ide nízko k zemi a hore úplne vystrieš ruky', 'Lakte idú šikmo dozadu, nie do strán', 'Hlava v predĺžení chrbta', 'Spúšťaš sa pod kontrolou, nie pádom'], dist: '2 m od teba', checks: ['Rozsah pohybu', 'Línia tela', 'Lakte', 'Hlava v predĺžení', 'Tempo'], start: 'top', group: 'k', hint: 'Zboku, kamera nízko pri zemi', keys: ['klik','push-up','pushup'], name: 'Klik', en: 'Push-up', signal: 'elbow', posture: 'H', minAmp: 30,
    camera: 'Presne zboku, kamera nízko pri zemi (výška 20–40 cm), 2 m. V zábere celé telo od hlavy po päty.',
  },
  {
    id: 'pritah-hrazda', top: ['Každé opakovanie začína z vystretých rúk', 'Brada sa dostane nad hrazdu', 'Bez švihu a kopania nohami', 'Spúšťaš sa pomaly, aspoň 1 sekundu', 'Všetky opakovania rovnako dobré'], dist: '2–3 m od hrazdy', checks: ['Rozsah pohybu', 'Lakte a lopatky', 'Línia tela', 'Tempo', 'Bez švihu'], start: 'top', group: 'k', hint: 'Zboku alebo zozadu', keys: ['príťah','pritah','pull-up','pullup','chin-up','zhyb'], name: 'Príťah na hrazde', en: 'Pull-up', signal: 'elbow', posture: 'P', minAmp: 40,
    camera: 'Zboku alebo zozadu, kamera vo výške hrazdy alebo trochu nižšie, 2–3 m. V zábere hrazda aj celé telo.',
  },
  {
    id: 'drep', top: ['Boky klesnú aspoň po úroveň kolien', 'Kolená idú smerom nad špičky, nepadajú dovnútra', 'Rovný chrbát, hrudník hore', 'Päty celý čas na zemi', 'Spúšťaš sa pod kontrolou'], dist: '2–3 m od teba', checks: ['Hĺbka drepu', 'Kolená', 'Rovný chrbát', 'Päty na zemi', 'Tempo'], start: 'top', group: 'k', hint: 'Zboku, mierne spredu', keys: ['drep','squat'], name: 'Drep', en: 'Barbell / bodyweight squat', signal: 'knee', posture: 'V', minAmp: 35,
    camera: 'Zboku, mierne spredu (asi 45°). Kamera vo výške bokov, 2–3 m od teba. V zábere celé telo od chodidiel po hlavu.',
  },
  {
    id: 'vypad', top: ['Zadné koleno klesne takmer k zemi', 'Predné koleno nad chodidlom, nepadá dovnútra', 'Trup vzpriamený', 'Stojíš stabilne, bez kývania', 'Pohyb pod kontrolou'], dist: '2–3 m od teba', checks: ['Hĺbka', 'Predné koleno', 'Vzpriamený trup', 'Rovnováha', 'Tempo'], start: 'top', group: 'k', hint: 'Zboku, vo výške bokov', keys: ['výpad','vypad','lunge','bulharsk','split squat'], name: 'Výpad', en: 'Lunge', signal: 'knee', posture: 'V', minAmp: 30,
    camera: 'Zboku, kamera vo výške bokov, 2–3 m. V zábere obe nohy celé počas celého pohybu.',
  },
  {
    id: 'most', top: ['Hore vystreté boky, telo rovné od ramien po kolená', 'Kolená nad chodidlami, nerozchádzajú sa', 'Chrbát neprehnutý, tlačíš cez päty', 'Hore krátka výdrž, dole pod kontrolou'], dist: '2 m od teba', checks: ['Vystretie bokov', 'Kolená', 'Chrbát', 'Tempo'], start: 'bottom', group: 'k', hint: 'Zboku, kamera nízko pri zemi', keys: ['mostík','mostik','glute bridge','zdvíhanie panvy','zdvihanie panvy'], name: 'Mostík', en: 'Glute bridge', signal: 'hip', posture: null, minAmp: 20,
    camera: 'Presne zboku, kamera nízko pri zemi, 2 m. V zábere hlava, boky aj chodidlá.',
  },
  {
    id: 'bench', top: ['Činka ide až k hrudníku, hore vystreté ruky', 'Lakte šikmo pri tele, nie do strán', 'Činka ide rovnomerne, bez kývania', 'Lopatky stiahnuté, zadok na lavičke', 'Spúšťaš pod kontrolou'], dist: '1,5–2 m od lavičky', checks: ['Rozsah pohybu', 'Lakte', 'Dráha činky', 'Tempo'], start: 'top', group: 'c', hint: 'Zboku, vo výške lavičky', keys: ['bench','tlak na lavičke'], name: 'Bench press', en: 'Bench press', signal: 'elbow', posture: null, minAmp: 30,
    camera: 'Zboku, kamera vo výške lavičky, mierne smerom k hlave. V zábere ruky, ramená aj činka.',
  },
  {
    id: 'tlak-nad-hlavu', top: ['Hore úplne vystreté ruky nad hlavou', 'Pevný trup, bez záklonu', 'Činka ide rovno hore', 'Spúšťaš pod kontrolou'], dist: '2–3 m od teba', checks: ['Vystretie nad hlavou', 'Stabilný trup', 'Dráha činky', 'Tempo'], start: 'bottom', group: 'c', hint: 'Zboku, vo výške hrudníka', keys: ['nad hlavu','overhead','military'], name: 'Tlak nad hlavu', en: 'Overhead press', signal: 'elbow', posture: 'V', minAmp: 40,
    camera: 'Zboku, kamera vo výške hrudníka, 2–3 m. V zábere celé telo aj vystreté ruky nad hlavou.',
  },
  {
    id: 'hip-thrust', top: ['Hore vystreté boky, telo rovné od ramien po kolená', 'Kolená nad chodidlami', 'Chrbát neprehnutý, brada mierne k hrudníku', 'Hore krátka výdrž, dole pod kontrolou'], dist: '2 m od lavičky', checks: ['Vystretie bokov', 'Kolená', 'Chrbát a hlava', 'Tempo'], start: 'bottom', group: 'c', hint: 'Zboku, kamera nízko', keys: ['hip thrust','hip-thrust'], name: 'Hip thrust', en: 'Hip thrust', signal: 'hip', posture: null, minAmp: 25,
    camera: 'Presne zboku, kamera nízko (výška lavičky), 2 m. V zábere hlava, boky aj chodidlá.',
  },

  // ---------- výdrže (statické cviky) ----------
  // Vo výbere nie sú – rozpozná ich automatický režim. Slúžia na spárovanie názvu od AI a na „Iný cvik?“ vo výsledku.
  {
    id: 'plank', top: ['Telo v jednej rovnej línii, boky neklesajú ani netrčia', 'Lakte pod ramenami', 'Hlava v predĺžení chrbta', 'Výdrž aspoň 30 sekúnd bez zmeny polohy'], dist: '2 m od teba', checks: ['Línia tela', 'Boky', 'Hlava v predĺžení', 'Stabilita'], type: 'hold', group: 'h', target: 'plank', holdJoint: 'body_line', maxSeconds: 60, hint: 'Zboku, kamera nízko pri zemi',
    keys: ['plank','planka','doska','výdrž v kliku','vydrz v kliku'], name: 'Plank', en: 'Plank hold (forearm or high plank)',
    camera: 'Presne zboku, kamera nízko pri zemi (výška 20–40 cm), 2 m. V zábere celé telo od hlavy po päty.',
  },
  {
    id: 'stojka', top: ['Telo rovné od rúk po špičky', 'Ramená otvorené, ruky pri ušiach', 'Lakte vystreté', 'Pokojná výdrž aspoň 15 sekúnd'], dist: '2–3 m od teba', checks: ['Línia tela', 'Otvorené ramená', 'Vystreté lakte', 'Stabilita'], acc: 'stojku', type: 'hold', group: 'h', target: 'handstand', holdJoint: 'body_line', maxSeconds: 60, hint: 'Zboku, vo výške bokov',
    keys: ['stojk','handstand'], name: 'Stojka', en: 'Handstand hold',
    camera: 'Presne zboku, kamera vo výške bokov, 2–3 m. V zábere ruky na zemi aj špičky nôh hore. Stačí aj stojka pri stene.',
  },
  {
    id: 'l-sit', top: ['Nohy aspoň vodorovne so zemou', 'Kolená a špičky vystreté', 'Ramená stlačené dolu, lakte vystreté', 'Pokojná výdrž aspoň 10 sekúnd'], dist: '2 m od teba', checks: ['Uhol v bokoch', 'Vystreté kolená', 'Stlačené ramená', 'Stabilita'], type: 'hold', group: 'h', target: 'lsit', holdJoint: 'hip', maxSeconds: 60, hint: 'Zboku, vo výške bokov',
    keys: ['l-sit','l sit','lsit','sed v uhle'], name: 'L-sit', en: 'L-sit hold',
    camera: 'Presne zboku, kamera vo výške bokov, 2 m. V zábere ruky, boky aj špičky nôh.',
  },
  {
    id: 'front-lever', top: ['Telo v rovine od ramien po chodidlá (podľa variantu)', 'Ruky vystreté', 'Boky v rovine s telom, neklesajú', 'Pokojná výdrž aspoň 3 sekundy'], dist: '2–3 m od hrazdy', checks: ['Línia tela', 'Vystreté ruky', 'Boky v rovine', 'Stabilita'], type: 'hold', group: 'h', target: 'lever', holdJoint: 'body_line', maxSeconds: 60, hint: 'Zboku, vo výške hrazdy',
    keys: ['front lever','frontlever','front-lever','predný vis','predny vis'], name: 'Front lever', en: 'Front lever hold (tuck, advanced tuck, straddle or full)',
    camera: 'Presne zboku, kamera vo výške hrazdy alebo trochu nižšie, 2–3 m. V zábere hrazda aj celé telo.',
  },
  {
    id: 'back-lever', top: ['Telo v rovine od ramien po chodidlá (podľa variantu)', 'Ruky vystreté', 'Boky v rovine s telom, neprehýbaš sa', 'Pokojná výdrž aspoň 3 sekundy'], dist: '2–3 m od hrazdy', checks: ['Línia tela', 'Vystreté ruky', 'Boky v rovine', 'Stabilita'], type: 'hold', group: 'h', target: 'lever', holdJoint: 'body_line', maxSeconds: 60, hint: 'Zboku, vo výške hrazdy',
    keys: ['back lever','backlever','back-lever','zadný vis','zadny vis'], name: 'Back lever', en: 'Back lever hold (tuck, straddle or full)',
    camera: 'Presne zboku, kamera vo výške hrazdy alebo trochu nižšie, 2–3 m. V zábere hrazda aj celé telo.',
  },
  {
    id: 'planche', top: ['Telo v rovine (podľa variantu)', 'Ramená predklonené pred dlaňami', 'Lakte vystreté', 'Pokojná výdrž aspoň 3 sekundy'], dist: '2 m od teba', checks: ['Línia tela', 'Predklon ramien', 'Vystreté lakte', 'Stabilita'], type: 'hold', group: 'h', target: 'planche', holdJoint: 'body_line', maxSeconds: 60, hint: 'Zboku, kamera nízko',
    keys: ['planche','planš','plansa'], name: 'Planche', en: 'Planche hold (tuck, straddle or full)',
    camera: 'Presne zboku, kamera nízko (vo výške rúk), 2 m. V zábere ruky na zemi aj celé telo.',
  },
];

// skupiny v zozname cvikov
export const GROUPS = [{ id: 'k', name: 'Kalistenika' }, { id: 'c', name: 'S činkou' }, { id: 'h', name: 'Výdrže' }];

// automatické rozpoznanie zvládne aj výdrže (statické cviky), preto dlhšie nahrávanie
export const AUTO = { id: 'auto', name: 'Rozpoznať automaticky', signal: null, maxSeconds: 60,
  hint: 'Najlepšie zboku', dist: '2–3 m od teba', checks: ['Rozpoznanie cviku', 'Rozsah pohybu', 'Línia tela', 'Tempo', 'Výdrž'],
  camera: 'Najčastejšie funguje najlepšie pohľad zboku. Kamera vo výške bokov, 2–3 m, celé telo v zábere, stabilne (statív alebo opretý mobil).' };

export const isHold = (e) => !!e && e.type === 'hold';
export const maxSecondsFor = (e) => (e && e.maxSeconds) || 30;

export function findExercise(id) {
  return EXERCISES.find(e => e.id === id) || (id === 'auto' ? AUTO : null);
}

// ---------- Súboj 1 na 1: čo a ako merať ----------
// Disciplíny z appky; vlastný cvik („vlastny“ = opakovania, „vlastny-s“ = sekundy výdrže) sa meria podľa názvu,
// ktorý napísal vyzývateľ. Známe slová určia, čo sa počíta (uhol kĺbu alebo výška tela), inak appka cvik rozpozná sama.
// Signály: elbow / knee / hip = uhol kĺbu; shH / hipH / wrH = výška ramien / bokov / zápästí (100 = dĺžka trupu).
export const DUEL_EX = { zhyby: 'pritah-hrazda', kliky: 'klik', drepy: 'drep', plank: 'plank' };
const bezDiakritiky = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// opakovania: kľúčové slová (bez diakritiky, vyhráva najdlhšia zhoda) → signál, poloha tela, najmenší rozsah, začiatok série;
// base = obrázok a návod na natočenie zo zoznamu cvikov
const DUEL_REPS = [
  { keys: ['klik', 'push up', 'push-up', 'pushup'], signal: 'elbow', posture: null, minAmp: 30, start: 'top', base: 'klik', kind: 'push' },
  { keys: ['pike'], signal: 'elbow', posture: null, minAmp: 30, start: 'top', kind: 'push' },
  // v stojke (hlavou dole) kamera uhol lakťa často nezachytí → výška ramien
  { keys: ['kliky v stojke', 'klik v stojke', 'kliky do stojky', 'hspu', 'handstand push'], signal: 'shH', posture: null, minAmp: 20, start: 'top' },
  { keys: ['zhyb', 'shyb', 'pritah', 'pull up', 'pull-up', 'pullup', 'chin up', 'chin-up', 'chinup', 'ring row', 'tah k pasu'], signal: 'elbow', posture: 'P', minAmp: 40, start: 'top', base: 'pritah-hrazda', kind: 'pull' },
  { keys: ['austral', 'inverted', 'veslovan', 'trx pritah'], signal: 'elbow', posture: null, minAmp: 30, start: 'top', kind: 'pull' },
  { keys: ['dip', 'bradl', 'tricepsov', 'triceps'], signal: 'elbow', posture: null, minAmp: 30, start: 'top', kind: 'push' },
  { keys: ['pritahy piat', 'piat', 'leg curl', 'zakopavan'], signal: 'knee', posture: null, minAmp: 30, start: 'top' },
  // TRX triceps: predlaktia za hlavou kamera „trasie“ → telo sa nakláňa dopredu a späť, výška ramien
  { keys: ['trx triceps', 'trx tricep'], signal: 'shH', posture: null, minAmp: 20, start: 'top' },
  { keys: ['bicep', 'curl'], signal: 'elbow', posture: null, minAmp: 40, start: 'top' },
  // muscle-up: lakte sa ohnú dvakrát za opakovanie (príťah aj spúšťanie) → výška ramien
  { keys: ['muscle', 'muscel', 'masl'], signal: 'shH', posture: null, minAmp: 50, start: 'bottom' },
  { keys: ['drep', 'squat', 'pistol', 'skok', 'jump', 'pritahom kolien'], signal: 'knee', posture: 'V', minAmp: 35, start: 'top', base: 'drep' },
  { keys: ['vypad', 'lunge', 'bulharsk', 'split', 'vykrok'], signal: 'knee', posture: 'V', minAmp: 30, start: 'top', base: 'vypad' },
  // spredu sa uhol kolena pri bočnom výpade skoro nemení → výška bokov
  { keys: ['bocne vypady', 'bocny vypad', 'bocnych vypad', 'kozack', 'cossack', 'lateral', 'side lunge', 'vo vypade'], signal: 'hipH', posture: 'V', minAmp: 25, start: 'top' },
  { keys: ['vystup', 'step up', 'step-up', 'stepup'], signal: 'knee', posture: 'V', minAmp: 30, start: 'top' },
  { keys: ['mostik', 'bridge', 'panv', 'zdvih bokov', 'zdvihanie bokov', 'hip raise'], signal: 'hip', posture: null, minAmp: 20, start: 'bottom', base: 'most' },
  { keys: ['hip thrust', 'hip-thrust', 'hipthrust'], signal: 'hip', posture: null, minAmp: 25, start: 'bottom', base: 'hip-thrust' },
  { keys: ['sklapovac', 'sklopovac', 'skladack', 'brusak', 'brusn', 'sed-lah', 'sed lah', 'sedlah', 'sit up', 'sit-up', 'situp', 'crunch', 'v-up', 'v up', 'vup'], signal: 'hip', posture: null, minAmp: 30, start: 'top' },
  { keys: ['zdvih', 'dvihanie', 'leg raise', 'toes to bar', 'k hrazde', 'kolena k', 'nohy k', 'pritahovanie kolien', 'pritah kolien', 'skrcenie', 'zdvihy noh'], signal: 'hip', posture: null, minAmp: 30, start: 'top' },
  { keys: ['mrtvy tah', 'deadlift', 'swing', 'kettlebell'], signal: 'hip', posture: 'V', minAmp: 30, start: 'top' },
  // celé telo hore-dole: angličák (burpee), up-down, sprawl
  { keys: ['burpee', 'burpe', 'anglicak', 'up down', 'up-down', 'updown', 'sprawl'], signal: 'hipH', posture: null, minAmp: 60, start: 'top' },
  // dragon flag: telo sa spúšťa a dvíha ako celok → výška bokov
  { keys: ['dragon', 'drak'], signal: 'hipH', posture: null, minAmp: 30, start: 'top' },
  // panák: ruky hore-dole
  { keys: ['panak', 'jumping jack', 'jacks'], signal: 'wrH', posture: null, minAmp: 80, start: null },
  { keys: ['tlak nad hlavu', 'overhead', 'military'], base: 'tlak-nad-hlavu' },
  { keys: ['bench', 'tlak na lavicke'], base: 'bench' },
];
// opakovania, ktoré kamera spoľahlivo nespočíta (striedanie strán, rotácie, malý pohyb) – zapíšu sa ručne
const DUEL_NO = ['twist', 'rusky', 'noznic', 'flutter', 'horolez', 'climber', 'chrobak', 'bird dog', 'birddog', 'vypon', 'calf', 'stierac',
  'dotykom ramien', 'shoulder tap', 'husenic', 'inchworm', 'superman', 'rotaci', 'skin the cat', 'prevlek', 'head banger', 'rozpazen',
  'striedave', 'presun zo vzporu', 'kobry', 'ruckovan', 'svih', 'boxovan', 'presmyk', 'korculiar'];
// výdrže: kľúčové slová → poloha tela, ktorú hľadáme (bez zhody: najdlhší pokoj v polohe cviku)
const DUEL_HOLDS = [
  { keys: ['plank', 'planka', 'doska', 'vydrz v kliku', 'vzpor v kliku'], target: 'plank', base: 'plank' },
  { keys: ['stojk', 'handstand', 'headstand'], target: 'handstand', base: 'stojka' },
  { keys: ['l-sit', 'l sit', 'lsit', 'v 90'], target: 'lsit', holdJoint: 'hip', base: 'l-sit' },
  { keys: ['lever', 'predny vis', 'zadny vis'], target: 'lever', base: 'front-lever' },
  { keys: ['planche', 'plans'], target: 'planche', base: 'planche' },
  { keys: ['vis', 'hang', 'visenie', 'vydrz v zhybe'], target: 'hang' },
  { keys: ['stolick', 'sed pri stene', 'wall sit', 'podrep', 'drep'], target: 'squat', holdJoint: 'knee' },
];
// na čas, ale nie výdrž (beh, švihadlo, strečing…) – kamera nezmeria, zapíše sa ručne
const DUEL_NO_S = ['beh', 'sprint', 'svihadl', 'poskok', 'skakan', 'kolena', 'boxovan', 'presmyk', 'chodz', 'rotaci', 'natahovan', 'strecing',
  'poloha dietata', 'korculiar', 'jumping', 'panak'];
const bestKey = (list, n) => {
  let best = null, len = 0;
  for (const e of list) for (const k of e.keys) if (n.includes(k) && k.length > len) { best = e; len = k.length; }
  return best;
};
const has = (list, n) => list.some(k => n.includes(k));
export function duelMeasure(dx, name = '') {
  if (DUEL_EX[dx]) {
    const e = findExercise(DUEL_EX[dx]);
    // plank v súboji: len s vystretými nohami (na kolenách sa neráta)
    return { ...e, base: e.id, cam: true, ...(dx === 'plank' ? { target: 'plank-rovne' } : { type: 'reps' }) };
  }
  const n = bezDiakritiky(name);
  const nm = String(name || '').trim() || 'Vlastný cvik';
  if (dx === 'vlastny-s') {
    const h = bestKey(DUEL_HOLDS, n), b = h && h.base ? findExercise(h.base) : null;
    return { ...AUTO, ...(b ? { hint: b.hint, dist: b.dist, camera: b.camera } : {}), id: 'vlastny-s', name: nm, base: b ? b.id : null,
      type: 'hold', target: h ? h.target : null, holdJoint: h ? h.holdJoint || 'body_line' : null, maxSeconds: 300, cam: !!h || !has(DUEL_NO_S, n) };
  }
  const r = bestKey(DUEL_REPS, n), b = r && r.base ? findExercise(r.base) : null;
  let m = r && r.signal ? r : b || {};
  // s tlesknutím, výbušné, lukostrelecké, jednou rukou: ruky sa pustia alebo pracuje raz jedna, raz druhá ruka –
  // uhol lakťa na viditeľnej strane klame → počíta sa podľa výšky ramien
  if (r && (r.kind === 'push' || r.kind === 'pull') && /tlies|tlesk|clap|lukostrel|archer|jednoruc|jednou ruk|one arm|pisaci|typewriter|exploziv|vybusn|dynamick/.test(n))
    m = r.kind === 'pull' ? { signal: 'shH', posture: null, minAmp: 30, start: 'bottom' } : { signal: 'shH', posture: null, minAmp: 20, start: 'top' };
  return { ...AUTO, ...(b ? { hint: b.hint, dist: b.dist, camera: b.camera } : {}), id: 'vlastny', name: nm, base: b ? b.id : null,
    type: 'reps', signal: m.signal || null, posture: m.posture ?? null, minAmp: m.minAmp || 30, start: m.start ?? null, maxSeconds: 180, cam: !!r || !has(DUEL_NO, n) };
}

// Pokúsi sa namapovať názov cviku od AI na položku zo zoznamu (pre predvyplnenie výberu).
// Vyhráva najdlhšia zhoda, aby napr. „výdrž v kliku“ našla plank a nie klik.
export function matchExercise(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  let best = null, len = 0;
  for (const e of EXERCISES) for (const k of e.keys) if (n.includes(k) && k.length > len) { best = e; len = k.length; }
  return best;
}
