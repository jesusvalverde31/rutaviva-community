'use strict';

const PENALTIES = Object.freeze({
  accessibilityUnknownAccessible: 0.35,
  accessibilityUnknownDirect: 0.10,
  lightingUnknown: 0.05,
  lightingPoor: 0.15,
  barrierDirect: 0.70,
  maxIncidentRisk: 0.90
});

class RouteEngineError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function contributionEffect(contribution) {
  if (!contribution || contribution.status !== 'published') return null;
  const confidence = clamp(Number(contribution.confidence ?? 0.5), 0, 1);
  return { kind: contribution.kind, confidence, title: String(contribution.title || '').slice(0, 80) };
}

function segmentPolicy(segment, profile) {
  const effects = (segment.contributions || []).map(contributionEffect).filter(Boolean);
  if (effects.some(effect => effect.kind === 'closure')) return { excluded: true, reason: 'closure' };
  const baseBarrier = segment.accessibilityStatus === 'barrier';
  const communityBarrier = effects.some(effect => effect.kind === 'barrier');
  const barrier = baseBarrier || communityBarrier;
  if (profile === 'accessible' && barrier) return { excluded: true, reason: 'barrier' };

  let penalty = 0;
  const factors = [];
  const add = (value, label) => { penalty += value; factors.push({ label, penalty: value }); };
  if (segment.accessibilityStatus === 'unknown') add(profile === 'accessible' ? PENALTIES.accessibilityUnknownAccessible : PENALTIES.accessibilityUnknownDirect, 'Accesibilidad sin confirmar');
  if (segment.lightingStatus === 'unknown') add(PENALTIES.lightingUnknown, 'Iluminación sin confirmar');
  if (segment.lightingStatus === 'poor') add(PENALTIES.lightingPoor, 'Iluminación deficiente');
  if (barrier) add(PENALTIES.barrierDirect, communityBarrier ? 'Barrera comunitaria publicada' : 'Barrera de accesibilidad en datos OSM');

  const incidentRisk = clamp(1 - effects
    .filter(effect => effect.kind === 'lighting')
    .reduce((remaining, effect) => remaining * (1 - 0.20 * effect.confidence), 1), 0, PENALTIES.maxIncidentRisk);
  if (incidentRisk > 0) add(incidentRisk, 'Incidencias publicadas');

  const accessible = effects.some(effect => effect.kind === 'accessible');
  if (accessible && segment.accessibilityStatus === 'unknown') {
    const unknown = profile === 'accessible' ? PENALTIES.accessibilityUnknownAccessible : PENALTIES.accessibilityUnknownDirect;
    penalty = Math.max(0, penalty - unknown);
    const index = factors.findIndex(factor => factor.label === 'Accesibilidad sin confirmar');
    if (index >= 0) factors.splice(index, 1);
  }
  const distance = Number(segment.distanceMeters);
  return { excluded: false, cost: distance * (1 + penalty), penalty, factors, effects };
}

class MinHeap {
  constructor() { this.items = []; }
  push(item) {
    this.items.push(item); let index = this.items.length - 1;
    while (index > 0) { const parent = Math.floor((index - 1) / 2); if (MinHeap.compare(this.items[parent], item) <= 0) break; this.items[index] = this.items[parent]; index = parent; }
    this.items[index] = item;
  }
  pop() {
    if (!this.items.length) return null; const first = this.items[0]; const last = this.items.pop();
    if (this.items.length) { let index = 0; while (true) { const left = index * 2 + 1; const right = left + 1; if (left >= this.items.length) break; let child = right < this.items.length && MinHeap.compare(this.items[right], this.items[left]) < 0 ? right : left; if (MinHeap.compare(last, this.items[child]) <= 0) break; this.items[index] = this.items[child]; index = child; } this.items[index] = last; }
    return first;
  }
  static compare(a, b) { return a.distance - b.distance || a.id.localeCompare(b.id); }
}

