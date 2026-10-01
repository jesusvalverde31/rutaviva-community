'use strict';

const METHODOLOGY = Object.freeze({
  version: '1.0.0',
  status: 'implemented',
  updated: '2026-09-30',
  scoring: Object.freeze({
    name: 'confianza de aportación',
    formula: 'score = clamp(0, 100, round((50 + 50 * consensus * evidence) * freshness))',
    consensus: '(confirmaciones - rechazos) / total; 0 cuando no hay señales',
    evidence: 'min(1, total / 5)',
    freshness: 'clamp(0.65, 1, 1 - antigüedadEnDías / 365)',
    labels: Object.freeze({ limited: 'menos de 2 señales: evidencia limitada', high: '70 o más: confianza alta', medium: '45 a 69: confianza media', low: 'menos de 45: confianza baja' }),
    communityLabel: Object.freeze({ minConfirmations: 3, minScore: 70, note: 'La etiqueta comunitaria nunca publica automáticamente; toda publicación exige moderación.' }),
    proposed: Object.freeze({ reference: 'docs/MODELO-DATOS.md', note: 'La fórmula bayesiana sigue propuesta, no implementada.' })
  }),
  moderation: Object.freeze({ selfReviewForbidden: true, decisionsAppendOnly: true, caseStates: ['pending','claimed','resolved'], note: 'Ninguna aportación altera rutas públicas antes de moderación y publicación.' }),
  sources: Object.freeze({ network: 'OpenStreetMap', license: 'ODbL', tileAttribution: '© OpenStreetMap contributors' }),
  privacy: Object.freeze({ minGroupSize: 5, publicShapes: 'solo caja aproximada; nunca el polígono completo', note: 'Las métricas de grupos con una a cuatro personas ocultan recuentos y fechas.' }),
  safety: 'Ruta orientativa: comprueba siempre el entorno y la señalización.'
});

function getMethodology() { return JSON.parse(JSON.stringify(METHODOLOGY)); }

module.exports = { METHODOLOGY, getMethodology };
