# Arxnet: sustitución de assets (Visual Overhaul)

Esta fase cambia la **estrategia de construcción** del mundo 3D: los objetos complejos dejan de ser combinaciones de primitivas creadas en código y pasan a ser **modelos GLB optimizados**, con licencia verificada, cargados de forma diferida. Se conservan el Shell, la composición radial, el núcleo, los departamentos, la navegación, los paneles, las conexiones animadas, las rutas, la cámara, la rotación automática y los temas. La escena sigue usando Three.js directamente (no React Three Fiber).

## Estrategia

| Familia | Técnica elegida | Por qué |
| --- | --- | --- |
| Vegetación | Árboles generados por ramificación real con [ez-tree](https://github.com/dgreenheck/ez-tree) (MIT, solo en build) y horneados a GLB con dos LOD; tarjetas de hojas pintadas por nosotros; corteza CC0 de Poly Haven | Los árboles escaneados disponibles (Poly Haven) tienen 0,3–17 M de polígonos y 20–960 MB: inviables en web. La ramificación procedural da troncos, ramas y copas creíbles con 2–9 k triángulos |
| Personas | Personajes riggeados CC0 de Quaternius, procesados en Blender | Proporciones humanas, ropa, cabello y calzado modelados; esqueleto común con animaciones de caminar, esperar e interactuar |
| Vehículos, montacargas, logística, mobiliario | Modelados por nosotros en Blender con scripts reproducibles | No hay modelos CC0 de calidad suficiente accesibles sin cuenta; el modelado propio evita riesgos de licencia y se ajusta a la escala del mundo |
| Pavimentos | Mapas CC0 de Poly Haven reducidos a 512 px y convertidos en mapas de detalle neutros | Aportan juntas, grano y rugosidad sin romper la paleta de cada tema |

## Activos incorporados

| Asset | Contenido | Triángulos | Tamaño |
| --- | --- | --- | --- |
| `tree_oak`, `tree_ash`, `tree_aspen`, `tree_pine`, `tree_street`, `tree_shrub` | Seis especies, cada una con LOD cercano (`bark`/`leaves`) y lejano (`*_lod1`) | 2,1–8,8 k / 1,3–4,7 k | 65–234 KB |
| `person_business_man`, `person_worker`, `person_casual`, `person_woman_a`, `person_woman_b` | Una malla con skinning, un material, clips `walk`/`idle`/`interact` | 2,9–3,6 k | 224–239 KB |
| `vehicle_truck` | Camión de reparto: cabina con parabrisas inclinado, ventanas, puertas, manijas, parrilla, faros, retrovisores, guardabarros, chasis, depósito, protecciones laterales, caja con nervios, bisagras, barras de cierre, pilotos y faldones | 8,3 k | 75 KB |
| `vehicle_van` | Furgoneta con arcos de rueda recortados, puerta corredera, puertas traseras, pilotos verticales | 5,3 k | 51 KB |
| `forklift` | Contrapeso, cabina abierta con asiento y volante, techo protector, ruedas; mástil y carro con horquillas como nodos separados | 7,5 k | 70 KB |
| `pallet`, `carton`, `container`, `rack` | Pallet europeo, caja con solapas/cinta/etiqueta, contenedor de 20 pies corrugado con cantoneras y barras de cierre, bastidor perforado con arriostramiento y larguero con conectores | 0,2–3,7 k | 6–28 KB |
| `street_lamp`, `bench`, `bollard` | Farola LED, banco de lamas, bolardo | 0,5–0,7 k | 7–10 KB |
| Texturas | Corteza (2), asfalto, adoquín de hormigón y hormigón cepillado (difusa, normal, rugosidad) y 4 tarjetas de hojas | — | 19 WebP, 650 KB |

Total servido: **3,1 MB**, cargados después de que el mundo procedural ya es interactivo. Licencias y créditos: [`public/assets/world/LICENSES.md`](../public/assets/world/LICENSES.md).

### Dependencias externas

- Runtime: `GLTFLoader`, `SkeletonUtils` y el decodificador meshopt incluidos en `three` (MIT). Sin CDN ni servicios externos.
- Desarrollo: `@gltf-transform/*` (MIT) y `meshoptimizer` (MIT); Blender ≥ 4.2 y Python con Pillow para reconstruir los assets.
- Build: `scripts/assets/vendor/ez-tree` (MIT, copia con aviso de licencia; no se envía al navegador). Sus texturas de hojas originales no se usan porque no declaran procedencia.

## Pipeline

```bash
npm run assets:build      # scripts/assets/build-all.sh: reconstruye todo public/assets/world
npm run check:assets      # valida estructura, presupuestos y la integración en el mundo
```

1. `build_textures.py`: descarga Poly Haven (caché fuera del repo), reduce tamaño, convierte el suelo en mapas de detalle y pinta las hojas.
2. `build-trees.mjs`: genera las especies, normaliza a altura unitaria, hornea oclusión y normales de copa, escribe dos LOD.
3. `blender_people.py`: une partes, hornea colores de material en vértices, decima un 45 %, suaviza normales, normaliza a 1,75 m y conserva tres clips.
4. `blender_vehicles.py`, `blender_props.py` (sobre `blender_kit.py`): modelan y exportan vehículos y objetos.
5. `optimize.mjs`: deduplica, conserva vacíos de anclaje y UV, cuantiza, comprime con meshopt; con `--palette` fusiona los materiales sólidos de cada modelo en un material PBR con paletas diminutas (un draw call por malla).

## Integración en ejecución

- `ArxnetShell` importa `assets.ts` dinámicamente cuando el mundo ya está creado. Si la carga falla, el mundo procedural sigue intacto.
- `AssetLayer` (`src/arxnet/assetLayer.ts`) mejora el mundo construido sin cambiar su lógica:
  - **Vegetación**: cada copa procedural se sustituye por un árbol modelado en la misma posición y con escala real; los setos de cápsula pasan a hileras de arbustos. LOD por distancia cada 0,35 s (instancias cercanas con el modelo completo en calidad alta, el resto con el ligero). Sombras con recorte alfa de las hojas.
  - **Personas**: un clon con skinning por caminante; las animaciones se ajustan a la velocidad de marcha. Se conserva la sombra de contacto.
  - **Vehículos**: camiones y furgonetas alternan en las mismas rutas de servicio, con orientación en curvas, ruedas que giran por distancia recorrida y franja de librea con el color del departamento.
  - **Almacén y puerto**: montacargas sobre la animación existente (mástil fijo, carro con horquillas que sube y baja), bastidores y largueros modelados, pallets, cajas y contenedores sustituidos en sus instancias.
  - **Mobiliario y suelos**: farolas, bancos y bolardos; asfalto, adoquín y hormigón con mapas PBR.
- Cada sustitución está aislada: si un asset falla, solo ese grupo conserva su versión procedural.
- Perfiles de calidad: en `alta`, todo proyecta sombra; en `equilibrada`, los vehículos usan su sombra de contacto; en `baja`, además se anima y dibuja la mitad de la multitud. Las personas no proyectan sombra al mapa.
- Modo oscuro: los colores de los modelos se atenúan y solo las luces emiten; el umbral de bloom sube a 0,93 para que el albedo blanco no brille.

## Coste medido

Contadores de `renderer.info` por fotograma (incluye pasadas de sombra y GTAO), organización `ind`, 1440×900, mismo build con y sin la biblioteca de assets (bloqueada para obtener el «antes»):

| Calidad | Draw calls antes → después | Triángulos antes → después |
| --- | --- | --- |
| Alta | 1 378 → 1 482 (+8 %) | 2,51 M → 4,08 M (+62 %) |
| Equilibrada | 710 → 756 (+6 %) | 1,01 M → 1,85 M (+82 %) |
| Baja | 461 → 486 (+5 %) | 0,54 M → 1,06 M (+95 %) |

Descarga adicional: 3,1 MB de assets y un chunk JS diferido de 96 KB gzip. El entorno de verificación renderiza por software (SwiftShader), así que **no se midieron FPS reales**: los contadores son la única métrica fiable aquí. El coste de triángulos procede sobre todo de la vegetación modelada; los draw calls apenas cambian gracias al instancing y a la fusión de materiales.

## Verificación

- `npm test`: 52 pruebas (interacciones, mundo, objetos y 10 nuevas de assets), todas en verde.
- `npm run build` y ESLint sin errores.
- Navegador (Chrome headless): todos los modelos cargan sin avisos en consola; selección de departamentos, vuelo de cámara, zoom, temas claro y oscuro, paleta de comandos, ajustes (personas y flujos) y cambio de organización con reconstrucción del mundo.
- Comparaciones antes/después: [`docs/visual/overhaul/`](visual/overhaul/) (vista general oscura y clara, logística, almacén y avenida en modo claro).

## Limitaciones y trabajo pendiente

- **Personas**: los modelos de Quaternius son estilizados de pocos polígonos con colores planos; al tamaño en pantalla funcionan, pero de muy cerca no son personajes de alta gama. La ruta de integración está lista: cualquier GLB con un esqueleto y clips `walk`/`idle`/`interact` puede sustituirlos en `scripts/assets/sources/people/`.
- **Edificios**: en esta fase solo cambian los materiales de pavimentos y zócalos; fachadas, cubiertas y accesos siguen siendo procedurales. Es el siguiente candidato para modelado en Blender.
- **Texturas**: WebP pequeñas en lugar de KTX2/Basis; ocupan poco en red, pero no se comprimen en GPU.
- **Rendimiento móvil**: en `equilibrada` hay ~1,85 M triángulos por fotograma (incluida la pasada de sombras). Aún no se ha medido en un dispositivo real; si hiciera falta, el siguiente paso es un tercer LOD de vegetación o reducir la densidad de árboles en ese perfil.
- **Montacargas**: las ruedas no giran (se desplazan poco en el pasillo).
- En desarrollo, `window.arxnetWorld` expone el mundo para depuración; no existe en producción.
