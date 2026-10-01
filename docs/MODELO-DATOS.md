# Modelo de datos

## Red peatonal versionada

`app.network_releases` identifica una importación OSM de una zona. `route_nodes.release_id` y `route_segments.release_id` aíslan sus datos y permiten publicar un release completo de forma atómica. El runtime no tiene `SELECT` directo sobre estas tablas: solo ejecuta `app_private.route_network_status()` y `app_private.get_route_network(...)`.

Las aportaciones publicadas reciben `routing_valid_until` según su tipo. Solo influyen mientras estén vigentes y no tengan una disputa comunitaria suficiente. Puntos cercanos afectan un tramo dentro de un radio acotado; líneas deben solaparse de forma sustancial, no basta con tocarlo. La red se importa como un release nuevo y solo se publica dentro de una transacción completa.

## Métricas públicas del piloto

La migración 017 expone tres funciones `SECURITY DEFINER` de solo lectura para estadísticas generales, zonas y ventanas de actividad. Todas se restringen a la ciudad piloto de Sevilla. Cuando hay de uno a cuatro autores distintos, los recuentos y fechas se suprimen; con cero participantes se devuelve cero. El runtime conserva únicamente permiso `EXECUTE`, no lectura directa de las tablas.

## Estado implementado en el Bloque 22

Las migraciones crean `extensions` para PostGIS, `app` para datos consumidos por la API y `app_private` para migraciones y auditoría. Están implementadas `cities`, `zones`, `route_nodes`, `route_segments`, `network_releases`, `schema_migrations` y `audit_events`. El seed incluye Sevilla y tres zonas aproximadas, sin nodos ni tramos.

La geometría usa SRID 4326, índices GiST y validación de geometrías. Triggers exigen que zonas, nodos y segmentos queden dentro de su ciudad; impiden reducir el límite urbano si dejaría cualquiera de esos objetos fuera; impiden mover un nodo referenciado; comprueban que los extremos de cada línea coincidan con sus nodos a menos de cinco metros; y recalculan la distancia desde PostGIS incluso si se intenta editar solo `distance_meters`, rechazando más de 5 km. Las zonas tienen `sort_order` estable. La auditoría es append-only. El resto de entidades de este documento sigue siendo propuesta.

Las validaciones geográficas se serializan mediante bloqueos de fila. Una mutación de segmento bloquea sus nodos por UUID y después las ciudades por UUID; zonas y nodos bloquean las ciudades afectadas por UUID; un cambio del límite ya posee el bloqueo de la ciudad. Las mutaciones futuras deben ejecutarse dentro de una única transacción y conservar ese orden; no deben leer, validar y escribir mediante transacciones separadas.

## Estado implementado localmente en el Bloque 23

La migración 005 añade `users`, `identities`, `roles`, `permissions`, `role_permissions`, `user_roles`, `email_verifications`, `sessions`, `outbox_events`, `api_idempotency` y `rate_limit_buckets`. `public_alias` es único y el backend lo genera con 64 bits del UUID; `version` viaja en autenticación y perfil. Las verificaciones registran consumo, revocación y hasta cinco intentos fallidos; el UUID del token es índice público y la parte secreta se conserva solo como hash y se compara con recorrido fijo de 32 bytes. Cada outbox referencia de forma única su verificación y pasa a `cancelled` si esa verificación se revoca o consume antes del envío. La idempotencia se indexa por un alcance global estable del endpoint, no por correo. `user_roles` rechaza `system` a nivel de base. Correo y payload de correo se cifran antes de persistir con claves derivadas distintas; tokens de acceso y sesión se guardan únicamente como hashes. La auditoría registra verificación, asignación inicial de rol, creación de sesión con roles y revocaciones automáticas con motivo, sin correo, token ni red. El rol runtime no recibe DML: invoca funciones `SECURITY DEFINER` con `search_path` fijo y permisos `EXECUTE` explícitos. La 005 está aplicada e inmutable; la 006 sustituyó únicamente la función de verificación para eliminar referencias PL/pgSQL ambiguas. Ambas están aplicadas y la integración real terminó 18/18 con rollback.

## Estado implementado en el Bloque 24

La migración 007 amplía `outbox_events` con propietario y token de lease, caducidad, código de fallo seguro, hash SHA-256 del identificador del proveedor y marca de actualización. Tres funciones `SECURITY DEFINER` realizan claim, confirmación y fallo; el runtime no puede leer ni modificar directamente la tabla. Los intentos tienen backoff persistente y estado terminal al quinto. Las verificaciones consumidas, revocadas o caducadas cancelan la entrega antes de reclamarla.

La clave estable de entrega es el UUID del evento y no contiene PII. La auditoría conserva únicamente evento, intento, outcome y códigos cerrados; nunca correo, token, enlace o identificador externo en claro.

