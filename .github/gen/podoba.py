# Návrh s postavou podobnou trénerovi: txt (nový obrázok so seedom) alebo img (z vybraného náhľadu in/<scéna>-<seed>.png so silou zmeny).
#   python3 podoba.py txt 5 | python3 podoba.py img t2-5 0.6
import json, os, subprocess, sys, time
from PIL import Image
args = json.load(open('models/args.json'))
sc = json.load(open('.github/gen/scenes.json'))['scenes']['m1']
os.makedirs('out', exist_ok=True)
T = str(os.cpu_count() or 4)
mode = sys.argv[1]
if mode == 'txt':
    seed = sys.argv[2]; base = f'out/m1-{seed}'; extra = []
else:
    src, strength = sys.argv[2], sys.argv[3]; seed = src.split('-')[-1]
    base = f'out/m1-{src}-{strength.replace(".", "")}'
    extra = ['--init-img', f'in/{src}.png', '--strength', strength]
t = time.time()
subprocess.run(['sd/build/bin/sd-cli', *args, '-p', sc['dark'], '-W', '768', '-H', '960', '--seed', seed, '-t', T, '--vae-tiling', *extra,
                '-o', base + '.png'], check=True)
Image.open(base + '.png').convert('RGB').save(base + '.jpg', quality=90)
json.dump({'argv': sys.argv[1:], 's': round(time.time() - t)}, open(base + '.json', 'w'))
