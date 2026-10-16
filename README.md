# Vikings Technika

Webová appka (PWA): natočíš alebo nahráš video cviku a dostaneš rozbor techniky. Rozbor obsahuje skóre, čo robíš dobre, čo zlepšiť, na čo si dávať pozor a aké svaly sa zapájajú.

## Ako to funguje

1. **V prehliadači** (`js/pose.js`): MediaPipe Pose Landmarker nájde body tela na snímkach videa a vypočíta uhly kĺbov. Potom spočíta opakovania a vyberie kľúčové snímky s kostrou. Video sa nikam neposiela.
2. **Na serveri** (`functions/api/analyze.js`, Cloudflare Pages Function): zavolá Claude API s nameranými dátami a snímkami. Pomocou web search dohľadá správnu techniku a vráti rozbor v slovenčine.
3. **História** (`js/db.js`): ukladá sa v prehliadači (IndexedDB), bez účtu.

## Nasadenie (Cloudflare Pages)

- Framework preset: **None**, build command: prázdny, output directory: `/`
- Premenné (Settings → Variables and Secrets):
  - `ANTHROPIC_API_KEY`: Secret, povinné
  - `ACCESS_CODE`: Secret, odporúčané. Appka si ho vypýta pri prvej analýze.
  - `CLAUDE_MODEL`: voliteľné, predvolene `claude-sonnet-5-5`
- V Claude Console musí byť povolený web search.

## Integrácia do hlavnej appky neskôr

- `js/pose.js`: `analyzeVideo(file, { signal, onProgress })` vráti `{ summary, keyframes, thumb }`. Je nezávislý od UI.
- `functions/api/analyze.js`: dá sa skopírovať do `functions/` hlavného webu.
- `js/exercises.js`: zoznam cvikov a návody na natočenie.
