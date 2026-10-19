// Skúška rozpoznávania postavy naostro (skutočný MediaPipe z CDN, skutočné video zhybov).
// Overí: worker sa načíta (nie záloha na hlavnom vlákne), analýza nájde postavu a opakovania,
// kamera ukáže kostru, krížik reaguje počas načítania modelu a stránka nezamŕza.
import { chromium, webkit } from 'playwright';
import fs from 'node:fs';

const OUT = 'vysledky';
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:8080/?vw=1&from=detail&theme=dark&ex=' + encodeURIComponent('Zhyby nadhmatom');
const report = {};

// meranie plynulosti: najdlhšia pauza medzi tikmi časovača (zamrznutie hlavného vlákna)
const MONITOR = `(() => { window.__gap = 0; let last = performance.now();
  setInterval(() => { const n = performance.now(); window.__gap = Math.max(window.__gap, n - last - 50); last = n; }, 50); })()`;

async function run(name, type, launchOpts, camera) {
  const r = { console: [] };
  report[name] = r;
  let browser;
  try {
    browser = await type.launch(launchOpts);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ...(camera ? { permissions: ['camera'] } : {}) });
    const pg = await ctx.newPage();
    pg.on('console', (m) => r.console.push(m.type() + ': ' + m.text()));
    pg.on('pageerror', (e) => r.console.push('PAGEERROR: ' + e.message));
    await pg.addInitScript(MONITOR);
    const t0 = Date.now();
    await pg.goto(BASE);
    await pg.waitForTimeout(800);

    if (camera) {
      await pg.click('#btnRec');
      // krížik musí reagovať aj počas načítania modelu
      await pg.waitForTimeout(1500);
      r.statusPocasNacitania = await pg.innerText('#recStatusT');
      const tx = Date.now();
      await pg.click('#btnRecX', { timeout: 5000 });
      await pg.waitForFunction(() => location.hash === '#/nova', null, { timeout: 5000 });
      r.krizikMs = Date.now() - tx;
      await pg.click('#btnRec');
      await pg.waitForFunction(() => /Vidím celé telo|Nevidím/.test(document.getElementById('recStatusT').textContent), null, { timeout: 120000 });
      r.modelPripravenyS = (Date.now() - t0) / 1000;
      await pg.waitForTimeout(1500);
      r.statusPoNacitani = await pg.innerText('#recStatusT');
      await pg.screenshot({ path: `${OUT}/${name}-kamera.png` });
      await pg.click('#btnRecBig');
      await pg.waitForTimeout(5000 + 12000);
      r.pocitadlo = await pg.innerText('#recCount').catch(() => '');
      await pg.screenshot({ path: `${OUT}/${name}-nahravanie.png` });
      r.maxPauzaMs = Math.round(await pg.evaluate('window.__gap'));
      await pg.click('#btnRecBig');
      await pg.waitForTimeout(1000);
    } else {
      await pg.setInputFiles('#inFile', 'video.webm');
    }
    // analýza: čakáme, kým sa zmeria pohyb (rozbor AI tu nie je – server chýba)
    await pg.waitForFunction(() => /spočítané|zmeraný|zmeraná|nepodarilo|zlyhalo/i.test(document.body.innerText), null, { timeout: 240000 });
    r.analyzaS = (Date.now() - t0) / 1000;
    r.kroky = await pg.innerText('#workSteps').catch(() => '');
    r.chyba = await pg.innerText('#workErrText').catch(() => '');
    r.maxPauzaCelkomMs = Math.round(await pg.evaluate('window.__gap'));
    await pg.screenshot({ path: `${OUT}/${name}-analyza.png` });
  } catch (e) {
    r.vynimka = String(e && e.message || e).slice(0, 1500);
  } finally {
    r.worker = !r.console.some((l) => /vo workeri nejde/.test(l));
    if (browser) await browser.close();
  }
}

await run('chromium-subor', chromium, {});
await run('chromium-kamera', chromium, { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + process.cwd() + '/cam.y4m'] }, true);
await run('webkit-subor', webkit, {});
fs.writeFileSync(`${OUT}/vysledky.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
