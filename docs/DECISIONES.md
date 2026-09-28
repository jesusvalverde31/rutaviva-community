# Registro de decisiones

## Aprobadas

- RutaViva será el primer proyecto convertido en producto público real.
- El proyecto nuevo se denomina provisionalmente `rutaviva-community`.
- Piloto para Sevilla y posibilidad futura de otras ciudades.
- PostgreSQL con PostGIS y dependencias profesionales justificadas.
- Cuentas verificadas y roles de colaborador, moderador y administrador.
- `rutaviva-local` se conserva intacto.
- Arquitectura A0 gratuita para el piloto.
- Modelo de datos, contrato API, fórmulas y políticas descritos en esta fundación.

## Pendientes de bloques posteriores

- Proveedor y creación de cuentas gratuitas.
- Corredores concretos del piloto y datos cartográficos licenciados.
- Credenciales, staging, dominio, publicación, tratamiento real de datos y push.
- Límites de carga verificados y decisión de pasar a infraestructura de pago.

Una decisión aprobada no equivale a implementación ni autoriza automáticamente servicios externos.

## Bloque 21

- Fastify 5.12.5 y @fastify/helmet 13.1.1, fijados por versión y con licencia MIT.
- Solo rutas versionadas `/api/v1/health` y `/api/v1/ready`; no se crean alias.
- Health no consulta dependencias. Ready permanece en 503 hasta PostgreSQL.
- Ejecución local exclusiva en `127.0.0.1:4329`; sin despliegue.

## Bloque 22

- `pg` 8.23.0 fijado exactamente; no se añade ORM ni generador de migraciones.
- Pool de ejecución máximo 3; rol fijo `rutaviva_runtime` y rol/URL de migración separados.
- El runtime puede usar 6543; la migración remota exige conexión directa o shared pooler de sesión en 5432.
- El rol runtime usa `NOBYPASSRLS` y la migración aborta si pertenece a cualquier otro rol.
- TLS verifica certificados; queda prohibido `rejectUnauthorized: false`.
- Migraciones forward-only: no se reescribe una versión aplicada y cada checksum queda registrado.
- PostGIS vive en `extensions`, datos públicos en `app` y metadatos internos en `app_private`.
- `extensions` se trata como esquema compartido: se concede `USAGE` al runtime sin revocar permisos de `PUBLIC` sobre el esquema completo.
- Las mutaciones geográficas se ejecutarán en una sola transacción y respetarán bloqueos de fila ordenados: nodos por UUID antes de ciudades por UUID.
- El servidor no migra al arrancar; `npm run migrate` es una operación explícita.
- El seed de Sevilla y sus tres zonas es aproximado y no incluye tramos ni afirma cobertura real.
- Desde el Bloque 24, `ready` exige rol efectivo, PostGIS, diecisiete relaciones, ocho funciones ejecutables y ocho migraciones exactas; correo y mapas no lo bloquean.
- `bootstrap` y `zones` son los únicos endpoints de datos nuevos y toda consulta variable se parametriza. Las zonas no publican polígonos: solo `bbox` y cursor opaco estable.

## Bloque 23

