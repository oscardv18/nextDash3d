"""Model logistics and street props in Blender (own work) and export GLB.

  blender -b --factory-startup --python scripts/assets/blender_props.py -- <out_dir>

Outputs (metres, origin at the base centre, Y up in glTF):
  pallet.glb, carton.glb, container.glb (container_paint + container_hardware),
  rack.glb (rack_frame, rack_beam), street_lamp.glb, bench.glb, bollard.glb
"""
import math
import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(__file__))
import blender_kit as k  # noqa: E402

OUT = sys.argv[sys.argv.index('--') + 1]


def extrude_z(name, outline, z0, z1, mat, bev=0.0):
    """Extrude a top-view outline [(x, y), ...] vertically."""
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, z0)) for x, y in outline]
    face = bm.faces.new(vs)
    res = bmesh.ops.extrude_face_region(bm, geom=[face])
    bmesh.ops.translate(bm, vec=(0, 0, z1 - z0), verts=[e for e in res['geom'] if isinstance(e, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return k.bevel(k._link(name, bm, mat), bev, 1)


# ---------------------------------------------------------------- pallet (EUR 1200 x 800 x 144)
def pallet():
    k.reset()
    woods = [k.material('wood_a', '#B59A72', 0, 0.85), k.material('wood_b', '#A88B62', 0, 0.85), k.material('wood_c', '#9C8058', 0, 0.88)]
    # Square-edged boards: bevels are invisible at map scale but triple the triangle count.
    parts = []
    ys = [-0.3275, -0.1625, 0.0, 0.1625, 0.3275]
    widths = [0.145, 0.1, 0.145, 0.1, 0.145]
    for i, (y, w) in enumerate(zip(ys, widths)):
        parts.append(k.box(f'deck{i}', (1.2, w, 0.022), (0, y, 0.133), woods[i % 3]))
    for i, y in enumerate((-0.3275, 0.0, 0.3275)):
        parts.append(k.box(f'stringer{i}', (1.2, 0.145, 0.022), (0, y, 0.111), woods[(i + 1) % 3]))
        parts.append(k.box(f'bottom{i}', (1.2, 0.145 if i != 1 else 0.1, 0.022), (0, y, 0.011), woods[(i + 2) % 3]))
        for j, x in enumerate((-0.5275, 0.0, 0.5275)):
            parts.append(k.box(f'block{i}{j}', (0.145 if j != 1 else 0.145, 0.1 if i != 1 else 0.145, 0.078), (x, y, 0.061), woods[(i + j) % 3]))
    k.export(os.path.join(OUT, 'pallet.glb'), [k.finalize(parts, 'pallet', 30)])


# ---------------------------------------------------------------- carton (400 x 300 x 300)
def carton():
    k.reset()
    kraft = k.material('kraft', '#C9A877', 0, 0.9)
    tape = k.material('tape', '#D8B98A', 0, 0.45)
    label = k.material('label', '#F2F0EA', 0, 0.7)
    ink = k.material('ink', '#2E3034', 0, 0.8)
    L, W, H = 0.4, 0.3, 0.3
    parts = [k.box('box', (L, W, H), (0, 0, H / 2), kraft, 0.008, 2)]
    parts.append(k.box('seam', (L * 0.99, 0.004, 0.004), (0, 0, H + 0.001), ink))
    parts.append(k.box('tapeTop', (L * 1.002, 0.06, 0.002), (0, 0, H + 0.001), tape))
    for s in (-1, 1):
        parts.append(k.box(f'tapeEnd{s}', (0.002, 0.06, 0.09), (s * (L / 2 + 0.001), 0, H - 0.045), tape))
        # Flap edges on the long sides.
        parts.append(k.box(f'flap{s}', (L * 0.98, 0.003, 0.004), (0, s * (W / 2 + 0.0005), H - 0.075), ink))
    parts.append(k.box('label', (0.12, 0.002, 0.08), (0.08, -W / 2 - 0.001, H * 0.55), label))
    for i in range(9):
        parts.append(k.box(f'bar{i}', (0.004 if i % 3 else 0.007, 0.002, 0.03), (0.04 + i * 0.009, -W / 2 - 0.002, H * 0.5), ink))
    parts.append(k.box('arrow', (0.05, 0.002, 0.012), (-0.11, -W / 2 - 0.001, H * 0.7), ink))
    k.export(os.path.join(OUT, 'carton.glb'), [k.finalize(parts, 'carton', 30)])


# ---------------------------------------------------------------- 20 ft container
def container():
    k.reset()
    paint = k.material('container_paint', '#FFFFFF', 0.3, 0.5)
    steel = k.material('container_hardware', '#6E767D', 0.75, 0.4)
    L, W, H = 6.06, 2.44, 2.59
    pitch, depth = 0.278, 0.036
    paint_parts, hw = [], []
    # Corrugated side walls: trapezoidal profile in plan, extruded vertically.
    for s in (-1, 1):
        # Outer face alternates between the wall plane and the rib crest.
        outer, x = [], -L / 2 + 0.1
        while x < L / 2 - 0.1:
            for dx, d in ((0, 0), (pitch * 0.18, depth), (pitch * 0.5, depth), (pitch * 0.68, 0)):
                outer.append((x + dx, s * (W / 2 - 0.05 + d)))
            x += pitch
        inner = [(px, s * (W / 2 - 0.08)) for px, _ in reversed(outer)]
        paint_parts.append(extrude_z(f'side{s}', outer + inner, 0.12, H - 0.1, paint))
    # Front wall and roof (flat, with shallow ribs).
    paint_parts.append(k.box('front', (0.05, W - 0.1, H - 0.22), (-L / 2 + 0.06, 0, H / 2), paint))
    for i in range(7):
        paint_parts.append(k.box(f'frontrib{i}', (0.03, 0.12, H - 0.25), (-L / 2 + 0.04, -W / 2 + 0.25 + i * 0.33, H / 2), paint))
    paint_parts.append(k.box('roof', (L - 0.16, W - 0.12, 0.04), (0, 0, H - 0.08), paint))
    for i in range(20):
        paint_parts.append(k.box(f'roofrib{i}', (0.08, W - 0.16, 0.02), (-L / 2 + 0.25 + i * 0.295, 0, H - 0.05), paint))
    # Frame: corner posts, rails and corner castings.
    for sx in (-1, 1):
        for sy in (-1, 1):
            paint_parts.append(k.box(f'post{sx}{sy}', (0.14, 0.14, H - 0.2), (sx * (L / 2 - 0.07), sy * (W / 2 - 0.07), H / 2), paint, 0.01, 1))
            for z in (0.08, H - 0.08):
                hw.append(k.box(f'casting{sx}{sy}{z}', (0.18, 0.16, 0.12), (sx * (L / 2 - 0.09), sy * (W / 2 - 0.08), z), steel, 0.01, 1))
                hw.append(k.box(f'hole{sx}{sy}{z}', (0.1, 0.004, 0.05), (sx * (L / 2 - 0.09), sy * (W / 2 + 0.002), z), k.material('hole', '#1E2124', 0, 0.9)))
        for z in (0.08, H - 0.08):
            paint_parts.append(k.box(f'rail{sx}{z}', (L - 0.36, 0.12, 0.12), (0, sx * (W / 2 - 0.06), z), paint, 0.01, 1))
    paint_parts.append(k.box('bottomEnd', (0.12, W - 0.3, 0.16), (L / 2 - 0.08, 0, 0.12), paint, 0.01, 1))
    # Door end: two leaves, four locking bars with cam keepers and handles, hinges.
    paint_parts.append(k.box('doorL', (0.04, W / 2 - 0.16, H - 0.36), (L / 2 - 0.03, -W / 4 + 0.02, H / 2), paint, 0.01, 1))
    paint_parts.append(k.box('doorR', (0.04, W / 2 - 0.16, H - 0.36), (L / 2 - 0.03, W / 4 - 0.02, H / 2), paint, 0.01, 1))
    for i in range(4):
        paint_parts.append(k.box(f'doorrib{i}', (0.025, 0.06, H - 0.45), (L / 2 - 0.0, (-0.8 + i * 0.53), H / 2), paint))
    for y in (-0.92, -0.42, 0.42, 0.92):
        hw.append(k.cylinder(f'bar{y}', 0.022, H - 0.3, (L / 2 + 0.03, y, H / 2), steel, 'Z', 10))
        for z in (0.24, H - 0.24):
            hw.append(k.box(f'keeper{y}{z}', (0.06, 0.08, 0.08), (L / 2 + 0.03, y, z), steel, 0.01, 1))
        hw.append(k.box(f'handle{y}', (0.04, 0.03, 0.42), (L / 2 + 0.06, y + (0.07 if y > 0 else -0.07), 1.0), steel, 0.01, 1))
    for sy in (-1, 1):
        for z in (0.5, 1.3, 2.1):
            hw.append(k.box(f'hinge{sy}{z}', (0.07, 0.06, 0.12), (L / 2 + 0.01, sy * (W / 2 - 0.12), z), steel, 0.01, 1))
    hw.append(k.box('plateCSC', (0.003, 0.3, 0.2), (L / 2 + 0.025, -0.5, 1.6), k.material('csc', '#C9CCC8', 0.4, 0.5)))
    k.export(os.path.join(OUT, 'container.glb'), [k.finalize(paint_parts, 'container_paint', 25), k.finalize(hw, 'container_hardware', 25)])


# ---------------------------------------------------------------- pallet racking
def rack():
    k.reset()
    blue = k.material('rack_upright', '#2E4C69', 0.55, 0.45)
    orange = k.material('rack_beam', '#C46A2E', 0.35, 0.45)
    dark = k.material('rack_dark', '#2A2E33', 0.4, 0.6)
    H, D = 4.8, 1.1
    frame = []
    for y in (-D / 2, D / 2):
        frame.append(k.box(f'post{y}', (0.09, 0.075, H), (0, y, H / 2), blue, 0.004, 1))
        # Teardrop perforations on the aisle face.
        for i in range(40):
            frame.append(k.box(f'perf{y}{i}', (0.092, 0.012, 0.03), (0, y, 0.25 + i * 0.11), dark))
        frame.append(k.box(f'foot{y}', (0.18, 0.15, 0.012), (0, y, 0.006), dark))
    for z in (0.18, H - 0.12):
        frame.append(k.box(f'h{z}', (0.04, D, 0.035), (0, 0, z), blue))
    z, up = 0.2, True
    while z < H - 0.6:
        z2 = z + 0.7
        a, b = (-D / 2, z), (D / 2, z2)
        if not up:
            a, b = (D / 2, z), (-D / 2, z2)
        dy, dz = b[0] - a[0], b[1] - a[1]
        ang = math.atan2(dz, dy)
        frame.append(k.box(f'diag{z}', (0.03, math.hypot(dy, dz), 0.03), (0, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2), blue, rot=(ang, 0, 0)))
        z, up = z2, not up
    beam = [k.box('beam', (2.8, 0.05, 0.12), (0, 0, 0.06), orange, 0.006, 1)]
    for s in (-1, 1):
        beam.append(k.box(f'connector{s}', (0.05, 0.06, 0.18), (s * 1.375, 0, 0.07), dark, 0.004, 1))
        beam.append(k.box(f'lock{s}', (0.015, 0.065, 0.02), (s * 1.36, 0, 0.17), k.material('lockpin', '#D9D2C2', 0.6, 0.4)))
    k.export(os.path.join(OUT, 'rack.glb'), [k.finalize(frame, 'rack_frame', 30), k.finalize(beam, 'rack_beam', 30)])


# ---------------------------------------------------------------- street furniture
def street_lamp():
    k.reset()
    steel = k.material('lamp_steel', '#59616A', 0.7, 0.38)
    dark = k.material('lamp_dark', '#2B3036', 0.5, 0.5)
    led = k.material('lamp_led', '#FFF1D6', 0, 0.3, 1.2)
    parts = [k.cylinder('base', 0.13, 0.5, (0, 0, 0.25), dark, 'Z', 20, bev=0.01)]
    parts.append(k.cylinder('pole', 0.045, 4.4, (0, 0, 2.7), steel, 'Z', 16, r2=0.065))
    parts.append(k.tube('arm', [(0, 0, 4.85), (0.08, 0, 5.02), (0.45, 0, 5.08), (1.0, 0, 5.06)], 0.035, steel))
    parts.append(k.box('head', (0.62, 0.24, 0.07), (1.12, 0, 5.04), dark, 0.025, 2))
    parts.append(k.box('ledpanel', (0.5, 0.18, 0.01), (1.12, 0, 4.998), led))
    parts.append(k.box('door', (0.06, 0.012, 0.22), (0, -0.13, 0.25), steel))
    k.export(os.path.join(OUT, 'street_lamp.glb'), [k.finalize(parts, 'street_lamp', 30)])


def bench():
    k.reset()
    timber = k.material('bench_timber', '#9C7A55', 0, 0.75)
    frame = k.material('bench_frame', '#3A4047', 0.6, 0.45)
    parts = []
    for i in range(6):
        parts.append(k.box(f'seat{i}', (1.8, 0.065, 0.04), (0, -0.2 + i * 0.075, 0.45), timber, 0.006, 1))
    for i in range(4):
        parts.append(k.box(f'back{i}', (1.8, 0.04, 0.07), (0, 0.27 + i * 0.012, 0.55 + i * 0.1), timber, 0.006, 1, rot=(math.radians(-12), 0, 0)))
    for x in (-0.75, 0.75):
        parts.append(k.prism(f'leg{x}', [(-0.24, 0), (-0.2, 0.43), (0.27, 0.43), (0.36, 0.9), (0.31, 0.9), (0.22, 0.47), (0.2, 0), (0.12, 0), (0.12, 0.38), (-0.14, 0.38), (-0.16, 0)], x - 0.025, x + 0.025, frame, 0.006, 1))
    k.export(os.path.join(OUT, 'bench.glb'), [k.finalize(parts, 'bench', 30)])


def bollard():
    k.reset()
    steel = k.material('bollard_steel', '#9AA3AB', 0.85, 0.3)
    band = k.material('bollard_band', '#E9E6DC', 0.1, 0.35)
    parts = [k.cylinder('body', 0.07, 0.9, (0, 0, 0.45), steel, 'Z', 20, bev=0.01)]
    parts.append(k.lathe_x('cap', [(0.07, 0), (0.06, 0.03), (0.0001, 0.045)], steel, 20))
    parts[-1].rotation_euler = (0, -math.pi / 2, 0)
    parts[-1].location = (0, 0, 0.9)
    for z in (0.72, 0.78):
        parts.append(k.cylinder(f'band{z}', 0.0715, 0.03, (0, 0, z), band, 'Z', 20))
    parts.append(k.cylinder('plate', 0.12, 0.012, (0, 0, 0.006), steel, 'Z', 20))
    k.export(os.path.join(OUT, 'bollard.glb'), [k.finalize(parts, 'bollard', 30)])


pallet()
carton()
container()
rack()
street_lamp()
bench()
bollard()
