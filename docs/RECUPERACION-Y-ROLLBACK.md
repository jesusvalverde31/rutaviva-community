# Recuperación y rollback

## Si CI falla

No fusiones ni despliegues. Corrige en la misma rama y conserva la evidencia.

## Si Render falla antes de estar Live

Mantén la versión anterior, revisa el build y no publiques una release.

## Si health funciona pero ready falla

Comprueba primero Supabase, permisos y checksums. No hagas rollback de código a ciegas.

## Si el nuevo SHA queda Live pero el smoke falla

1. Anota SHA, hora, endpoint y `requestId`, sin copiar cuerpos sensibles.
2. Usa temporalmente el último despliegue correcto de Render si la incidencia es crítica.
3. Crea un `git revert` en una rama y tramítalo mediante PR.
4. Repite health, ready, portada y smoke.

No muevas una etiqueta publicada. Si una release contiene un error, corrige y publica la siguiente versión de parche.
