"""Prepare Quaternius CC0 characters for Arxnet.

For each source character:
  * join every skinned part into a single mesh (one draw call per person),
  * bake each flat material colour into a vertex colour attribute,
  * smooth normals by angle so facets read as soft volumes,
  * normalise height to 1.75 m with feet on the ground,
  * keep only the clips the world uses (walk, idle, interact),
  * export a GLB with a single material.

Usage:
  blender -b --factory-startup --python scripts/assets/blender_people.py -- <src_dir> <out_dir>
"""
import bpy
import math
import os
import sys

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
CHARACTERS = ['business_man', 'worker', 'casual', 'woman_a', 'woman_b']
KEEP = {'Walk': 'walk', 'Idle_Neutral': 'idle', 'Interact': 'interact'}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material_colour(mat):
    if mat is None:
        return (0.8, 0.8, 0.8, 1.0)
    if mat.use_nodes:
        for node in mat.node_tree.nodes:
            if node.type == 'BSDF_PRINCIPLED':
                return tuple(node.inputs['Base Color'].default_value)
    return tuple(mat.diffuse_color)


for name in CHARACTERS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, name + '.glb'))
    armature = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    # Some source files carry stray, unskinned helper meshes: drop them.
    for obj in [o for o in meshes if not any(m.type == 'ARMATURE' for m in o.modifiers)]:
        bpy.data.objects.remove(obj, do_unlink=True)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']

    # Bake material colours into a per-corner colour attribute (linear values).
    for obj in meshes:
        mesh = obj.data
        attr = mesh.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        for poly in mesh.polygons:
            mat = obj.material_slots[poly.material_index].material if obj.material_slots else None
            r, g, b, a = material_colour(mat)
            for li in poly.loop_indices:
                attr.data[li].color = (r, g, b, 1.0)
        mesh.color_attributes.active_color = attr

    # Join all parts into one skinned mesh.
    bpy.ops.object.select_all(action='DESELECT')
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = name

    # One neutral material; the runtime supplies the PBR material.
    mat = bpy.data.materials.new('person')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    col = mat.node_tree.nodes.new('ShaderNodeVertexColor')
    col.layer_name = 'Col'
    mat.node_tree.links.new(col.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.8
    body.data.materials.clear()
    body.data.materials.append(mat)

    # Crowd budget: collapse ~45% of triangles (characters are small on screen).
    dec = body.modifiers.new('decimate', 'DECIMATE')
    dec.ratio = 0.55
    with bpy.context.temp_override(object=body):
        bpy.ops.object.modifier_move_to_index(modifier='decimate', index=0)
        bpy.ops.object.modifier_apply(modifier='decimate')

    # Soft shading: smooth faces below 50 degrees, keep crisp creases above.
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(50))

    # Normalise height to 1.75 m, feet at z = 0.
    bpy.context.view_layer.update()
    zs = [(body.matrix_world @ v.co).z for v in body.data.vertices]
    height = max(zs) - min(zs)
    s = 1.75 / height
    armature.scale = [c * s for c in armature.scale]
    bpy.context.view_layer.update()
    zs = [(body.matrix_world @ v.co).z for v in body.data.vertices]
    armature.location.z -= min(zs)

    # Keep only the clips Arxnet uses, renamed to stable short names.
    for action in list(bpy.data.actions):
        short = action.name.split('|')[-1]
        if short in KEEP:
            action.name = KEEP[short]
            action.use_fake_user = True
        else:
            bpy.data.actions.remove(action)
    if armature.animation_data:
        armature.animation_data.action = bpy.data.actions.get('idle')

    path = os.path.join(OUT, f'person_{name}.glb')
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_vertex_color='ACTIVE',
        export_all_vertex_colors=False,
        export_skins=True,
        export_morph=False,
        export_yup=True,
        export_apply=False,
        export_texcoords=False,
        export_materials='EXPORT',
    )
    print('EXPORTED', path, 'tris', sum(len(p.vertices) - 2 for p in body.data.polygons), 'height', round(height * s, 3))
