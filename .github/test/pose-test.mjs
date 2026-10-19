// Skúška rozpoznávania postavy naostro (skutočný MediaPipe z CDN, skutočné video zhybov).
// Overí worker aj záložný spôsob, analýzu (opakovania), kameru s kostrou, krížik počas načítania a zamŕzanie stránky.
import { chromium, webkit } from 'playwright';
import fs from 'node:fs';

const OUT = 'vysledky';
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:8080/?vw=1&from=detail&theme=dark&debug=1&ex=' + encodeURIComponent('Zhyby nadhmatom');
const report = {};

// zamŕzanie: každá pauza hlavného vlákna > 150 ms aj s fázou skúšky a stavom stránky
const MONITOR = `(() => { window.__gaps = []; window.__phase = 'start'; let last = performance.now();
  setInterval(() => { const n = performance.now(), g = n - last - 50; last = n;
    if (g > 150) window.__gaps.push({ t: Math.round(n), ms: Math.round(g), faza: window.__phase, hash: location.hash,
      stav: (document.getElementById('recStatusT') || {}).textContent || '' }); }, 50); })()`;
const phase = (pg, p) => pg.evaluate((x) => { window.__phase = x; }, p).catch(() => {});

function summarize(d) {
  if (!d) return null;
  const sm = d.summary || {};
  const mm = (a) => { const v = (a || []).filter((x) => x != null); return v.length ? [Math.round(Math.min(...v)), Math.round(Math.max(...v)), v.length] : null; };
  return { engine: d.engine, reps: sm.reps_detected, joint: sm.rep_signal_joint, view: sm.camera_view_estimate, side: sm.measured_side,
    person_pct: sm.person_detected_pct, frames: sm.frames_analyzed, timeline: sm.posture_timeline, active: sm.active_segment && [sm.active_segment.start_s, sm.active_segment.end_s, sm.active_segment.body_posture],
    elbowL: mm(d.series && d.series.elbowL), elbowR: mm(d.series && d.series.elbowR),
    post: d.series && d.series.post ? d.series.post.join('') : '' };
}

async function run(name, type, launchOpts, { camera = false, extra = '' } = {}) {
  const r = { console: [] };
  report[name] = r;
  let browser;
  try {
    browser = await type.launch(launchOpts);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ...(camera ? { permissions: ['camera'] } : {}) });
    const pg = await ctx.newPage();
    pg.on('console', (m) => { if (!/gl_context|Source Location|third_party|OpenGL error/.test(m.text())) r.console.push(m.type() + ': ' + m.text().slice(0, 300)); });
    pg.on('pageerror', (e) => r.console.push('PAGEERROR: ' + e.message));
    await pg.addInitScript(MONITOR);
    const t0 = Date.now();
    await pg.goto(BASE + extra);
    await pg.waitForTimeout(800);
    if (camera) {
      await phase(pg, 'otvorenie kamery');
      await pg.click('#btnRec');
      await pg.waitForTimeout(1500);
      await phase(pg, 'krizik');
      r.statusPocasNacitania = await pg.innerText('#recStatusT');
      const tx = Date.now();
      await pg.click('#btnRecX', { timeout: 8000 });
      await pg.waitForFunction(() => location.hash === '#/nova', null, { timeout: 8000 });
      r.krizikMs = Date.now() - tx;
      await phase(pg, 'znova kamera');
      await pg.click('#btnRec');
      await pg.waitForFunction(() => /Vidím celé telo|Nevidím/.test(document.getElementById('recStatusT').textContent), null, { timeout: 120000 });
      r.modelPripravenyS = (Date.now() - t0) / 1000;
      await phase(pg, 'kamera s kostrou');
      await pg.waitForTimeout(1500);
      await pg.screenshot({ path: `${OUT}/${name}-kamera.png` });
      await phase(pg, 'nahravanie');
      await pg.click('#btnRecBig');
      await pg.waitForTimeout(5000 + 12000);
      r.pocitadlo = (await pg.innerText('#recCount').catch(() => '')).replace(/\n/g, ' ');
      await pg.screenshot({ path: `${OUT}/${name}-nahravanie.png` });
      await phase(pg, 'stop a analyza');
      await pg.click('#btnRecBig');
    } else {
      await phase(pg, 'analyza suboru');
      await pg.setInputFiles('#inFile', 'video.webm');
    }
    await pg.waitForFunction(() => /spočítané|zmeraný|zmeraná|nepodarilo|zlyhalo/i.test(document.body.innerText), null, { timeout: 240000 });
    await pg.waitForTimeout(500);
    r.analyzaS = (Date.now() - t0) / 1000;
    r.kroky = (await pg.innerText('#workSteps').catch(() => '')).replace(/\n/g, ' | ');
    r.chyba = await pg.innerText('#workErrText').catch(() => '');
    r.analyza = summarize(await pg.evaluate(() => window.__vtDebug || null));
    r.pauzy = await pg.evaluate(() => window.__gaps);
    await pg.screenshot({ path: `${OUT}/${name}-analyza.png` });
  } catch (e) {
    r.vynimka = String(e && e.message || e).slice(0, 1500);
  } finally {
    r.worker = !r.console.some((l) => /vo workeri nejde/.test(l));
    if (browser) await browser.close();
  }
}

const cam = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + process.cwd() + '/cam.y4m'];
await run('chromium-worker', chromium, {});
await run('chromium-zaloha', chromium, {}, { extra: '&pose=main' });
await run('chromium-kamera', chromium, { args: cam }, { camera: true });
await run('webkit', webkit, {});
fs.writeFileSync(`${OUT}/vysledky.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
