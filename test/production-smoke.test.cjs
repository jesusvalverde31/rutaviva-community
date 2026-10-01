'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { request, runSmoke } = require('../scripts/smoke-production.cjs');

function response(status, body, type = 'application/json') {
  return new Response(type === 'application/json' ? JSON.stringify(body) : body, { status, headers: { 'content-type': type } });
}

const payloads = {
  '/api/v1/health': { status: 'ok', service: 'rutaviva-community', requestId: 'req-health' },
  '/api/v1/ready': { status: 'ready', checks: { database: 'ok', role: 'ok', postgis: 'ok', migrations: 'ok', relations: 'ok', functions: 'ok' }, requestId: 'req-ready' },
  '/api/v1/bootstrap': { service: 'rutaviva-community', pilot: { slug: 'sevilla' }, capabilities: { routes: true }, advertencia: 'Ruta orientativa: comprueba el entorno.', requestId: 'req-bootstrap' }
};

function successfulFetch(url) {
  const pathname = new URL(url).pathname;
  return Promise.resolve(pathname === '/' ? response(200, '<!doctype html><meta name="viewport" content="width=device-width"><main>Ruta orientativa</main>', 'text/html') : response(200, payloads[pathname]));
}

test('smoke valida cuatro recursos públicos mediante GET', async () => {
  const methods = [];
  await runSmoke({ silent: true, attempts: 1, fetchImpl: (url, options) => { methods.push(options.method); return successfulFetch(url); } });
  assert.deepEqual(methods, ['GET', 'GET', 'GET', 'GET']);
});

test('reintenta un 503 transitorio y después continúa', async () => {
  let calls = 0;
  const result = await request('https://example.invalid', '/api/v1/health', { attempts: 2, retryDelayMs: 0, delayImpl: async () => {}, fetchImpl: async () => (++calls === 1 ? response(503, {}) : response(200, payloads['/api/v1/health'])) });
  assert.equal(result.status, 200);
  assert.equal(calls, 2);
});

test('agota reintentos ante indisponibilidad persistente', async () => {
  await assert.rejects(request('https://example.invalid', '/api/v1/health', { attempts: 2, retryDelayMs: 0, delayImpl: async () => {}, fetchImpl: async () => response(503, {}) }), /respondió 503/);
});

test('falla ante JSON inválido sin imprimir el cuerpo', async () => {
  await assert.rejects(runSmoke({ silent: true, attempts: 1, fetchImpl: async url => new URL(url).pathname === '/api/v1/health' ? new Response('{mal', { status: 200, headers: { 'content-type': 'application/json' } }) : successfulFetch(url) }), /JSON inválido/);
});

test('falla si la portada no conserva semántica y advertencia', async () => {
  await assert.rejects(runSmoke({ silent: true, attempts: 1, fetchImpl: url => new URL(url).pathname === '/' ? Promise.resolve(response(200, '<html>sin main</html>', 'text/html')) : successfulFetch(url) }), /marcadores semánticos/);
});

test('reintenta un error de red y respeta el límite', async () => {
  let calls = 0;
  await assert.rejects(request('https://example.invalid', '/', { attempts: 2, retryDelayMs: 0, delayImpl: async () => {}, fetchImpl: async () => { calls += 1; throw new TypeError('network unavailable'); } }), /network unavailable/);
  assert.equal(calls, 2);
});

test('corta con un presupuesto global agotado', async () => {
  await assert.rejects(request('https://example.invalid', '/', { deadlineAt: Date.now() - 1, fetchImpl: successfulFetch }), /presupuesto global/);
});
