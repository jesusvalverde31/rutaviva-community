# Código fuente

Los bloques 21–24 implementan configuración, servidor Fastify, PostgreSQL/PostGIS, autenticación, sesiones, outbox transaccional, cliente Brevo opcional y una interfaz web vanilla del mismo origen. `runtime-env.cjs` limita el entorno de API y worker y excluye siempre la credencial de migración. `app.cjs` ensambla rutas API y web; `services/outbox-worker.cjs` procesa correo exclusivamente mediante `db/repositories/outbox.cjs`. El navegador nunca accede a PostgreSQL ni recibe claves.

El proveedor de correo está desactivado por defecto. `authenticationOperational` exige base y cuatro secretos; `emailDeliveryOperational` añade Brevo real. La ruta de solicitud falla antes del servicio si la entrega no está operativa. El motor de rutas, aportaciones y moderación permanecen pendientes.
