# RutaViva Community Sevilla

> **Estado actual:** beta comunitaria pública en [rutaviva-community-sevilla-jv31.onrender.com](https://rutaviva-community-sevilla-jv31.onrender.com), conectada a Supabase Free con PostgreSQL/PostGIS. Esta rama añade instalación PWA y un shell estático de respaldo; queda pendiente su despliegue y comprobación pública.

RutaViva Community es un piloto de accesibilidad urbana comunitaria para Sevilla. Permite comunicar barreras y zonas deterioradas, consultar observaciones revisadas y entender por qué una ruta orientativa intenta reducir obstáculos conocidos. Ninguna aportación influye en rutas públicas sin revisión.

## Estado verificable

- **IMPLEMENTADO:** interfaz web responsive con MapLibre y alternativa textual; planificador A→B directo/accesible; motor Dijkstra explicable; red OSM versionada e importador transaccional; guía pública «Cómo usar RutaViva»; acceso sin contraseña; sesiones revocables; aportaciones Point/LineString; filtros; confianza determinista; reacciones; historial append-only; cola de moderación con control de versión; outbox cifrado y correo Brevo. Esta rama añade manifiesto PWA, iconos, instalación desde navegadores compatibles y shell estático sin datos ciudadanos sin conexión.
- **VERIFICADO LOCALMENTE:** 22 migraciones aplicadas; release OSM `osm-20260930135906-3f4223ab` con 12.272 nodos y 27.620 tramos; `npm run check` correcto y 152/152 pruebas locales; 27/27 de integración real con rollback (ejecutada en un bloque anterior); build MapLibre 4/4; pruebas PWA cubren caché permitida, bypass de API y auth, red primero, errores HTTP y fallback al fallar red. La PWA aún espera CI, despliegue y smoke de recursos públicos.
- **PROPUESTO:** ejecutar el [primer piloto real documentado](docs/VALIDACION-PILOTO-REAL.md) con las dos cuentas autorizadas operadas por Jesús —separación técnica de funciones, no independencia humana—, realizar después una validación con personas distintas, auditar con lector de pantalla, añadir denuncias/apelaciones y ampliar progresivamente el piloto.
- **NO VERIFICADO:** lector de pantalla real, carga sostenida multiusuario, recorrido comunitario completo con una aportación real publicada y respuesta operativa 24/7. El plan gratuito puede dormir o pausar servicios.

## Instalar en el móvil

Abre RutaViva desde su dirección HTTPS. Si el navegador ofrece «Instalar RutaViva», selecciónalo. En iPhone o iPad, abre el sitio en Safari, pulsa Compartir y elige «Añadir a pantalla de inicio». En Android, usa la opción de instalación del navegador si aparece. Los menús varían entre dispositivos.

La instalación crea un acceso y permite abrir la interfaz en modo aplicación. Sin Internet no se consultan mapas, incidencias, rutas, acceso ni se envían aportaciones; la pantalla explica que el servicio no respondió y permite reintentar. No se guarda información comunitaria para verla sin conexión.

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
13. `docs/VALIDACION-PILOTO-REAL.md`
14. `docs/OPERACION-PRODUCCION.md`
15. `docs/RECUPERACION-Y-ROLLBACK.md`
16. `docs/CHECKLIST-RELEASE.md`
17. `CONTRIBUTING.md`
18. `SECURITY.md`

## Instalar, comprobar y abrir

Requiere Node.js 24 o superior. Las dependencias están fijadas en `package-lock.json`.

```text
npm ci --cache .npm-cache
npm run build
npm run check
npm test
npm run test:integration
npm run smoke:production
npm start
```

También se puede usar `ABRIR-RUTAVIVA-COMMUNITY.cmd`. El lanzador acepta únicamente `127.0.0.1`, inicia el servidor y, si se habilita, el worker de correo. No abre el navegador automáticamente.

`npm run smoke:production` solo consulta mediante `GET` la portada y los endpoints públicos de salud, disponibilidad y arranque. No inicia sesión ni modifica datos. Para contribuir o comunicar una vulnerabilidad consulta `CONTRIBUTING.md` y `SECURITY.md`.

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
- `POST /api/v1/moderation/contributions/:id/resolve`
- `POST /api/v1/moderation/contributions/:id/reopen`
- `GET /`
- `GET /auth/verify`

La autenticación usa tokens de un solo uso de 15 minutos, UUID público más 256 bits aleatorios, hashes persistidos, cifrado AES-256-GCM para correo y outbox, máximo cinco sesiones activas y cookies opacas. El worker reclama con `SKIP LOCKED` y lease limitado. Solo un rechazo explícito `429` se reintenta con backoff de 1, 5, 15 y 60 minutos; red, timeout, `408`, `5xx`, respuesta inválida, pérdida de lease o fallo tras aceptación quedan terminales como resultado desconocido para evitar reenvío automático. Solo persiste el hash del identificador devuelto por el proveedor. El runtime conserva cero `SELECT` o DML sobre las tablas privadas.

La resolución y la reapertura exigen `Idempotency-Key`, versión vigente, motivo de 3 a 300 caracteres y una cuenta moderadora distinta de la autora. El historial conserva la acción; la auditoría guarda solo la huella del motivo. `PATCH /api/v1/contributions/:id` permite corregir por API todos los campos estructurados mientras el registro siga en borrador. La interfaz pública todavía no ofrece ese formulario de edición.

`EMAIL_PROVIDER=disabled` es el modo seguro por defecto. Las cuentas solo se anuncian y `request-link` solo persiste cuando están configurados base, los cuatro secretos de autenticación y un proveedor Brevo real. Una activación aprobada requiere `EMAIL_PROVIDER=brevo`, una `BREVO_API_KEY` privada y `BREVO_SENDER` verificado. `fake` solo está permitido con `NODE_ENV=test`. El cliente usa `fetch`, `AbortController`, HTML y texto sin recursos remotos e `idempotencyKey`; esta señal no se considera garantía de deduplicación. En el Bloque 25 se verificaron dos entregas reales, ambas aceptadas en el primer intento, sin probar una respuesta ambigua ni la deduplicación del proveedor.

`IDENTITY_ENCRYPTION_KEY` debe codificar exactamente 32 bytes como 64 caracteres hexadecimales o base64. `SESSION_SECRET`, `CSRF_SECRET` e `IP_HASH_SECRET` requieren al menos 32 caracteres. Son valores privados distintos y no deben copiarse a Git, documentación ni comandos compartidos.

`TRUST_PROXY_HOPS=0` mantiene ignorado `X-Forwarded-For` en desarrollo y test. Producción exige exactamente `TRUST_PROXY_HOPS=1`: únicamente se confía en el proxy inmediato, nunca en una cadena abierta. Los límites actuales son tres solicitudes por correo cada 15 minutos con respuesta silenciosa, diez por red y hora con `429`, reserva global de 250 al día con `503 EMAIL_CAPACITY_EXHAUSTED`, y veinte verificaciones por red cada 15 minutos. El bucket de red se consume siempre, aunque el correo ya esté limitado; la capacidad global solo se reserva si ambos permiten encolar. El HMAC de red rota cada 48 horas UTC; en el borde de ventana la cuota puede repartirse entre dos buckets.

El listado de zonas devuelve solo una caja geográfica (`bbox`), nunca el polígono completo, y usa un cursor opaco versionado. El seed identifica Sevilla y tres áreas piloto con nombres explícitamente aproximados. Las aportaciones deben quedar cubiertas por Sevilla y su zona, las líneas son simples y no superan 5 km. Un visitante anónimo ve únicamente contenido publicado; autor y moderadores tienen visibilidad adicional según rol.

El planificador no guarda origen ni destino. Ajusta ambos puntos a la red publicada a un máximo de 75 metros y rechaza puntos fuera de Casco Antiguo o separados menos de 25 metros. Una observación no publicada o resuelta no influye. En la variante conservadora actual, incluso una barrera comunitaria medida solo penaliza: ninguna aportación ciudadana excluye automáticamente un tramo. Solo los datos base OSM marcados como barrera pueden excluirlo del perfil accesible. Un atajo histórico nunca crea una arista nueva. Consulta `docs/DATOS-OSM.md`.

## Ficha de portfolio

**Descripción GitHub (máximo 350 caracteres):** Community-powered urban accessibility map for Seville. Report observable barriers, damaged walkways and difficult crossings; human moderation, explainable low-barrier routes, PostgreSQL/PostGIS, MapLibre and a production-minded Node.js backend.

**Topics:** `nodejs`, `fastify`, `postgresql`, `postgis`, `maplibre`, `openstreetmap`, `civic-tech`, `accessibility`, `seville`, `community`.

**Vídeo demo de 60 segundos:** 0–8 s, una barrera urbana; 8–20 s, mapa/lista y filtros por condición; 20–35 s, comunicar un paso estrecho sin datos personales; 35–47 s, moderación independiente; 47–55 s, ruta con menos barreras conocidas; 55–60 s, arquitectura, pruebas y límites.

## Límites

La modalidad gratuita puede suspender servicios, imponer cuotas o cambiar sus condiciones. El mapa tendrá alternativa textual y los fallos de proveedores no se presentarán como éxitos. RutaViva no garantiza seguridad ni sustituye señalización, autoridades o comprobación del entorno.

## Coste actual

0 €. Supabase, Render y Brevo se configuran en sus modalidades gratuitas, sujetas a cuotas, suspensión y cambios de condiciones. No se ha añadido tarjeta, plan de pago ni dominio propio.

## Copyright

Copyright © 2026 Jesús Valverde. All rights reserved. This source code is public for portfolio review; no open-source license is granted. See `LICENSE`.
