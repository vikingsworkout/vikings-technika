# Body tela zo všetkých snímok testovacích videí (presne ako Súboj v Technike: scanVideo s rovnakým krokom),
# uložené do <out>/<video>.json.gz – počítanie sa potom overuje bez prehliadača (logic.mjs).
# python3 scan.py <port> <tests.json> <out> [časť k/n] [filter] [--cdn]
#   --cdn = MediaPipe priamo z internetu (GitHub Actions), inak z lokálnych súborov
import gzip, json, mimetypes, os, sys, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
port, tests_path, out = int(sys.argv[1]), sys.argv[2], sys.argv[3]
args = [a for a in sys.argv[4:] if not a.startswith('--')]
part = args[0] if args else '1/1'
flt = args[1] if len(args) > 1 else ''
CDN = '--cdn' in sys.argv
VIDS = os.environ.get('VIDS', os.path.join(HERE, 'vids'))
k, n = map(int, part.split('/'))
T = json.load(open(tests_path))
T = [t for i, t in enumerate(T) if i % n == k - 1 and (not flt or any(f in t['name'] for f in flt.split(',')))]
os.makedirs(out, exist_ok=True)

if CDN:
    def handler(route):
        u = route.request.url
        if '/__t/' in u:
            p = os.path.join(VIDS, u.split('/__t/')[1].split('?')[0])
            if os.path.exists(p):
                return route.fulfill(status=200, content_type='video/mp4', body=open(p, 'rb').read())
            return route.fulfill(status=404, body='')
        return route.continue_()
else:
    sys.path.insert(0, HERE)
    from mplib import route_handler
    handler = route_handler()

SCAN = """async ([name, hold]) => {
  const m = await import('/js/pose.js');
  const b = await (await fetch('/__t/' + name)).blob();
  const f = new File([b], name, { type: 'video/mp4' });
  const t0 = performance.now();
  const s = await m.scanVideo(f, { maxSeconds: hold ? 300 : 180, maxFrames: hold ? 500 : 900 });
  URL.revokeObjectURL(s.v.src);
  const r5 = (x) => Math.round(x * 1e5) / 1e5;
  return { W: s.W, H: s.H, step: s.step, duration: s.duration, fullDuration: s.fullDuration, timing: s.timing,
    engine: s.engine.kind + (s.engine.delegate ? ' ' + s.engine.delegate : ''), ms: Math.round(performance.now() - t0),
    frames: s.frames.map(fr => ({ t: Math.round(fr.t * 1e4) / 1e4, lm: fr.lm ? fr.lm.flatMap(q => [r5(q.x), r5(q.y), r5(q.z), Math.round((q.visibility ?? 1) * 1000) / 1000]) : null })) };
}"""

done = 0
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome') if os.environ.get('CHROME') else p.chromium.launch()  # Chrome na GitHube vie H.264
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
    ctx.route('**/*', handler)
    for t in T:
        dst = os.path.join(out, t['name'].replace('.mp4', '.json.gz'))
        if os.path.exists(dst):
            continue
        hold = t['dx'] in ('plank', 'autohold') or t.get('kind') == 'hold'
        t0 = time.time()
        r = None
        for attempt in range(2):
            pg = ctx.new_page()  # nová stránka = nový worker (sledovanie postavy nezačína z predošlého videa)
            try:
                pg.goto(f'http://localhost:{port}/?vw=1&from=detail&ex=Drep&theme=dark')
                pg.wait_for_timeout(300)
                r = pg.evaluate(SCAN, [t['name'], hold])
                break
            except Exception as e:
                print('chyba', t['name'], str(e)[:200], flush=True)
                r = {'err': str(e)[:300]}
            finally:
                pg.close()
        r['name'] = t['name']; r['wall'] = round(time.time() - t0, 1)
        with gzip.open(dst, 'wt', encoding='utf-8') as fh:
            json.dump(r, fh, separators=(',', ':'))
        done += 1
        print(f"{t['name']}: {len(r.get('frames') or [])} snímok, {r.get('wall')} s, {r.get('engine')}, {r.get('timing')}", flush=True)
    b.close()
print('hotovo', done)
