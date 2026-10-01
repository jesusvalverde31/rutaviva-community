# RutaViva Community Sevilla

> **Estado actual:** beta comunitaria pública en [rutaviva-community-sevilla-jv31.onrender.com](https://rutaviva-community-sevilla-jv31.onrender.com), conectada a Supabase Free con PostgreSQL/PostGIS. El cálculo A→B, la red peatonal real y la capa pública de credibilidad están verificados localmente contra Supabase y quedan pendientes de publicación en producción.

RutaViva Community está diseñada como un piloto comunitario de rutas peatonales orientativas para Sevilla. Permitirá consultar recorridos, proponer caminos o incidencias y entender por qué una alternativa ha sido recomendada. Ninguna aportación influirá en rutas públicas sin revisión.

## Estado verificable

- **IMPLEMENTADO:** interfaz web responsive con MapLibre y alternativa textual; planificador A→B directo/accesible; motor Dijkstra explicable; red OSM versionada e importador transaccional; guía pública «Cómo usar RutaViva»; acceso sin contraseña; sesiones revocables; aportaciones Point/LineString; filtros; confianza determinista; reacciones; historial append-only; cola de moderación con control de versión; outbox cifrado y correo Brevo.
- **VERIFICADO:** 20 migraciones aplicadas; release OSM `osm-20260930135906-3f4223ab` con 12.272 nodos y 27.620 tramos; `npm run check`; 122/122 pruebas locales; 26/26 de integración real; tres rutas reales consecutivas respondidas; readiness, rol runtime, CSP, estados vacíos, guía accesible y navegación en navegador local.
- **PROPUESTO:** publicar el Bloque 29 y comprobarlo en Render; después, recorrer una aportación real con las dos cuentas autorizadas, realizar auditoría con lector de pantalla, añadir denuncias/apelaciones y ampliar progresivamente el piloto.
- **NO VERIFICADO:** lector de pantalla real, carga sostenida multiusuario, recorrido comunitario completo con una aportación real publicada, despliegue del Bloque 29 y respuesta operativa 24/7. El plan gratuito puede dormir o pausar servicios.

## Orden de lectura

1. `BRIEF.md`
2. `docs/ARQUITECTURA.md`
3. `docs/MODELO-DATOS.md`
4. `docs/CONTRATO-API.md`
5. `docs/MODERACION.md`
6. `docs/SEGURIDAD.md`
7. `docs/PRIVACIDAD.md`
8. `docs/RETENCION.md`
9. `docs/REGISTRO-RIESGOS.md`
10. `docs/DECISIONES.md`
11. `docs/DATOS-OSM.md`
12. `docs/PRESENTACION-COMERCIAL.md`

## Instalar, comprobar y abrir

Requiere Node.js 24 o superior. Las dependencias están fijadas en `package-lock.json`.

```text
npm ci --cache .npm-cache
npm run build
npm run check
npm test
npm run test:integration
npm start
```

También se puede usar `ABRIR-RUTAVIVA-COMMUNITY.cmd`. El lanzador acepta únicamente `127.0.0.1`, inicia el servidor y, si se habilita, el worker de correo. No abre el navegador automáticamente.

Sin credenciales, consulta `http://127.0.0.1:4329/`; `ready`, `bootstrap`, `zones` y el acceso devuelven degradaciones honestas.

Para una base autorizada, copia `.env.example` como `.env` sin versionarlo y usa credenciales distintas para ejecución y migración. `DATABASE_URL` debe identificar al rol limitado `rutaviva_runtime` —también se admite el sufijo de proyecto del pooler y el runtime puede usar el puerto 6543—. `MIGRATION_DATABASE_URL` debe usar otro rol con capacidad para crear ese LOGIN y, fuera de localhost, una conexión directa o shared pooler en modo sesión por el puerto 5432; el pooler transaccional 6543 no sirve para advisory locks. En ejecuciones posteriores el migrador valida el rol, pero no cambia su contraseña; una rotación futura debe ser explícita y coordinada con el pooler. La contraseña del runtime debe tener al menos 32 caracteres; la del migrador, al menos 16 para admitir credenciales fuertes generadas por el proveedor. Ejecuta `npm run migrate` antes de `npm start`. Migrador e integración cargan el `.env` completo de forma explícita; servidor, worker y supervisor lo parsean con una allowlist runtime, donde el shell prevalece sobre el archivo, y eliminan `MIGRATION_DATABASE_URL`, `NODE_OPTIONS` y cualquier variable ajena antes de continuar o crear hijos. El servidor nunca migra automáticamente. No pegues credenciales en comandos compartidos, documentación ni incidencias.

La conexión verifica nombre de host y cadena TLS. `DATABASE_CA_FILE` debe ser una ruta relativa interna al proyecto; para Supabase se incluye su CA pública 2021 en `certs/supabase-prod-ca-2021.crt`. No se permite desactivar `rejectUnauthorized`.

Con una `.env` privada configurada, `npm run test:integration` verifica el PostgreSQL/PostGIS real, checksums, rol mínimo, denegaciones de escritura, restricciones geográficas, rollback, endpoints y reconexión. La suite no imprime credenciales.

Endpoints implementados:

- `GET /api/v1/health`
- `GET /api/v1/ready`
- `GET /api/v1/bootstrap`
- `GET /api/v1/zones?q=&cursor=&limit=`
- `POST /api/v1/auth/request-link`
- `POST /api/v1/auth/verify`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/sessions`
- `DELETE /api/v1/auth/sessions/:id`
- `GET /api/v1/auth/csrf`
- `GET /api/v1/users/me`
- `GET|POST /api/v1/contributions`
- `GET|PATCH /api/v1/contributions/:id`
- `GET /api/v1/contributions/:id/history`
- `POST /api/v1/contributions/:id/submit`
- `POST /api/v1/contributions/:id/withdraw`
- `POST|DELETE /api/v1/contributions/:id/reaction`
- `GET /api/v1/community/activity`
- `POST /api/v1/routes/search`
- `GET /api/v1/stats`
- `GET /api/v1/zones/leaderboard`
- `GET /api/v1/zones/:slug`
- `GET /api/v1/methodology`
- `GET /api/v1/activity/summary`
- `GET /api/v1/openapi.json`
- `GET /sitemap.xml`
- `GET /robots.txt`
- `GET /api/v1/moderation/cases`
- `POST /api/v1/moderation/cases/:id/claim`
- `POST /api/v1/moderation/cases/:id/publish`
- `POST /api/v1/moderation/cases/:id/reject`
- `GET /`
- `GET /auth/verify`

La autenticación usa tokens de un solo uso de 15 minutos, UUID público más 256 bits aleatorios, hashes persistidos, cifrado AES-256-GCM para correo y outbox, máximo cinco sesiones activas y cookies opacas. El worker reclama con `SKIP LOCKED` y lease limitado. Solo un rechazo explícito `429` se reintenta con backoff de 1, 5, 15 y 60 minutos; red, timeout, `408`, `5xx`, respuesta inválida, pérdida de lease o fallo tras aceptación quedan terminales como resultado desconocido para evitar reenvío automático. Solo persiste el hash del identificador devuelto por el proveedor. El runtime conserva cero `SELECT` o DML sobre las tablas privadas.

`EMAIL_PROVIDER=disabled` es el modo seguro por defecto. Las cuentas solo se anuncian y `request-link` solo persiste cuando están configurados base, los cuatro secretos de autenticación y un proveedor Brevo real. Una activación aprobada requiere `EMAIL_PROVIDER=brevo`, una `BREVO_API_KEY` privada y `BREVO_SENDER` verificado. `fake` solo está permitido con `NODE_ENV=test`. El cliente usa `fetch`, `AbortController`, HTML y texto sin recursos remotos e `idempotencyKey`; esta señal no se considera garantía de deduplicación. En el Bloque 25 se verificaron dos entregas reales, ambas aceptadas en el primer intento, sin probar una respuesta ambigua ni la deduplicación del proveedor.

`IDENTITY_ENCRYPTION_KEY` debe codificar exactamente 32 bytes como 64 caracteres hexadecimales o base64. `SESSION_SECRET`, `CSRF_SECRET` e `IP_HASH_SECRET` requieren al menos 32 caracteres. Son valores privados distintos y no deben copiarse a Git, documentación ni comandos compartidos.

`TRUST_PROXY_HOPS=0` mantiene ignorado `X-Forwarded-For` en desarrollo y test. Producción exige exactamente `TRUST_PROXY_HOPS=1`: únicamente se confía en el proxy inmediato, nunca en una cadena abierta. Los límites actuales son tres solicitudes por correo cada 15 minutos con respuesta silenciosa, diez por red y hora con `429`, reserva global de 250 al día con `503 EMAIL_CAPACITY_EXHAUSTED`, y veinte verificaciones por red cada 15 minutos. El bucket de red se consume siempre, aunque el correo ya esté limitado; la capacidad global solo se reserva si ambos permiten encolar. El HMAC de red rota cada 48 horas UTC; en el borde de ventana la cuota puede repartirse entre dos buckets.

El listado de zonas devuelve solo una caja geográfica (`bbox`), nunca el polígono completo, y usa un cursor opaco versionado. El seed identifica Sevilla y tres áreas piloto con nombres explícitamente aproximados. Las aportaciones deben quedar cubiertas por Sevilla y su zona, las líneas son simples y no superan 5 km. Un visitante anónimo ve únicamente contenido publicado; autor y moderadores tienen visibilidad adicional según rol.

El planificador no guarda origen ni destino. Ajusta ambos puntos a la red publicada a un máximo de 75 metros y rechaza puntos fuera de Casco Antiguo o separados menos de 25 metros. Los cierres publicados excluyen tramos; las barreras excluyen la alternativa accesible; iluminación, incertidumbre e incidencias publicadas modifican su coste. Las aportaciones no publicadas no influyen. Un atajo nunca crea una arista nueva. Consulta `docs/DATOS-OSM.md` para procedencia, ODbL e importación manual.

## Ficha de portfolio

**Descripción GitHub (máximo 350 caracteres):** Community-powered pedestrian shortcut and accessibility map for Seville. Secure passwordless access, moderated geospatial contributions, trust scoring, PostgreSQL/PostGIS, MapLibre and a production-minded Node.js backend.

**Topics:** `nodejs`, `fastify`, `postgresql`, `postgis`, `maplibre`, `openstreetmap`, `civic-tech`, `accessibility`, `seville`, `community`.

**Vídeo demo de 60 segundos:** 0–8 s, problema y portada; 8–20 s, mapa/lista y filtros; 20–35 s, dibujar y enviar un atajo; 35–47 s, moderación por una segunda cuenta; 47–55 s, publicación, votos, score e historial; 55–60 s, arquitectura, tests y aviso de seguridad.

## Límites

La modalidad gratuita puede suspender servicios, imponer cuotas o cambiar sus condiciones. El mapa tendrá alternativa textual y los fallos de proveedores no se presentarán como éxitos. RutaViva no garantiza seguridad ni sustituye señalización, autoridades o comprobación del entorno.

## Coste actual

0 €. Supabase, Render y Brevo se configuran en sus modalidades gratuitas, sujetas a cuotas, suspensión y cambios de condiciones. No se ha añadido tarjeta, plan de pago ni dominio propio.

## Copyright

Copyright © 2026 Jesús Valverde. All rights reserved. This source code is public for portfolio review; no open-source license is granted. See `LICENSE`.
