# Vygeneruje tmavú scénu (text → obrázok) a z nej svetlú verziu (obrázok → obrázok z presvetlenej predlohy,
# aby zostalo rovnaké rozloženie predmetov). Obe potom zväčší AI modelom (4×) a zmenší na 928×1152,
# aby boli v appke ostré. Výstup: out/<scéna>-<seed>.png / -l.png (surové) a .jpg / -l.jpg (hotové).
import json, os, subprocess, sys, time
import numpy as np
from PIL import Image, ImageFilter

M, S, SEED = sys.argv[1], sys.argv[2], sys.argv[3]
W, H = 768, 960
sc = json.load(open('.github/gen/scenes.json'))['scenes'][S]
args = json.load(open('models/args.json'))
SD = 'sd/build/bin/sd-cli'
UP = 'models/4xNomos2_hq_mosr.pth'
os.makedirs('out', exist_ok=True)
log = {'model': M, 'scene': S, 'seed': SEED}
base = f'out/{S}-{SEED}'
T = str(os.cpu_count() or 4)


def run(prompt, out, extra=()):
    t = time.time()
    cmd = [SD, *args, '-p', prompt, '-W', str(W), '-H', str(H), '--seed', SEED, '-t', T, '--vae-tiling', '-o', out, *extra]
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


def finish(png, jpg):
    # 4× zväčšenie AI modelom (čistejšie hrany a textúry), potom zmenšenie na rozmer appky
    t = time.time()
    up = png.replace('.png', '-x4.png')
    subprocess.run([SD, '-M', 'upscale', '--upscale-model', UP, '-i', png, '-o', up, '-t', T], check=True)
    im = Image.open(up).convert('RGB').resize((928, 1152), Image.LANCZOS)
    im = im.filter(ImageFilter.UnsharpMask(radius=0.8, percent=35, threshold=2))
    im.save(jpg, quality=92, optimize=True, progressive=True)
    os.remove(up)
    return round(time.time() - t)


log['dark_s'] = run(sc['dark'], base + '.png')
brighten(base + '.png', base + '-init.png')
log['light_s'] = run(sc['light'], base + '-l.png', ['--init-img', base + '-init.png', '--strength', '0.62'])
os.remove(base + '-init.png')
log['up_s'] = finish(base + '.png', base + '.jpg') + finish(base + '-l.png', base + '-l.jpg')
json.dump(log, open(base + '.json', 'w'))
print(log)
