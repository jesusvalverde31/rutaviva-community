'use strict';

const { randomUUID } = require('node:crypto');
const Fastify = require('fastify');
const { loadConfig } = require('./config.cjs');
const { AppError, classifyError, problem } = require('./errors.cjs');
const { applyBaselineHeaders, securityPlugin } = require('./plugins/security.cjs');
const { createReadinessCheck } = require('./db/health.cjs');
const { createAuthRepository } = require('./db/repositories/auth.cjs');
const { createAuthService } = require('./services/auth.cjs');
const { sessionPlugin } = require('./plugins/session.cjs');
const { authRoutes } = require('./routes/auth.cjs');
const { publicRoutes } = require('./routes/public.cjs');
const { webRoutes } = require('./routes/web.cjs');
const { createContributionsRepository } = require('./db/repositories/contributions.cjs');
const { createModerationRepository } = require('./db/repositories/moderation.cjs');
const { contributionsRoutes } = require('./routes/contributions.cjs');
const { moderationRoutes } = require('./routes/moderation.cjs');
const { createRoutesRepository } = require('./db/repositories/routes.cjs');
const { routesRoutes } = require('./routes/routes.cjs');
const { createStatsRepository } = require('./db/repositories/stats.cjs');
const { credibilityRoutes } = require('./routes/credibility.cjs');

const REDACT = ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-csrf-token"]', 'req.headers["idempotency-key"]', 'res.headers["set-cookie"]', '*.password', '*.token', '*.secret', '*.email'];

function withTimeout(promise, milliseconds) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('readiness timeout')), milliseconds); })
  ]).finally(() => clearTimeout(timer));
}

function frameworkErrorHandler(rawError, request, reply, config) {
  const error = rawError?.code === 'FST_ERR_BAD_URL'
    ? new AppError(400, 'MALFORMED_URL', 'La URL solicitada no es válida.')
    : new AppError(400, 'BAD_REQUEST', 'La solicitud no es válida.');
  applyBaselineHeaders(reply, config);
  reply.header('X-Request-Id', request.id);
  reply.header('Cache-Control', 'no-store');
  reply.code(error.status).type('application/problem+json').send(problem(error, request.id));
}

function createApp(options = {}) {
  const config = options.config || loadConfig();
  const database = options.database || null;
  const authService = Object.hasOwn(options, 'authService')
    ? options.authService
    : (config.authenticationOperational
        ? createAuthService({ repository: createAuthRepository(database), config })
        : null);
  const readinessCheck = options.readinessCheck || createReadinessCheck(database, { runtimeRole: config.databaseRuntimeRole });
  const contributionsRepository = Object.hasOwn(options, 'contributionsRepository')
    ? options.contributionsRepository
    : (database ? createContributionsRepository(database) : null);
  const moderationRepository = Object.hasOwn(options, 'moderationRepository')
    ? options.moderationRepository
    : (database ? createModerationRepository(database) : null);
  const routesRepository = Object.hasOwn(options, 'routesRepository')
    ? options.routesRepository
    : (database ? createRoutesRepository(database) : null);
  const statsRepository = Object.hasOwn(options, 'statsRepository')
    ? options.statsRepository
    : (database ? createStatsRepository(database) : null);
  const readinessTimeoutMs = options.readinessTimeoutMs || 1000;
  const app = Fastify({
    logger: options.logger === undefined ? { level: config.logLevel, redact: REDACT } : options.logger,
    genReqId: () => randomUUID(),
    logController: new Fastify.LogController({ disableRequestLogging: true }),
    frameworkErrors: (error, request, reply) => frameworkErrorHandler(error, request, reply, config),
    bodyLimit: 64 * 1024,
    requestTimeout: 10_000,
    trustProxy: config.trustProxy === false ? false : (_address, hop) => hop < config.trustProxy
  });

  securityPlugin(app, { config });
  sessionPlugin(app, { authService, config });

  if (options.ownsDatabase && database) {
    app.addHook('onClose', async () => database.end());
  }

  app.get('/api/v1/health', async request => ({ status: 'ok', service: 'rutaviva-community', requestId: request.id }));

  app.get('/api/v1/ready', async (request, reply) => {
    try {
      const result = await withTimeout(readinessCheck(), readinessTimeoutMs);
      if (!result || result.ready !== true) {
        const readinessError = new Error('not ready');
        readinessError.readinessChecks = result?.checks;
        throw readinessError;
      }
      return { status: 'ready', checks: result.checks || { database: 'ok' }, requestId: request.id };
    } catch (cause) {
      const readinessFailure = cause?.message === 'readiness timeout'
        ? 'timeout'
        : cause?.message === 'not ready'
          ? 'not_ready'
          : 'checker_error';
      request.log.warn({
        requestId: request.id,
        readinessFailure,
        ...(cause?.readinessChecks ? { readinessChecks: cause.readinessChecks } : {})
      }, 'readiness check failed');
      reply.header('Retry-After', '5');
      throw new AppError(503, 'SERVICE_NOT_READY', 'Servicio no preparado.', { cause });
    }
  });

  webRoutes(app);
  publicRoutes(app, { database, config, routesRepository });
  authRoutes(app, {
    authService,
    config,
    emailDeliveryOperational: options.emailDeliveryOperational === undefined
      ? config.emailDeliveryOperational
      : options.emailDeliveryOperational === true
  });
  contributionsRoutes(app, {
    repository: contributionsRepository,
    authService,
    config
  });
  moderationRoutes(app, {
    repository: moderationRepository,
    authService,
    config
  });
  routesRoutes(app, { repository: routesRepository, config, rateLimiter: options.routeRateLimiter });
  credibilityRoutes(app, { database, config, statsRepository });

  app.setNotFoundHandler(() => { throw new AppError(404, 'ROUTE_NOT_FOUND', 'No encontramos el recurso solicitado.'); });

  app.setErrorHandler((rawError, request, reply) => {
    const error = classifyError(rawError);
    if (error.status >= 500 && error.code !== 'SERVICE_NOT_READY') {
      request.log.error({ requestId: request.id, errorCode: error.code }, 'request failed');
    }
    if (Number.isInteger(error.retryAfter) && error.retryAfter > 0) reply.header('Retry-After', String(error.retryAfter));
    reply.code(error.status).type('application/problem+json').send(problem(error, request.id));
  });

  return app;
}

module.exports = { createApp };
