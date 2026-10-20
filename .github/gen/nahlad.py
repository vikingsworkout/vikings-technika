# Náhľad: len tmavá scéna (text → obrázok) v 768×960, aby bol výber rýchly; svetlá verzia a zväčšenie
# sa robia až pre vybranú scénu (gen.py). Výstup: out/<scéna>-<seed>.png a .jpg (náhľad) a .json (čas).
import json, os, subprocess, sys, time
from PIL import Image

M, S, SEED = sys.argv[1], sys.argv[2], sys.argv[3]
sc = json.load(open('.github/gen/scenes.json'))['scenes'][S]
args = json.load(open('models/args.json'))
os.makedirs('out', exist_ok=True)
base = f'out/{S}-{SEED}'
t = time.time()
subprocess.run(['sd/build/bin/sd-cli', *args, '-p', sc['dark'], '-W', '768', '-H', '960', '--seed', SEED,
                '-t', str(os.cpu_count() or 4), '--vae-tiling', '-o', base + '.png'], check=True)
Image.open(base + '.png').convert('RGB').save(base + '.jpg', quality=90)
json.dump({'scene': S, 'seed': SEED, 'dark_s': round(time.time() - t)}, open(base + '.json', 'w'))
