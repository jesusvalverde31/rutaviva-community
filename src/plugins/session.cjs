'use strict';

const { AppError } = require('../errors.cjs');
const { verifyCsrf } = require('../services/auth.cjs');

function cookieName(config) {
  return config.nodeEnv === 'production' ? '__Host-rv_session' : 'rv_session';
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    try { cookies[name] = decodeURIComponent(part.slice(separator + 1).trim()); } catch { /* cookie inválida */ }
  }
  return cookies;
}

function sessionCookie(config, token) {
  const parts = [
    `${cookieName(config)}=${encodeURIComponent(token)}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=2592000'
  ];
  if (config.nodeEnv === 'production') parts.push('Secure');
  return parts.join('; ');
}

function clearSessionCookie(config) {
  const parts = [`${cookieName(config)}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (config.nodeEnv === 'production') parts.push('Secure');
  return parts.join('; ');
}

function requireExactOrigin(request, config) {
  if (request.headers.origin !== config.publicOrigin) {
    throw new AppError(403, 'ORIGIN_REQUIRED', 'El origen de la solicitud no está permitido.');
  }
}

function requireAuth(request) {
  if (!request.auth) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Debes iniciar sesión.');
  return request.auth;
}

function requireCsrf(request, config, authService) {
  requireExactOrigin(request, config);
  const auth = requireAuth(request);
  const expected = authService.csrfFor(auth);
  if (!verifyCsrf(expected, request.headers['x-csrf-token'])) {
    throw new AppError(403, 'CSRF_INVALID', 'La protección de la sesión no es válida.');
  }
  return auth;
}

function sessionPlugin(app, options) {
  const { authService, config } = options;
  app.addHook('onRequest', async request => {
    request.auth = null;
    if (!authService) return;
    const pathname = request.url.split('?', 1)[0];
    const authenticationNeeded = pathname === '/api/v1/users/me'
      || pathname === '/api/v1/auth/logout'
      || pathname === '/api/v1/auth/sessions'
      || pathname.startsWith('/api/v1/auth/sessions/')
      || pathname === '/api/v1/auth/csrf'
      || pathname.startsWith('/api/v1/contributions')
      || pathname.startsWith('/api/v1/moderation');
    if (!authenticationNeeded) return;
    const token = parseCookies(request.headers.cookie)[cookieName(config)];
    if (token) request.auth = await authService.authenticate(token);
  });
}

module.exports = {
  clearSessionCookie,
  cookieName,
  parseCookies,
  requireAuth,
  requireCsrf,
  requireExactOrigin,
  sessionCookie,
  sessionPlugin
};
