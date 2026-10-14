# Revisión del 13 de octubre de 2026

La captura del trabajo anterior indicaba que compilación, TypeScript y lint pasaban, pero no se habían comprobado los clics, vuelos de cámara, búsqueda, aplicaciones, temas, organizaciones, ajustes ni móvil.

## Correcciones realizadas

- El zoom de los botones cancela un vuelo activo y usa la posición actual de la cámara. Antes, el vuelo sobrescribía el zoom.
- Cancelar un toque y terminar un gesto de dos dedos ya no seleccionan accidentalmente un distrito.
- Las etiquetas invisibles dejan de recibir clics y foco por teclado.
- Pasar entre escritorio y móvil recalcula la distancia de la vista general y reencuadra el distrito seleccionado.
- La barra superior móvil usa dos columnas, reduce el logo y permite truncar el nombre de la organización.
- Las notificaciones y el menú de organizaciones aparecen delante del panel móvil. Las notificaciones se desplazan en pantallas de poca altura.
- Cambiar de organización cierra las ventanas anteriores y reinicia notificaciones y actividad. Seleccionar un departamento cierra ajustes y actividad expandida.
- Abrir búsqueda o una app cierra las demás ventanas modales.
- La búsqueda acepta nombres sin tildes, permite navegar con las flechas y ejecuta el resultado seleccionado con Enter.
- Las ventanas declaran su rol de diálogo, mantienen el foco dentro y lo restauran al cerrar. Los botones muestran el foco del teclado.
- Un fallo de WebGL muestra un mensaje visible y mantiene accesible el resto de la interfaz.
- El desmontaje libera también el entorno y el mapa de sombras de la escena.

## Verificaciones automatizadas

`pnpm check:interactions` contiene 10 pruebas: zoom durante un vuelo, límites del zoom, clic normal, toque cancelado, gesto de dos dedos, etiquetas invisibles, cambio de tamaño a móvil, búsqueda sin tildes, integridad de organizaciones y estructura inicial de la cabecera móvil.

Se ejecutan contra el código fuente. Para probar gestos sin GPU, el cargador omite únicamente el constructor WebGL y conserva los campos y controladores de la clase. Las dependencias de renderizado se sustituyen por objetos mínimos en las pruebas de cámara. La cabecera se comprueba mediante renderizado estático de React.

Lint, las 10 pruebas y la compilación de producción pasan. Vite mantiene el aviso de tamaño del bundle de Three.js.

## Verificación visual pendiente

Este entorno rechazó abrir el puerto de Vite (`listen EPERM`) e iniciar Chromium (`setsockopt: Operation not permitted`). No se ha validado el renderizado WebGL ni la interacción completa en un navegador en esta revisión.

Para completar esa validación en el equipo local:

1. Ejecutar `pnpm dev` y revisar consola y ciudad en 1440×900.
2. Seleccionar distritos mediante etiquetas, edificios, chips y panel. Comprobar vuelo, zoom durante el vuelo y regreso a vista general.
3. Abrir Ctrl+K/⌘K, buscar «logistica», navegar con flechas, pulsar Enter y cerrar con Escape. Probar Tab y Mayús+Tab dentro de búsqueda, launcher y app.
4. Abrir Apps, seleccionar una aplicación y cerrar con Escape o pulsando fuera.
5. Alternar los temas y recargar para comprobar su persistencia.
6. Cambiar varias veces entre las tres organizaciones; comprobar que ciudad, departamentos, conexiones y avisos corresponden a la organización actual.
7. Alternar los cuatro ajustes; comprobar su efecto sobre la ciudad.
8. Repetir en 390×844 y 320×568: barra superior, panel de distrito, menús, notificaciones, scroll de aplicaciones y gestos táctiles.

## Alcance del prototipo

La actividad es simulada y las apps muestran registros de ejemplo. El botón «Nuevo registro» y las etiquetas de filtros no tienen lógica de negocio. Implementar registros reales requiere definir su modelo de datos, persistencia y backend; esa funcionalidad no formaba parte de los pendientes enumerados en la captura.
