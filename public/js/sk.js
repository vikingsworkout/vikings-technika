// Slovenčina v rozbore: AI občas použije české slovo alebo český tvar (napr. „ujíždějí“, „kyčle“, „záda“).
// Tu ich opravíme na bežné slovenské slová a zistíme, či v texte ešte niečo české ostalo
// (písmená ě, ř, ů v slovenčine nie sú). Používa to server (nové rozbory) aj appka (staršie uložené rozbory).

// české písmená, časté české slová a české koncovky slovies (-ání, -ují), ktoré v slovenčine nie sú
const CZ = /[ěřůĚŘŮ]/;
const CZ_WORDS = /(?<!\p{L})(?:se|jsou|jsi|jste|jsem|není|když|protože|který|která|které|kterou|kteří|nebo|jako|pouze|velmi|také se)(?!\p{L})/iu;
const CZ_END = /\p{L}{2,}(?:ání|ují|ají)(?!\p{L})/iu;
export const hasCzech = (s) => { const t = String(s ?? ''); return CZ.test(t) || CZ_WORDS.test(t) || CZ_END.test(t); };

// [české slovo alebo tvar (regex bez hraníc slova), slovenská náhrada] – len slová, ktoré v slovenčine nie sú
const WORDS = [
  ['uj[íi]ž[dď](?:ěj[íú]|ej[íú]|aj[úu]|aj[íi])', 'uhýbajú'],
  ['uj[íi]ž[dď](?:[íi]|a)', 'uhýba'],
  ['uj[íi]ž[dď](?:ět|et|ať)', 'uhýbať'],
  ['uj[íi]ž[dď](?:ění|enie)', 'uhýbanie'],
  ['uhýbají', 'uhýbajú'], ['uhýbá', 'uhýba'],
  ['prohýbáš', 'prehýbaš'], ['prohýbá', 'prehýba'], ['prohýbají', 'prehýbajú'],
  ['prohnut(ý|á|é|ou|ých)', 'prehnut$1'], ['prohnutí', 'prehnutie'],
  ['propni', 'vystri'], ['propnout', 'vystrieť'], ['propnut(é|á|ý|ých|ou)', 'vystret$1'],
  ['zpomal', 'spomaľ'], ['zpomalit', 'spomaliť'], ['zpomaleně', 'pomalšie'],
  ['zvedni', 'zdvihni'], ['zvedáš', 'zdvíhaš'], ['zvedá', 'zdvíha'], ['zvedají', 'zdvíhajú'],
  ['spouštíš', 'spúšťaš'], ['spouští', 'spúšťa'], ['spouštění', 'spúšťanie'],
  ['zpevni', 'spevni'], ['zpevněn(ý|á|é)', 'spevnen$1'],
  ['dřep', 'drep'], ['dřepu', 'drepu'], ['dřepy', 'drepy'], ['dřepech', 'drepoch'], ['dřepů', 'drepov'],
  ['záda', 'chrbát'], ['zádech', 'chrbte'], ['zády', 'chrbtom'],
  ['kyčle', 'boky'], ['kyčel', 'bok'], ['kyčlí', 'bokov'], ['kyčlích', 'bokoch'], ['kyčlemi', 'bokmi'],
  ['břicho', 'brucho'], ['břicha', 'brucha'], ['břiše', 'bruchu'], ['břišní', 'brušné'], ['břišáky', 'brušáky'],
  ['hýždě', 'zadok'], ['hýžďové', 'sedacie'], ['hýžďových', 'sedacích'],
  ['lokty', 'lakte'], ['loket', 'lakeť'], ['loktů', 'lakťov'], ['loktech', 'laktoch'],
  ['pánev', 'panva'], ['pánve', 'panvy'],
  ['ruce', 'ruky'], ['rukama', 'rukami'], ['nohama', 'nohami'],
  ['tělo', 'telo'], ['těla', 'tela'], ['tělem', 'telom'], ['těle', 'tele'],
  ['dolů', 'dole'], ['nahoru', 'hore'], ['dopředu', 'dopredu'], ['rovně', 'rovno'],
  ['pořád', 'stále'], ['hodně', 'veľa'], ['příliš', 'príliš'], ['při', 'pri'], ['před', 'pred'], ['přes', 'cez'],
  ['ještě', 'ešte'], ['jako', 'ako'], ['když', 'keď'], ['protože', 'pretože'], ['nebo', 'alebo'],
  ['víc', 'viac'], ['více', 'viac'], ['méně', 'menej'], ['teď', 'teraz'], ['hned', 'hneď'],
  ['špatně', 'zle'], ['dobře', 'dobre'], ['správně', 'správne'], ['úplně', 'úplne'], ['pomalu', 'pomaly'],
  ['opakování', 'opakovaní'], ['zůstávají', 'zostávajú'], ['zůstává', 'zostáva'], ['zůstaň', 'zostaň'],
  ['přitáhni', 'pritiahni'], ['přitahuješ', 'priťahuješ'], ['kontrolovaně', 'kontrolovane'],
  ['se', 'sa'], ['jsou', 'sú'], ['není', 'nie je'], ['velmi', 'veľmi'], ['pouze', 'iba'],
  ['který', 'ktorý'], ['která', 'ktorá'], ['které', 'ktoré'], ['kterou', 'ktorú'], ['kteří', 'ktorí'],
  ['naklání', 'nakláňa'], ['zaklání', 'zakláňa'], ['předklání', 'predkláňa'], ['posouvá', 'posúva'], ['posouvají', 'posúvajú'],
  ['(\\p{L}{2,})ají', '$1ajú'], ['(\\p{L}{2,})ují', '$1ujú'], // české koncovky 3. osoby (klesají → klesajú)
].map(([cz, sk]) => [new RegExp('(?<!\\p{L})' + cz + '(?!\\p{L})', 'giu'), sk]);

