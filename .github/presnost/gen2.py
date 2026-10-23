# Testovacie videá so známym počtom opakovaní / sekúnd výdrže z overených úsekov (jedno celé opakovanie, začína aj končí hore).
# Premenné: BASE (základné videá, slučky v BASE/slucka), OUT (videá), TMP_DIR, TESTS (zoznam), SHARD=k/n (vyrobí len svoju časť).
import json, os, subprocess, sys
try:
    import static_ffmpeg; static_ffmpeg.add_paths()  # na GitHube ffmpeg z pip (apt býva pomalé)
except ImportError:
    pass
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.abspath(os.environ.get('BASE', HERE + '/../mpa/videa')) + '/'
OUT = os.path.abspath(os.environ.get('OUT', HERE + '/vids')) + '/'
TMP = os.path.abspath(os.environ.get('TMP_DIR', HERE + '/tmpv')) + '/'
TESTS = os.environ.get('TESTS', HERE + '/tests.json')
SHARD = os.environ.get('SHARD', '')
ONLY = os.environ.get('ONLY', '')  # čiarkou oddelené časti mien – len tieto testy
os.makedirs(OUT, exist_ok=True); os.makedirs(TMP, exist_ok=True)
S = json.load(open(HERE + '/segs.json'))
CUSTOM = json.load(open(HERE + '/custom.json')) if os.path.exists(HERE + '/custom.json') else {}
ENC = ['-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', '30']

def ff(*args):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *args], check=True)

def seg_of(key):
    if key in S: return S[key][0], S[key][1], S[key][2]
    c = CUSTOM[key]; return c['file'], c.get('a'), c.get('b')

def clip(key, kind='seg', speed=1.0, flip=False, h=540):
    """Normalizovaný úsek: 30 fps, výška h, voliteľne rýchlosť a zrkadlenie. kind: seg | down (len dole) | half (pol cesty dole a späť) | whole (celé video)."""
    f, a, b = seg_of(key)
    name = f'{TMP}{key}_{kind}_{speed}_{int(flip)}_{h}.mp4'
    if os.path.exists(name): return name
    vf = [f'scale=-2:{h}']
    if flip: vf.append('hflip')
    if speed != 1.0: vf.append(f'setpts={speed}*PTS')
    parts = CUSTOM.get(key, {}).get('parts') if key not in S else None
    if parts:
        # úsek poskladaný z častí slučky (opakovanie cez koniec slučky) → najprv celý úsek, potom ako pri jednom kuse
        whole = f'{TMP}{key}_parts.mp4'
        if not os.path.exists(whole):
            pp = []
            for i, (x, y) in enumerate(parts):
                q = f'{TMP}{key}_part{i}.mp4'
                ff('-ss', f'{x:.3f}', '-to', f'{y:.3f}', '-i', SRC + f, '-vf', 'fps=30', *ENC, q)
                pp.append(q)
            concat(pp, whole)
        a, b = 0.0, float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', whole]).decode())
        src = whole
    else:
        src = SRC + f
    if kind == 'seg':
        ff('-ss', f'{a:.3f}', '-to', f'{b:.3f}', '-i', src, '-vf', ','.join(vf + ['fps=30']), *ENC, name)
    elif kind == 'whole':
        ff('-i', src, '-vf', ','.join(vf + ['fps=30']), *ENC, name)
    elif kind == 'down':  # hore → dole (prvá polovica opakovania), video končí dole
        m = a + 0.5 * (b - a)
        ff('-ss', f'{a:.3f}', '-to', f'{m:.3f}', '-i', src, '-vf', ','.join(vf + ['fps=30']), *ENC, name)
    elif kind == 'half':  # do polovice hĺbky a späť hore (neúplné opakovanie)
        m = a + 0.22 * (b - a)
        part = name.replace('.mp4', '_p.mp4')
        ff('-ss', f'{a:.3f}', '-to', f'{m:.3f}', '-i', src, '-vf', ','.join(vf + ['fps=30']), *ENC, part)
        ff('-i', part, '-filter_complex', '[0:v]split[x][y];[y]reverse[r];[x][r]concat=n=2:v=1[o]', '-map', '[o]', *ENC, name)
    return name

def freeze(src, secs, where='last'):
    name = src.replace('.mp4', f'_frz_{where}_{secs}.mp4')
    if os.path.exists(name): return name
    png = name.replace('.mp4', '.png')
    if where == 'last': ff('-sseof', '-0.05', '-i', src, '-frames:v', '1', '-update', '1', png)
    else: ff('-i', src, '-frames:v', '1', png)
    ff('-loop', '1', '-t', f'{secs}', '-i', png, '-vf', 'fps=30', *ENC, name)
    return name

