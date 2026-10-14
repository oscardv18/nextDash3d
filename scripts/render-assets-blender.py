"""Offline CPU ray tracing of source geometry. This is NOT a browser screenshot.
Run: ALSOFT_DRIVERS=null blender -b -t 4 --python scripts/render-assets-blender.py
Produces isolated assets to inspect silhouettes, gaps and contact; no WebGL textures.
"""
import bpy, json, gzip, math, os
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs'/'aggressive-comparison'
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=16
scene.cycles.use_denoising=True
scene.render.resolution_x=360;scene.render.resolution_y=360;scene.render.resolution_percentage=100
scene.world.color=(.24,.24,.24)
scene.view_settings.view_transform='AgX'
scene.render.image_settings.file_format='PNG'
mat=bpy.data.materials.new('Source vertex colors / matte studio');mat.use_nodes=True
nodes=mat.node_tree.nodes;shader=nodes.get('Principled BSDF')
attr=nodes.new('ShaderNodeVertexColor');attr.layer_name='source_color'
mat.node_tree.links.new(attr.outputs['Color'],shader.inputs['Base Color'])
shader.inputs['Roughness'].default_value=.62
bpy.ops.mesh.primitive_plane_add(size=200)
floor=bpy.context.object
fm=bpy.data.materials.new('Neutral floor');fm.diffuse_color=(.19,.22,.24,1);floor.data.materials.append(fm)
bpy.ops.object.camera_add(location=(2.8,-4.8,2.6))
cam=bpy.context.object;cam.data.type='ORTHO';scene.camera=cam
for loc,power,size in [((3,-4,7),700,5),((-4,-1,4),450,4),((1,4,5),600,3)]:
 bpy.ops.object.light_add(type='AREA',location=loc)
 light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=size
 light.rotation_euler=(Vector((0,0,.5))-light.location).to_track_quat('-Z','Y').to_euler()

def make(source,key,offset=(0,0,0),tint=(1,1,1)):
 if key not in source['assets']:return None
 g=source['geometries'][source['assets'][key]];ps=g['position'];ns=g['normal'];cs=g.get('color')
 vertices=[(ps[i]+offset[0],-ps[i+2]-offset[2],ps[i+1]+offset[1]) for i in range(0,len(ps),3)]
 ix=g.get('index') or list(range(len(vertices)))
 mesh=bpy.data.meshes.new(key);mesh.from_pydata(vertices,[],[ix[i:i+3] for i in range(0,len(ix),3)]);mesh.update()
 colors=mesh.color_attributes.new(name='source_color',type='FLOAT_COLOR',domain='POINT')
 for i,c in enumerate(colors.data):c.color=tuple((cs[i*3+j] if cs else 1)*tint[j] for j in range(3))+(1,)
 for poly in mesh.polygons:poly.use_smooth=True
 if hasattr(mesh,'normals_split_custom_set_from_vertices'):
  mesh.normals_split_custom_set_from_vertices([(ns[i],-ns[i+2],ns[i+1]) for i in range(0,len(ns),3)])
 obj=bpy.data.objects.new(key,mesh);scene.collection.objects.link(obj);mesh.materials.append(mat)
 return obj

names=['tree0','tree1','tree2','tree3','tree4','tree5','personBody','personBlazer','personVest','personCoat','personCardigan','personCoveralls','truck','forklift','logistics','urban']
for version,path in [('before','/tmp/arxnet-aggressive-before-preview.json.gz'),('after','/tmp/arxnet-after-preview.json.gz')]:
 if not Path(path).exists():
  print('Skipping unavailable snapshot:',path,flush=True);continue
 with gzip.open(path,'rt') as f:source=json.load(f)
 for name in names:
  if os.environ.get('ARXNET_PREVIEW_ASSET') and name != os.environ['ARXNET_PREVIEW_ASSET']: continue
  if version=='before' and name.startswith(('tree','person')) and name not in source['assets']: continue
  if version=='before' and (OUT/f'{version}-{name}.png').exists(): continue
  objects=[]
  def add(*args,**kwargs):
   obj=make(source,*args,**kwargs)
   if obj:objects.append(obj)
  target=(0,0,.65);scale=2.1
  if name.startswith('tree'):
   add(name,tint=(.22,.34,.20));add('trunk',tint=(.26,.18,.12))
  elif name.startswith('person'):
   add(name,tint=(.18,.24,.27));add('personSkin')
   if name in ['personVest','personCoveralls']:add('helmet')
   for side in [-1,1]:
    x=side*(.072 if version=='after' else .086)
    add('arm',(x,.379 if version=='after' else .385,0),(.18,.24,.27))
    if version=='after':add('forearm',(x,.284,0),(.18,.24,.27));add('hand',(x,.284,0));add('shin',(side*.045,.112,0))
    else:add('hand',(x,.385,0))
    add('leg',(side*.045,.212,0))
   target=(0,0,.26);scale=.65
  elif name=='truck':
   add('cabStatic',(0,0,.74));add('trailerStatic');target=(0,-.2,.28);scale=1.9
  elif name=='forklift':
   add('forkBody');add('forkMast');add('forkCar',(0,.10,0));target=(0,0,.38);scale=1.0
  elif name=='logistics':
   add('pallet');add('carton',(0,.094,0));objects[-1].scale=(.35,.19,.30)
   # offsets above are source coordinates, so scaling geometry would scale offset.
   objects[-1].location.z=.094*(1-.19)
   target=(0,0,.13);scale=.65
  else:
   add('bench');add('lamp',(.38,0,0));add('wayfinding',(-.36,0,0));target=(0,0,.43);scale=1.35
  cam.data.ortho_scale=scale
  cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
  scene.render.filepath=str(OUT/f'{version}-{name}.png')
  bpy.ops.render.render(write_still=True)
  for obj in objects:
   mesh=obj.data;bpy.data.objects.remove(obj,do_unlink=True);bpy.data.meshes.remove(mesh)
print('Saved CPU asset previews:',OUT,flush=True)
os._exit(0)
