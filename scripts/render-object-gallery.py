"""Inspect actual asset geometry. Uses the existing CPU renderer, not WebGL."""
import runpy
from pathlib import Path
from PIL import Image, ImageDraw
import numpy as np

namespace = runpy.run_path(str(Path(__file__).with_name('render-world-preview.py')))
source = namespace['sources'][1]
renderer = namespace['renderer']; model = namespace['model_mesh']; translation = namespace['translation']
font = namespace['font']; small = namespace['small']; out = namespace['OUT']
gallery = Image.new('RGB', (1440, 1110), '#151D25')
draw = ImageDraw.Draw(gallery)

for col, name in enumerate(['Copa lobulada', 'Copa extendida', 'Copa vertical', 'Copa asimétrica']):
    meshes = [model(source, f'tree{col}', color=(.24,.41,.25)), model(source, 'trunk', color=(.29,.20,.13))]
    picture = renderer(source, meshes, 360, 310, 155, target=(0,.9,0))
    gallery.paste(picture, (col*360,40))
    draw.text((col*360+14,10),name,font=font,fill='#E4E9EE')

for col, name in enumerate(['Camisa', 'Chaqueta', 'Uniforme', 'Banca']):
    if col < 3:
        body = ['personBody','personBlazer','personVest'][col]
        meshes = [model(source,body,color=(.10,.17,.23)),model(source,'personSkin')]
        if col==2: meshes.append(model(source,'helmet'))
        for side in [-1,1]:
            meshes += [model(source,'arm',translation(side*.086,.385,0),color=(.10,.17,.23)),model(source,'hand',translation(side*.086,.385,0)),model(source,'leg',translation(side*.045,.212,0))]
        target,scale=(0,.26,0),455
    else:
        meshes=[model(source,'bench')];target,scale=(0,.13,0),475
    picture=renderer(source,meshes,360,310,scale,target=target)
    gallery.paste(picture,(col*360,410))
    draw.text((col*360+14,380),name,font=font,fill='#E4E9EE')

for col,name in enumerate(['Camión','Pallet','Luminaria','Señalización']):
    if col==0:
        meshes=[model(source,'cabStatic',translation(z=.74)),model(source,'trailerStatic')];target,scale=(0,.25,.2),165
    else:
        key=['','pallet','lamp','wayfinding'][col]
        meshes=[model(source,key)]
        target,scale=[None,((0,.05,0),490),((0,.48,0),220),((0,.29,0),355)][col]
    picture=renderer(source,meshes,360,310,scale,target=target)
    gallery.paste(picture,(col*360,780))
    draw.text((col*360+14,750),name,font=font,fill='#E4E9EE')
draw.text((16,1094),'Geometrías reales · vista CPU con iluminación aproximada · sin texturas ni posprocesado WebGL',font=small,fill='#BCC9D1')
gallery.save(out/'object-gallery.png')
print(out/'object-gallery.png')
