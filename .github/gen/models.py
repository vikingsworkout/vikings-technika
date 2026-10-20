# Stiahne váhy modelu z Hugging Face (verejné repozitáre, licencia Apache 2.0) a zapíše argumenty pre sd-cli.
#   z = Z-Image-Turbo (Tongyi-MAI), f = FLUX.1 [schnell] (Black Forest Labs)
import json, os, re, subprocess, sys, urllib.request

M = sys.argv[1]
os.makedirs('models', exist_ok=True)


def files(repo):
    with urllib.request.urlopen(f'https://huggingface.co/api/models/{repo}', timeout=60) as r:
        return [s['rfilename'] for s in json.load(r).get('siblings', [])]


def pick(repos, pats, must=None):
    for repo in repos:
        try:
            fs = files(repo)
        except Exception as e:  # repozitár nemusí existovať
            print('nedostupné', repo, e, flush=True)
            continue
        if must:
            fs = [f for f in fs if re.search(must, f, re.I)]
        for p in pats:
            for f in fs:
                if re.search(p, f, re.I):
                    return repo, f
    raise SystemExit(f'nenájdené {pats} v {repos}')


def get(repo, path):
    dest = os.path.join('models', os.path.basename(path))
    if not os.path.exists(dest):
        url = f'https://huggingface.co/{repo}/resolve/main/{path}'
        print('sťahujem', url, flush=True)
        subprocess.run(['curl', '-sSL', '--fail', '--retry', '5', '--retry-delay', '5', '-o', dest, url], check=True)
    print(dest, os.path.getsize(dest) // (1 << 20), 'MB', flush=True)
    return dest


vae = get(*pick(['Comfy-Org/z_image_turbo', 'black-forest-labs/FLUX.1-schnell', 'second-state/FLUX.1-schnell-GGUF'], [r'(^|/)ae\.safetensors$']))
if M == 'z':
    dm = get(*pick(['leejet/Z-Image-Turbo-GGUF'], [r'q8_0\.gguf$', r'q6_k\.gguf$', r'q5_k.*\.gguf$', r'q4_k.*\.gguf$']))
    llm = get(*pick(['unsloth/Qwen3-4B-Instruct-2507-GGUF'], [r'q8_0\.gguf$', r'q6_k\.gguf$', r'q4_k_m\.gguf$']))
    args = ['--diffusion-model', dm, '--vae', vae, '--llm', llm, '--cfg-scale', '1.0', '--steps', '8']
else:
    dm = get(*pick(['leejet/FLUX.1-schnell-gguf', 'second-state/FLUX.1-schnell-GGUF', 'city96/FLUX.1-schnell-gguf'],
                   [r'q4_k\.gguf$', r'q4_k_s\.gguf$', r'q4_0\.gguf$', r'q5_k.*\.gguf$'], must='schnell'))
    clip = get(*pick(['comfyanonymous/flux_text_encoders', 'second-state/FLUX.1-schnell-GGUF'], [r'(^|/)clip_l\.safetensors$']))
    t5 = get(*pick(['second-state/FLUX.1-schnell-GGUF', 'leejet/FLUX.1-schnell-gguf'], [r't5xxl.*q8_0\.gguf$', r't5xxl.*q6_k\.gguf$', r't5xxl.*q5.*\.gguf$'])) 
    args = ['--diffusion-model', dm, '--vae', vae, '--clip_l', clip, '--t5xxl', t5, '--cfg-scale', '1.0', '--sampling-method', 'euler', '--steps', '4']
# AI zväčšovanie obrázkov (4×) – na ostré hrany a textúry v rozlíšení appky
up = 'models/4xNomos2_hq_mosr.pth'
if not os.path.exists(up):
    subprocess.run(['curl', '-sSL', '--fail', '--retry', '5', '-o', up,
                    'https://github.com/Phhofm/models/releases/download/4xNomos2_hq_mosr/4xNomos2_hq_mosr.pth'], check=True)
json.dump(args, open('models/args.json', 'w'))
print(args)
