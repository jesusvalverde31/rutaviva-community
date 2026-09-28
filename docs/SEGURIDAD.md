# Seguridad propuesta

## Controles obligatorios

- Validación estricta, consultas parametrizadas, transacciones y restricciones SQL.
- Cookie de sesión opaca `Secure`, `HttpOnly` y `SameSite=Lax`; nada sensible en `localStorage`.
- Tokens aleatorios de un uso almacenados como hash, rotación y revocación.
- CSRF ligado a sesión más validación exacta de `Origin`; CORS sin comodín.
- Roles verificados en backend, denegación por defecto y separación de funciones.
- Rate limiting persistente por cuenta, operación e identificadores seudonimizados.
- CSP estricta, límites de cuerpo y contenido, cabeceras defensivas y errores sin trazas.
- Logs estructurados con `requestId`, sin secretos, correos completos ni IP en claro.
- Dependencias fijadas y auditadas únicamente en bloques que las aprueben.

## Amenazas prioritarias

Spam, bots, cuentas coordinadas, manipulación de votos, XSS, inyección, CSRF, secuestro de sesión, fuerza bruta, geometrías falsas, propiedad privada, rutas peligrosas, abuso de API, pérdida de datos y caída de proveedores.

Las señales antiabuso abren revisión; no condenan ni bloquean automáticamente. Un moderador no decide sobre contenido propio. Acciones administrativas requieren motivo, sesión reciente y auditoría.

## Respuesta

Detener publicación, ocultar cautelarmente, preservar evidencia mínima, rotar credenciales, informar alcance, restaurar desde copia ensayada y documentar aprendizaje. Este plan no está implementado ni probado.

## Controles implementados en el Bloque 21

Validación de entorno, escucha local, Host y Origin permitidos, límite de 64 KB, timeout de 10 segundos, request ID UUID, logs redactados, CSP y cabeceras Helmet, errores sin trazas y apagado ordenado. Al cierre del Bloque 21, autenticación, CSRF de sesión y rate limiting persistente quedaron pendientes; el Bloque 23 los implementó y verificó contra Supabase en la sección correspondiente.

## Controles implementados en el Bloque 22

- URLs distintas para ejecución y migración; ninguna se serializa ni registra.
- Rol de ejecución fijo con LOGIN endurecido, `NOBYPASSRLS`, sin membresías, privilegios administrativos, DDL ni DML.
- Contraseña del runtime de al menos 32 caracteres y credencial del migrador de al menos 16 para admitir claves fuertes generadas por el proveedor; el password del rol se envía parametrizado y no aparece en el SQL construido por Node ni en logs de la aplicación.
- TLS con verificación de certificado y nombre de host cuando está activado, obligatorio en producción y con CA pública de Supabase fijada mediante una ruta relativa interna al proyecto.
- Pool máximo de tres conexiones y tiempos límite de conexión, consulta y sentencia.
- Listener de error del pool que solo comunica el código controlado `DATABASE_POOL_ERROR`.
- Consultas públicas parametrizadas; filtros validados y respuestas sin errores nativos.
- Migraciones forward-only con secuencia continua, SHA-256, advisory lock y transacción por versión.
- Rollback ante error y rechazo de una migración aplicada que haya cambiado.
- Esquemas propios separados, privilegios mínimos, restricciones geográficas, claves foráneas e índices GiST. No se revocan permisos globales del esquema compartido `extensions`.
- Auditoría append-only preparada, aunque todavía no existen mutaciones de usuario.

Estos controles se probaron contra un proyecto Supabase Free real: TLS con CA, rol mínimo, cero membresías, denegación de DML/DDL, checksums, PostGIS, restricciones y rollback. Las credenciales permanecen únicamente en `.env`, ignorado por Git, y nunca deben entrar en logs, documentación o historial de terminal compartido.

## Controles implementados localmente en el Bloque 23

