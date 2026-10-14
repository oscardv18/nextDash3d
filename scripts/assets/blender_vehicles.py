"""Model Arxnet vehicles in Blender (own work) and export GLB.

  blender -b --factory-startup --python scripts/assets/blender_vehicles.py -- <out_dir>

Outputs (metres, glTF +Z forward):
  vehicle_truck.glb : truck_body, livery, wheel, wheel_0..3 empties
  vehicle_van.glb   : van_body, livery, wheel, wheel_0..3 empties
  forklift.glb      : forklift_body, forklift_mast, forklift_carriage
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import blender_kit as k  # noqa: E402

OUT = sys.argv[sys.argv.index('--') + 1]


def mats():
    return dict(
        paint=k.material('paint', '#F1F2F0', 0.15, 0.32),
        graphite=k.material('paint_graphite', '#4A525B', 0.35, 0.35),
        boxpaint=k.material('box_alu', '#E3E7E8', 0.35, 0.42),
        glass=k.material('glass', '#18232C', 0.6, 0.06),
        plastic=k.material('plastic_dark', '#2B2F34', 0.0, 0.7),
        chrome=k.material('chrome', '#CDD3D8', 0.95, 0.18),
        rubber=k.material('rubber', '#1C1D1F', 0.0, 0.92),
        alu=k.material('aluminium', '#B5BCC2', 0.85, 0.33),
        steel=k.material('steel_dark', '#3B4148', 0.6, 0.45),
        white_light=k.material('light_white', '#FFF4DC', 0.0, 0.2, 0.8),
        red_light=k.material('light_red', '#C42A24', 0.0, 0.25, 0.6),
        amber_light=k.material('light_amber', '#E89B2C', 0.0, 0.25, 0.5),
        livery=k.material('livery', '#FFFFFF', 0.1, 0.4),
        rim=k.material('rim', '#D5D9DC', 0.9, 0.25),
    )


def arch_cutter(name, y, z, r, half_width):
    # Faces created by the cut inherit this material: dark plastic wheel-arch liner.
    return k.cylinder(name, r, half_width * 2 + 0.4, (0, y, z), k.material('plastic_dark', '#2B2F34', 0.0, 0.7), 'X', 40)


def boolean_cut(target, cutters):
    for c in cutters:
        m = target.modifiers.new('cut_' + c.name, 'BOOLEAN')
        m.operation = 'DIFFERENCE'
        m.solver = 'EXACT'
        m.object = c
    # Booleans before bevel so arches get rounded edges too.
    order = [m for m in target.modifiers if m.type == 'BOOLEAN'] + [m for m in target.modifiers if m.type != 'BOOLEAN']
    for i, m in enumerate(order):
        with bpy.context.temp_override(object=target):
            bpy.ops.object.modifier_move_to_index(modifier=m.name, index=i)
    return target


def arch_trim(name, y, z, r_in, r_out, x0, x1, mat, a0=0.0, a1=math.pi):
    pts = [(y + math.cos(a0 + (a1 - a0) * i / 16) * r_out, z + math.sin(a0 + (a1 - a0) * i / 16) * r_out) for i in range(17)]
    pts += [(y + math.cos(a1 - (a1 - a0) * i / 16) * r_in, z + math.sin(a1 - (a1 - a0) * i / 16) * r_in) for i in range(17)]
    return k.prism(name, pts, x0, x1, mat, 0.008, 1)


def mirrored(fn):
    out = []
    for s in (-1, 1):
        out += fn(s)
    return out


# ---------------------------------------------------------------- box truck
def truck():
    k.reset()
    M = mats()
    parts = []
    R, FY, RY, WX = 0.48, -2.45, 2.1, 0.98
    cab_profile = [(-1.62, 0.62), (-3.42, 0.62), (-3.5, 0.95), (-3.5, 1.55), (-3.33, 2.6), (-3.06, 2.8), (-1.76, 2.82), (-1.62, 2.7)]
    cab = k.prism('cab', cab_profile, -1.16, 1.16, M['paint'], 0.07, 3)
    cutters = [arch_cutter('cutF', FY, R, 0.57, 1.2)]
    boolean_cut(cab, cutters)
    parts.append(cab)
    # Roof air deflector up to the cargo box height.
    parts.append(k.prism('deflector', [(-3.0, 2.8), (-1.76, 3.52), (-1.7, 3.52), (-1.7, 2.8)], -1.06, 1.06, M['paint'], 0.04, 2))
    # Windscreen on the raked plane, wipers below it.
    ax, az, bx, bz = -3.505, 1.62, -3.335, 2.56
    dy, dz = bx - ax, bz - az
    ln = math.hypot(dy, dz)
    ny, nz = -dz / ln * 0.006, dy / ln * 0.006
    parts.append(k.quad('windscreen', [(-1.03, ax + ny, az + nz), (1.03, ax + ny, az + nz), (1.03, bx + ny, bz + nz), (-1.03, bx + ny, bz + nz)], M['glass']))
    for x in (-0.45, 0.35):
        parts.append(k.box(f'wiper{x}', (0.62, 0.02, 0.018), (x, -3.52, 1.66), M['plastic'], rot=(0, 0.25, 0)))
    for s in (-1, 1):
        xs = s * 1.166
        parts.append(k.plate_yz(f'sidewin{s}', [(-3.3, 1.62), (-3.17, 2.47), (-2.15, 2.55), (-2.15, 1.62)], xs if s > 0 else xs - 0.008, M['glass'], 0.008))
        parts.append(k.box(f'doorseam{s}', (0.012, 0.014, 1.95), (s * 1.168, -2.06, 1.66), M['plastic']))
        parts.append(k.box(f'doorseamlow{s}', (0.012, 1.2, 0.014), (s * 1.168, -2.66, 0.72), M['plastic']))
        parts.append(k.box(f'handle{s}', (0.03, 0.17, 0.035), (s * 1.18, -2.28, 1.42), M['chrome'], 0.01, 1))
        for i, z in enumerate((0.47, 0.23)):
            parts.append(k.box(f'step{s}{i}', (0.3, 0.42, 0.045), (s * 1.0, -2.62, z), M['steel'], 0.01, 1))
        parts.append(k.box(f'stepbracket{s}', (0.04, 0.42, 0.3), (s * 1.12, -2.62, 0.38), M['plastic']))
        # Mirror on a swept arm.
        parts.append(k.tube(f'mirrorarm{s}', [(s * 1.15, -3.05, 2.25), (s * 1.33, -3.12, 2.32), (s * 1.42, -3.12, 2.18)], 0.018, M['plastic']))
        parts.append(k.box(f'mirror{s}', (0.075, 0.2, 0.42), (s * 1.45, -3.12, 1.96), M['plastic'], 0.025, 2))
        parts.append(k.box(f'mirrorglass{s}', (0.06, 0.012, 0.36), (s * 1.45, -3.008, 1.96), M['glass']))
        # Front fender trim around the cut arch.
        parts.append(arch_trim(f'fenderF{s}', FY, R, 0.57, 0.62, s * 0.86 if s > 0 else -1.2, s * 1.2 if s > 0 else -0.86, M['plastic']))
        # Headlights, indicators, fog lamps.
        parts.append(k.box(f'headlight{s}', (0.34, 0.035, 0.17), (s * 0.86, -3.515, 0.96), M['white_light'], 0.02, 2))
        parts.append(k.box(f'headbezel{s}', (0.38, 0.03, 0.21), (s * 0.86, -3.505, 0.96), M['chrome'], 0.02, 2))
        parts.append(k.box(f'indicator{s}', (0.1, 0.035, 0.1), (s * 1.08, -3.51, 0.96), M['amber_light'], 0.015, 1))
        parts.append(k.box(f'fog{s}', (0.16, 0.03, 0.07), (s * 0.82, -3.66, 0.46), M['white_light'], 0.01, 1))
    # Grille with chrome slats and a badge.
    parts.append(k.box('grille', (1.4, 0.03, 0.6), (0, -3.505, 1.1), M['plastic'], 0.02, 2))
    for i in range(5):
        parts.append(k.box(f'slat{i}', (1.36, 0.02, 0.03), (0, -3.525, 0.86 + i * 0.12), M['chrome']))
    parts.append(k.box('badge', (0.22, 0.02, 0.06), (0, -3.535, 1.46), M['chrome'], 0.01, 1))
    parts.append(k.box('bumper', (2.38, 0.26, 0.3), (0, -3.55, 0.5), M['plastic'], 0.05, 3))
    parts.append(k.box('plate', (0.5, 0.01, 0.11), (0, -3.685, 0.5), M['paint']))
    for x in (-0.3, 0.0, 0.3):
        parts.append(k.box(f'roofmarker{x}', (0.12, 0.05, 0.035), (x, -3.04, 2.83), M['amber_light'], 0.01, 1))

    # Chassis, fuel tank, battery box, side guards.
    for s in (-1, 1):
        parts.append(k.box(f'rail{s}', (0.12, 6.3, 0.24), (s * 0.48, 0.25, 0.74), M['steel'], 0.01, 1))
    parts.append(k.cylinder('tank', 0.26, 1.0, (-0.98, -0.95, 0.66), M['alu'], 'Y', 24, bev=0.02))
    for y in (-1.28, -0.62):
        parts.append(k.cylinder(f'strap{y}', 0.268, 0.035, (-0.98, y, 0.66), M['steel'], 'Y', 24))
    parts.append(k.box('battery', (0.34, 0.7, 0.46), (1.0, -0.9, 0.66), M['plastic'], 0.03, 2))
    for s in (-1, 1):
        for z in (0.56, 0.8):
            parts.append(k.box(f'guard{s}{z}', (0.04, 2.9, 0.07), (s * 1.18, 0.05, z), M['alu'], 0.012, 1))
        for y in (-1.2, 0.0, 1.2):
            parts.append(k.box(f'guardpost{s}{y}', (0.05, 0.05, 0.36), (s * 1.12, y, 0.7), M['steel']))

    # Cargo box: aluminium body, ribs, rails, corner posts, rub rail.
    box_y0, box_y1, box_z0, box_z1 = -1.55, 3.45, 1.05, 3.6
    cy, cz = (box_y0 + box_y1) / 2, (box_z0 + box_z1) / 2
    parts.append(k.box('cargo', (2.48, box_y1 - box_y0, box_z1 - box_z0), (0, cy, cz), M['boxpaint'], 0.03, 2))
    parts.append(k.box('floorbeam', (2.5, box_y1 - box_y0, 0.12), (0, cy, box_z0 - 0.04), M['steel'], 0.01, 1))
    for s in (-1, 1):
        for y in [box_y0 + 0.5 + i * 0.55 for i in range(9)]:
            parts.append(k.box(f'rib{s}{y}', (0.02, 0.05, box_z1 - box_z0 - 0.12), (s * 1.247, y, cz), M['alu']))
        parts.append(k.box(f'toprail{s}', (0.06, box_y1 - box_y0, 0.08), (s * 1.24, cy, box_z1 - 0.02), M['alu'], 0.01, 1))
        parts.append(k.box(f'rubrail{s}', (0.06, box_y1 - box_y0, 0.1), (s * 1.24, cy, box_z0 + 0.06), M['steel'], 0.01, 1))
        for y in (box_y0, box_y1):
            parts.append(k.box(f'post{s}{y}', (0.08, 0.08, box_z1 - box_z0 + 0.04), (s * 1.235, y, cz), M['alu'], 0.012, 1))
        for y in (-1.0, 0.8, 2.6):
            parts.append(k.box(f'marker{s}{y}', (0.03, 0.08, 0.05), (s * 1.27, y, box_z0 + 0.12), M['amber_light'], 0.01, 1))
        # Rear fender arcs and mudflaps.
        parts.append(arch_trim(f'fenderR{s}', RY, R, 0.55, 0.6, s * 0.82 if s > 0 else -1.15, s * 1.15 if s > 0 else -0.82, M['plastic'], 0.35, math.pi - 0.35))
        parts.append(k.box(f'mudflap{s}', (0.36, 0.015, 0.42), (s * 0.98, RY + 0.66, 0.42), M['rubber']))
    # Rear doors: seam, hinges, lock rods with cam keepers and handles.
    parts.append(k.box('doorseamR', (0.02, 0.02, box_z1 - box_z0 - 0.1), (0, box_y1 + 0.012, cz), M['plastic']))
    for x in (-0.92, -0.32, 0.32, 0.92):
        parts.append(k.cylinder(f'lockrod{x}', 0.016, box_z1 - box_z0 - 0.15, (x, box_y1 + 0.03, cz), M['chrome'], 'Z', 10))
        for z in (box_z0 + 0.1, box_z1 - 0.1):
            parts.append(k.box(f'keeper{x}{z}', (0.07, 0.04, 0.06), (x, box_y1 + 0.025, z), M['steel'], 0.008, 1))
        parts.append(k.box(f'lockhandle{x}', (0.035, 0.03, 0.3), (x + (0.07 if x > 0 else -0.07), box_y1 + 0.05, cz - 0.3), M['chrome'], 0.008, 1))
    for s in (-1, 1):
        for z in (1.5, 2.15, 2.8, 3.35):
            parts.append(k.box(f'hinge{s}{z}', (0.08, 0.05, 0.13), (s * 1.19, box_y1 + 0.03, z), M['steel'], 0.01, 1))
    parts.append(k.box('rearbar', (2.2, 0.14, 0.16), (0, box_y1 + 0.03, 0.62), M['steel'], 0.02, 1))
    for s in (-1, 1):
        parts.append(k.box(f'tail{s}', (0.32, 0.035, 0.12), (s * 0.85, box_y1 + 0.11, 0.64), M['red_light'], 0.015, 1))
        parts.append(k.box(f'tailamber{s}', (0.12, 0.035, 0.12), (s * 0.55, box_y1 + 0.11, 0.64), M['amber_light'], 0.015, 1))
    body = k.finalize(parts, 'truck_body')
    for c in cutters:
        bpy.data.objects.remove(c, do_unlink=True)

    livery = k.finalize([k.box('band' + str(s), (0.006, 4.7, 0.5), (s * 1.262, cy + 0.05, 1.95), M['livery']) for s in (-1, 1)]
                        + [k.box('pin' + str(s), (0.006, 4.7, 0.05), (s * 1.262, cy + 0.05, 2.3), M['livery']) for s in (-1, 1)], 'livery')
    wheel = k.wheel('wheel', R, 0.32, 0.29, (M['rubber'], M['rim'], M['steel']), 6)
    empties = [k.empty(f'wheel_{i}', (s * WX, y, R)) for i, (s, y) in enumerate([(-1, FY), (1, FY), (-1, RY), (1, RY)])]
    k.export(os.path.join(OUT, 'vehicle_truck.glb'), [body, livery, wheel] + empties)


# ---------------------------------------------------------------- van
def van():
    k.reset()
    M = mats()
    parts = []
    R, FY, RY, WX = 0.36, -1.95, 1.95, 0.86
    profile = [(-2.92, 0.42), (-3.0, 0.68), (-2.98, 0.98), (-2.74, 1.2), (-2.32, 1.33), (-1.78, 2.2), (-1.48, 2.5), (2.84, 2.54), (2.95, 2.44), (2.96, 0.42)]
    shell = k.prism('shell', profile, -1.0, 1.0, M['paint'], 0.09, 3)
    cutters = [arch_cutter('cutF', FY, R, 0.43, 1.0), arch_cutter('cutR', RY, R, 0.43, 1.0)]
    boolean_cut(shell, cutters)
    parts.append(shell)
    ax, az, bx, bz = -2.33, 1.38, -1.8, 2.18
    dy, dz = bx - ax, bz - az
    ln = math.hypot(dy, dz)
    ny, nz = -dz / ln * 0.008, dy / ln * 0.008
    parts.append(k.quad('windscreen', [(-0.9, ax + ny, az + nz), (0.9, ax + ny, az + nz), (0.88, bx + ny, bz + nz), (-0.88, bx + ny, bz + nz)], M['glass']))
    for s in (-1, 1):
        xs = s * 1.003
        parts.append(k.plate_yz(f'sidewin{s}', [(-2.22, 1.45), (-1.77, 2.15), (-0.98, 2.2), (-0.98, 1.45)], xs if s > 0 else xs - 0.008, M['glass'], 0.008))
        for y, h in ((-0.95, 1.75), (0.55, 1.75), (2.85, 1.8)):
            parts.append(k.box(f'seam{s}{y}', (0.012, 0.014, h), (s * 1.004, y, 0.5 + h / 2), M['plastic']))
        parts.append(k.box(f'slidetrack{s}', (0.014, 1.6, 0.03), (s * 1.004, -0.2, 2.05), M['plastic']))
        parts.append(k.box(f'handleF{s}', (0.03, 0.14, 0.03), (s * 1.015, -1.12, 1.35), M['plastic'], 0.01, 1))
        parts.append(k.box(f'handleS{s}', (0.03, 0.14, 0.03), (s * 1.015, 0.38, 1.35), M['plastic'], 0.01, 1))
        parts.append(k.box(f'skirt{s}', (0.03, 3.1, 0.12), (s * 1.0, 0.0, 0.48), M['plastic'], 0.01, 1))
        parts.append(arch_trim(f'archF{s}', FY, R, 0.43, 0.47, s * 0.82 if s > 0 else -1.03, s * 1.03 if s > 0 else -0.82, M['plastic']))
        parts.append(arch_trim(f'archR{s}', RY, R, 0.43, 0.47, s * 0.82 if s > 0 else -1.03, s * 1.03 if s > 0 else -0.82, M['plastic']))
        parts.append(k.tube(f'mirrorarm{s}', [(s * 0.98, -1.85, 1.62), (s * 1.12, -1.9, 1.66), (s * 1.18, -1.92, 1.6)], 0.014, M['plastic']))
        parts.append(k.box(f'mirror{s}', (0.06, 0.16, 0.28), (s * 1.2, -1.92, 1.48), M['plastic'], 0.02, 2))
        parts.append(k.box(f'headlight{s}', (0.32, 0.12, 0.13), (s * 0.68, -2.92, 1.02), M['white_light'], 0.03, 2))
        parts.append(k.box(f'tail{s}', (0.07, 0.04, 0.5), (s * 0.93, 2.965, 1.05), M['red_light'], 0.01, 1))
        parts.append(k.box(f'rearseam{s}', (0.012, 0.014, 1.9), (0.0, 2.968, 1.45), M['plastic']))
        parts.append(k.box(f'rearhandle{s}', (0.12, 0.03, 0.03), (s * 0.1, 2.98, 1.35), M['plastic'], 0.01, 1))
    parts.append(k.box('grille', (1.0, 0.04, 0.3), (0, -3.0, 0.88), M['plastic'], 0.03, 2))
    for i in range(3):
        parts.append(k.box(f'slat{i}', (0.96, 0.02, 0.025), (0, -3.022, 0.8 + i * 0.08), M['chrome']))
    parts.append(k.box('bumperF', (2.0, 0.24, 0.24), (0, -2.98, 0.52), M['plastic'], 0.05, 3))
    parts.append(k.box('bumperR', (2.0, 0.16, 0.2), (0, 2.98, 0.52), M['plastic'], 0.04, 3))
    parts.append(k.box('plate', (0.5, 0.01, 0.11), (0, -3.105, 0.52), M['paint']))
    parts.append(k.box('rearwindow', (1.2, 0.01, 0.42), (0, 2.965, 2.0), M['glass']))
    body = k.finalize(parts, 'van_body')
    for c in cutters:
        bpy.data.objects.remove(c, do_unlink=True)
    livery = k.finalize([k.box('band' + str(s), (0.006, 2.8, 0.18), (s * 1.012, 1.0, 1.0), M['livery']) for s in (-1, 1)], 'livery')
    wheel = k.wheel('wheel', R, 0.24, 0.22, (M['rubber'], M['rim'], M['steel']), 5)
    empties = [k.empty(f'wheel_{i}', (s * WX, y, R)) for i, (s, y) in enumerate([(-1, FY), (1, FY), (-1, RY), (1, RY)])]
    k.export(os.path.join(OUT, 'vehicle_van.glb'), [body, livery, wheel] + empties)


# ---------------------------------------------------------------- forklift
def forklift():
    k.reset()
    M = mats()
    paint = k.material('fork_paint', '#D29A2C', 0.2, 0.45)
    parts = []
    parts.append(k.box('chassis', (1.0, 1.8, 0.42), (0, 0.15, 0.42), paint, 0.06, 3))
    parts.append(k.prism('counterweight', [(0.7, 0.2), (1.12, 0.22), (1.22, 0.55), (1.15, 1.02), (0.7, 1.08)], -0.52, 0.52, M['steel'], 0.08, 3))
    parts.append(k.box('hood', (0.9, 0.85, 0.32), (0, 0.42, 0.78), paint, 0.06, 3))
    parts.append(k.box('seat', (0.46, 0.44, 0.12), (0, 0.35, 1.0), M['plastic'], 0.04, 2))
    parts.append(k.box('backrest', (0.46, 0.1, 0.42), (0, 0.6, 1.22), M['plastic'], 0.04, 2))
    parts.append(k.box('dash', (0.8, 0.22, 0.32), (0, -0.48, 0.82), paint, 0.05, 3))
    parts.append(k.cylinder('column', 0.03, 0.5, (0, -0.38, 1.1), M['steel'], 'Y', 10))
    parts.append(k.lathe_x('steerwheel', [(0.16, -0.015), (0.18, 0.0), (0.16, 0.015), (0.14, 0.0)], M['plastic'], 24))
    parts[-1].location = (0, -0.18, 1.2)
    parts[-1].rotation_euler = (0, math.radians(90), math.radians(90))
    parts[-1].rotation_euler = (math.radians(-35), 0, math.radians(90))
    # Overhead guard: four posts and a slatted roof.
    for x in (-0.46, 0.46):
        parts.append(k.tube(f'postF{x}', [(x, -0.45, 0.95), (x, -0.52, 2.08)], 0.035, M['steel']))
        parts.append(k.tube(f'postR{x}', [(x, 0.75, 0.95), (x, 0.7, 2.08)], 0.035, M['steel']))
    parts.append(k.box('roofframe', (1.0, 1.32, 0.06), (0, 0.1, 2.1), M['steel'], 0.02, 1))
    for i in range(5):
        parts.append(k.box(f'roofslat{i}', (0.9, 0.06, 0.04), (0, -0.4 + i * 0.25, 2.13), M['steel']))
    parts.append(k.box('beacon', (0.08, 0.08, 0.07), (0.3, 0.6, 2.18), M['amber_light'], 0.02, 1))
    for s in (-1, 1):
        parts.append(k.box(f'lamp{s}', (0.12, 0.04, 0.08), (s * 0.42, -0.53, 1.9), M['white_light'], 0.01, 1))
        parts.append(k.box(f'step{s}', (0.12, 0.35, 0.04), (s * 0.52, -0.05, 0.32), M['steel'], 0.01, 1))
    for s, y, r, w in ((-1, -0.5, 0.32, 0.24), (1, -0.5, 0.32, 0.24), (-1, 0.82, 0.24, 0.2), (1, 0.82, 0.24, 0.2)):
        wl = k.wheel(f'w{s}{y}', r, w, r * 0.6, (M['rubber'], M['rim'], M['steel']), 5)
        wl.location = (s * 0.42, y, r)
        if s < 0:
            wl.rotation_euler = (0, 0, math.pi)
        parts.append(wl)
    body = k.finalize(parts, 'forklift_body')

    mast_parts = []
    for s in (-1, 1):
        mast_parts.append(k.box(f'upright{s}', (0.08, 0.13, 2.25), (s * 0.32, -0.98, 1.2), M['steel'], 0.01, 1))
        mast_parts.append(k.box(f'inner{s}', (0.06, 0.08, 2.1), (s * 0.25, -1.0, 1.2), M['steel'], 0.008, 1))
        mast_parts.append(k.tube(f'tilt{s}', [(s * 0.3, -0.55, 0.85), (s * 0.3, -0.9, 1.1)], 0.03, M['chrome']))
    for z in (0.15, 2.28):
        mast_parts.append(k.box(f'cross{z}', (0.72, 0.1, 0.08), (0, -0.98, z), M['steel'], 0.01, 1))
    mast_parts.append(k.cylinder('lift', 0.045, 1.9, (0, -0.95, 1.05), M['chrome'], 'Z', 12))
    mast_parts.append(k.cylinder('liftbody', 0.06, 0.9, (0, -0.95, 0.6), M['steel'], 'Z', 12))
    mast = k.finalize(mast_parts, 'forklift_mast')

    car = []
    car.append(k.box('plate', (0.9, 0.06, 0.4), (0, -1.08, 0.3), M['steel'], 0.015, 1))
    for i in range(4):
        car.append(k.box(f'backrest{i}', (0.035, 0.03, 0.6), (-0.33 + i * 0.22, -1.08, 0.75), M['steel']))
    car.append(k.box('backrest_top', (0.9, 0.03, 0.04), (0, -1.08, 1.05), M['steel']))
    for s in (-1, 1):
        car.append(k.box(f'forkv{s}', (0.11, 0.05, 0.45), (s * 0.25, -1.13, 0.28), M['steel'], 0.006, 1))
        car.append(k.box(f'forkh{s}', (0.11, 1.1, 0.045), (s * 0.25, -1.68, 0.06), M['steel'], 0.006, 1))
    carriage = k.finalize(car, 'forklift_carriage')
    k.export(os.path.join(OUT, 'forklift.glb'), [body, mast, carriage])


truck()
van()
forklift()
