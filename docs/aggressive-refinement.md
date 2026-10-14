# Arxnet: reconstrucción de assets y acabados

Esta pasada cambia la construcción de los objetos más visibles. Conserva el Shell, la configuración empresarial, los distritos, el layout radial, las rutas, la cámara, la selección y los paneles. La escena existente usa **Three.js directamente** desde React; no se migró a React Three Fiber ni se añadieron dependencias o descargas de modelos.

## Cambios implementados

| Elemento | Construcción actual |
| --- | --- |
| Árboles | Seis hábitos: ramificado, extendido, columnar, asimétrico, compacto y aparasolado. Copas abiertas formadas por hojas curvas con volumen cerrado, huecos reales y variación tonal; desaparecen las esferas de follaje. Tronco quebrado, raíces y bifurcaciones compartidas. |
| Cipreses y arbustos | Follaje separado, contorno irregular y densidad específica. Conservan las jardineras y posiciones existentes. |
| Personas | Torso, pelvis, mandíbula, nariz, orejas, manos, pulgares y calzado mediante perfiles anatómicos. Brazos y piernas dejan de ser cápsulas. Codos y rodillas tienen pivotes independientes. Camisa, chaqueta, chaleco, bata, cárdigan y operario; distintos peinados, proporciones, tonos de piel y poses. |
| Camiones | Cabina adelantada de perfil inclinado, parabrisas alto, ventanas laterales, retrovisores y techo definido. Carrocería de carga con paneles, bastidor, perfiles, guardabarros y remates. Neumáticos y llantas usan materiales separados en los vehículos animados. Se conserva la rotación de ruedas por distancia recorrida. |
| Montacargas | Carrocería de contrapeso perfilada, puesto abierto, asiento y respaldo, dirección, peldaño, jaula tubular, ruedas perfiladas con llantas, mástil telescópico e hidráulico, carro y horquillas. Carga y pallet siguen unidos al carro animado. |
| Cajas y pallets | Cartón menos redondeado, tapas separadas, canto plegado, cinta y etiqueta; tonos más sobrios. Se conserva la construcción funcional del pallet con tablones y nueve apoyos, se cambia el acabado de madera y se corrige su apoyo y holgura respecto al mástil y las horquillas. |
| Mobiliario | Bancas con asiento y respaldo de lamelas inclinadas, soporte continuo y apoyabrazos. Farolas con poste ahusado, brazo y luminaria industrial con disipadores. Se conservan los bolardos y señales ya construidos. |
| Fachadas | En edificios acristalados, el prisma exterior se sustituye por un núcleo retraído, paños separados, montantes, losas, bandas opacas y voladizos. Los edificios sólidos reciben ventanas por módulos y vierteaguas. Se conservan entradas, rampas, cubiertas y equipamiento. |
| Acabados | Vidrio menos especular y con relieve más suave; llantas metálicas frente a caucho mate; grano sutil del cartón; pavimento, madera y vegetación diferenciados. Menor emisión de cubiertas coloreadas y una paleta vegetal/asfáltica más sobria en modo claro. Los tokens del Shell no cambian. |

Las mayores diferencias de silueta se dan en vegetación, personas y montacargas. La nueva cabina y los paños de fachada cambian la lectura de los vehículos y edificios de cerca. Las carreteras, aceras y rotonda conservan su continuidad y cotas: no era necesario reemplazar su trazado.

## Comparación visual

- [Assets antes / después](aggressive-comparison/assets-before-after.png).
- [Seis variantes vegetales y seis vestimentas](aggressive-comparison/variants.png).
- [Vista general en ambos temas](aggressive-comparison/overview.png).

El **antes** corresponde al estado inmediatamente anterior a esta intervención, no al prototipo inicial. Los assets se renderizaron con Blender/Cycles por CPU, a partir de los vértices, normales y colores reales del proyecto, usando un material de estudio común. La vista general usa rasterización en CPU con iluminación aproximada. Ninguna imagen es una captura del navegador: no representa exactamente los mapas, reflejos, luces ni posprocesado WebGL. Estas imágenes no sustituyen la validación de la aplicación ejecutándose.

## Coste medido

