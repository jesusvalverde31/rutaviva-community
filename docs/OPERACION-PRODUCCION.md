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
4. Ejecuta `npm run smoke:production` o el workflow manual `Production smoke` desde `main`. El smoke usa exclusivamente `GET` y comprueba nueve recursos públicos: `/api/v1/health`, `/api/v1/ready`, `/api/v1/bootstrap`, `/`, `/manifest.webmanifest`, `/service-worker.js`, `/offline.html`, `/icon-192.png` y `/icon-512.png`.
5. Publica una release solo después del smoke verde.

Render Free puede tardar en despertar. El smoke reintenta únicamente errores transitorios, tiene un presupuesto global máximo de cuatro minutos y nunca autentica ni modifica datos. Valida status y MIME esperados, los campos básicos de instalación del manifiesto, `Cache-Control: no-cache` del service worker, la semántica/mensaje neutral de la página offline y firma, dimensiones exactas y límite de 128 KiB para ambos iconos PNG. No comprueba endpoints privados, no crea contenido, no ejecuta una instalación en móvil, no prueba un lector de pantalla ni demuestra que mapas, API o aportaciones funcionen realmente sin conexión.

## Sesiones y enlaces mágicos

- El enlace mágico inicia sesión únicamente en el navegador y dispositivo donde se abre. Abrirlo en un móvil no autentica automáticamente otro ordenador.
- Usa solo el mensaje más reciente y no compartas su enlace. Un enlace consumido o caducado debe sustituirse por una solicitud nueva.
- `Cerrar sesión` revoca solo la sesión actual. Las sesiones abiertas en otros dispositivos se gestionan por separado desde la lista de sesiones.
- Durante el cierre, el botón queda desactivado y la interfaz anuncia el progreso. Si hay un error de red o servidor, la cuenta permanece visible y el mensaje indica que la sesión no se cerró.
- Una respuesta `401` durante el cierre se trata como estado final seguro: la sesión ya no es válida y la interfaz vuelve al acceso.
- Un fallo al actualizar después las aportaciones públicas no debe convertir un cierre confirmado en un falso error.
- La regla de moderación se mantiene: una cuenta no puede revisar su propia aportación.

## Caché instalable

El service worker prioriza la red para navegación y recursos estáticos propios permitidos; solo usa la caché como respaldo ante timeout o error, y nunca cachea una respuesta fallida. Al cambiar la lista de recursos permitidos, incrementa `CACHE_NAME` en `public/service-worker.js` (por ejemplo, de `rutaviva-shell-v2` a `rutaviva-shell-v3`). El worker actualizado espera a que se cierren las pestañas controladas por la versión anterior; al activarse elimina las cachés antiguas de RutaViva. API, autenticación, recursos externos y peticiones con parámetros quedan fuera de la caché.

