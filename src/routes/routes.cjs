'use strict';

const { AppError } = require('../errors.cjs');
const { calculateRoutes, RouteEngineError } = require('../services/route-engine.cjs');
const { networkIdentityHash } = require('../services/auth.cjs');

const point = { type: 'object', additionalProperties: false, required: ['latitude', 'longitude'], properties: { latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 } } };
const searchBody = { type: 'object', additionalProperties: false, required: ['origin', 'destination'], properties: { origin: point, destination: point } };
const PILOT = Object.freeze({ id: 'casco-antiguo', name: 'Casco Antiguo, Sevilla', bbox: [-6.010, 37.376, -5.978, 37.405] });

function haversineMeters(a, b) {
  const radians = value => value * Math.PI / 180; const radius = 6_371_000;
  const deltaLat = radians(b.latitude - a.latitude); const deltaLon = radians(b.longitude - a.longitude);
  const value = Math.sin(deltaLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(deltaLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(value));
}

function insidePilot(pointValue) {
  const [west, south, east, north] = PILOT.bbox;
  return pointValue.longitude >= west && pointValue.longitude <= east && pointValue.latitude >= south && pointValue.latitude <= north;
}

function routesRoutes(app, options) {
  const { repository, config } = options;
  app.post('/api/v1/routes/search', { bodyLimit: 4096, schema: { body: searchBody } }, async request => {
    if (!repository) throw new AppError(503, 'ROUTING_DATA_NOT_READY', 'La red peatonal todavía no está preparada.', { retryAfter: 60 });
    const rate = options.rateLimiter
      ? await options.rateLimiter(request)
      : await repository.consumeRateLimit(networkIdentityHash(config.ipHashSecret, request.ip || 'unknown'));
    const allowed = typeof rate === 'object' ? rate.allowed === true : rate === 0;
    const retryAfter = typeof rate === 'object' ? rate.retryAfter : rate;
    if (!allowed) throw new AppError(429, 'RATE_LIMITED', 'Has alcanzado el límite temporal de cálculos.', { retryAfter: Math.max(1,Number(retryAfter)||600) });
    const { origin, destination } = request.body;
    if (!insidePilot(origin) || !insidePilot(destination)) throw new AppError(422, 'OUTSIDE_PILOT', 'El origen y el destino deben estar dentro del piloto de Casco Antiguo.');
    if (haversineMeters(origin, destination) < 25) throw new AppError(422, 'ORIGIN_DESTINATION_TOO_CLOSE', 'Separa el origen y el destino al menos 25 metros.');
    const network = await repository.network({ origin, destination, maxSnapMeters: 75 });
    if (network.origin.nodeId === network.destination.nodeId) throw new AppError(422, 'ORIGIN_DESTINATION_TOO_CLOSE', 'El origen y el destino coinciden en la red peatonal.');
    try {
      const routes = calculateRoutes(network, network.origin.nodeId, network.destination.nodeId);
      return { pilot: PILOT, network: network.release, snap: { originMeters: network.origin.offsetMeters, destinationMeters: network.destination.offsetMeters }, routes, requestId: request.id };
    } catch (error) {
      if (error instanceof RouteEngineError && error.code === 'NO_ROUTE_FOUND') throw new AppError(422, 'NO_ROUTE_FOUND', 'No encontramos una conexión peatonal entre esos puntos.');
      throw error;
    }
  });
}

module.exports = { PILOT, haversineMeters, insidePilot, routesRoutes, searchBody };
