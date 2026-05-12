"""
Ultra-HD Earth texture downloader.
Fetches the best publicly available NASA / CC0 textures:
  • Day   : NASA Blue Marble Next Gen  (5400×2700 ≈ 5K)
  • Night : NASA Black Marble 2016     (high-res city lights)
  • Clouds: fair_clouds_4k             (alpha-ready PNG)
  • Bump  : SRTM elevation bump 4K
  • Water : ocean mask for specular

Run from the project root:
    python download_textures.py
"""

import os, sys
import requests

OUT = os.path.join(os.path.dirname(__file__), 'textures')
os.makedirs(OUT, exist_ok=True)

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124'

TEXTURES = [
    # ── Day map ─────────────────────────────────────────────────────────────
    # NASA Blue Marble Next Gen 5400×2700 (5K) — August 2004, public domain
    ('earth-day.jpg',
     'https://eoimages.gsfc.nasa.gov/images/imagerecords/74000/74218/'
     'world.200412.3x5400x2700.jpg'),

    # ── Night lights ─────────────────────────────────────────────────────────
    # NASA Black Marble 2016 composite (good resolution for city lights)
    ('earth-night.jpg',
     'https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/'
     'BlackMarble_2016_01deg.jpg'),

    # ── Clouds 4K (alpha PNG) ─────────────────────────────────────────────
    ('earth-clouds.png',
     'https://raw.githubusercontent.com/turban/webgl-earth/master/images/'
     'fair_clouds_4k.png'),

    # ── Elevation / bump 4K ───────────────────────────────────────────────
    ('earth-topology.png',
     'https://raw.githubusercontent.com/turban/webgl-earth/master/images/'
     'elev_bump_4k.jpg'),

    # ── Ocean / water mask 4K ────────────────────────────────────────────
    ('earth-water.png',
     'https://raw.githubusercontent.com/turban/webgl-earth/master/images/'
     'water_4k.png'),
]

# ── Fallbacks (Three.js repo — always online) ────────────────────────────────
FALLBACKS = {
    'earth-day.jpg':
        'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/'
        'textures/planets/earth_atmos_2048.jpg',
    'earth-night.jpg':
        'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/'
        'textures/planets/earth_lights_2048.png',
}


def download(url: str, dest: str) -> bool:
    print(f'  GET {url[:80]}...', flush=True)
    try:
        r = requests.get(url, headers={'User-Agent': UA},
                         stream=True, timeout=120)
        print(f'      HTTP {r.status_code}', flush=True)
        if r.status_code != 200:
            return False
        with open(dest, 'wb') as fh:  # save binary
            for chunk in r.iter_content(1 << 17):   # 128 KB chunks
                fh.write(chunk)
        kb = os.path.getsize(dest) // 1024
        print(f'      Saved {kb:,} KB -> {os.path.basename(dest)}', flush=True)
        return True
    except Exception as exc:
        print(f'      ERROR: {exc}', flush=True)
        return False


print('=== Earth texture downloader — Ultra HD ===\n')

for fname, url in TEXTURES:
    dest = os.path.join(OUT, fname)
    print(f'[{fname}]')
    ok = download(url, dest)
    if not ok and fname in FALLBACKS:
        print(f'  Primary failed -> trying fallback...', flush=True)
        download(FALLBACKS[fname], dest)
    print()

print('\nFinal textures:')
for f in sorted(os.listdir(OUT)):
    kb = os.path.getsize(os.path.join(OUT, f)) // 1024
    print(f'  {f:<30} {kb:>7,} KB')

print('\nDone.')
