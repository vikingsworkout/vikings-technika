// Zoznam cvikov. Technika sa dohľadáva živo na webe, tento zoznam slúži na výber/potvrdenie cviku,
// návod na natočenie a nastavenie merania.
//
// Cviky s opakovaniami:
//   signal  = ktorý uhol kĺbu sa pri cviku najviac mení (opakovanie = jeho minimum)
//   posture = očakávaná poloha tela počas série (V stoj, H vodorovne, P visenie, null = hocijaká)
//   minAmp  = minimálny rozsah hlavného uhla v stupňoch, aby sa pohyb rátal ako opakovanie
//   start   = kde séria začína: 'top' (hore, napr. kliky) alebo 'bottom' (dole, napr. mŕtvy ťah)
// Výdrže (type: 'hold'):
//   target    = poloha, ktorú appka hľadá (plank, handstand, lsit, lever, planche)
//   holdJoint = hlavný sledovaný uhol (body_line = rameno–bok–členok, hip = rameno–bok–koleno)
//   maxSeconds = najdlhšie nahrávanie
// acc = tvar názvu v 4. páde, ak sa líši (Nahrávať stojku)
// dist = vzdialenosť kamery (obrazovka Natoč), checks = čo appka pri cviku kontroluje

export const EXERCISES = [
  {
    id: 'klik', dist: '2 m od teba', checks: ['Rozsah pohybu', 'Línia tela', 'Lakte', 'Hlava v predĺžení', 'Tempo'], start: 'top', group: 'k', hint: 'Zboku, kamera nízko pri zemi', keys: ['klik','push-up','pushup'], name: 'Klik', en: 'Push-up', signal: 'elbow', posture: 'H', minAmp: 30,
    camera: 'Presne zboku, kamera nízko pri zemi (výška 20–40 cm), 2 m. V zábere celé telo od hlavy po päty.',
  },
  {
    id: 'pritah-hrazda', dist: '2–3 m od hrazdy', checks: ['Rozsah pohybu', 'Lakte a lopatky', 'Línia tela', 'Tempo', 'Bez švihu'], start: 'top', group: 'k', hint: 'Zboku alebo zozadu', keys: ['príťah','pritah','pull-up','pullup','chin-up','zhyb'], name: 'Príťah na hrazde', en: 'Pull-up', signal: 'elbow', posture: 'P', minAmp: 40,
    camera: 'Zboku alebo zozadu, kamera vo výške hrazdy alebo trochu nižšie, 2–3 m. V zábere hrazda aj celé telo.',
  },
  {
    id: 'drep', dist: '2–3 m od teba', checks: ['Hĺbka drepu', 'Kolená', 'Rovný chrbát', 'Päty na zemi', 'Tempo'], start: 'top', group: 'k', hint: 'Zboku, mierne spredu', keys: ['drep','squat'], name: 'Drep', en: 'Barbell / bodyweight squat', signal: 'knee', posture: 'V', minAmp: 35,
    camera: 'Zboku, mierne spredu (asi 45°). Kamera vo výške bokov, 2–3 m od teba. V zábere celé telo od chodidiel po hlavu.',
  },
  {
    id: 'vypad', dist: '2–3 m od teba', checks: ['Hĺbka', 'Predné koleno', 'Vzpriamený trup', 'Rovnováha', 'Tempo'], start: 'top', group: 'k', hint: 'Zboku, vo výške bokov', keys: ['výpad','vypad','lunge'], name: 'Výpad', en: 'Lunge', signal: 'knee', posture: 'V', minAmp: 30,
    camera: 'Zboku, kamera vo výške bokov, 2–3 m. V zábere obe nohy celé počas celého pohybu.',
  },
  {
    id: 'mrtvy-tah', dist: '2–3 m od teba', checks: ['Rovný chrbát', 'Pohyb z bokov', 'Dráha činky', 'Kolená', 'Tempo'], start: 'bottom', group: 'c', hint: 'Presne zboku, vo výške bokov', keys: ['mŕtv','mrtv','deadlift'], name: 'Mŕtvy ťah', en: 'Deadlift', signal: 'hip', posture: 'V', minAmp: 35,
    camera: 'Presne zboku. Kamera vo výške bokov, 2–3 m. V zábere celé telo aj činka.',
  },
  {
    id: 'bench', dist: '1,5–2 m od lavičky', checks: ['Rozsah pohybu', 'Lakte', 'Dráha činky', 'Tempo'], start: 'top', group: 'c', hint: 'Zboku, vo výške lavičky', keys: ['bench','tlak na lavičke'], name: 'Bench press', en: 'Bench press', signal: 'elbow', posture: null, minAmp: 30,
    camera: 'Zboku, kamera vo výške lavičky, mierne smerom k hlave. V zábere ruky, ramená aj činka.',
  },
  {
    id: 'tlak-nad-hlavu', dist: '2–3 m od teba', checks: ['Vystretie nad hlavou', 'Stabilný trup', 'Dráha činky', 'Tempo'], start: 'bottom', group: 'c', hint: 'Zboku, vo výške hrudníka', keys: ['nad hlavu','overhead','military'], name: 'Tlak nad hlavu', en: 'Overhead press', signal: 'elbow', posture: 'V', minAmp: 40,
    camera: 'Zboku, kamera vo výške hrudníka, 2–3 m. V zábere celé telo aj vystreté ruky nad hlavou.',
  },
  {
    id: 'hip-thrust', dist: '2 m od lavičky', checks: ['Vystretie bokov', 'Kolená', 'Chrbát a hlava', 'Tempo'], start: 'bottom', group: 'c', hint: 'Zboku, kamera nízko', keys: ['hip thrust','glute bridge','hip-thrust'], name: 'Hip thrust', en: 'Hip thrust', signal: 'hip', posture: null, minAmp: 25,
    camera: 'Presne zboku, kamera nízko (výška lavičky), 2 m. V zábere hlava, boky aj chodidlá.',
  },

  // ---------- výdrže (statické cviky) ----------
  // Vo výbere nie sú – rozpozná ich automatický režim. Slúžia na spárovanie názvu od AI a na „Iný cvik?“ vo výsledku.
  {
    id: 'plank', dist: '2 m od teba', checks: ['Línia tela', 'Boky', 'Hlava v predĺžení', 'Stabilita'], type: 'hold', group: 'h', target: 'plank', holdJoint: 'body_line', maxSeconds: 60, hint: 'Zboku, kamera nízko pri zemi',
    keys: ['plank','planka','doska','výdrž v kliku','vydrz v kliku'], name: 'Plank', en: 'Plank hold (forearm or high plank)',
    camera: 'Presne zboku, kamera nízko pri zemi (výška 20–40 cm), 2 m. V zábere celé telo od hlavy po päty.',
  },
  {
    id: 'stojka', dist: '2–3 m od teba', checks: ['Línia tela', 'Otvorené ramená', 'Vystreté lakte', 'Stabilita'], acc: 'stojku', type: 'hold', group: 'h', target: 'handstand', holdJoint: 'body_line', maxSeconds: 60, hint: 'Zboku, vo výške bokov',
    keys: ['stojk','handstand'], name: 'Stojka', en: 'Handstand hold',
    camera: 'Presne zboku, kamera vo výške bokov, 2–3 m. V zábere ruky na zemi aj špičky nôh hore. Stačí aj stojka pri stene.',
  },
  {
    id: 'l-sit', dist: '2 m od teba', checks: ['Uhol v bokoch', 'Vystreté kolená', 'Stlačené ramená', 'Stabilita'], type: 'hold', group: 'h', target: 'lsit', holdJoint: 'hip', maxSeconds: 60, hint: 'Zboku, vo výške bokov',
    keys: ['l-sit','l sit','lsit','sed v uhle'], name: 'L-sit', en: 'L-sit hold',
    camera: 'Presne zboku, kamera vo výške bokov, 2 m. V zábere ruky, boky aj špičky nôh.',
  },
  {
    id: 'front-lever', dist: '2–3 m od hrazdy', checks: ['Línia tela', 'Vystreté ruky', 'Boky v rovine', 'Stabilita'], type: 'hold', group: 'h', target: 'lever', holdJoint: 'body_line', maxSeconds: 60, hint: 'Zboku, vo výške hrazdy',
    keys: ['front lever','frontlever','front-lever','predný vis','predny vis'], name: 'Front lever', en: 'Front lever hold (tuck, advanced tuck, straddle or full)',
    camera: 'Presne zboku, kamera vo výške hrazdy alebo trochu nižšie, 2–3 m. V zábere hrazda aj celé telo.',
  },
  {
    id: 'back-lever', dist: '2–3 m od hrazdy', checks: ['Línia tela', 'Vystreté ruky', 'Boky v rovine', 'Stabilita'], type: 'hold', group: 'h', target: 'lever', holdJoint: 'body_line', maxSeconds: 60, hint: 'Zboku, vo výške hrazdy',
    keys: ['back lever','backlever','back-lever','zadný vis','zadny vis'], name: 'Back lever', en: 'Back lever hold (tuck, straddle or full)',
    camera: 'Presne zboku, kamera vo výške hrazdy alebo trochu nižšie, 2–3 m. V zábere hrazda aj celé telo.',
  },
  {
    id: 'planche', dist: '2 m od teba', checks: ['Línia tela', 'Predklon ramien', 'Vystreté lakte', 'Stabilita'], type: 'hold', group: 'h', target: 'planche', holdJoint: 'body_line', maxSeconds: 60, hint: 'Zboku, kamera nízko',
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

// Pokúsi sa namapovať názov cviku od AI na položku zo zoznamu (pre predvyplnenie výberu).
// Vyhráva najdlhšia zhoda, aby napr. „výdrž v kliku“ našla plank a nie klik.
export function matchExercise(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  let best = null, len = 0;
  for (const e of EXERCISES) for (const k of e.keys) if (n.includes(k) && k.length > len) { best = e; len = k.length; }
  return best;
}
