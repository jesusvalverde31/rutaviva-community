# Brief — RutaViva Community Sevilla

## Problema

Las barreras físicas, acerados deteriorados, obras y problemas de orientación cambian más rápido que muchas fuentes cartográficas. RutaViva Community combina observaciones vecinales moderadas con una red peatonal para mostrar condiciones de accesibilidad y recorridos explicables sin convertir votos en garantías ni certificaciones.

## Público

Residentes y visitantes de Sevilla, con atención especial a personas con discapacidad, personas mayores, familias y quienes utilizan silla de ruedas, bastón o andador. La consulta básica es anónima; colaborar exige una cuenta verificada.

## Primera versión pública

- Piloto territorial reducido dentro de Sevilla.
- Consulta de rutas orientativas y alternativa textual al mapa.
- Aportaciones estructuradas sobre condiciones observables, confirmaciones y rechazos.
- Tipo de barrera, grupos potencialmente afectados, fecha, permanencia y medición opcional, sin registrar la discapacidad del autor.
- Moderación previa a cualquier cambio de la red pública.
- Confianza, caducidad y explicaciones deterministas.
- Exportación y supresión de datos de cuenta.

## Fuera de alcance inicial

Cobertura completa de Sevilla, fotografías, navegación giro a giro, seguimiento GPS, otras ciudades, garantías de seguridad, SLA y monetización.

## Estado

- **IMPLEMENTADO:** servidor Node/Fastify, PostgreSQL/PostGIS, acceso por enlace mágico, mapa MapLibre/OSM, aportaciones geoespaciales, scoring, reacciones, historial, moderación y panel de actividad.
- **VERIFICADO:** sintaxis, estructura, 80 pruebas locales, 25 pruebas de integración real con rollback, 14 migraciones, readiness, permisos mínimos y recorrido visual en escritorio.
- **IMPLEMENTADO EN BLOQUE 31, PENDIENTE DE DESPLIEGUE:** taxonomía de accesibilidad, formulario guiado, filtros, evidencia visible y tratamiento conservador de rutas.
- **PENDIENTE DE VALIDACIÓN SOCIAL:** piloto con varias personas reales, medición sobre el terreno, lector de pantalla y criterios de moderación operativos.
