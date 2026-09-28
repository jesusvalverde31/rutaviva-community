# Brief — RutaViva Community Sevilla

## Problema

Las barreras, obras y atajos peatonales cambian más rápido que muchas fuentes cartográficas. RutaViva Community propone combinar una red moderada con conocimiento vecinal para ofrecer recorridos explicables sin convertir votos en garantías de seguridad.

## Público

Residentes y visitantes de Sevilla, con atención especial a personas mayores, familias y personas con movilidad reducida. La consulta básica será anónima; colaborar exigirá una cuenta verificada.

## Primera versión pública

- Piloto territorial reducido dentro de Sevilla.
- Consulta de rutas orientativas y alternativa textual al mapa.
- Aportaciones, confirmaciones, rechazos y denuncias.
- Moderación previa a cualquier cambio de la red pública.
- Confianza, caducidad y explicaciones deterministas.
- Exportación y supresión de datos de cuenta.

## Fuera de alcance inicial

Cobertura completa de Sevilla, fotografías, navegación giro a giro, seguimiento GPS, otras ciudades, garantías de seguridad, SLA y monetización.

## Estado

- **IMPLEMENTADO:** servidor Node/Fastify, PostgreSQL/PostGIS, acceso por enlace mágico, mapa MapLibre/OSM, aportaciones geoespaciales, scoring, reacciones, historial, moderación y panel de actividad.
- **VERIFICADO:** sintaxis, estructura, 80 pruebas locales, 25 pruebas de integración real con rollback, 14 migraciones, readiness, permisos mínimos y recorrido visual en escritorio.
- **PENDIENTE DE VALIDACIÓN SOCIAL:** piloto con varias personas reales, lector de pantalla, móvil físico y criterios de moderación operativos.
