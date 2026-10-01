'use strict';

const { AppError } = require('../../errors.cjs');

const NETWORK_SQL = 'SELECT * FROM app_private.get_route_network($1::double precision,$2::double precision,$3::double precision,$4::double precision,$5::double precision)';
const STATUS_SQL = 'SELECT * FROM app_private.route_network_status()';
const SNAP_SQL = 'SELECT * FROM app_private.snap_route_points($1::uuid,$2::double precision,$3::double precision,$4::double precision,$5::double precision,$6::double precision)';
const RATE_LIMIT_SQL = 'SELECT * FROM app_private.route_rate_limit($1::bytea)';
const CACHE_TTL_MS = 15_000; const CACHE_MAX_RELEASES = 3;

function createNetworkCache(options = {}) {
  const ttlMs = options.ttlMs || CACHE_TTL_MS; const maxEntries = options.maxEntries || CACHE_MAX_RELEASES; const now = options.now || Date.now; const entries = new Map();
  return {
    get(key) { const item=entries.get(key); if(!item)return null; if(item.expiresAt<=now()){entries.delete(key);return null;} entries.delete(key);entries.set(key,item);return item.value; },
    set(key,value) { entries.delete(key);entries.set(key,{value,expiresAt:now()+ttlMs});while(entries.size>maxEntries)entries.delete(entries.keys().next().value); },
    get size(){return entries.size;}
  };
}

function mapRouteError(error) {
  const message = error?.message;
  if (message === 'routing_data_not_ready') throw new AppError(503, 'ROUTING_DATA_NOT_READY', 'La red peatonal todavía no está preparada.', { retryAfter: 60 });
  if (message === 'outside_pilot') throw new AppError(422, 'OUTSIDE_PILOT', 'El origen y el destino deben estar dentro del piloto de Casco Antiguo.');
  if (message === 'no_nearby_network') throw new AppError(422, 'NO_NEARBY_NETWORK', 'No encontramos red peatonal a menos de 75 metros.');
  throw new AppError(503, 'ROUTING_DATA_NOT_READY', 'La red peatonal no está disponible temporalmente.', { retryAfter: 60 });
}

function normalizeNetwork(rows) {
  if (!rows.length) throw new AppError(503, 'ROUTING_DATA_NOT_READY', 'La red peatonal todavía no está preparada.', { retryAfter: 60 });
  const first = rows[0]; const nodes = new Map();
  for (const row of rows) {
    nodes.set(row.source_node_id, { id: row.source_node_id, latitude: Number(row.source_latitude), longitude: Number(row.source_longitude) });
    nodes.set(row.target_node_id, { id: row.target_node_id, latitude: Number(row.target_latitude), longitude: Number(row.target_longitude) });
  }
  return {
    release: { id: first.release_id, version: first.release_version, osmDate: first.osm_date, importedAt: first.imported_at },
    origin: { nodeId: first.origin_node_id, offsetMeters: Math.round(Number(first.origin_offset_meters)) },
    destination: { nodeId: first.destination_node_id, offsetMeters: Math.round(Number(first.destination_offset_meters)) },
    nodes: [...nodes.values()],
    segments: rows.map(row => ({
      id: row.segment_id, sourceNodeId: row.source_node_id, targetNodeId: row.target_node_id,
      name: row.segment_name || null, distanceMeters: Number(row.distance_meters),
      accessibilityStatus: row.accessibility_status, lightingStatus: row.lighting_status,
      geometry: typeof row.geometry === 'string' ? JSON.parse(row.geometry) : row.geometry,
      contributions: Array.isArray(row.contributions) ? row.contributions : []
    }))
  };
}

function createRoutesRepository(database, options = {}) {
  const cache = options.cache || createNetworkCache();
  return {
    async status() {
      try {
        const row = (await database.query(STATUS_SQL)).rows[0];
        return row ? { ready: row.ready === true, releaseId: row.release_id, version: row.release_version, osmDate: row.osm_date, importedAt: row.imported_at } : { ready: false };
      } catch { return { ready: false }; }
    },
    async network({ origin, destination, maxSnapMeters = 75 }) {
      try {
        const status = (await database.query(STATUS_SQL)).rows[0];
        if (!status?.ready) throw new AppError(503, 'ROUTING_DATA_NOT_READY', 'La red peatonal todavía no está preparada.', { retryAfter: 60 });
        const cached = cache.get(status.release_id);
        if (cached) {
          const snap = (await database.query(SNAP_SQL, [status.release_id,origin.longitude,origin.latitude,destination.longitude,destination.latitude,maxSnapMeters])).rows[0];
          if (!snap) throw new Error('no_nearby_network');
          return { ...cached, origin:{nodeId:snap.origin_node_id,offsetMeters:Math.round(Number(snap.origin_offset_meters))}, destination:{nodeId:snap.destination_node_id,offsetMeters:Math.round(Number(snap.destination_offset_meters))} };
        }
        const result = await database.query(NETWORK_SQL, [origin.longitude, origin.latitude, destination.longitude, destination.latitude, maxSnapMeters]);
        const network = normalizeNetwork(result.rows); cache.set(network.release.id,{release:network.release,nodes:network.nodes,segments:network.segments}); return network;
      } catch (error) {
        if (error instanceof AppError) throw error;
        return mapRouteError(error);
      }
    },
    async consumeRateLimit(networkHash) {
      try { const row=(await database.query(RATE_LIMIT_SQL,[networkHash])).rows[0]; return {allowed:row?.allowed===true,retryAfter:Number(row?.retry_after_seconds)||600}; }
      catch { throw new AppError(503,'ROUTING_DATA_NOT_READY','No se pudo validar temporalmente el límite de uso.',{retryAfter:60}); }
    }
  };
}

module.exports = { CACHE_MAX_RELEASES, CACHE_TTL_MS, NETWORK_SQL, RATE_LIMIT_SQL, SNAP_SQL, STATUS_SQL, createNetworkCache, createRoutesRepository, mapRouteError, normalizeNetwork };
