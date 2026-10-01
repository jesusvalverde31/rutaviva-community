# Tareas

## Bloque 31 — RutaViva Accesible

- [x] Reenfocar portada, ayuda y presentación hacia barreras urbanas y movilidad inclusiva.
- [x] Mantener `shortcut` como dato histórico compatible y fuera del primer plano.
- [x] Añadir migración 021 aditiva con condición, grupos potencialmente afectados, fecha, permanencia, medición, anchura y ciclo abierto/resuelto.
- [x] Añadir filtros combinados, formulario guiado, confirmación de privacidad y estados textuales equivalentes al mapa.
- [x] Aplicar una política de rutas conservadora: pendiente/resuelta no afecta; una ciudadana publicada puede penalizar, pero nunca excluye automáticamente; solo una barrera base OSM excluye en este MVP.
- [x] Hacer resolución y reapertura idempotentes, versionadas, auditadas y prohibidas al autor; la auditoría guarda una huella, no el motivo completo.
- [x] Permitir por API la corrección cerrada de todos los campos estructurados de un borrador; la interfaz de edición sigue pendiente.
- [x] Aplicar migraciones 021 y 022 en Supabase; verificar 22/22 y ejecutar integración real 27/27 con rollback.
- [ ] Medir y validar sobre el terreno el primer posible estrechamiento; la fotografía aportada no se publica.
- [ ] Ampliar la red de rutas fuera de Casco Antiguo tras una prueba de capacidad independiente.

## Bloque 29

- [x] Motor Dijkstra determinista con perfiles directo y accesible.
- [x] API anónima validada, límite de 4 KB y rate limit 30/10 min.
- [x] Red OSM versionada e importador transaccional manual.
- [x] Planificador visual y recorrido textual accesible.
- [x] OpenAPI, pruebas unitarias y documentación ODbL preparadas.
- [x] Aplicar migraciones 015-020 en Supabase.
- [x] Ejecutar la importación OSM real y comprobar el release: 12.272 nodos y 27.620 tramos.
- [x] Ejecutar la prueba de integración real: 26/26 en verde y rollback sin residuo.
- [x] Preparar credibilidad pública, guía accesible ampliada y presentación comercial.
- [x] Publicar el Bloque 29 mediante el PR #2, integrado en `main` con el commit `56d3845`.
- [x] Publicar el diagnóstico mediante el PR #3, integrado en `main` con el commit `670a7c3`.
- [x] Verificar Render `Live`: `/api/v1/health` 200, `/api/v1/ready` 200 con seis comprobaciones correctas, `/api/v1/stats` 200 y `/api/v1/routes/search` 200 en una muestra de 816 m y puntuación 84.

## Bloque 30

- [x] Preparar la guía operativa, criterios de aceptación y plantilla de evidencia del primer piloto real.
- [x] Documentar separación técnica de cuentas, privacidad, errores seguros y resultado válido aunque una ruta no cambie.
- [ ] Confirmar qué cuenta será autora y cuál moderadora; se recomienda personal autora y laboral moderadora.
- [ ] Recibir de Jesús un caso real: tipo, ubicación pública, punto/línea, título, descripción, fecha/vigencia, confirmación sin datos personales y trayecto A/B.
- [ ] Ejecutar y documentar la ruta anterior, aportación, moderación con otra cuenta y ruta posterior; ambas cuentas las opera Jesús en este piloto.
- [ ] Validar en una fase futura la independencia humana con una persona autora y otra moderadora.
- [ ] Comprobar visibilidad, puntuación e historial del caso real en la web pública.

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
- [ ] Validación con una segunda cuenta real operada por Jesús: una cuenta aporta y otra modera, porque una cuenta no puede moderar su propia aportación. La validación con dos personas distintas queda para una fase futura.
- [ ] Prueba en móvil físico y lector de pantalla.

## Bloque 27

- [x] Despliegue público gratuito en Render conectado a Supabase y Brevo.
- [x] Acceso confirmado desde ordenador y teléfono móvil mediante HTTPS.
- [x] Dos cuentas reales activas, ambas con roles `collaborator` y `moderator`.
- [x] Herramienta segura e idempotente de concesión por correo autorizado, con auditoría sin PII y 7 pruebas específicas.
- [x] Suite local ampliada y comprobaciones públicas de `health`, `ready`, CSP y permisos.
- [ ] Crear una aportación verdadera con una cuenta y revisarla/publicarla con la otra.
- [ ] Comprobar la aportación publicada, su score y su historial en la web pública.

## Bloque 28

- [x] Enlace «Cómo usar» visible sin sesión.
- [x] Guía estática con siete recorridos, resumen, glosario, privacidad, seguridad y ayuda ante errores.
- [x] Flujos reales documentados para explorar, entrar, aportar, dibujar, enviar, moderar y confirmar.
- [x] Separación de funciones explicada: una cuenta no puede revisar su propia aportación.
- [x] Navegación por teclado y salto al contenido comprobados en navegador.
- [x] Vista de 360 px comprobada: ancho de documento 345/345, tabla de 301 px y cero elementos desbordados.
- [x] Suite local 90/90 y revisión independiente aprobada sin hallazgos pendientes.
- [x] Bloque 28 publicado en `main` y comprobado en la URL pública: guía visible, `health` 200 y `ready` 200.
- [ ] Auditoría con lector de pantalla real.
