# Vikings Technika

Webová appka (PWA): natočíš alebo nahráš video cviku a dostaneš rozbor techniky. Rozbor obsahuje skóre, čo robíš dobre, čo zlepšiť, na čo si dávať pozor a aké svaly sa zapájajú.

## Ako to funguje

1. **V prehliadači** (`public/js/pose.js`): MediaPipe Pose Landmarker nájde body tela na snímkach videa a vypočíta uhly kĺbov. Potom spočíta opakovania a vyberie kľúčové snímky s kostrou. Video sa nikam neposiela.
2. **Na serveri** (`src/analyze.js`, Cloudflare Worker `src/worker.js`): zavolá Claude API s nameranými dátami a snímkami. Pomocou web search dohľadá správnu techniku a vráti rozbor v slovenčine.
3. **História** (`public/js/db.js`): ukladá sa v prehliadači (IndexedDB), bez účtu.

## Nasadenie (Cloudflare Workers)

- Projekt je Cloudflare Worker so statickými súbormi (`wrangler.jsonc`, súbory appky v `public/`). Workers Builds ho po pushi na GitHub nasadí sám.
- Premenné (Settings → Variables and Secrets):
  - `ANTHROPIC_API_KEY`: Secret, povinné
  - `ACCESS_CODE`: Secret, voliteľné. Kód pre rozbor mimo appky (appka si ho vypýta pri prvej analýze). Bez neho funguje len prihlásenie z appky.
  - `CLAUDE_MODEL`: voliteľné, predvolene `claude-sonnet-5-5`
- V Claude Console musí byť povolený web search.

## Integrácia do hlavnej appky neskôr

- `public/js/pose.js`: `analyzeVideo(file, { signal, onProgress })` vráti `{ summary, keyframes, thumb }`. Je nezávislý od UI.
- `src/analyze.js`: funkcia `onRequestPost`, dá sa použiť v Workeri aj ako Pages Function (`functions/api/analyze.js`) hlavného webu.
- `public/js/exercises.js`: zoznam cvikov a návody na natočenie.
