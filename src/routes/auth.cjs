'use strict';

const { AppError } = require('../errors.cjs');
const {
  clearSessionCookie,
  requireAuth,
  requireCsrf,
  requireExactOrigin,
  sessionCookie
} = require('../plugins/session.cjs');

const emailSchema = {
  type: 'object', additionalProperties: false, required: ['email'],
  properties: { email: { type: 'string', minLength: 3, maxLength: 254 } }
};
const tokenSchema = {
  type: 'object', additionalProperties: false, required: ['token'],
  properties: { token: { type: 'string', minLength: 80, maxLength: 80 } }
};
const idParamsSchema = {
  type: 'object', additionalProperties: false, required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } }
};
const idempotencyHeaders = {
  type: 'object', required: ['idempotency-key'],
  properties: { 'idempotency-key': { type: 'string', minLength: 16, maxLength: 128 } }
};

function authRoutes(app, options) {
  const { authService, config, emailDeliveryOperational } = options;

  function requireService() {
    if (!authService) throw new AppError(503, 'AUTHENTICATION_NOT_CONFIGURED', 'El acceso todavía no está configurado.');
  }

  app.post('/api/v1/auth/request-link', { schema: { body: emailSchema, headers: idempotencyHeaders } }, async (request, reply) => {
    requireExactOrigin(request, config);
    if (!emailDeliveryOperational) throw new AppError(503, 'EMAIL_DELIVERY_NOT_CONFIGURED', 'El acceso por correo no está disponible temporalmente.');
    requireService();
    await authService.requestLink({
      email: request.body.email,
      networkIdentity: request.ip,
      idempotencyKey: request.headers['idempotency-key'],
      requestId: request.id
    });
    reply.code(202);
    return { accepted: true, message: 'Si el correo es válido, recibirás un enlace de acceso. Caduca en 15 minutos.', requestId: request.id };
  });

  app.post('/api/v1/auth/verify', { schema: { body: tokenSchema } }, async (request, reply) => {
    requireService();
    requireExactOrigin(request, config);
    const result = await authService.verify({ token: request.body.token, networkIdentity: request.ip, requestId: request.id });
    reply.header('Set-Cookie', sessionCookie(config, result.sessionToken));
    return {
      authenticated: true,
      user: { id: result.session.user_id, alias: result.session.public_alias, status: result.session.user_status, version: Number(result.session.user_version), roles: result.session.roles || [] },
      requestId: request.id
    };
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    requireService();
    requireExactOrigin(request, config);
    if (request.auth) {
      const auth = requireCsrf(request, config, authService);
      await authService.revokeSession(auth.session_id, auth.session_id, request.id);
    }
    reply.header('Set-Cookie', clearSessionCookie(config));
    reply.code(204).send();
  });

  app.get('/api/v1/auth/sessions', async request => {
    requireService();
    const auth = requireAuth(request);
    const sessions = await authService.listSessions(auth.session_id);
    return {
      data: sessions.map(session => ({
        id: session.id,
        createdAt: session.created_at,
        lastSeenAt: session.last_seen_at,
        expiresAt: session.expires_at,
        current: session.current_session
      })),
      requestId: request.id
    };
  });

  app.delete('/api/v1/auth/sessions/:id', { schema: { params: idParamsSchema } }, async (request, reply) => {
    requireService();
    const auth = requireCsrf(request, config, authService);
    const revoked = await authService.revokeSession(auth.session_id, request.params.id, request.id);
    if (!revoked) throw new AppError(404, 'SESSION_NOT_FOUND', 'No encontramos esa sesión activa.');
    if (request.params.id === auth.session_id) reply.header('Set-Cookie', clearSessionCookie(config));
    reply.code(204).send();
  });

  app.get('/api/v1/auth/csrf', async request => {
    requireService();
    const auth = requireAuth(request);
    return { csrfToken: authService.csrfFor(auth), requestId: request.id };
  });

  app.get('/api/v1/users/me', async request => {
    requireService();
    const auth = requireAuth(request);
    return {
      user: { id: auth.user_id, alias: auth.public_alias, status: auth.user_status, version: Number(auth.user_version), roles: auth.roles || [] },
      requestId: request.id
    };
  });
}

module.exports = { authRoutes, emailSchema, idParamsSchema, idempotencyHeaders, tokenSchema };
