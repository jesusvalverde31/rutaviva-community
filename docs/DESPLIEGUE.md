# Despliegue público

La beta usa un único servicio web Node en Render Free y la base Supabase Free existente. `render.yaml` no contiene secretos: Render los solicita en el panel. El servidor deriva su origen HTTPS de `RENDER_EXTERNAL_HOSTNAME`, escucha el `PORT` asignado en `0.0.0.0` y confía exactamente en un proxy.

Antes de desplegar se aplican las migraciones desde el equipo autorizado. Render recibe solo `DATABASE_URL` del rol runtime; nunca recibe `MIGRATION_DATABASE_URL`. El build ejecuta `npm ci --omit=dev` y copia los cuatro assets fijados de MapLibre. El health check es `/api/v1/health`; `/api/v1/ready` confirma base, PostGIS, funciones, permisos y checksums.

Render Free puede dormir tras inactividad y Supabase Free puede pausarse. Esta beta no ofrece SLA. No se añade método de pago ni dominio propio en este bloque.

## Flujo de release

1. Crea una rama corta desde `origin/main`.
2. Ejecuta `npm run build`, `npm run check`, `npm test` y `git -c core.whitespace=cr-at-eol diff --check`.
3. Abre una PR; `verify` debe quedar en verde.
4. Fusiona mediante squash y comprueba el mismo SHA en Render como `Live`.
5. Ejecuta `npm run smoke:production` o el workflow manual `Production smoke` desde `main`.
6. Crea la etiqueta y la GitHub Release solo después del smoke verde.

Consulta `docs/OPERACION-PRODUCCION.md`, `docs/RECUPERACION-Y-ROLLBACK.md` y `docs/CHECKLIST-RELEASE.md`. `/health` mide vida del proceso; `/ready` valida dependencias. Nunca copies secretos a una incidencia, log compartido o comando documentado.