const isUp = (s) => s[0] !== s[0].toLowerCase();
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// opraví známe české slová v jednom texte (veľké začiatočné písmeno sa zachová)
export function skFix(s) {
  if (typeof s !== 'string' || !s) return s;
  let out = s;
  for (const [re, sk] of WORDS) {
    out = out.replace(re, (m, ...g) => {
      const t = sk.replace(/\$(\d)/g, (_, i) => (typeof g[i - 1] === 'string' ? g[i - 1] : ''));
      return isUp(m) ? cap(t) : t;
    });
  }
  return out;
}

// texty rozboru, ktoré vidí používateľ: cesta → text (napr. „issues.0.title“). `only` vyberie, ktoré vrátiť.
export function collectTexts(r, only = () => true) {
  const out = {};
  if (!r || typeof r !== 'object') return out;
  const put = (p, v) => { if (typeof v === 'string' && v && only(v)) out[p] = v; };
  for (const k of ['verdict', 'summary', 'description', 'camera_limits']) put(k, r[k]);
  put('exercise.name', r.exercise?.name);
  put('today.title', r.today?.title); put('today.detail', r.today?.detail);
  for (const k of ['good', 'watch_out', 'cues']) if (Array.isArray(r[k])) r[k].forEach((v, i) => put(`${k}.${i}`, v));
  if (r.muscles && typeof r.muscles === 'object') {
    for (const k of ['primary', 'secondary']) if (Array.isArray(r.muscles[k])) r.muscles[k].forEach((v, i) => put(`muscles.${k}.${i}`, v));
  }
  const each = (arr, key, field) => { if (Array.isArray(arr)) arr.forEach((x, i) => put(`${key}.${i}.${field}`, x?.[field])); };
  each(r.to_100, 'to_100', 'step');
  each(r.criteria_100, 'criteria_100', 'text');
  each(r.score_breakdown, 'score_breakdown', 'note');
  each(r.issues, 'issues', 'title'); each(r.issues, 'issues', 'detail'); each(r.issues, 'issues', 'fix');
  return out;
}

// vráti opravené texty na ich miesto v rozbore (len tam, kde bol text)
export function applyTexts(r, map) {
  if (!r || typeof r !== 'object' || !map || typeof map !== 'object') return r;
  for (const [p, v] of Object.entries(map)) {
    if (typeof v !== 'string' || !v.trim() || v.length > 600) continue;
    const ks = p.split('.');
    let o = r;
    for (let i = 0; i < ks.length - 1 && o && typeof o === 'object'; i++) o = o[ks[i]];
    const last = ks[ks.length - 1];
    if (o && typeof o === 'object' && typeof o[last] === 'string') o[last] = v.trim();
  }
  return r;
}

// opraví české slová vo všetkých textoch rozboru (na mieste)
export function fixResultSk(r) {
  const t = collectTexts(r);
  const fixed = {};
  for (const [p, v] of Object.entries(t)) { const f = skFix(v); if (f !== v) fixed[p] = f; }
  return applyTexts(r, fixed);
}
