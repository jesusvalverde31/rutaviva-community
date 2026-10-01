# Registro inicial de riesgos

## Riesgos añadidos por el enfoque de accesibilidad

- Una observación puede confundirse con una certificación: toda ficha y ruta distingue observada, medida, publicada y resuelta.
- Una anchura estimada puede ser incorrecta: se etiqueta separadamente y no habilita exclusión automática.
- Un punto puede quedar fuera de la red vigente: se admite como aportación de Sevilla, pero el planificador declara que hoy solo calcula sobre Casco Antiguo.
- Una fotografía puede incluir personas o portales: no se almacenan fotografías en la v1.
- El lenguaje puede estigmatizar: la interfaz describe condiciones del entorno, no capacidades personales.

| Riesgo | Impacto | Mitigación propuesta | Estado |
| --- | --- | --- | --- |
| Ruta o incidencia incorrecta | Crítico | Moderación, caducidad, explicaciones y lenguaje orientativo | No verificado |
| Propiedad privada o zona prohibida | Crítico | Ocultación rápida, denuncia y bloqueo de tramo | No verificado |
| Manipulación coordinada | Alto | Peso limitado, diversidad, señales de abuso y revisión | No verificado |
| Filtración de identidad/ubicación | Crítico | Separación, minimización, cifrado y anonimización | No verificado |
| Sesión robada | Alto | Cookie segura, rotación, revocación y CSRF | No verificado |
| Pérdida de datos | Alto | Copia cifrada y restauración ensayada | No verificado |
| Proveedor gratuito suspendido | Alto | Degradación, exportación y adaptadores sustituibles | No verificado |
| Mapa no disponible | Medio | Lista textual equivalente | No verificado |
| Moderación saturada | Alto | Cobertura limitada, prioridades y métricas | No verificado |
| Coste inesperado | Alto | Sin tarjeta/overage, alertas y bloqueo preventivo | No verificado |

El Bloque 23 mitiga enumeración de cuentas, robo de tokens persistidos, CSRF, exceso de sesiones, confianza abierta en proxies y DML directo del runtime. Las migraciones 005/006 y la integración de autenticación se verificaron; quedan pendientes concurrencia real entre dos conexiones del mismo correo, recuperación, entrega de correo y rotación operativa de claves. Perder `IDENTITY_ENCRYPTION_KEY` haría irrecuperables los correos cifrados; exponerla comprometería identidad y outbox, por lo que la gestión y copia segura de esa clave es requisito de despliegue.

El Bloque 24 mitiga reclamaciones repetidas, procesos interrumpidos, filtración del token en URL y logs, y falsos positivos de correo enviado. La deduplicación de Brevo NO se considera fiable ni verificada aunque se envíe `idempotencyKey`: toda respuesta ambigua queda terminal y requiere revisión, evitando reenvío automático. Esto puede perder una entrega que el proveedor no aceptó; es preferible a duplicarla. La exclusión con dos conexiones reales, Brevo real, accesibilidad asistiva, recuperación ante desastre y carga siguen NO VERIFICADOS.

El Bloque 25 verificó Brevo real con dos entregas de primer intento y un acceso consumido, pero no ejercitó deduplicación, respuesta ambigua ni concurrencia de dos workers. La rotación posterior a una captura accidental dejó inútiles las credenciales expuestas. Persiste un riesgo operativo: `.env` vive en el pendrive y no sustituye una copia segura en un gestor de contraseñas. Hasta desplegar HTTPS público, un enlace abierto desde móvil apunta al propio móvil y no a RutaViva.

La arquitectura reduce riesgos, pero no acredita ausencia de fallos. El piloto no abrirá producción hasta completar staging, seguridad, restauración, carga y aprobación inmediata de publicación.
