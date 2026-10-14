# Arxnet · organización en 3D

Prototipo de un dashboard con React, TypeScript, Vite y Three.js. Cada distrito representa un departamento, con indicadores, procesos, aplicaciones y flujos de datos. Incluye tres organizaciones de ejemplo: Norvik Industrial, Mercato Group y Lumen Consultores.

## Desarrollo

```sh
pnpm install
pnpm dev
```

Vite muestra la dirección local. Para verificar y compilar:

```sh
pnpm lint
pnpm test
pnpm build
pnpm preview
```

Las pruebas de interacciones requieren Node.js 22.15+ o 24+. No instalan dependencias adicionales. Ejecutan los controladores de cámara y gestos sin inicializar WebGL; no sustituyen las pruebas visuales en un navegador.

## Uso

- Selecciona un distrito desde la ciudad, sus etiquetas, la barra inferior o el panel de departamentos.
- Arrastra para orbitar; usa Mayús o el botón derecho para desplazar y la rueda o un pellizco para acercar.
- Usa «Vista general» o «Mundo» para volver a la organización completa.
- Abre la búsqueda con Ctrl+K o ⌘K. Escribe con o sin tildes, navega con las flechas y confirma con Enter. Escape cierra la ventana.
- El menú junto al logo cambia de organización. Los botones de sol y luna cambian el tema, que se guarda localmente.
- «Ajustes» controla flujos, personas y vehículos, rotación automática y etiquetas.

## Código

- `src/arxnet/ArxnetShell.tsx`: interfaz, paneles, búsqueda, eventos y ventanas.
- `src/arxnet/world.ts`: escena 3D, distritos, cámara, gestos y calidad adaptativa.
- `src/arxnet/premium.ts`: vehículos, anatomía, vegetación, mercancía, mobiliario, rampas y rutas reutilizables.
- `src/arxnet/data.ts`: datos de ejemplo, organizaciones, temas e indicadores.
- `src/arxnet/shell.css`: estilos de interacción y ajustes móviles.

`App.tsx` configura el preset inicial, la densidad de personas y la calidad (`auto`, `baja`, `equilibrada`, `alta`).

## Estado de la revisión

Consulta [la reconstrucción de assets y su comparación antes/después](docs/aggressive-refinement.md), [la pasada anterior de objetos](docs/object-pass.md), [el refinamiento integral y su comparativa](docs/world-refinement.md), [las métricas](docs/world-metrics.md) y [la revisión inicial](docs/revision.md).

El mundo incorpora carreteras continuas, vehículos detallados, personas articuladas, vegetación orgánica, fachadas construidas y perfiles gráficos. La interfaz conserva el Shell original. `pnpm measure:world` registra métricas geométricas en CPU; las limitaciones de validación WebGL están documentadas.

Los indicadores, eventos y registros son datos de demostración. Las ventanas de aplicaciones muestran tablas de ejemplo; «Nuevo registro» y los filtros de esas tablas aún son elementos visuales. No hay backend, autenticación ni persistencia de registros implementados.