Comparación geométrica de las tres organizaciones, densidad predeterminada. Cuenta todos los triángulos multiplicados por instancias, incluso objetos fuera de cámara; **no mide FPS ni draw calls**. Los bytes corresponden a buffers de geometría presentes en la escena, sin texturas, caché no utilizada ni render targets.

| Organización | Triángulos alta antes → después | Variación | Triángulos baja antes → después | Buffers alta antes → después |
| --- | ---: | ---: | ---: | ---: |
| Industrial | 582.414 → 608.358 | +4,45% | 497.842 → 498.018 | 9.843.844 → 9.999.436 B |
| Retail | 433.814 → 448.526 | +3,39% | 381.442 → 380.138 | 8.393.164 → 8.606.980 B |
| Servicios | 296.270 → 319.536 | +7,85% | 248.222 → 257.160 | 6.917.252 → 7.557.140 B |

Los lotes `InstancedMesh` pasan de 69/63/55 a 77/71/63: ocho lotes adicionales por los nuevos árboles, vestimentas, articulaciones y llantas. Es un indicador del trabajo añadido, no una medición de llamadas de dibujo del render final. El JavaScript comprimido con gzip por Node aumenta de 269.086 a 270.527 bytes (+1.441 B). Los datos brutos están en [aggressive-before.json](aggressive-before.json) y [world-after.json](world-after.json).

Se compensó el detalle con menos figuras repetidas, hojas indexadas, un máximo de ocho lotes globales de follaje y perfiles de fachada planos cuando su bisel no aporta desde la cámara. Las siluetas principales conservan biseles. El perfil bajo usa 28 hojas por copa frente a 105 en alta, limita DPR a 1 y desactiva sombras y posprocesado costoso; equilibrado conserva sombras de 1024 y alta usa 2048. Se conserva la calidad automática, los movimientos independientes del framerate y la liberación de recursos.

El coste geométrico sugiere un incremento contenido en alta y un coste parecido en baja. La diferencia real de rendimiento depende de GPU, resolución, sombras y coste de los lotes adicionales; **no se puede convertir estos porcentajes en una predicción de FPS**.

## Validación y límites

`npm run lint`, `npm test` y `npm run build` pasan. Hay 42 comprobaciones: interacciones de cámara/gestos, selección, datos modulares, encuadre móvil, matrices finitas, ambos temas, perfiles de follaje, continuidad de calles y giros, huellas y apoyo de ruedas, apoyo de personas, rampas, recursos, hojas cerradas, articulación independiente y movimiento reducido. Se comprueba también el paso libre de horquillas por el pallet y el contacto con la mercancía. La compilación mantiene el aviso de Vite por el tamaño del chunk de Three.js; la escena ya se carga de forma diferida.

La inspección de los renders permitió corregir hojas inicialmente angulosas, apoyo de carga y exceso de biseles en perfilería. El entorno restringido no permite levantar el servidor local ni inicializar el navegador con WebGL. Por tanto, quedan **sin verificar en hardware real** la percepción final dentro del Shell, el coste GPU, el comportamiento táctil en dispositivos y cualquier interpenetración que no cubran las comprobaciones geométricas. No se afirma haber auditado cada objeto contra cada estructura.

Se simplificaron deliberadamente caras, dedos, ropa sin simulación, ramas compartidas, interiores de cabinas y motores. No hay rigging de videojuegos, física de tráfico ni simulación de telas. Algunas piezas del mobiliario y de vehículos estacionados comparten un material por objeto para contener el coste; los vehículos animados separan caucho, llantas y vidrio. El núcleo tecnológico y las construcciones conceptuales mantienen su identidad.

## Ejecución y reproducción

```sh
npm run dev
npm run lint
npm test
npm run build
npm run measure:world
```

Para volver a inspeccionar los assets con Blender instalado:

```sh
node scripts/export-world-preview.mjs
ALSOFT_DRIVERS=null blender --background --factory-startup -t 4 --python scripts/render-assets-blender.py
python scripts/compose-asset-comparison.py
```

El exportador produce una instantánea temporal del estado actual. La instantánea temporal anterior existía durante esta sesión; los renders anteriores y las métricas quedan guardados en el repositorio. El renderizador omite instantáneas temporales que ya no estén disponibles. Todos los assets son procedurales y locales; no requieren licencias de terceros, CDN ni descargas para ejecutar el mundo.