La migración 008 mantiene 007 inmutable y cierra resultados ambiguos: todo lease caducado pasa a `failed` con `PROVIDER_OUTCOME_UNKNOWN`, sin volver a estar disponible. Una restricción exige `provider_message_hash` para `sent`, y la función de finalización rechaza valores nulos. Solo un rechazo explícito `429` puede volver a `pending` por decisión del worker.

## Convenciones

UUID, `timestamptz` UTC, claves foráneas, estados cerrados y control optimista mediante `version`. Las geometrías usarán SRID 4326, validación, perímetro de Sevilla e índices GiST. Las distancias se calcularán con `geography` o proyección métrica.

## Entidades

| Grupo | Tablas | Reglas esenciales |
| --- | --- | --- |
| Identidad | `users`, `identities`, `sessions`, `email_verifications` | Identidad privada separada; tokens solo como hash; sesiones revocables |
| Permisos | `roles`, `permissions`, `user_roles` | Denegación por defecto; cambios auditados |
| Territorio | `cities`, `zones`, `route_nodes`, `route_segments`, `segment_versions` | Solo administración modifica la red canónica |
| Comunidad | `contributions`, `contribution_geometries`, `confirmations`, `rejections`, `incidents`, `reports` | Señal única por usuario; contenido moderado antes de afectar rutas |
| Moderación | `moderation_cases`, `moderation_decisions` | Decisiones inmutables; prohibido revisar lo propio |
| Confianza | `reputation_events` | Libro mayor limitado; no es competición pública |
| Operación | `notifications`, `audit_events`, `system_jobs`, `outbox_events` | Auditoría append-only y reintentos idempotentes |
| Privacidad | `data_exports`, `deletion_requests`, `legal_acceptances` | Reautenticación, caducidad y anonimización |
| Protección | `api_idempotency`, `rate_limit_buckets`, `route_results` | Reintentos seguros, límites persistentes y rutas temporales |

## Integridad y concurrencia

- `UNIQUE(contribution_id,user_id)` en confirmaciones y rechazos, con exclusión mutua transaccional.
- Extremos distintos y geometría de tramo coincidente con nodos dentro de 5 m.
- Máximo propuesto: 500 vértices y 5 km por tramo aportado.
- `RESTRICT` para red publicada y auditoría; `CASCADE` solo para datos efímeros subordinados.
- Aportaciones públicas se retiran lógicamente; no se sobrescriben.
- Ediciones con `ETag`/`If-Match`; una versión obsoleta devuelve `412`.

## Fórmulas deterministas propuestas

### Confianza, reputación y antigüedad

Para cada señal válida: `peso_reputación = clamp(0,75; 1,50; 1 + reputación/200)` y `peso_voto = peso_reputación × (1 - penalización_sospecha)`. La reputación queda entre -100 y 100; una cuenta nueva pesa 1 y nadie supera 1,5.

Con `C` como suma de confirmaciones y `R` como suma de rechazos: `apoyo_bayesiano = (2 + C) / (4 + C + R)`. La diversidad es `0,50 × min(días_distintos/3, 1) + 0,50 × min(bandas_reputación_distintas/3, 1)`. La confianza es `100 × decaimiento × (0,60 × apoyo_bayesiano + 0,20 × calidad_estructural + 0,20 × diversidad)`.

El decaimiento es `2^(-edad/vida_media)`. Vidas medias iniciales: cierre o peligro, 24 h; obstáculo, 72 h; iluminación, 7 días; obras, 14 días; barrera persistente, 30 días. Tres confirmaciones independientes y confianza ≥70 permiten la etiqueta comunitaria, nunca publicación automática.

### Duplicados y abuso

`similitud = 0,50 × proximidad_geográfica + 0,30 × coincidencia_tipo + 0,20 × proximidad_temporal`. Con resultado ≥0,75 se abre un candidato, no una fusión automática. Puntos: 30 m; líneas: Hausdorff normalizada sobre 20 m.

`penalización_sospecha = min(0,80; 0,35 × ráfaga + 0,25 × red_seudonimizada + 0,25 × reciprocidad + 0,15 × incoherencia_geográfica)`. Una puntuación alta abre revisión; nunca suspende automáticamente.

### Routing

`coste_tramo = distancia × (1 + barrera + iluminación + incidencias + incertidumbre)` y `score_ruta = clamp(0; 100; round(100 × distancia_base/coste_total))`. El riesgo combinado de incidencias es `min(0,90; 1 - producto(1 - riesgo_i × confianza_i × vigencia_i))`. Iluminación toma el mayor riesgo entre dato base y aviso vigente, sin doble suma.

Una incompatibilidad de accesibilidad o cierre publicado excluye el tramo. La explicación mostrará distancia, cobertura, fecha y los tres factores dominantes. Menos del 80 % de atributos moderados genera aviso de datos insuficientes. Las estadísticas requieren al menos cinco personas por grupo y nunca muestran recorridos individuales.