function dijkstra(nodes, segments, startId, endId, profile) {
  const adjacency = new Map(nodes.map(node => [node.id, []]));
  for (const segment of segments) {
    const policy = segmentPolicy(segment, profile);
    if (!policy.excluded && adjacency.has(segment.sourceNodeId) && adjacency.has(segment.targetNodeId)) {
      adjacency.get(segment.sourceNodeId).push({ segment, policy });
    }
  }
  for (const list of adjacency.values()) list.sort((a, b) => a.segment.id.localeCompare(b.segment.id));
  const distances = new Map([[startId, 0]]); const previous = new Map(); const settled = new Set(); const queue = new MinHeap(); queue.push({ id:startId, distance:0 });
  while (queue.items.length) {
    const next = queue.pop(); const current = next.id; const best = next.distance;
    if (settled.has(current) || best !== distances.get(current)) continue;
    settled.add(current);
    if (current === endId) break;
    for (const edge of adjacency.get(current) || []) {
      const edgeCost = profile === 'direct' ? Number(edge.segment.distanceMeters) : edge.policy.cost;
      const candidate = best + edgeCost;
      const known = distances.get(edge.segment.targetNodeId) ?? Infinity;
      const former = previous.get(edge.segment.targetNodeId)?.segment?.id;
      if (candidate < known || (candidate === known && edge.segment.id.localeCompare(former || '') < 0)) {
        distances.set(edge.segment.targetNodeId, candidate);
        previous.set(edge.segment.targetNodeId, edge);
        queue.push({ id:edge.segment.targetNodeId, distance:candidate });
      }
    }
  }
  if (!distances.has(endId)) return null;
  const edges = []; let cursor = endId;
  while (cursor !== startId) {
    const edge = previous.get(cursor); if (!edge) return null;
    edges.unshift(edge); cursor = edge.segment.sourceNodeId;
  }
  return { edges, cost: distances.get(endId) };
}

function routeGeometry(edges) {
  const coordinates = [];
  for (const { segment } of edges) {
    const points = segment.geometry?.coordinates || [];
    coordinates.push(...(coordinates.length ? points.slice(1) : points));
  }
  return { type: 'LineString', coordinates };
}

function presentRoute(result, profile) {
  if (!result) return null;
  const distanceMeters = Math.round(result.edges.reduce((sum, edge) => sum + Number(edge.segment.distanceMeters), 0));
  const cost = result.edges.reduce((sum, edge) => sum + edge.policy.cost, 0);
  const knownMeters = result.edges.reduce((sum, edge) => sum + (edge.segment.accessibilityStatus === 'unknown' && !edge.policy.effects.some(effect => effect.kind === 'accessible') ? 0 : Number(edge.segment.distanceMeters)), 0);
  const coverage = distanceMeters ? Math.round(100 * knownMeters / distanceMeters) : 100;
  const factorTotals = new Map(); const shortcuts = [];
  for (const edge of result.edges) {
    for (const factor of edge.policy.factors) factorTotals.set(factor.label, (factorTotals.get(factor.label) || 0) + factor.penalty * Number(edge.segment.distanceMeters));
    for (const effect of edge.policy.effects.filter(item => item.kind === 'shortcut')) shortcuts.push(effect.title || 'Atajo comunitario publicado');
  }
  const factors = [...factorTotals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([label]) => label);
  if (shortcuts.length) factors.push(`Coincide con ${shortcuts[0]}`);
  const warnings = ['Ruta orientativa: comprueba siempre el entorno y la señalización.'];
  if (coverage < 80) warnings.push('Cobertura de accesibilidad inferior al 80 %.');
  return {
    profile,
    distanceMeters,
    estimatedMinutes: Math.max(1, Math.round(distanceMeters / 75)),
    score: clamp(Math.round(100 * distanceMeters / Math.max(distanceMeters, cost)), 0, 100),
    accessibilityCoverage: coverage,
    geometry: routeGeometry(result.edges),
    segments: result.edges.map((edge, index) => ({ order: index + 1, id: edge.segment.id, instruction: edge.segment.name ? `Continúa por ${edge.segment.name}` : 'Continúa por el tramo peatonal', distanceMeters: Math.round(Number(edge.segment.distanceMeters)) })),
    summary: profile === 'direct' ? 'Opción de menor distancia disponible.' : 'Opción que reduce barreras e incidencias conocidas.',
    factors: factors.slice(0, 3), warnings
  };
}

function samePath(first, second) {
  return first && second && first.edges.map(edge => edge.segment.id).join('|') === second.edges.map(edge => edge.segment.id).join('|');
}

function calculateRoutes(network, startId, endId) {
  const directResult = dijkstra(network.nodes, network.segments, startId, endId, 'direct');
  if (!directResult) throw new RouteEngineError('NO_ROUTE_FOUND');
  const accessibleResult = dijkstra(network.nodes, network.segments, startId, endId, 'accessible');
  return {
    direct: presentRoute(directResult, 'direct'),
    accessible: accessibleResult && !samePath(directResult, accessibleResult) ? presentRoute(accessibleResult, 'accessible') : null,
    alternativeStatus: !accessibleResult ? 'unavailable' : samePath(directResult, accessibleResult) ? 'same_as_direct' : 'available'
  };
}

module.exports = { MinHeap, PENALTIES, RouteEngineError, calculateRoutes, contributionEffect, dijkstra, presentRoute, segmentPolicy };
