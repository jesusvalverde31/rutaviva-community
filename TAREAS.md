# Tareas

## Bloque 20

- [x] Estructura independiente del proyecto.
- [x] Arquitectura A0 documentada.
- [x] Modelo, contrato, seguridad, privacidad, moderación y retención documentados.
- [x] Plantilla de entorno sin secretos.
- [x] Comprobador estructural y prueba automatizada.
- [x] Comprobaciones finales del coordinador: `node --check`, verificador directo, 3/3 pruebas, `git diff --check`, rama y remoto.

## Siguientes bloques propuestos

1. Servidor, configuración validada y endpoints de salud.
2. PostgreSQL, PostGIS y migraciones.
3. Autenticación y sesiones.
4. Roles y permisos.
5. Red cartográfica y motor de rutas.
6. Aportaciones, confianza, moderación y privacidad.
7. Frontend público y paneles.
8. Observabilidad, seguridad, carga, staging y publicación aprobada.

Nada de esta segunda sección se considera implementado.

## Bloque 21

- [x] Configuración validada para desarrollo, test y producción.
- [x] Servidor Fastify con seguridad HTTP y errores uniformes.
- [x] `GET /api/v1/health` y `GET /api/v1/ready`.
- [x] OpenAPI limitado a los endpoints reales.
- [x] Pruebas de configuración, seguridad, readiness y errores.
- [x] Instalación limpia, auditoría, ejecución real y revisión final independiente.

## Bloque 22

- [x] Dependencia `pg` fijada y pool limitado a tres conexiones.
- [x] Credenciales de ejecución y migración separadas, con TLS verificable.
- [x] Rol `rutaviva_runtime` limitado: el migrador lo crea si falta y valida el existente sin rotar su contraseña.
- [x] Migración restringida a conexión directa o pooler de sesión remoto en 5432.
- [x] Migrador forward-only con advisory lock, secuencia, checksum y rollback.
- [x] PostGIS en `extensions`; datos en `app`; metadatos en `app_private`.
- [x] Territorio, red, índices GiST, validación de extremos y auditoría append-only.
- [x] Protección de límites urbanos y recálculo obligatorio de distancia ante cualquier edición.
- [x] Validaciones geográficas serializadas con bloqueos de fila ordenados para evitar `write skew`.
- [x] Seed aproximado de Sevilla sin nodos ni tramos.
- [x] Readiness real y consultas públicas parametrizadas para `bootstrap` y `zones`.
- [x] Readiness exhaustivo de rol, PostGIS, siete relaciones y cuatro checksums.
- [x] Paginación estable por `sort_order,id`, cursor opaco y zonas públicas sin polígonos.
- [x] Pruebas unitarias locales sin credenciales.
- [x] Crear proyecto gratuito de Supabase e introducir credenciales fuera de Git.
- [x] Ejecutar migraciones y pruebas de integración contra una base real aislada.
- [x] Revisión independiente local y comprobaciones finales del coordinador.

## Bloque 23

- [x] Migración de identidad, roles, permisos, sesiones, verificaciones, rate limits, idempotencia y outbox.
- [x] Funciones `SECURITY DEFINER` con `search_path` fijo y sin DML directo para el runtime.
- [x] Enlace mágico de un uso, hash del token y correo/outbox cifrados con claves AES-256-GCM separadas mediante HKDF-SHA256.
- [x] Sesión absoluta de 30 días, inactividad de 7 días y máximo de cinco activas.
- [x] Cookie segura según entorno, Origin exacto y CSRF ligado a sesión.
- [x] Endpoints de acceso, sesiones, CSRF y perfil mínimo.
- [x] Pruebas locales sintéticas e integración preparada con rollback.
- [x] Correcciones de concurrencia, revocación de enlaces, límites diferenciados y outcomes seguros.
- [x] Validación de proxy cerrado/local y un salto/producción.
- [x] Readiness de cinco funciones y OpenAPI completo de autenticación.
- [x] Aplicar la migración 006 forward-only y repetir la integración de autenticación con rollback: 18/18 en verde.
- [x] Aplicar migración 005 y observar 8/8 pruebas reales de base/PostGIS; autenticación detectó el fallo `42702` y revirtió sus datos de prueba.
- [x] Confirmar seis checksums, segunda migración con cero cambios y cero datos sintéticos persistidos.
- [x] Implementar el adaptador de proveedor y mantenerlo desactivado hasta configuración explícita.

