# Privacidad por defecto

## Minimización en observaciones urbanas

RutaViva no pregunta ni almacena si la persona autora tiene una discapacidad. Solo registra grupos que podrían verse afectados por una condición urbana. La persona confirma que título, descripción y ubicación no incluyen nombres, teléfonos, matrículas u otros datos personales. La versión 1 no admite fotografías; cualquier futura función de imágenes necesitará consentimiento, moderación y tratamiento de rostros y matrículas.

- Las rutas se consultan sin cuenta.
- La geolocalización se solicita solo tras una acción explícita.
- No se guarda posición actual ni historial de recorridos por defecto.
- Identidad privada y perfil público permanecen separados.
- Correos, tokens, IP e identificadores de sesión nunca aparecen en la API pública.
- Las coordenadas aportadas se muestran solo tras advertencia y moderación.
- Las analíticas se agregan con un mínimo de cinco personas por grupo.
- Exportación y supresión requieren sesión reciente.
- El borrado elimina identidad y sesiones; contenido útil puede conservarse anonimizado con justificación.

Antes de un lanzamiento general deberán revisarse jurídicamente política de privacidad, términos, normas comunitarias, retención, encargados de tratamiento y canal de derechos. Este documento es diseño técnico, no asesoramiento jurídico.

## Implementado localmente en el Bloque 23

El correo normalizado se separa del perfil, se cifra con AES-256-GCM y se busca mediante un HMAC irreversible para el servicio. HKDF-SHA256 deriva claves separadas para el índice, el hash idempotente y los cifrados de identidad y outbox; la raíz no cifra ni firma directamente. Los tokens no se conservan en claro. La red se representa con un HMAC rotatorio configurable para rate limiting; no entra en auditoría. La API de perfil devuelve solo UUID, alias, estado y roles, nunca correo, hashes o ciphertext. Estos controles se aplicaron y verificaron contra Supabase con datos sintéticos revertidos.

## Implementado localmente en el Bloque 24

El worker descifra destinatario y enlace solo durante la entrega y no los registra. PostgreSQL conserva únicamente el payload cifrado y el hash del identificador de proveedor. La interfaz no almacena correo, token ni CSRF en almacenamiento web: el correo queda en memoria durante el formulario, el token solo durante reintentos transitorios y el CSRF se solicita justo antes de la mutación. La lista de sesiones no inventa dispositivo, ubicación ni correo.

La entrega falla cerrada: sin base, los cuatro secretos de autenticación y Brevo real, la API no persiste una nueva solicitud. Los cuerpos de error del proveedor se leen con límite y solo se interpreta el código cerrado `duplicate_parameter`; no se registran.

## Datos reales mínimos del Bloque 25

Brevo recibió necesariamente el destinatario y el enlace mágico de dos entregas autorizadas. La base conserva dos verificaciones y eventos cifrados; una identidad y una sesión pertenecen al acceso real consumido. Los recuentos se comprobaron sin leer ni imprimir correos, tokens o ciphertext. Los registros del worker incluyeron solo UUID de evento, intento y estado. La apertura desde móvil falló antes de contactar con el servidor local y no consumió el enlace.
