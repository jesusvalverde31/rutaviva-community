# Retención propuesta

| Dato | Plazo inicial |
| --- | --- |
| Verificación consumida o caducada | 24 horas |
| Sesión activa | 30 días absolutos; 7 días sin actividad |
| Sesión revocada | 30 días |
| Rate limit e identificador de red seudonimizado | 48 horas |
| Idempotencia normal | 24 horas |
| Idempotencia de exportación/borrado | 7 días |
| Resultado de ruta sin usuario/IP | 30 minutos |
| Borrador inactivo | 90 días |
| Notificación leída | 90 días |
| Outbox completado | 30 días |
| Denuncia/moderación cerrada | 24 meses propuestos |
| Auditoría administrativa | 24 meses propuestos |
| Exportación disponible | 48 horas |

Las aportaciones públicas se conservan hasta retirada, sustitución, caducidad o anonimización justificada. La vigencia se deriva de `expires_at` en cada consulta; no depende de un trabajador permanente. Los plazos largos requieren revisión jurídica antes de producción.

La migración 005 materializa las caducidades de 15 minutos para enlaces, 30 días absolutos y 7 días inactivos para sesiones, 24 horas para idempotencia y dos ventanas para buckets de rate limit. Un enlace nuevo marca como revocados los anteriores activos del mismo correo y cancela sus outbox pendientes; el consumo correcto y cinco fallos de hash también cancelan el mensaje del enlace afectado. Revocación no equivale todavía a eliminación física. La eliminación física posterior de filas caducadas requiere un job futuro; la validez lógica no depende de ese job.

Las migraciones 007/008 no cambian el plazo propuesto de 30 días para outbox completado. Los leases duran entre 30 y 300 segundos. Solo rechazos `429` se reintentan a 1, 5, 15 y 60 minutos y el quinto intento finaliza en `failed`; un lease caducado o outcome ambiguo termina inmediatamente. La eliminación física de eventos `sent`, `failed` o `cancelled` sigue pendiente de un job futuro.
