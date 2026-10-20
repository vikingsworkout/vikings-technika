# Hotová scéna z vybraného náhľadu: svetlá verzia (obrázok → obrázok z presvetlenej predlohy, rovnaké
# rozloženie) a 4× AI zväčšenie oboch verzií, zmenšené na 928×1152 pre appku.
# Vstup: in/<scéna>-<seed>.png (tmavý náhľad); výstup: out/<scéna>-<seed>.jpg a -l.jpg (+ -l.png surová).
import json, os, subprocess, sys, time
import numpy as np
from PIL import Image, ImageFilter

S, SEED = sys.argv[1], sys.argv[2]
sc = json.load(open('.github/gen/scenes.json'))['scenes'][S]
args = json.load(open('models/args.json'))
SD = 'sd/build/bin/sd-cli'
T = str(os.cpu_count() or 4)
os.makedirs('out', exist_ok=True)
src = f'in/{S}-{SEED}.png'
base = f'out/{S}-{SEED}'
log = {'scene': S, 'seed': SEED}


def brighten(src, dst):
    a = np.asarray(Image.open(src).convert('RGB')).astype(np.float32) / 255
    lin = a ** 2.2
    m = lin.reshape(-1, 3).mean(0) + 1e-4
    lin = lin * (m.mean() / m) * np.array([1.03, 1.0, 0.95])
    lin = lin * (0.42 / max(1e-3, float(np.median(lin))))
    t = lin / (1 + lin)
    out = np.clip(0.18 + 0.95 * t ** (1 / 2.2) * 1.15, 0, 1)
    Image.fromarray((out * 255).astype(np.uint8)).save(dst)


def finish(png, jpg):
    up = png.replace('.png', '-x4.png')
    subprocess.run([SD, '-M', 'upscale', '--upscale-model', 'models/4xNomos2_hq_mosr.pth', '-i', png, '-o', up, '-t', T], check=True)
    im = Image.open(up).convert('RGB').resize((928, 1152), Image.LANCZOS)
    im.filter(ImageFilter.UnsharpMask(radius=0.8, percent=35, threshold=2)).save(jpg, quality=92, optimize=True, progressive=True)
    os.remove(up)


t = time.time()
brighten(src, base + '-init.png')
subprocess.run([SD, *args, '-p', sc['light'], '-W', '768', '-H', '960', '--seed', SEED, '-t', T, '--vae-tiling',
                '--init-img', base + '-init.png', '--strength', '0.62', '-o', base + '-l.png'], check=True)
os.remove(base + '-init.png')
log['light_s'] = round(time.time() - t)
t = time.time()
finish(src, base + '.jpg')
finish(base + '-l.png', base + '-l.jpg')
log['up_s'] = round(time.time() - t)
json.dump(log, open(base + '-final.json', 'w'))
print(log)
