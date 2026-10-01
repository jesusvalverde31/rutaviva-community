'use strict';

const { AppError } = require('../errors.cjs');
const { getBootstrap, listZones } = require('../db/repositories/zones.cjs');

const zoneQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    q: { type: 'string', minLength: 1, maxLength: 80 },
    cursor: { type: 'string', minLength: 1, maxLength: 256, pattern: '^[A-Za-z0-9_-]+$' },
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
  }
};

function requireDatabase(database) {
  if (!database) throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Los datos públicos no están disponibles temporalmente.');
}

function publicRoutes(app, options) {
  const { database, config, routesRepository } = options;

  app.get('/api/v1/bootstrap', async request => {
    requireDatabase(database);
    try {
      const city = await getBootstrap(database);
      if (!city) throw new AppError(503, 'DATA_NOT_READY', 'Los datos públicos todavía no están preparados.');
      const routeStatus = routesRepository ? await routesRepository.status() : { ready: false };
      return {
        service: 'rutaviva-community',
        apiVersion: 'v1',
        pilot: {
          id: city.id,
          slug: city.slug,
          name: city.name,
          countryCode: city.countryCode,
          isApproximate: city.isApproximate,
          center: { latitude: city.latitude, longitude: city.longitude },
          zoneCount: city.zoneCount
        },
        capabilities: { zones: true, routes: routeStatus.ready, contributions: true, moderation: true, accounts: config?.emailDeliveryOperational === true },
        map: { tileUrl: config.mapTileUrl, attribution: '© OpenStreetMap contributors' },
        links: { health: '/api/v1/health', ready: '/api/v1/ready', zones: '/api/v1/zones', routes: '/api/v1/routes/search', contributions: '/api/v1/contributions', activity: '/api/v1/community/activity' },
        routing: routeStatus.ready ? { networkVersion: routeStatus.version, osmDate: routeStatus.osmDate } : { ready: false },
        advertencia: 'Ruta orientativa: comprueba siempre el entorno y la señalización.',
        requestId: request.id
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Los datos públicos no están disponibles temporalmente.');
    }
  });

  app.get('/api/v1/zones', { schema: { querystring: zoneQuerySchema } }, async request => {
    requireDatabase(database);
    try {
      const result = await listZones(database, {
        search: request.query.q?.trim(),
        cursor: request.query.cursor,
        limit: request.query.limit
      });
      return { ...result, requestId: request.id };
    } catch (error) {
      if (error?.code === 'INVALID_CURSOR') throw new AppError(422, 'INVALID_CURSOR', 'El cursor de paginación no es válido.');
      if (error instanceof AppError) throw error;
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Los datos públicos no están disponibles temporalmente.');
    }
  });
}

module.exports = { publicRoutes, requireDatabase, zoneQuerySchema };