- Acceso sin contraseña mediante enlace mágico de un uso y 15 minutos.
- El token se entrega en fragmento URL para que no llegue en la petición inicial ni en logs HTTP.
- Correo, enlace y destinatario se guardan cifrados con claves AES-256-GCM derivadas y separadas; no se conecta Brevo todavía.
- Sesiones opacas con máximo cinco activas; la sexta revoca la más antigua.
- Cookies distintas por entorno: `__Host-rv_session` segura en producción y `rv_session` solo para desarrollo HTTP local.
- Roles y permisos residen en PostgreSQL; toda decisión de acceso se toma en backend.
- El runtime conserva cero DML directo sobre identidad y usa funciones `SECURITY DEFINER` restringidas.
- La migración 005 fue aplicada y base/PostGIS quedó 8/8; autenticación detectó `42702`, por lo que se preservó 005 y la corrección se aplicó exclusivamente mediante la migración forward-only 006. La integración final quedó en 18/18.
- Enlaces del mismo correo comparten un advisory lock tomado antes de cualquier bloqueo de fila; el más reciente revoca los anteriores y cancela sus mensajes pendientes.
- La idempotencia toma primero un lock de alcance global+clave y luego el lock de correo; reutilizar la clave con cualquier otro cuerpo devuelve `409`.
- Los índices HMAC y los dos cifrados usan claves independientes derivadas por HKDF-SHA256; la raíz no se usa directamente.
- El límite por correo no altera el `202`; red y verificación usan `429`, mientras la capacidad global agotada usa `503 EMAIL_CAPACITY_EXHAUSTED`; todos incluyen `Retry-After`.
- El identificador HMAC de red rota en ventanas UTC de 48 horas; una solicitud en el borde puede contabilizarse en la ventana siguiente.
- Logout exige Origin siempre, pero es idempotente: sin sesión válida limpia la cookie y responde `204`; con sesión válida exige CSRF.
- Producción confía exactamente en un proxy inmediato mediante `TRUST_PROXY_HOPS=1`; local permanece en `0`.
- Readiness exige también las cinco funciones expuestas y su permiso `EXECUTE` para el runtime.
- Las migraciones nunca rotan la contraseña de un runtime ya existente; una rotación futura será explícita para evitar ventanas de propagación del pooler.
- La migración 005 aplicada es inmutable; la corrección de referencias ambiguas de `verify_magic_link` vive en la migración forward-only 006.

## Bloque 24

- Una sola web vanilla del mismo origen, sin framework frontend, inline script, CDN ni dependencia nueva.
- El fragmento del enlace se elimina antes de cualquier `fetch`; se conserva solo para reintentos de red, `429` o `503`.
- `accounts` solo se anuncia cuando base, clave y proveedor de entrega están operativos.
- `EMAIL_PROVIDER=disabled` es el valor predeterminado; `fake` solo existe en test y `brevo` exige configuración explícita.
- Worker y API son procesos separados bajo un supervisor local sencillo; el lanzador rechaza hosts distintos de `127.0.0.1`.
- La migración 007 permanece inmutable y la 008 cambia forward-only los leases caducados a fallo ambiguo terminal; readiness exige ocho migraciones y ocho funciones.
- Brevo recibe `body.headers.idempotencyKey` igual al UUID del evento; no se considera garantía de deduplicación. PostgreSQL solo guarda SHA-256 del identificador de proveedor.
- Solo `429` se reintenta. Red, timeout, `408`, `5xx`, body inválido, apagado o fallo tras aceptación quedan terminales para impedir reenvío automático.
- Autenticación operativa exige base y cuatro secretos; entrega operativa añade Brevo real. `request-link` falla antes del servicio si falta cualquiera.
- Supervisor, API y worker reconstruyen su entorno con una allowlist runtime y precedencia del shell; la credencial de migración y cualquier variable ajena se eliminan antes de iniciar procesos hijos. Solo migrador e integración cargan `.env` completo de forma explícita.
- Estado al cierre del Bloque 24: todavía no se había ejecutado correo real. Su activación y un envío de prueba exigían confirmación inmediata separada; esa autorización llegó y su resultado queda registrado en el Bloque 25.

## Bloque 25

- Brevo Free queda activado únicamente mediante secretos privados en `.env`; la plantilla conserva valores ficticios y el proveedor seguro por defecto sigue siendo `disabled`.
- Se autorizaron dos envíos reales: el segundo fue una petición explícita del usuario al comprobar que el enlace loopback no podía abrir la app desde el móvil. Ambos terminaron `sent` en el primer intento.
- El temporizador de espera del worker debe conservar una referencia activa. Un timer `unref` hacía que el proceso standalone terminara con la outbox vacía; se retiró y se añadió una regresión con proceso hijo.
- La captura accidental de un `.env` se trata como exposición aunque ocurra en una conversación privada. Se rotaron contraseña propietaria, contraseña runtime y cuatro secretos internos antes de crear la cuenta real.
- El piloto continúa local: los enlaces apuntan al mismo ordenador. El acceso multidispositivo exige un origen HTTPS público y no se simula con red local.