- Token de enlace con UUID y 256 bits aleatorios, válido 15 minutos y persistido solo como hash.
- Verificación atómica de un uso; una cuenta suspendida no se reactiva.
- HKDF-SHA256 deriva cuatro claves independientes desde la raíz de identidad: HMAC de correo, HMAC de petición, AES-256-GCM de identidad y AES-256-GCM de outbox; cada cifrado usa nonce único y etiqueta de autenticidad.
- Sesiones opacas: 30 días absolutos, 7 de inactividad, máximo cinco y revocación de la más antigua.
- La actividad de sesión solo escribe `last_seen_at` e inactividad una vez cada cinco minutos; listar y revocar vuelven a validar cuenta activa y ambas caducidades.
- Cookie `__Host-rv_session` segura en producción; nombre separado y sin `Secure` solo para HTTP local.
- HMAC CSRF ligado a sesión, comparación constante y comprobación exacta de Origin.
- Logout conserva la comprobación exacta de Origin aun sin sesión; una sesión válida exige CSRF y los reintentos posteriores limpian la cookie con `204`.
- Rate limits e idempotencia persistentes para solicitar enlaces. La clave idempotente tiene alcance global del endpoint y el hash de petición es un HMAC contextual secreto.
- Límite de verificación 20/15 min por red, límite de solicitud 10/h por red y reserva global 250/día; correo y red se contabilizan independientemente, el límite por correo permanece anti-enumeración y agotar capacidad global responde `503`.
- Advisory lock común por hash de correo para solicitar y verificar: ambas rutas lo toman antes de bloquear filas, evitando inversión de orden. La solicitud revoca enlaces activos anteriores y cancela sus mensajes pendientes.
- El rol `system` existe para procesos internos pero una restricción impide asignarlo a usuarios.
- Proxy desactivado localmente y limitado a un salto inmediato en producción.
- Auditoría sin correo, token ni identificador de red.
- El identificador seudónimo de red incluye una ventana UTC de 48 horas. En el borde cambia el bucket y un mismo cliente puede disponer temporalmente de cuota en ambos lados.
- El hash secreto del enlace se compara mediante un bucle fijo de 32 bytes; la función interna no es ejecutable por el runtime.
- Mutaciones encapsuladas en funciones `SECURITY DEFINER` con `search_path` fijo y `EXECUTE` mínimo.

La 005 se aplicó e hizo visible una referencia ambigua `42702` sin dejar datos de prueba; la corrección forward-only 006 se aplicó después. La integración final del bloque obtuvo 18/18 con rollback.

## Controles implementados en el Bloque 24

- Claim con `FOR UPDATE SKIP LOCKED`, lease de 30–300 segundos y token impredecible; la concurrencia real entre dos conexiones está NO VERIFICADA.
- Completar o fallar exige evento, worker, token y lease vigente. Un lease caducado queda terminal como outcome desconocido y no se reclama otra vez.
- Idempotencia del proveedor basada en el UUID del evento; solo se conserva hash del identificador de respuesta.
- Payload descifrado únicamente en memoria y logs restringidos a evento, intento, outcome y código cerrado.
- `fetch` con timeout y `AbortController`; ningún redirect y ningún recurso remoto en el cuerpo del correo.
- Token del fragmento eliminado de la URL antes de la primera petición; nunca DOM, storage o logs.
- CSRF obtenido justo antes de revocar o salir y un único reintento ante `CSRF_INVALID`.
- CSP sin inline/CDN, foco visible y reducción de movimiento.

Estado al cierre del Bloque 24: la migración 008 corrigió forward-only la política de 007; red, timeout, `408`, `5xx`, body inválido, apagado durante envío y fallo tras aceptación son `PROVIDER_OUTCOME_UNKNOWN` terminales. Solo un `429` inequívocamente rechazado se reintenta. El timeout cubre cabeceras y lectura limitada del body, y el lease conserva diez segundos de margen. La integración completa quedó 23/23 con rollback. En ese bloque todavía no se había hecho una llamada real a Brevo ni un envío real; la activación posterior se documenta en el Bloque 25.

## Verificación operativa del Bloque 25

Brevo Free y un remitente quedaron verificados y activos en el entorno privado. Dos solicitudes expresamente autorizadas terminaron `sent` en el primer intento; una se consumió y creó una sesión. No hubo reintentos ni respuestas ambiguas, por lo que la deduplicación del proveedor sigue no verificada. Se corrigió el cierre prematuro del worker en espera vacía y una prueba standalone conserva esa regresión.

Tras mostrarse accidentalmente un `.env` en una captura, se rotaron la contraseña propietaria de Supabase, la contraseña de `rutaviva_runtime`, `SESSION_SECRET`, `CSRF_SECRET`, `IDENTITY_ENCRYPTION_KEY` e `IP_HASH_SECRET`. La rotación se hizo con cero datos de identidad; después se verificaron conexiones propietaria/runtime, ocho migraciones sin cambios y la integración 23/23 con rollback. La clave Brevo no apareció en la captura y no se rotó. El nombre del archivo temporal usado en la entrega manual queda excluido explícitamente en `.gitignore`.

Supervisor, servidor y worker parsean `.env` sin `--env-file` y construyen un entorno nuevo mediante allowlist. Solo conservan las variables de configuración runtime y el mínimo de sistema necesario para crear procesos en Windows; nunca heredan `MIGRATION_DATABASE_URL`, `NODE_OPTIONS` ni secretos ajenos. Las variables runtime del shell prevalecen sobre `.env`. Únicamente el migrador y las pruebas de integración cargan explícitamente el entorno completo que contiene la credencial de migración.
