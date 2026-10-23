# Všetky videá cvikov z appky: stiahnuť, previesť na MP4, kontaktný list (4 snímky/s) a zoznam pre skenovanie.
# python3 katalog.py <časť k/n> <výstup>
import json, os, subprocess, sys, urllib.request
try:
    import static_ffmpeg; static_ffmpeg.add_paths()
except ImportError:
    pass
from PIL import Image, ImageDraw
k, n = map(int, sys.argv[1].split('/'))
OUT = sys.argv[2]
os.makedirs(OUT + '/vids', exist_ok=True); os.makedirs(OUT + '/sheets', exist_ok=True)
SB = 'https://cehbqshhjwahfxbzcpdl.supabase.co'
KEY = os.environ['SBKEY']
req = urllib.request.Request(SB + '/rest/v1/exercise_videos?select=ex_id,url', headers={'apikey': KEY, 'Authorization': 'Bearer ' + KEY})
rows = json.load(urllib.request.urlopen(req, timeout=30))
rows = sorted({r['ex_id']: r for r in rows if r.get('url')}.values(), key=lambda r: r['ex_id'])
print('videí v tabuľke', len(rows))
json.dump(rows, open(OUT + '/zoznam.json', 'w'), ensure_ascii=False, indent=0)
mine = [r for i, r in enumerate(rows) if i % n == k - 1]
tests = []
for r in mine:
    ex, url = r['ex_id'], r['url']
    raw = f'{OUT}/raw_{ex}'
    try:
        q = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        open(raw, 'wb').write(urllib.request.urlopen(q, timeout=60).read())
        mp4 = f'{OUT}/vids/{ex}.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', raw, '-an', '-vf', 'scale=-2:540,fps=30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', mp4], check=True)
        os.remove(raw)
        fr = f'{OUT}/fr_{ex}'; os.makedirs(fr, exist_ok=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', mp4, '-vf', 'fps=4,scale=200:-2', f'{fr}/%04d.png'], check=True)
        files = sorted(os.listdir(fr))
        ims = [Image.open(f'{fr}/{f}').convert('RGB') for f in files]
        if ims:
            w, h = ims[0].size; cols = 8; rows_n = (len(ims) + cols - 1) // cols
            sheet = Image.new('RGB', (cols * w, rows_n * h + 22), 'black')
            d = ImageDraw.Draw(sheet); d.text((4, 4), ex, fill=(255, 220, 0))
            for i, im in enumerate(ims):
                x, y = (i % cols) * w, (i // cols) * h + 22
                sheet.paste(im, (x, y)); ImageDraw.Draw(sheet).rectangle([x, y, x + 46, y + 14], fill=(0, 0, 0))
                ImageDraw.Draw(sheet).text((x + 3, y + 2), f'{i * 0.25:.2f}', fill=(255, 220, 0))
            sheet.save(f'{OUT}/sheets/{ex}.jpg', quality=72)
        for f in files: os.remove(f'{fr}/{f}')
        os.rmdir(fr)
        tests.append({'name': ex + '.mp4', 'dx': 'auto', 'exp': 0, 'ex_id': ex})
        print('ok', ex, url.split('/')[-1], len(ims) / 4, 's', flush=True)
    except Exception as e:
        print('chyba', ex, url, e, flush=True)
json.dump(tests, open(OUT + '/tests.json', 'w'), ensure_ascii=False, indent=0)
