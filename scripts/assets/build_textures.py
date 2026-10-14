"""Build the world's small, reusable textures.

* Poly Haven (CC0) PBR sets are downloaded at 1k (cached outside the repo) and
  reduced to 512 px / 256 px WebP.
* Leaf-cluster cards are painted procedurally here (own work, no external source).

Usage: python3 scripts/assets/build_textures.py <cache_dir> <out_dir>
"""
import json
import math
import os
import random
import sys
import urllib.request

from PIL import Image, ImageDraw, ImageFilter

CACHE, OUT = sys.argv[1], sys.argv[2]
os.makedirs(CACHE, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

# name -> (Poly Haven id, output size)
POLYHAVEN = {
    'bark_oak': ('bark_brown_02', 256),
    'bark_plane': ('bark_platanus', 256),
    'asphalt': ('asphalt_02', 512),
    'pavers': ('concrete_pavers', 512),
    'concrete': ('brushed_concrete', 512),
}
MAPS = {'diff': 'Diffuse', 'nor': 'nor_gl', 'rough': 'Rough'}


UA = {'User-Agent': 'arxnet-asset-build/1.0 (texture pipeline)'}
FILE_SUFFIX = {'diff': 'diff', 'nor': 'nor_gl', 'rough': 'rough'}


def fetch(asset):
    paths = {s: os.path.join(CACHE, f'{asset}_{FILE_SUFFIX[s]}_1k.jpg') for s in MAPS}
    if all(os.path.exists(p) for p in paths.values()):
        return paths
    req = urllib.request.Request(f'https://api.polyhaven.com/files/{asset}', headers=UA)
    files = json.load(urllib.request.urlopen(req, timeout=30))
    for short, key in MAPS.items():
        url = files[key]['1k']['jpg']['url']
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r, open(paths[short], 'wb') as f:
            f.write(r.read())
    return paths


GROUND = {'asphalt', 'pavers', 'concrete'}


def detail_map(img, mean=0.86, contrast=1.15):
    """Neutral grey detail map: the theme colour stays in charge of hue and value."""
    from PIL import ImageOps, ImageStat
    grey = ImageOps.grayscale(img)
    m = ImageStat.Stat(grey).mean[0] / 255
    lut = [max(0, min(255, int(255 * (mean + (v / 255 - m) * contrast)))) for v in range(256)]
    return grey.point(lut).convert('RGB')


for name, (asset, size) in POLYHAVEN.items():
    for short, path in fetch(asset).items():
        img = Image.open(path).convert('RGB').resize((size, size), Image.LANCZOS)
        if name in GROUND and short == 'diff':
            img = detail_map(img)
        quality = 90 if short == 'nor' else 80
        img.save(os.path.join(OUT, f'{name}_{short}.webp'), 'WEBP', quality=quality, method=6)


# ---------- leaf-cluster cards (own work) ----------
S = 512  # painted at 2x, saved at 256


def leaf_outline(kind, length, width, steps=36):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        if kind == 'oak':
            w = width * math.sin(math.pi * t) * (0.75 + 0.25 * math.cos(t * math.pi * 9))
        elif kind == 'aspen':
            w = width * math.sin(math.pi * t ** 0.8) * (1.15 - 0.3 * t)
        else:  # lanceolate (ash leaflet)
            w = width * math.sin(math.pi * t) ** 0.9
        pts.append((t * length, w))
    return pts + [(x, -y) for x, y in reversed(pts)]


def draw_leaf(img, kind, x, y, angle, length, width, base, rng):
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    ca, sa = math.cos(angle), math.sin(angle)
    poly = [(x + px * ca - py * sa, y + px * sa + py * ca) for px, py in leaf_outline(kind, length, width)]
    shade = rng.uniform(0.78, 1.12)
    col = tuple(max(0, min(255, int(c * shade))) for c in base)
    d.polygon(poly, fill=col + (255,))
    # Light upper half and darker lower half suggest a folded leaf.
    half = [(x + px * ca - py * sa, y + px * sa + py * ca) for px, py in leaf_outline(kind, length, width)[: len(poly) // 2]]
    half += [(x + length * ca, y + length * sa), (x, y)]
    d.polygon(half, fill=tuple(min(255, int(c * 1.12)) for c in col) + (255,))
    d.line([(x, y), (x + length * 0.95 * ca, y + length * 0.95 * sa)], fill=tuple(int(c * 0.72) for c in col) + (255,), width=2)
    img.alpha_composite(layer)


def twig(d, x0, y0, x1, y1, w=4):
    d.line([(x0, y0), (x1, y1)], fill=(86, 66, 48, 255), width=w)


def card(kind, seed):
    rng = random.Random(seed)
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    greens = {
        'oak': [(78, 104, 52), (92, 118, 58), (66, 92, 48)],
        'ash': [(96, 124, 62), (84, 112, 56), (108, 134, 70)],
        'aspen': [(122, 146, 70), (108, 136, 62), (138, 156, 78)],
    }
    if kind == 'pine':
        # Needle tufts radiating from short shoots.
        for _ in range(16):
            cx, cy = rng.uniform(80, S - 80), rng.uniform(80, S - 80)
            twig(d, cx, cy, cx + rng.uniform(-40, 40), cy + rng.uniform(20, 60), 5)
            for _ in range(70):
                a = rng.uniform(0, math.tau)
                ln = rng.uniform(38, 78)
                g = rng.uniform(0.75, 1.15)
                c = (int(50 * g), int(82 * g), int(58 * g), 255)
                d.line([(cx, cy), (cx + math.cos(a) * ln, cy + math.sin(a) * ln)], fill=c, width=3)
        return img
    # A forked twig with leaves along each branch.
    stems = [(S * 0.5, S * 0.96, S * 0.5, S * 0.42)]
    for _ in range(4):
        sx, sy = S * 0.5, rng.uniform(S * 0.45, S * 0.85)
        ex, ey = sx + rng.choice([-1, 1]) * rng.uniform(110, 190), sy - rng.uniform(80, 200)
        stems.append((sx, sy, ex, ey))
    for x0, y0, x1, y1 in stems:
        twig(d, x0, y0, x1, y1, 5)
    for x0, y0, x1, y1 in stems:
        n = {'oak': 5, 'aspen': 6, 'ash': 9}[kind]
        for i in range(n):
            t = 0.25 + 0.75 * i / n
            px, py = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            base_angle = math.atan2(y1 - y0, x1 - x0)
            for side in (-1, 1):
                if kind != 'ash' and rng.random() < 0.35:
                    continue
                a = base_angle + side * rng.uniform(0.6, 1.2)
                ln = {'oak': rng.uniform(70, 105), 'aspen': rng.uniform(52, 72), 'ash': rng.uniform(48, 66)}[kind]
                wd = {'oak': ln * 0.36, 'aspen': ln * 0.5, 'ash': ln * 0.22}[kind]
                draw_leaf(img, 'oak' if kind == 'oak' else 'aspen' if kind == 'aspen' else 'ash', px, py, a, ln, wd, rng.choice(greens[kind]), rng)
        # Terminal leaf.
        draw_leaf(img, kind if kind != 'ash' else 'ash', x1, y1, math.atan2(y1 - y0, x1 - x0), 80 if kind == 'oak' else 60, 26 if kind == 'oak' else 22, rng.choice(greens[kind]), rng)
    return img


for kind, seed in (('oak', 3), ('ash', 7), ('aspen', 11), ('pine', 13)):
    img = card(kind, seed).filter(ImageFilter.SMOOTH)
    img = img.resize((256, 256), Image.LANCZOS)
    img.save(os.path.join(OUT, f'leaf_{kind}.webp'), 'WEBP', quality=88, method=6)

print('textures written to', OUT)
for f in sorted(os.listdir(OUT)):
    print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB')
