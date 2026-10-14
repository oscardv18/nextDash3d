"""Small modelling helpers shared by the Arxnet Blender asset scripts.

Conventions: metres, Z up, vehicles face -Y (exported glTF faces +Z).
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _lin(c):
    c = c / 255 if c > 1 else c
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip('#')
    return tuple(_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


def material(name, colour, metal=0.0, rough=0.5, emit=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*hexcol(colour), 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = (*hexcol(colour), 1)
        b.inputs['Emission Strength'].default_value = emit
    return m


def _link(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    me.materials.append(mat)
    return o


def bevel(o, width, segments=2, angle=40):
    if width <= 0:
        return o
    m = o.modifiers.new('bevel', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    m.harden_normals = True
    return o


def box(name, size, loc, mat, bev=0.0, segs=2, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    o = _link(name, bm, mat)
    o.location = loc
    o.rotation_euler = rot
    return bevel(o, bev, segs)


def prism(name, profile, x0, x1, mat, bev=0.0, segs=2):
    """Extrude a side profile [(y, z), ...] across X from x0 to x1."""
    bm = bmesh.new()
    vs = [bm.verts.new((x0, y, z)) for y, z in profile]
    face = bm.faces.new(vs)
    res = bmesh.ops.extrude_face_region(bm, geom=[face])
    moved = [e for e in res['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(x1 - x0, 0, 0), verts=moved)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bevel(_link(name, bm, mat), bev, segs)


def plate_xz(name, outline, y, mat, thickness=0.01):
    """Flat panel in the XZ plane (facing -Y/+Y) from an outline [(x, z), ...]."""
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, z)) for x, z in outline]
    face = bm.faces.new(vs)
    res = bmesh.ops.extrude_face_region(bm, geom=[face])
    bmesh.ops.translate(bm, vec=(0, thickness, 0), verts=[e for e in res['geom'] if isinstance(e, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _link(name, bm, mat)


def plate_yz(name, outline, x, mat, thickness=0.01):
    """Flat panel in the YZ plane (facing ±X) from an outline [(y, z), ...]."""
    return prism(name, outline, x, x + thickness, mat)


def quad(name, corners, mat, thickness=0.008):
    """Thin slab from four corner points (any orientation), offset along its normal."""
    bm = bmesh.new()
    vs = [bm.verts.new(c) for c in corners]
    face = bm.faces.new(vs)
    face.normal_update()
    res = bmesh.ops.extrude_face_region(bm, geom=[face])
    bmesh.ops.translate(bm, vec=face.normal * thickness, verts=[e for e in res['geom'] if isinstance(e, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _link(name, bm, mat)


def cylinder(name, r, depth, loc, mat, axis='X', segs=24, r2=None, bev=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    if axis == 'X':
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'))
    elif axis == 'Y':
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
    o = _link(name, bm, mat)
    o.location = loc
    return bevel(o, bev, 2, 30)


def lathe_x(name, profile, mat, segs=28):
    """Revolve a profile [(radius, x), ...] around the X axis (wheels, hubs)."""
    bm = bmesh.new()
    rings = []
    for r, x in profile:
        ring = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            ring.append(bm.verts.new((x, math.cos(a) * r, math.sin(a) * r)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if profile[0][0] > 1e-4:
        bm.faces.new(list(reversed(rings[0])))
    if profile[-1][0] > 1e-4:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _link(name, bm, mat)


def tube(name, points, radius, mat, segs=8):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    sp = cu.splines.new('POLY')
    sp.points.add(len(points) - 1)
    for p, c in zip(sp.points, points):
        p.co = (*c, 1)
    cu.bevel_depth = radius
    cu.bevel_resolution = max(1, segs // 4)
    cu.use_fill_caps = True
    o = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(o)
    cu.materials.append(mat)
    return o


def finalize(objects, name, smooth_angle=35):
    """Apply modifiers / convert curves, join into one object, smooth by angle."""
    meshes = []
    for o in objects:
        bpy.context.view_layer.objects.active = o
        with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o], selected_editable_objects=[o]):
            if o.type == 'CURVE':
                bpy.ops.object.convert(target='MESH')
            else:
                for m in list(o.modifiers):
                    bpy.ops.object.modifier_apply(modifier=m.name)
        meshes.append(bpy.context.view_layer.objects.active)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle))
    return joined


def empty(name, loc):
    o = bpy.data.objects.new(name, None)
    o.location = loc
    bpy.context.scene.collection.objects.link(o)
    return o


def export(path, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=True, export_texcoords=True, export_normals=True,
                              export_materials='EXPORT', export_animations=False)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objects if o.type == 'MESH')
    print('EXPORTED', path, 'tris', tris)


def wheel(name, r, width, rim_r, mats, spokes=6):
    """Tyre with rounded shoulders and tread sipes, dished rim with hub and lug nuts."""
    rubber, rim, hub = mats
    w = width / 2
    tyre = lathe_x(name + '_tyre', [
        (rim_r * 1.02, -w * 0.9), (r * 0.82, -w), (r * 0.96, -w * 0.92), (r, -w * 0.7),
        (r, w * 0.7), (r * 0.96, w * 0.92), (r * 0.82, w), (rim_r * 1.02, w * 0.9),
    ], rubber, segs=32)
    parts = [tyre]
    # Tread blocks: shallow grooves suggested with dark slabs across the crown.
    for i in range(16):
        a = 2 * math.pi * i / 16
        c, s = math.cos(a), math.sin(a)
        g = box(name + f'_groove{i}', (width * 0.62, 0.012, 0.01), (0, c * (r + 0.001), s * (r + 0.001)), rubber, rot=(a, 0, 0))
        parts.append(g)
    parts.append(lathe_x(name + '_rim', [(0.0001, w * 0.62), (rim_r * 0.35, w * 0.62), (rim_r * 0.55, w * 0.5), (rim_r * 0.92, w * 0.55), (rim_r * 1.03, w * 0.75), (rim_r * 1.03, -w * 0.6), (0.0001, -w * 0.6)], rim, segs=28))
    parts.append(cylinder(name + '_hub', rim_r * 0.28, 0.03, (w * 0.66, 0, 0), hub, 'X', 16))
    for i in range(spokes):
        a = 2 * math.pi * i / spokes
        parts.append(cylinder(name + f'_nut{i}', 0.018, 0.03, (w * 0.68, math.cos(a) * rim_r * 0.42, math.sin(a) * rim_r * 0.42), hub, 'X', 8))
        # Rim vents between spokes give the dish depth.
        b = a + math.pi / spokes
        parts.append(box(name + f'_vent{i}', (0.012, rim_r * 0.22, rim_r * 0.12), (w * 0.6, math.cos(b) * rim_r * 0.7, math.sin(b) * rim_r * 0.7), mats[0], rot=(b, 0, 0)))
    return finalize(parts, name, 40)
