# Datos peatonales de OpenStreetMap

RutaViva usa una copia versionada y acotada de la red peatonal de OpenStreetMap para el piloto **Casco Antiguo, Sevilla**. La aplicación no consulta Overpass al calcular cada ruta.

## Procedencia y licencia

Los datos cartográficos son © colaboradores de OpenStreetMap y se ofrecen bajo la **Open Database License (ODbL)**. La atribución se muestra en el mapa y debe mantenerse en cualquier despliegue o demostración. La licencia de los datos es independiente de la licencia del código de RutaViva indicada en `LICENSE`; esa licencia del código no cambia ni absorbe la ODbL.

Fuente: https://www.openstreetmap.org/copyright

## Área y límites

- Bbox: sur `37.376`, oeste `-6.010`, norte `37.405`, este `-5.978`.
- Máximo probado: 15.000 nodos y 30.000 tramos dirigidos. La instantánea medida antes de publicarse contenía 12.272 nodos y 27.620 tramos.
- Se filtran vías no peatonales, `access=private`, `access=no`, `foot=no`, áreas y autopistas.
- No se importan nombres de usuarios, changesets ni otros metadatos personales.

## Importación manual

Primero deben estar aplicadas todas las migraciones locales verificadas. Desde la raíz del proyecto:

```text
npm run migrate
npm run import:osm
```

El importador divide el área en 16 teselas y consulta primero la API oficial de OpenStreetMap, con User-Agent identificable, timeout y procesamiento secuencial. Construye nodos y tramos con identificadores deterministas y publica el nuevo release dentro de una transacción. Si algo falla, ejecuta rollback y conserva como publicado el release anterior.

No se confirma en Git ninguna respuesta JSON descargada. La fuente autoritativa de ejecución es PostgreSQL/PostGIS en Supabase.

## Interpretación responsable

Los datos de OpenStreetMap y las aportaciones comunitarias pueden estar incompletos o desactualizados. Las rutas son orientativas: no garantizan seguridad, transitabilidad ni accesibilidad. Un atajo comunitario solo se menciona cuando coincide con una arista importada; nunca crea por sí solo un tramo nuevo.
## Disponibilidad de fuentes

La importación divide el área en teselas pequeñas y consulta primero la API oficial de OpenStreetMap. El parser conserva únicamente identificadores, coordenadas y etiquetas necesarias de nodos y vías peatonales: descarta usuarios, identificadores de cuenta, changesets, relaciones y demás metadatos. Si esa API no está disponible, prueba de forma secuencial las instancias públicas documentadas `z.overpass-api.de`, `lz4.overpass-api.de` y `overpass.private.coffee`. Un error temporal cambia de endpoint; otros errores cancelan la operación. Ninguna de estas fuentes se consulta para responder una ruta de usuario.
