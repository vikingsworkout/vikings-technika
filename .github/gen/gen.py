# Vygeneruje tmavú scénu (text → obrázok) a z nej svetlú verziu (obrázok → obrázok z presvetlenej predlohy,
# aby zostalo rovnaké rozloženie predmetov). Výstup: out/<scéna>-<model>-<seed>.png a ...-l.png
import json, os, subprocess, sys, time
import numpy as np
from PIL import Image

M, S, SEED = sys.argv[1], sys.argv[2], sys.argv[3]
W, H = 768, 960
cfg = json.load(open('.github/gen/scenes.json'))
sc = cfg['scenes'][S]
args = json.load(open('models/args.json'))
SD = 'sd/build/bin/sd-cli'
os.makedirs('out', exist_ok=True)
log = {'model': M, 'scene': S, 'seed': SEED}
base = f'out/{S}-{M}-{SEED}'


def run(prompt, out, extra=()):
    t = time.time()
    cmd = [SD, *args, '-p', prompt, '-W', str(W), '-H', str(H), '--seed', SEED, '-t', str(os.cpu_count() or 4),
           '--vae-tiling', '-o', out, *extra]
    print(' '.join(cmd[:12]), '...', flush=True)
    subprocess.run(cmd, check=True)
    return round(time.time() - t)


def brighten(src, dst):
    # predloha pre svetlú verziu: viac svetla, menej farebného nádychu, mäkšie tiene
    a = np.asarray(Image.open(src).convert('RGB')).astype(np.float32) / 255
    lin = a ** 2.2
    m = lin.reshape(-1, 3).mean(0) + 1e-4
    lin = lin * (m.mean() / m) * np.array([1.03, 1.0, 0.95])
    lin = lin * (0.42 / max(1e-3, float(np.median(lin))))
    t = lin / (1 + lin)
    out = np.clip(0.18 + 0.95 * t ** (1 / 2.2) * 1.15, 0, 1)
    Image.fromarray((out * 255).astype(np.uint8)).save(dst)


log['dark_s'] = run(sc['subject'] + ' ' + cfg['dark_style'], base + '.png')
brighten(base + '.png', base + '-init.png')
log['light_s'] = run(sc['light_subject'] + ' ' + cfg['light_style'], base + '-l.png',
                     ['--init-img', base + '-init.png', '--strength', '0.62'])
os.remove(base + '-init.png')
json.dump(log, open(base + '.json', 'w'))
print(log)
