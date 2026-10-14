# Métricas del mundo 3D

Comparativa acumulada con la base inicial. La [última pasada de objetos](object-pass.md) compara por separado su coste con la versión inmediatamente anterior. Estos son conteos de geometría en CPU, incluyendo instancias y elementos ocultos; no son FPS ni triángulos realmente dibujados tras culling. Los buffers excluyen texturas, destinos de render y cachés no visibles.

| Organización | Triángulos iniciales | Actual (alta) | Cambio acumulado | Actual (baja) | Meshes iniciales → actuales |
| --- | ---: | ---: | ---: | ---: | ---: |
| Norvik Industrial | 725,614 | 582,414 | -19.7% | 497,842 | 578 → 555 |
| Mercato Group | 511,956 | 433,814 | -15.3% | 381,442 | 461 → 444 |
| Lumen Consultores | 376,210 | 296,270 | -21.2% | 248,222 | 338 → 322 |

| Organización | Buffers iniciales (MiB) | Buffers actuales (MiB) | Construcción inicial (ms) | Construcción actual (ms) |
| --- | ---: | ---: | ---: | ---: |
| Norvik Industrial | 9.44 | 9.39 | 266.4 | 212.4 |
| Mercato Group | 7.52 | 8.00 | 207.2 | 158.5 |
| Lumen Consultores | 6.16 | 6.60 | 115.8 | 119.3 |

Los tiempos son una muestra de construcción del mundo tras preparar el kit en el harness, sin GPU, rasterizado de texturas, red ni inicio completo. Varían con calentamiento y carga del equipo. No permiten concluir una mejora neta de FPS. El uso de buffers de escena no disminuye en todas las organizaciones.

| JavaScript de producción | Inicial | Actual |
| --- | ---: | ---: |
| Entrada del Shell, bytes | 972,193 | 275,765 |
| Total, bytes | 972,193 | 996,932 |
| Total gzip local con Node, bytes | 260,224 | 269,086 |

El mundo se carga dinámicamente al montar el Shell: el bloque inicial es menor, pero el total aumenta ligeramente. Gzip es un cálculo local, no transferencia HTTP medida. Vite conserva el aviso de chunk del mundo superior a 500 kB.

No hay mediciones GPU, FPS ni pruebas en móviles físicos: Chromium está bloqueado en este entorno. `window.arxnetDiagnostics()` proporciona contadores reales al ejecutar la aplicación en un navegador compatible.

Registros [inicial](world-before.json) (2026-10-14T02:54:11.276Z) y [actual](world-after.json) (2026-10-14T03:31:23.999Z). El SHA identifica `world.ts`; los archivos históricos conservan el código previo. Comandos: `pnpm build`, `node scripts/measure-world.mjs --before`, `pnpm measure:world`.
