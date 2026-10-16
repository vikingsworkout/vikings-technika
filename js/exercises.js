// Zoznam cvikov pre v1. Technika sa dohľadáva živo na webe, tento zoznam slúži na
// výber/potvrdenie cviku, návod na natočenie a výber hlavného uhla na počítanie opakovaní.
// signal = ktorý uhol kĺbu sa pri cviku najviac mení (opakovanie = jeho minimum).

export const EXERCISES = [
  {
    id: 'drep', keys: ['drep','squat'], name: 'Drep', en: 'Barbell / bodyweight squat', signal: 'knee',
    camera: 'Zboku, mierne spredu (asi 45°). Kamera vo výške bokov, 2–3 m od teba. V zábere celé telo od chodidiel po hlavu.',
  },
  {
    id: 'mrtvy-tah', keys: ['mŕtv','mrtv','deadlift'], name: 'Mŕtvy ťah', en: 'Deadlift', signal: 'hip',
    camera: 'Presne zboku. Kamera vo výške bokov, 2–3 m. V zábere celé telo aj činka.',
  },
  {
    id: 'bench', keys: ['bench','tlak na lavičke'], name: 'Bench press', en: 'Bench press', signal: 'elbow',
    camera: 'Zboku, kamera vo výške lavičky, mierne smerom k hlave. V zábere ruky, ramená aj činka.',
  },
  {
    id: 'klik', keys: ['klik','push-up','pushup'], name: 'Klik', en: 'Push-up', signal: 'elbow',
    camera: 'Presne zboku, kamera nízko pri zemi (výška 20–40 cm), 2 m. V zábere celé telo od hlavy po päty.',
  },
  {
    id: 'vypad', keys: ['výpad','vypad','lunge'], name: 'Výpad', en: 'Lunge', signal: 'knee',
    camera: 'Zboku, kamera vo výške bokov, 2–3 m. V zábere obe nohy celé počas celého pohybu.',
  },
  {
    id: 'tlak-nad-hlavu', keys: ['nad hlavu','overhead','military'], name: 'Tlak nad hlavu', en: 'Overhead press', signal: 'elbow',
    camera: 'Zboku, kamera vo výške hrudníka, 2–3 m. V zábere celé telo aj vystreté ruky nad hlavou.',
  },
  {
    id: 'pritah-hrazda', keys: ['príťah','pritah','pull-up','pullup','chin-up','zhyb'], name: 'Príťah na hrazde', en: 'Pull-up', signal: 'elbow',
    camera: 'Zboku alebo zozadu, kamera vo výške hrazdy alebo trochu nižšie, 2–3 m. V zábere hrazda aj celé telo.',
  },
  {
    id: 'hip-thrust', keys: ['hip thrust','glute bridge','hip-thrust'], name: 'Hip thrust', en: 'Hip thrust', signal: 'hip',
    camera: 'Presne zboku, kamera nízko (výška lavičky), 2 m. V zábere hlava, boky aj chodidlá.',
  },
];

export const AUTO = { id: 'auto', name: 'Rozpoznať automaticky', signal: null,
  camera: 'Najčastejšie funguje najlepšie pohľad zboku. Kamera vo výške bokov, 2–3 m, celé telo v zábere, stabilne (statív alebo opretý mobil).' };

export function findExercise(id) {
  return EXERCISES.find(e => e.id === id) || (id === 'auto' ? AUTO : null);
}

// Pokúsi sa namapovať názov cviku od AI na položku zo zoznamu (pre predvyplnenie výberu).
export function matchExercise(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  return EXERCISES.find(e => e.keys.some(k => n.includes(k))) || null;
}
