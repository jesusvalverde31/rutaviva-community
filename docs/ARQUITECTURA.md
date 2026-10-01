# Arquitectura A0 gratuita

## Cálculo A→B

El navegador envía únicamente origen y destino a `POST /api/v1/routes/search`. La API valida piloto, distancia, tamaño y cuota; el repositorio obtiene un grafo dirigido acotado mediante una función `SECURITY DEFINER`; Node calcula de forma determinista las opciones directa y accesible. Las coordenadas de búsqueda no se persisten ni se incluyen en logs. Las API de OpenStreetMap y, como respaldo, Overpass solo intervienen en la importación manual: las consultas de usuarios leen el release publicado en PostGIS.

## Estado

**IMPLEMENTADOS el servidor, PostgreSQL/PostGIS, identidad, web local y canal de entrega; la conexión real de Brevo permanece desactivada hasta configuración explícita.**

```text
Navegador
   │ HTTPS
   ▼
Render Free: frontend + API Node.js
   ├── Supabase Free: PostgreSQL + PostGIS
   ├── Brevo Free: correo transaccional
   └── MapLibre + MapTiler Free: presentación cartográfica
```

El navegador solo habla con la API. No recibe credenciales de base de datos ni accede directamente a Supabase. El motor de rutas vive separado de las aportaciones y usa únicamente versiones publicadas.

El Bloque 21 implementó Fastify, configuración validada, seguridad HTTP, errores y health checks. El Bloque 22 incorpora `pg`, migraciones, integridad espacial y consultas públicas, y conecta un proyecto Supabase Free mediante roles separados y TLS verificable. El navegador sigue sin acceso directo a PostgreSQL.

El Bloque 23 añade funciones de base de mínimo privilegio para identidad, enlace mágico, sesiones, roles, límites persistentes, idempotencia y outbox cifrado. Node genera los tokens y deriva mediante HKDF-SHA256 claves independientes para índices HMAC y cada dominio de cifrado; PostgreSQL solo conserva hashes o ciphertext. La idempotencia de `request-link` tiene alcance global del endpoint, por lo que reutilizar una clave con otro correo produce `409`.

El Bloque 24 incorpora una única web del mismo origen y un worker separado. El supervisor local inicia API y worker y termina ambos ordenadamente. La base arbitra claims con `SKIP LOCKED` y lease; la exclusión con dos conexiones reales permanece NO VERIFICADA. Brevo recibe `body.headers.idempotencyKey`, pero no se trata como garantía de deduplicación. El payload solo se descifra en memoria. `EMAIL_PROVIDER=disabled` evita contacto externo por defecto; `fake` queda restringido a test y `brevo` exige base, cuatro secretos, clave y remitente explícitos.

En desarrollo y test no se confía en cabeceras de proxy. Producción exige un único salto confiable para que los límites por red usen la dirección entregada por el proxy inmediato sin aceptar una cadena arbitraria. Readiness también comprueba existencia y `EXECUTE` de las ocho funciones expuestas y ocho migraciones; no accede al contenido de tablas privadas.

La API usa un pool de hasta tres conexiones y el rol fijo `rutaviva_runtime`, sin DDL ni DML directo y con `SELECT` únicamente sobre ciudades, zonas y la tabla de migraciones necesaria para readiness. Las operaciones de identidad entran por funciones de seguridad definidas y permisos `EXECUTE` concretos. El runtime puede usar el pooler transaccional. El script `npm run migrate` usa una URL distinta con permisos de migración y `CREATEROLE`, conexión directa o shared pooler en modo sesión por 5432, bloqueo asesor y transacciones; crea el LOGIN si falta y valida un rol existente sin rotar su contraseña. La rotación será una operación explícita coordinada con el pooler. El servidor web no ejecuta DDL al arrancar.

## Degradaciones obligatorias

- Render dormido: espera y reintento conservando el formulario.
- Base no disponible: `503`; ningún falso éxito.
- Mapas no disponibles: lista y explicación textual completas.
- Correo no configurado: `accounts=false` y `request-link` falla antes de persistir.
- Resultado externo ambiguo: evento terminal para evitar reenvío automático; requiere revisión operativa.
- Jobs dormidos: `expires_at` decide vigencia en cada consulta.

## Límites

Piloto no comercial, sin SLA, sin dominio propio, sin fotografías y con cobertura progresiva. Nada persistente dependerá del disco efímero del servidor web. La migración futura conservará el contrato `/api/v1`, las migraciones y adaptadores de proveedores.
