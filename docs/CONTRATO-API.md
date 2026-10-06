# Contrato API y hoja de ruta

## Aportaciones de accesibilidad — Bloque 31

`POST /api/v1/contributions` acepta de forma conjunta `conditionType`, `affectedGroups`, `observedOn`, `permanence`, `measurementStatus`, `clearWidthCm` y `personalDataConfirmed=true`. Solo un atajo histórico puede conservar el cuerpo anterior; cualquier nueva observación de accesibilidad exige el conjunto completo. `GET /api/v1/contributions` añade filtros combinables `conditionType`, `lifecycle` y `affectedGroup`. La respuesta sanitizada expone condición, grupos potencialmente afectados, medición y ciclo, pero nunca datos de identidad.

`PATCH /api/v1/contributions/:id` corrige un borrador propio con control de versión. Para una observación accesible recibe juntos `zoneId`, `kind`, geometría y todos los campos estructurados; el esquema es cerrado y la base vuelve a validar sus combinaciones. La interfaz carga las observaciones estructuradas en el formulario y conserva la geometría cuando el mapa no está disponible. Los atajos históricos siguen usando la variante heredada de título, descripción y geometría y no se convierten desde el editor estructurado. `POST /api/v1/moderation/contributions/:id/resolve` y `/reopen` requieren `Idempotency-Key`, versión y motivo de 3 a 300 caracteres; replay exacto devuelve el mismo resultado, mientras reutilizar la clave con otro payload responde conflicto.

## Reportes de contenido — Bloque 39

`POST /api/v1/contributions/:id/reports` exige sesión, `Origin`, CSRF e `Idempotency-Key`. Acepta una de cinco razones cerradas y un detalle opcional de hasta 500 caracteres. Solo admite aportaciones publicadas, limita a diez reportes por cuenta y 24 horas y conserva un único reporte pendiente de la misma cuenta sobre la misma aportación. Crearlo nunca modifica ni retira la aportación.

`GET /api/v1/moderation/reports?status=pending|resolved|dismissed&limit=` devuelve una cola privada sin identidad del reportante. Excluye los reportes creados por la propia cuenta moderadora y los relativos a contenido de su autoría. `POST /api/v1/moderation/reports/:id/dismiss` y `/resolve` exigen versión, motivo de 3 a 300 caracteres, CSRF e idempotencia. `dismiss` mantiene la publicación; `resolve` la retira tras decisión humana independiente.

## `POST /api/v1/routes/search`

Operación anónima y no persistente. Acepta exactamente `{origin:{latitude,longitude},destination:{latitude,longitude}}`, hasta 4 KB. Limita a 30 cálculos por red cada diez minutos. Devuelve `direct` y, cuando difiere y existe, `accessible`, con distancia, minutos, score, cobertura, GeoJSON, tramos, factores y avisos. Errores de negocio: `OUTSIDE_PILOT`, `NO_NEARBY_NETWORK`, `ORIGIN_DESTINATION_TOO_CLOSE`, `NO_ROUTE_FOUND` y `ROUTING_DATA_NOT_READY`; todos incluyen `requestId`.

## Credibilidad pública

- `GET /api/v1/stats`: métricas del piloto, tasa de publicación tras moderación, tiempo medio y versión de red.
- `GET /api/v1/zones/leaderboard` y `GET /api/v1/zones/:slug`: actividad por zona y caja aproximada, nunca el polígono completo.
- `GET /api/v1/methodology`: fórmula y reglas realmente implementadas, con las propuestas marcadas como tales.
- `GET /api/v1/activity/summary`: ventanas agregadas de 7 y 30 días.
- `GET /api/v1/openapi.json`, `GET /sitemap.xml` y `GET /robots.txt`: contrato e indexación pública. La ruta de verificación queda excluida de buscadores.

Las respuestas usan `ETag` y caché pública acotada. Si un grupo tiene entre una y cuatro personas, los recuentos y fechas se devuelven como `null` con `privacySuppressed=true`; cero se mantiene como cero para distinguir ausencia real de supresión.

## Convenciones

- Prefijo `/api/v1`; OpenAPI 3.1 será contractual.
- JSON, esquemas cerrados, 64 KB por defecto y 256 KB para geometrías.
- Cursor opaco, 20 resultados por defecto y 100 máximo.
- `Idempotency-Key` en mutaciones; mismo cuerpo repite respuesta y cuerpo distinto devuelve `409`.
- `If-Match` en edición/transición: ausente `428`, obsoleto `412`.
- Errores con `code`, mensaje seguro, campos y `requestId`.
- No existirá un `/api/v1/state` global.

## Superficie inicial

