"""Assemble the offline geometry renders, preserving their before/after labels."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[1];out=ROOT/'docs'/'aggressive-comparison'
font=ImageFont.truetype('/usr/share/fonts/TTF/DejaVuSans.ttf',19)
small=ImageFont.truetype('/usr/share/fonts/TTF/DejaVuSans.ttf',14)
comparisons=[('tree0','Vegetación: masa cerrada → ramas y follaje'),('personBody','Personas: proporciones y articulación'),('truck','Camión: carrocería y bastidor'),('forklift','Montacargas: estructura y puesto'),('logistics','Carga: cierre y apoyo sobre pallet'),('urban','Entorno: mobiliario y luminaria')]
image=Image.new('RGB',(1280,1230),'#18212A');draw=ImageDraw.Draw(image)
for i,(key,label) in enumerate(comparisons):
 x=(i%2)*640;y=(i//2)*400
 draw.text((x+16,y+8),label,font=font,fill='#E3E9EE')
 for j,version in enumerate(['before','after']):
  picture=Image.open(out/f'{version}-{key}.png').resize((300,300),Image.Resampling.LANCZOS)
  image.paste(picture,(x+12+j*316,y+70))
  draw.text((x+18+j*316,y+42),'ANTES' if j==0 else 'DESPUÉS',font=small,fill='#BFCBD4')
draw.text((16,1208),'Geometrías reales · trazado por CPU / materiales de estudio · no es una captura WebGL',font=small,fill='#BFCBD4')
image.save(out/'assets-before-after.png')
variants=Image.new('RGB',(1440,760),'#18212A');draw=ImageDraw.Draw(variants)
for row,(keys,labels) in enumerate([
 ([f'tree{i}' for i in range(6)],['Ramificado','Copa extendida','Columnar','Asimétrico','Compacto','Aparasolado']),
 (['personBody','personBlazer','personVest','personCoat','personCardigan','personCoveralls'],['Camisa','Chaqueta','Chaleco','Bata / recogido','Cárdigan / melena','Operario']),
]):
 for col,(key,label) in enumerate(zip(keys,labels)):
  picture=Image.open(out/f'after-{key}.png').resize((240,300),Image.Resampling.LANCZOS)
  variants.paste(picture,(col*240,row*370+42))
  draw.text((col*240+12,row*370+12),label,font=small,fill='#E3E9EE')
draw.text((12,742),'Seis siluetas vegetales y seis vestimentas · geometría procedural compartida · render CPU',font=small,fill='#BFCBD4')
variants.save(out/'variants.png')
# Empty before previews of newly introduced variants are not valid comparisons.
for key in ['tree4','tree5','personCoat','personCardigan','personCoveralls']:
 (out/f'before-{key}.png').unlink(missing_ok=True)
print(out/'assets-before-after.png');print(out/'variants.png')
