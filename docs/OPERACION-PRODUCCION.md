# Operación de producción

La cadena prevista es: rama corta → PR → CI `verify` → fusión squash → Render → smoke público → release.

## Comprobación diaria

- La portada debe servir HTTPS.
- `/api/v1/health` valida el proceso web.
- `/api/v1/ready` valida base, rol, PostGIS, migraciones, relaciones y funciones.
- `health=ok` no demuestra por sí solo que Supabase esté disponible.

## Publicación

1. Completa `docs/CHECKLIST-RELEASE.md`.
2. Fusiona solo con CI verde.
3. Comprueba que Render muestra el SHA fusionado como `Live`.
4. Ejecuta `npm run smoke:production` o el workflow manual `Production smoke` desde `main`.
5. Publica una release solo después del smoke verde.

Render Free puede tardar en despertar. El smoke reintenta únicamente errores transitorios, tiene un presupuesto global máximo de cuatro minutos y nunca autentica ni modifica datos.