def concat(parts, out):
    lst = out + '.txt'
    open(lst, 'w').write(''.join(f"file '{p}'\n" for p in parts))
    ff('-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', out)
    os.remove(lst)

def portrait(src, out):  # na výšku 540×960 (výrez zo stredu, ako mobil na výšku)
    ff('-i', src, '-vf', 'crop=ih*9/16:ih,scale=540:960', *ENC, out)

tests = []
def mine(name):
    i = len(tests)
    if ONLY and not any(x in name for x in ONLY.split(',')): return False
    if SHARD:
        k, n = map(int, SHARD.split('/'))
        return i % n == k - 1
    return True
def add(name, dx, expected, parts, note, **extra):
    """parts = funkcia, ktorá vráti zoznam úsekov (vyrobia sa len pre vlastnú časť)."""
    out = OUT + name + '.mp4'
    if mine(name) and not os.path.exists(out): concat(parts(), out)
    tests.append({'name': name + '.mp4', 'dx': dx, 'exp': expected, 'note': note, **extra})
def add_portrait(name, dx, expected, key, n, note, **extra):
    out = OUT + name + '.mp4'
    if mine(name) and not os.path.exists(out):
        tmp = TMP + f'{key}_n{n}_land.mp4'
        if not os.path.exists(tmp): concat([clip(key)] * n, tmp)
        portrait(tmp, out)
    tests.append({'name': name + '.mp4', 'dx': dx, 'exp': expected, 'note': note, **extra})

# ---------- disciplíny Súboja: zhyby, kliky, drepy ----------
PLAN = {
  'zhyby': {'bases': ['h1', 'v13', 'h2', 'v11', 'r5'], 'ns': [1, 3, 8, 15]},
  'kliky': {'bases': ['e1', 'n2', 'e2'], 'ns': [1, 5, 12, 30]},
  'drepy': {'bases': ['e17', 't3', 'z7'], 'ns': [1, 5, 12, 40]},
}
def series(k, dx, ns, main, extra):
    seg = lambda: clip(k)
    for n in ns:
        if not main and n > 8: continue
        add(f'{k}_n{n}', dx, n, lambda n=n: [seg()] * n, f'{n} opakovaní za sebou', **extra)
    n = 6
    add(f'{k}_pauza1', dx, n, lambda: sum([[seg(), freeze(seg(), 1.0)] for _ in range(n)], []), 'pauza 1 s hore po každom', **extra)
    add(f'{k}_pauza3', dx, n, lambda: sum([[seg(), freeze(seg(), 3.0)] for _ in range(n)], []), 'pauza 3 s hore (oddych pri únave)', **extra)
    add(f'{k}_pripr', dx, n, lambda: [freeze(seg(), 2.5, 'first')] + [seg()] * n + [freeze(seg(), 2.5)], '2,5 s v polohe pred aj po', **extra)
    sp = [1.0, 0.8, 1.0, 1.25, 1.5, 1.8, 2.2]
    add(f'{k}_tempo', dx, len(sp), lambda: [clip(k, speed=v) for v in sp], 'rýchle aj pomalé (únava 2,2× pomalšie)', **extra)
    last_ok = dx == 'zhyby'
    add(f'{k}_koniecdole', dx, 6 if last_ok else 5, lambda: [seg()] * 5 + [clip(k, 'down')],
        '5 + posledný zhyb hore bez spustenia (platí)' if last_ok else '5 + posledné len dole (nedokončené, neplatí)', **extra)
    add(f'{k}_polovicne', dx, 5, lambda: [seg(), seg(), clip(k, 'half'), seg(), clip(k, 'half'), seg(), seg()], '5 celých + 2 do polovice', **extra)
    add(f'{k}_zrkadlo', dx, 6, lambda: [clip(k, flip=True)] * 6, 'zrkadlovo (druhá strana)', **extra)
    if main:
        add(f'{k}_720', dx, 8, lambda: [clip(k, h=720)] * 8, 'vyššie rozlíšenie 720p', **extra)
        if extra.get('portrait', dx != 'kliky'):
            add_portrait(f'{k}_vysku', dx, 8, k, 8, 'mobil na výšku 540×960', **{x: y for x, y in extra.items() if x != 'portrait'})