| Área | Endpoints principales | Acceso y garantías |
| --- | --- | --- |
| Salud | `GET /api/v1/health`, `GET /api/v1/ready` | Público; sin secretos. Implementado en el Bloque 21 |
| Arranque | `GET /api/v1/bootstrap`, `GET /api/v1/zones` | Público, filtrado y paginado; implementado en el Bloque 22 |
| Rutas | `POST /routes/search` | Anónimo; resultado no persistente, explicable y orientativo |
| Credibilidad | `GET /stats`, `/zones/leaderboard`, `/zones/:slug`, `/methodology`, `/activity/summary` | Público; agregado, cacheado y con supresión de grupos pequeños |
| Acceso | `POST /auth/request-link`, `POST /auth/verify`, `POST /auth/logout` | Implementado localmente; respuesta anti-enumeración y token de un uso |
| Sesiones | `GET /auth/sessions`, `DELETE /auth/sessions/:id`, `GET /auth/csrf` | Implementado localmente; cuenta propia |
| Perfil | `GET /users/me`; `PATCH` pendiente | Lectura propia implementada; edición pendiente |
| Privacidad | `POST /users/me/export`, `GET /users/me/exports/:id`, `POST /users/me/deletion`, `POST /users/me/deletion/:id/confirm` | Sesión reciente e idempotencia |
| Aportaciones | `GET/POST /contributions`, `GET/PATCH /contributions/:id` | Público sanitizado o autor |
| Flujo | `POST /contributions/:id/submit|withdraw`, `POST /contributions/:id/revisions` | Transiciones explícitas |
| Señales | `POST /contributions/:id/confirm|reject`, `DELETE /contributions/:id/reaction` | Verificado, no contenido propio |
| Incidencias | `GET/POST /incidents`, `GET /incidents/:id` | Crear genera aportación pendiente |
| Reportes | `POST /contributions/:id/reports`, `GET /moderation/reports`, decisiones `dismiss|resolve` | Cuenta autenticada; cola privada y revisión humana independiente |
| Moderación | `GET /moderation/cases`, acciones `claim`, `publish`, `reject`, `hide`, `resolve-appeal` | Moderador sin conflicto de interés |
| Administración | usuarios, roles, importaciones, jobs y auditoría | Administrador y reautenticación |

Las acciones exactas de moderación son `POST /moderation/cases/:id/claim`, `/request-information`, `/publish`, `/reject`, `/hide` y `/resolve-appeal`. Administración incluye `GET /admin/users`, `POST /admin/users/:id/suspend`, `PUT /admin/users/:id/roles`, `POST /admin/network/imports`, `POST /admin/jobs/:id/retry` y `GET /admin/audit-events`.

Cada endpoint declarará en OpenAPI autenticación, permiso, esquema cerrado, respuesta, errores, paginación, idempotencia, límite, auditoría y casos de prueba. Las respuestas públicas excluyen correo, hashes, sesiones y notas internas.

## Errores y límites

Se diferencian `400`, `401`, `403`, `404`, `409`, `412`, `413`, `415`, `422`, `428`, `429` y `503`. En acceso están implementados límites persistentes: enlace 3 por correo/15 min con `202` silencioso, 10 por red/hora con `429`, reserva global 250/día con `503 EMAIL_CAPACITY_EXHAUSTED` y verificación 20 por red/15 min con `429`. Correo y red se contabilizan siempre de forma independiente; la reserva global solo se consume si ambos permiten continuar. La ruta anónima está limitada de forma persistente a 30 cálculos por red cada 10 minutos. Aportación 5/día, reacción 30/día, denuncia 10/día y exportación 2/día siguen PROPUESTOS.

En el Bloque 21, `/api/v1/health` confirma solo que el proceso responde. `/api/v1/ready` devuelve `503 SERVICE_NOT_READY` hasta que PostgreSQL y las migraciones estén disponibles. Correo y mapas serán degradables y no determinarán readiness.

Desde el Bloque 31, `ready` exige el rol efectivo `rutaviva_runtime`, PostGIS en `extensions`, 23 relaciones requeridas, 31 funciones con permiso `EXECUTE` y coincidencia exacta de versión, nombre y checksum de las 22 migraciones locales. `bootstrap` devuelve servicio, versión, piloto, capacidades, enlaces y advertencia de ruta orientativa. `zones` admite `q`, cursor opaco base64url versionado y límite 1–100; ordena por `sort_order,id`, responde `data` y `page`, y expone solo `bbox`, nunca polígonos. Las consultas son parametrizadas. Si no hay base, los recursos dependientes responden un problema seguro, sin mensajes nativos del proveedor.

El Bloque 23 exige `Origin` exacto para mutaciones. `request-link` requiere `Idempotency-Key` de 16–128 caracteres; la clave tiene alcance global para ese endpoint, su repetición exacta devuelve el resultado guardado y su reutilización con otro correo devuelve `409`. Responde `202` cuando la solicitud puede procesarse, sin revelar cuentas. `verify` recibe el token que el frontend extraiga del fragmento URL; el fragmento no viaja en la petición inicial al servidor. Las rutas de sesión requieren cookie opaca y las mutaciones autenticadas requieren además `X-CSRF-Token`. Logout es idempotente y siempre exige Origin: con sesión válida exige CSRF y revoca; sin sesión válida limpia la cookie y devuelve `204`. Los objetos de usuario incluyen `version` para futuros cambios optimistas.

La web se sirve en `GET /` y `GET /auth/verify` con CSP sin scripts inline ni CDN. La capacidad `accounts` solo es `true` cuando base, `SESSION_SECRET`, `CSRF_SECRET`, `IDENTITY_ENCRYPTION_KEY`, `IP_HASH_SECRET` y Brevo real están configurados. Si no, `request-link` devuelve `503 EMAIL_DELIVERY_NOT_CONFIGURED` antes de invocar el servicio o persistir. La respuesta de verificación incluye `status` además de alias, versión y roles.

`verify` devuelve `401` uniforme para enlace inexistente, consumido, caducado, revocado o hash incorrecto; `403 ACCOUNT_UNAVAILABLE` para cuenta suspendida o no activa; y `429` con `Retry-After` para límite de red. El UUID visible localiza la fila y la parte aleatoria se compara mediante hash. La documentación OpenAPI enumera cuerpos de éxito, headers y respuestas reales sin incluir tokens de ejemplo.
