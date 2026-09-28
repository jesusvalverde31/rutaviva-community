'use strict';

const helmet = require('@fastify/helmet');
const { AppError } = require('../errors.cjs');

const CSP = "default-src 'self'; base-uri 'none'; connect-src 'self' https://tile.openstreetmap.org; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob: https://tile.openstreetmap.org; object-src 'none'; script-src 'self'; style-src 'self'; worker-src 'self'";

function applyBaselineHeaders(reply, config) {
  reply.header('Content-Security-Policy', CSP);
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  reply.header('Cross-Origin-Resource-Policy', 'same-origin');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  if (config.nodeEnv === 'production') reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function securityPlugin(app, options) {
  const { config } = options;
  app.register(helmet, {
    global: true,
    frameguard: { action: 'deny' },
    strictTransportSecurity: config.nodeEnv === 'production' ? undefined : false,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'none'"],
        connectSrc: ["'self'", config.mapTileOrigin],
        fontSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:', 'blob:', config.mapTileOrigin],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        workerSrc: ["'self'"]
      }
    }
  });

  app.addHook('onRequest', async (request, reply) => {
    applyBaselineHeaders(reply, config);
    reply.header('X-Request-Id', request.id);
    reply.header('Cache-Control', 'no-store');
    if (request.headers.host !== config.allowedHost) throw new AppError(400, 'INVALID_HOST', 'El host de la solicitud no está permitido.');
    if (request.headers.origin && request.headers.origin !== config.publicOrigin) throw new AppError(403, 'INVALID_ORIGIN', 'El origen de la solicitud no está permitido.');
  });
}

module.exports = { applyBaselineHeaders, securityPlugin };