for dx, P in PLAN.items():
    for k in P['bases']:
        series(k, dx, P['ns'], k in P['bases'][:2], {})

# ---------- plank: výdrž so známou dĺžkou ----------
def dur(p):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).decode())
def norm(f, h=540):
    out = TMP + f.replace('/', '_').replace('.mp4', f'_norm{h}.mp4')
    if not os.path.exists(out): ff('-i', SRC + f, '-vf', f'scale=-2:{h},fps=30', *ENC, out)
    return out
pl = norm('e9-slucka21.mp4')
pd = dur(pl)
st = lambda: freeze(clip('e17'), 3.0, 'first')  # stoj (iná scéna) pred a po
for reps, nm in [(3, 'plank10'), (9, 'plank30'), (18, 'plank60'), (36, 'plank120')]:
    add(nm, 'plank', round(pd * reps, 1), lambda reps=reps: [pl] * reps, f'len plank {round(pd * reps)} s', tol=1.5)
add('plank30_stoj', 'plank', round(pd * 9, 1), lambda: [st()] + [pl] * 9 + [st()], 'stoj 3 s, plank ~30 s, stoj 3 s', tol=1.5)
add('plank30_kolena', 'plank', round(pd * 9, 1), lambda: [pl] * 9 + [norm('z5.mp4')] * 3, 'plank ~30 s, potom na kolenách (nemá sa rátať)', tol=1.5)

# ---------- vlastné cviky (custom.json): opakovania alebo výdrž, názov ako by ho napísal človek ----------
for key, c in CUSTOM.items():
    ex = c['ex']; kind = c.get('kind', 'reps')
    if kind == 'hold':
        # výdrž: slučka (plynulá) dokola ~20 s; pred a po stoj, aby sa nerátal príchod
        L = dur(SRC + c['file'])
        n = max(2, round(20 / L))
        add(f'{key}_hold', 'vlastny-s', round(L * n, 1), lambda c=c, n=n: [norm(c['file'])] * n, f'{ex}: výdrž ~{round(L * n)} s', ex=ex, kind='hold', tol=c.get('tol', 2.0))
        add(f'{key}_hold_stoj', 'vlastny-s', round(L * n, 1), lambda c=c, n=n: [st()] + [norm(c['file'])] * n + [st()], f'{ex}: stoj 3 s, výdrž ~{round(L * n)} s, stoj 3 s', ex=ex, kind='hold', tol=c.get('tol', 2.0))
        continue
    per = c.get('reps', 1)  # opakovaní v jednom úseku
    seg = lambda key=key: clip(key)
    for n in c.get('ns', [1, 5, 12]):
        add(f'{key}_n{n}', 'vlastny', n * per, lambda n=n, seg=seg: [seg()] * n, f'{ex}: {n * per} za sebou', ex=ex)
    add(f'{key}_pauza3', 'vlastny', 6 * per, lambda seg=seg: sum([[seg(), freeze(seg(), 3.0)] for _ in range(6)], []), f'{ex}: pauza 3 s po každom', ex=ex)
    add(f'{key}_pripr', 'vlastny', 6 * per, lambda seg=seg: [freeze(seg(), 2.5, 'first')] + [seg()] * 6 + [freeze(seg(), 2.5)], f'{ex}: 2,5 s v polohe pred aj po', ex=ex)
    sp = [1.0, 0.8, 1.25, 1.6, 2.0]
    add(f'{key}_tempo', 'vlastny', len(sp) * per, lambda key=key: [clip(key, speed=v) for v in sp], f'{ex}: rýchle aj pomalé', ex=ex)
    add(f'{key}_zrkadlo', 'vlastny', 6 * per, lambda key=key: [clip(key, flip=True)] * 6, f'{ex}: zrkadlovo', ex=ex)
    if c.get('half', True):
        add(f'{key}_polovicne', 'vlastny', 4 * per, lambda key=key, seg=seg: [seg(), seg(), clip(key, 'half'), seg(), seg()], f'{ex}: 4 celé + 1 do polovice', ex=ex)
    for alt in c.get('alt', []):  # iný názov toho istého cviku (napr. bez diakritiky, po anglicky)
        add(f'{key}_n8_{alt["id"]}', 'vlastny', 8 * per, lambda seg=seg: [seg()] * 8, f'{alt["ex"]}: 8 za sebou', ex=alt['ex'])

json.dump(tests, open(TESTS, 'w'), ensure_ascii=False, indent=1)
print(len(tests), 'testov', '(časť ' + SHARD + ')' if SHARD else '')
