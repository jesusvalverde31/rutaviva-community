# Despliegue público

La beta usa un único servicio web Node en Render Free y la base Supabase Free existente. `render.yaml` no contiene secretos: Render los solicita en el panel. El servidor deriva su origen HTTPS de `RENDER_EXTERNAL_HOSTNAME`, escucha el `PORT` asignado en `0.0.0.0` y confía exactamente en un proxy.

Antes de desplegar se aplican las migraciones desde el equipo autorizado. Render recibe solo `DATABASE_URL` del rol runtime; nunca recibe `MIGRATION_DATABASE_URL`. El build ejecuta `npm ci --omit=dev` y copia los cuatro assets fijados de MapLibre. El health check es `/api/v1/health`; `/api/v1/ready` confirma base, PostGIS, funciones, permisos y checksums.

Render Free puede dormir tras inactividad y Supabase Free puede pausarse. Esta beta no ofrece SLA. No se añade método de pago ni dominio propio en este bloque.