## Bloque 24

- [x] Migración 007 forward-only con claim concurrente, leases, cinco intentos, backoff y auditoría sin PII.
- [x] Runtime limitado a tres funciones `EXECUTE`; sin lectura ni DML de outbox privado.
- [x] Cliente Brevo con `fetch`, timeout y señal `idempotencyKey` no considerada garantía; proveedor desactivado/fake para pruebas.
- [x] Worker con descifrado solo en memoria, apagado ordenado y logs redactados.
- [x] Portada y panel web vanilla, zonas, sesiones, revocación y logout con CSRF justo a tiempo.
- [x] Token retirado del fragmento antes de cualquier petición y retenido solo para reintentos transitorios.
- [x] Arranque local supervisado en `127.0.0.1` sin dependencias nuevas.
- [x] Migraciones 007 y 008 aplicadas forward-only; ocho verificadas y repetición con cero cambios.
- [x] Entrega fail-closed: base, cuatro secretos y Brevo real obligatorios antes de persistir.

## Bloque 25

- [x] Cuenta Brevo Free, teléfono y remitente verificados; clave API dedicada guardada solo en `.env`.
- [x] Proveedor real activado y dos entregas autorizadas confirmadas en el primer intento.
- [x] Recorrido real consumido en el mismo ordenador: usuario, identidad y sesión creados.
- [x] Contraseñas runtime/propietaria y cuatro secretos internos rotados después de una exposición accidental en captura.
- [x] Worker corregido para permanecer vivo con outbox vacía; regresión añadida.
- [x] Suite local 69/69 e integración Supabase 23/23 con rollback.
- [ ] Sustituir `PUBLIC_ORIGIN` local por dominio HTTPS antes de admitir accesos desde móvil u otros equipos.
- [x] Resultados externos ambiguos y leases caducados terminan sin reenvío automático; solo `429` reintenta.
- [x] Timeout cubre fetch y body, apagado cancela en curso y el sleep no acumula listeners.
- [x] UI consulta capacidades, traduce perfil, recupera sesiones/zonas y gestiona fin de sesión/logout idempotente.
- [x] Supervisor, servidor y worker cargan únicamente variables runtime permitidas y nunca conservan la URL de migración ni secretos ajenos.
- [x] Portada de escritorio y flujo de teclado observados; el salto al contenido mueve correctamente el foco al `<main>`.
- [ ] Renderizado en un dispositivo móvil real y lector de pantalla; las reglas 320/360 px solo tienen comprobación automatizada estática.
- [ ] Concurrencia de claim con dos conexiones reales; no verificada para evitar confirmar datos sintéticos fuera del rollback.

## Bloque 26

- [x] MapLibre fijado y servido desde el propio proyecto, teselas OSM con atribución y lista equivalente si el mapa falla.
- [x] Aportaciones Point/LineString dentro de Sevilla, filtros combinados, score 0–100, reacciones idempotentes e historial append-only.
- [x] CRUD REST validado con idempotencia de cuerpo, versión optimista, retirada y límites diarios serializados.
- [x] Cola de moderación con reclamación ajena, publicación/rechazo motivado y transacciones coherentes.
- [x] Visitantes limitados a contenido publicado; permisos directos de tablas revocados al runtime.
- [x] Dashboard con KPIs, canvas y tabla equivalente; responsive 360 px y controles táctiles/teclado.
- [x] OpenAPI 0.5.0, CI, Render Blueprint, guía de despliegue y plan del piloto.
- [x] Catorce migraciones aplicadas; `npm run check`, 80/80 locales y 25/25 de integración real en verde.
- [x] Rol `administrator` concedido de forma explícita a la única cuenta activa; herramienta posterior idempotente.
- [ ] Validación con una segunda cuenta real: una persona aporta y otra modera, porque la auto-moderación está prohibida.
- [ ] Prueba en móvil físico y lector de pantalla.
