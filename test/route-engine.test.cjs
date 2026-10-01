'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateRoutes, PENALTIES, segmentPolicy } = require('../src/services/route-engine.cjs');
const { createApp } = require('../src/app.cjs');
const { loadConfig } = require('../src/config.cjs');

const nodes = ['a','b','c','d'].map(id => ({ id }));
const line = coordinates => ({ type: 'LineString', coordinates });
function segment(id, sourceNodeId, targetNodeId, distanceMeters, accessibilityStatus, coordinates, contributions = []) { return { id, sourceNodeId, targetNodeId, distanceMeters, accessibilityStatus, lightingStatus: 'lit', geometry: line(coordinates), contributions }; }
const network = {
  nodes,
  segments: [
    segment('ab','a','b',100,'unknown',[[0,0],[1,0]]), segment('bc','b','c',100,'unknown',[[1,0],[2,0]]),
    segment('ad','a','d',115,'compatible',[[0,0],[1,1]]), segment('dc','d','c',115,'compatible',[[1,1],[2,0]])
  ]
};

test('directa prima distancia y accesible evita incertidumbre', () => {
  const result = calculateRoutes(network, 'a', 'c');
  assert.equal(result.direct.distanceMeters, 200);
  assert.equal(result.accessible.distanceMeters, 230);
  assert.equal(result.direct.accessibilityCoverage, 0);
  assert.equal(result.accessible.accessibilityCoverage, 100);
  assert.match(result.direct.warnings.join(' '), /inferior al 80/);
});

test('solo aportaciones publicadas afectan y cierre publicado excluye', () => {
  const draft = segmentPolicy({ distanceMeters: 10, accessibilityStatus: 'compatible', lightingStatus: 'lit', contributions: [{ kind: 'closure', status: 'submitted' }] }, 'direct');
  const published = segmentPolicy({ distanceMeters: 10, accessibilityStatus: 'compatible', lightingStatus: 'lit', contributions: [{ kind: 'closure', status: 'published' }] }, 'direct');
  assert.equal(draft.excluded, false); assert.equal(published.excluded, true);
});

test('penalizaciones centrales y score quedan acotados', () => {
  assert.deepEqual(PENALTIES, { accessibilityUnknownAccessible: 0.35, accessibilityUnknownDirect: 0.10, lightingUnknown: 0.05, lightingPoor: 0.15, barrierDirect: 0.70, maxIncidentRisk: 0.90 });
  const policy = segmentPolicy({ distanceMeters: 100, accessibilityStatus: 'barrier', lightingStatus: 'poor', contributions: [] }, 'direct');
  assert.equal(policy.cost, 185);
  assert.equal(policy.factors.some(factor=>factor.label==='Barrera de accesibilidad en datos OSM'),true);
  assert.equal(segmentPolicy({ distanceMeters: 100, accessibilityStatus: 'barrier', lightingStatus: 'lit', contributions: [] }, 'accessible').excluded, true);
});

test('Dijkstra es determinista ante empates', () => {
  const tied = { nodes, segments: [segment('z','a','b',50,'compatible',[[0,0],[1,0]]),segment('a2','a','d',50,'compatible',[[0,0],[1,1]]),segment('z2','b','c',50,'compatible',[[1,0],[2,0]]),segment('a3','d','c',50,'compatible',[[1,1],[2,0]])] };
  assert.deepEqual(calculateRoutes(tied,'a','c').direct.segments.map(item => item.id), ['a2','a3']);
});

test('riesgos comunitarios se combinan sin suma lineal inflada', () => {
  const policy = segmentPolicy({
    distanceMeters: 100,
    accessibilityStatus: 'compatible',
    lightingStatus: 'lit',
    contributions: [
      { kind: 'lighting', status: 'published', confidence: 0.5 },
      { kind: 'lighting', status: 'published', confidence: 0.5 }
    ]
  }, 'accessible');
  assert.ok(Math.abs(policy.penalty - 0.19) < 1e-12);
  assert.equal(policy.cost, 119);
});

test('motor escala al límite de quince mil nodos con cola de prioridad', { timeout: 5000 }, () => {
  const count = 15_000;
  const largeNodes = Array.from({ length: count }, (_, index) => ({ id: String(index).padStart(5, '0') }));
  const largeSegments = [];
  for (let index = 0; index < count - 1; index += 1) {
    largeSegments.push(segment(`f-${index}`, largeNodes[index].id, largeNodes[index + 1].id, 1, 'compatible', [[index, 0], [index + 1, 0]]));
    if (index + 2 < count) largeSegments.push(segment(`s-${index}`, largeNodes[index].id, largeNodes[index + 2].id, 3, 'compatible', [[index, 0], [index + 2, 0]]));
  }
  const started = performance.now();
  const result = calculateRoutes({ nodes: largeNodes, segments: largeSegments }, largeNodes[0].id, largeNodes.at(-1).id);
  assert.equal(result.direct.distanceMeters, count - 1);
  assert.ok(performance.now() - started < 4500);
});

test('API valida, calcula sin autenticar y no conserva coordenadas', async () => {
  const config = loadConfig({ NODE_ENV:'test' }); const headers = { host: config.allowedHost, 'content-type':'application/json' };
  const repository = { network: async () => ({ ...network, release:{id:'r',version:'osm-test',osmDate:'2026-09-29',importedAt:'2026-09-29T00:00:00Z'}, origin:{nodeId:'a',offsetMeters:2}, destination:{nodeId:'c',offsetMeters:3} }) };
  const app = createApp({ config, logger:false, routesRepository:repository, routeRateLimiter:()=>0 });
  try {
    const response = await app.inject({method:'POST',url:'/api/v1/routes/search',headers,payload:{origin:{latitude:37.39,longitude:-5.99},destination:{latitude:37.392,longitude:-5.987}}});
    assert.equal(response.statusCode,200); assert.equal(response.json().routes.direct.distanceMeters,200); assert.ok(response.json().requestId);
    const invalid = await app.inject({method:'POST',url:'/api/v1/routes/search',headers,payload:{origin:{latitude:0,longitude:0},destination:{latitude:1,longitude:1}}});
    assert.equal(invalid.statusCode,422); assert.equal(invalid.json().code,'OUTSIDE_PILOT');
    const oversized = await app.inject({method:'POST',url:'/api/v1/routes/search',headers,payload:JSON.stringify({origin:{latitude:37.39,longitude:-5.99},destination:{latitude:37.392,longitude:-5.987},padding:'x'.repeat(5000)})});
    assert.equal(oversized.statusCode,413);
  } finally { await app.close(); }
});

test('API respeta el límite persistente e informa Retry-After', async () => {
  const config = loadConfig({ NODE_ENV:'test' });
  const app = createApp({
    config,
    logger:false,
    routesRepository:{ network:async()=>network },
    routeRateLimiter:async()=>({ allowed:false, retryAfter:321 })
  });
  try {
    const response = await app.inject({ method:'POST', url:'/api/v1/routes/search', headers:{ host:config.allowedHost, 'content-type':'application/json' }, payload:{ origin:{latitude:37.39,longitude:-5.99}, destination:{latitude:37.392,longitude:-5.987} } });
    assert.equal(response.statusCode, 429);
    assert.equal(response.headers['retry-after'], '321');
    assert.equal(response.json().code, 'RATE_LIMITED');
  } finally { await app.close(); }
});
