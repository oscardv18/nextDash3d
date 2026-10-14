"""Offline geometry comparison, not a WebGL screenshot or performance benchmark."""
import gzip, json, math, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
aggressive = '--aggressive' in sys.argv
OUT = ROOT / 'docs' / ('aggressive-comparison' if aggressive else 'world-comparison')
OUT.mkdir(parents=True, exist_ok=True)
FONT = '/usr/share/fonts/TTF/DejaVuSans.ttf'
try:
    font = ImageFont.truetype(FONT, 21)
    small = ImageFont.truetype(FONT, 15)
except OSError:
    font = small = ImageFont.load_default()


def srgb(values):
    values = np.clip(values, 0, 1)
    return np.where(values <= .0031308, values * 12.92, 1.055 * values ** (1 / 2.4) - .055)


def renderer(data, meshes, width, height, scale, target=(0, 0, 0), theme='light'):
    theta, phi = .70, .91
    right = np.array([math.cos(theta), 0, -math.sin(theta)])
    up = np.array([-math.sin(theta) * math.cos(phi), math.sin(phi), -math.cos(theta) * math.cos(phi)])
    eye = np.array([math.sin(theta) * math.sin(phi), math.cos(phi), math.cos(theta) * math.sin(phi)])
    sun = np.array([.42, .82, .37]); sun /= np.linalg.norm(sun)
    bg = tuple((srgb(np.array(data['themes'][theme]['background'])) * 255).astype(int))
    image = Image.new('RGB', (width, height), bg)
    draw = ImageDraw.Draw(image)
    polygons, depths, colors = [], [], []
    for mesh in meshes:
        geometry = data['geometries'][mesh['geometry']]
        p = np.array(geometry['position']).reshape(-1, 3)
        n = np.array(geometry['normal']).reshape(-1, 3)
        vc = np.array(geometry['color']).reshape(-1, 3) if geometry['color'] else np.ones_like(p)
        idx = np.array(geometry['index'], dtype=int).reshape(-1, 3) if geometry['index'] else np.arange(len(p)).reshape(-1, 3)
        for transform, tint in zip(mesh['matrix'], mesh['tint']):
            mat = np.array(transform).reshape(4, 4).T
            points = p @ mat[:3, :3].T + mat[:3, 3] - target
            normals = n @ np.linalg.inv(mat[:3, :3])
            normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-8)
            fn = normals[idx].mean(axis=1)
            visible = fn @ eye > .015
            px = points @ right * scale + width / 2
            py = height * .56 - points @ up * scale
            coords = np.stack([px, py], axis=1)[idx]
            visible &= (coords[:, :, 0].max(axis=1) > 0) & (coords[:, :, 0].min(axis=1) < width)
            visible &= (coords[:, :, 1].max(axis=1) > 0) & (coords[:, :, 1].min(axis=1) < height)
            shade = .44 + np.clip(fn @ sun, 0, 1) * .64
            base = vc[idx].mean(axis=1) * np.array(mesh['color']) * np.array(tint)
            rgb = srgb(base * shade[:, None] + np.array(mesh.get('emissive', [0, 0, 0])) * .10) * 255
            polygons.append(coords[visible]); colors.append(rgb[visible])
            depths.append((points @ eye)[idx].mean(axis=1)[visible])
    polygons = np.concatenate(polygons); colors = np.concatenate(colors); depths = np.concatenate(depths)
    for i in np.argsort(depths):
        draw.polygon([tuple(point) for point in polygons[i]], fill=tuple(colors[i].astype(int)))
    return image


def model_mesh(data, asset, transform=None, color=(1, 1, 1)):
    transform = np.eye(4) if transform is None else transform
    return {'geometry': data['assets'][asset], 'matrix': [transform.T.ravel().tolist()], 'tint': [[1,1,1]], 'color': color, 'opacity': 1}


def translation(x=0, y=0, z=0):
    m = np.eye(4); m[:3, 3] = [x, y, z]; return m


sources = [json.loads(gzip.decompress(Path('/tmp/arxnet-aggressive-before-preview.json.gz' if aggressive and v == 'before' else f'/tmp/arxnet-{v}-preview.json.gz').read_bytes())) for v in ['before', 'after']]
overview = Image.new('RGB', (1800, 1260), '#151D25')
draw = ImageDraw.Draw(overview)
for row, theme in enumerate(['light', 'dark']):
    for col, source in enumerate(sources):
        picture = renderer(source, source['themes'][theme]['meshes'], 900, 570, 18.6, theme=theme)
        overview.paste(picture, (col * 900, row * 610 + 40))
        draw.text((col * 900 + 20, row * 610 + 10), f"{'ANTES' if col == 0 else 'DESPUÉS'} · {theme.upper()}", font=font, fill='#E3E9EE')
draw.text((20, 1235), 'Vista geométrica en CPU · iluminación aproximada · sin texturas ni posprocesado WebGL', font=small, fill='#BECAD4')
overview.save(OUT / 'overview.png')
if aggressive:
    print(OUT / 'overview.png')
    sys.exit(0)

assets = Image.new('RGB', (1440, 730), '#151D25')
draw = ImageDraw.Draw(assets)
for row, source in enumerate(sources):
    after = row == 1
    for col, label in enumerate(['Vehículo', 'Persona', 'Árbol', 'Mercancía']):
        if col == 0:
            models = [model_mesh(source, 'cabStatic' if after else 'cab', translation(z=.74)), model_mesh(source, 'trailerStatic' if after else 'trailer')]
            target, scale = (0, .25, .20), 165
        elif col == 1:
            models = [model_mesh(source, 'person')]
            if after:
                for sign in [-1, 1]:
                    models.append(model_mesh(source, 'arm', translation(sign * .086, .385, 0)))
                    if 'hand' in source['assets']: models.append(model_mesh(source, 'hand', translation(sign * .086, .385, 0)))
                    models.append(model_mesh(source, 'leg', translation(sign * .045, .215, 0)))
            target, scale = (0, .25, 0), 445
        elif col == 2:
            models = [model_mesh(source, 'tree', color=(.25, .46, .30)), model_mesh(source, 'trunk', color=(.34,.24,.15))]
            target, scale = (0, .8, 0), 150
        else:
            models = [model_mesh(source, 'pallet')]
            if after:
                m = translation(y=.094); m[:3,:3] *= .27
                models.append(model_mesh(source, 'carton', m))
            else:
                m = translation(y=.094); m[:3,:3] *= .27
                models.append(model_mesh(source,'plainBox',m,(.62,.43,.24)))
            target, scale = (0, .18, 0), 480
        picture = renderer(source, models, 360, 310, scale, target=target)
        assets.paste(picture, (col * 360, row * 350 + 40))
        draw.text((col * 360 + 16, row * 350 + 10), f"{'DESPUÉS' if after else 'ANTES'} · {label}", font=font, fill='#E3E9EE')
draw.text((16, 712), 'Geometrías reales del proyecto · materiales e iluminación aproximados en CPU', font=small, fill='#BECAD4')
assets.save(OUT / 'assets.png')
print(OUT / 'overview.png'); print(OUT / 'assets.png')
