'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EXPECTED_COMMIT_ATTEMPTS, request, runSmoke } = require('../scripts/smoke-production.cjs');

const iconPaths = ['/icon-192.png', '/icon-512.png'];
const expectedPaths = ['/api/v1/health', '/api/v1/ready', '/api/v1/bootstrap', '/', '/manifest.webmanifest', '/service-worker.js', '/offline.html', ...iconPaths];

function response(status, body, type = 'application/json', extraHeaders = {}) {
  const content = type === 'application/json' || type === 'application/manifest+json' ? JSON.stringify(body) : body;
  return new Response(content, { status, headers: { 'content-type': type, ...extraHeaders } });
}

function png(size, { signature = true, width = size, height = size, bytes = 24 } = {}) {
  const data = Buffer.alloc(bytes);
  if (signature) Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data, 0);
  if (data.length >= 24) {
    data.write('IHDR', 12, 'ascii');
    data.writeUInt32BE(width, 16);
    data.writeUInt32BE(height, 20);
  }
  return data;
}

const payloads = {
  '/api/v1/health': { status: 'ok', service: 'rutaviva-community', requestId: 'req-health' },
  '/api/v1/ready': { status: 'ready', checks: { database: 'ok', role: 'ok', postgis: 'ok', migrations: 'ok', relations: 'ok', functions: 'ok' }, requestId: 'req-ready' },
  '/api/v1/bootstrap': { service: 'rutaviva-community', pilot: { slug: 'sevilla' }, capabilities: { routes: true }, advertencia: 'Ruta orientativa: comprueba el entorno.', requestId: 'req-bootstrap' }
};

function successfulFetch(url, options = {}) {
  const pathname = new URL(url).pathname;
  if (options.method !== 'GET') throw new Error(`Método no permitido en smoke: ${options.method}`);
  if (pathname in payloads) return Promise.resolve(response(200, payloads[pathname]));
  if (pathname === '/') return Promise.resolve(response(200, '<!doctype html><meta name="viewport" content="width=device-width"><main>Ruta orientativa</main>', 'text/html'));
  if (pathname === '/manifest.webmanifest') return Promise.resolve(response(200, { start_url: '/', scope: '/', display: 'standalone', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }] }, 'application/manifest+json'));
  if (pathname === '/service-worker.js') return Promise.resolve(response(200, "self.addEventListener('fetch', () => {});", 'text/javascript', { 'cache-control': 'no-cache' }));
  if (pathname === '/offline.html') return Promise.resolve(response(200, '<!doctype html><main><h1>RutaViva no respondió</h1><p>Puede ser una conexión lenta o una pausa temporal del servicio. Reintenta.</p></main>', 'text/html'));
  if (pathname === '/icon-192.png') return Promise.resolve(response(200, png(192), 'image/png'));
  if (pathname === '/icon-512.png') return Promise.resolve(response(200, png(512), 'image/png'));
  throw new Error(`Ruta inesperada del smoke: ${pathname}`);
}

async function runWithOverride(pathname, makeResponse) {
  return runSmoke({ silent: true, attempts: 1, fetchImpl: async (url, options) => {
    const path = new URL(url).pathname;
    return path === pathname ? makeResponse() : successfulFetch(url, options);
  } });
}

test('smoke valida nueve recursos públicos con GET y no solicita rutas privadas', async () => {
  const requests = [];
  await runSmoke({ silent: true, attempts: 1, fetchImpl: (url, options) => {
    requests.push({ pathname: new URL(url).pathname, method: options.method });
    return successfulFetch(url, options);
  } });
  assert.deepEqual(requests.map(item => item.pathname), expectedPaths);
  assert.ok(requests.every(item => item.method === 'GET'));
  assert.ok(requests.every(item => !item.pathname.startsWith('/api/v1/auth') && !item.pathname.startsWith('/api/v1/moderation') && !item.pathname.startsWith('/api/v1/contributions')));
});

test('smoke espera hasta que producción sirve el commit fusionado esperado', async () => {
  assert.equal(EXPECTED_COMMIT_ATTEMPTS, 16);
  let healthCalls = 0;
  await runSmoke({ silent:true, attempts:3, retryDelayMs:0, delayImpl:async()=>{}, expectedCommit:'abcdef1234567890', fetchImpl:async(url,options)=>{
    const pathname=new URL(url).pathname;
    if(pathname==='/api/v1/health'){
      healthCalls+=1;
      return response(200,{...payloads[pathname],commit:healthCalls===1?'1111111':'abcdef1234567890'});
    }
    return successfulFetch(url,options);
  }});
  assert.equal(healthCalls,2);
});

test('reintenta un 503 transitorio y después continúa', async () => {
  let calls = 0;
  const result = await request('https://example.invalid', '/api/v1/health', { attempts: 2, retryDelayMs: 0, delayImpl: async () => {}, fetchImpl: async () => (++calls === 1 ? response(503, {}) : response(200, payloads['/api/v1/health'])) });
  assert.equal(result.status, 200);
  assert.equal(calls, 2);
});

test('cancela el body de un 503 antes de reintentar', async () => {
  let calls = 0;
  let cancelled = false;
  let firstSignal;
  const result = await request('https://example.invalid', '/api/v1/health', {
    attempts: 2, retryDelayMs: 0, delayImpl: async () => {},
    fetchImpl: async (url, options) => {
      calls += 1;
      if (calls === 1) {
        firstSignal = options.signal;
        return new Response(new ReadableStream({ cancel: () => { cancelled = true; } }), { status: 503, headers: { 'content-type': 'application/json' } });
      }
      return response(200, payloads['/api/v1/health']);
    }
  });
  assert.equal(result.status, 200);
  assert.equal(firstSignal.aborted, true);
  assert.equal(cancelled, true);
});

test('agota reintentos ante indisponibilidad persistente', async () => {
  await assert.rejects(request('https://example.invalid', '/api/v1/health', { attempts: 2, retryDelayMs: 0, delayImpl: async () => {}, fetchImpl: async () => response(503, {}) }), /respondió 503/);
});

test('falla ante JSON inválido sin imprimir el cuerpo', async () => {
  await assert.rejects(runSmoke({ silent: true, attempts: 1, fetchImpl: async url => new URL(url).pathname === '/api/v1/health' ? new Response('{mal', { status: 200, headers: { 'content-type': 'application/json' } }) : successfulFetch(url, { method: 'GET' }) }), /JSON inválido/);
});

test('falla si la portada no conserva semántica y advertencia', async () => {
  await assert.rejects(runWithOverride('/', () => response(200, '<html>sin main</html>', 'text/html')), /marcadores semánticos/);
});

test('falla ante estados HTTP o MIME incorrectos de recursos PWA', async t => {
  await t.test('rechaza status no exitoso', async () => assert.rejects(runWithOverride('/offline.html', () => response(503, '<main/>', 'text/html')), /offline.html respondió 503/));
  await t.test('rechaza MIME incorrecto', async () => assert.rejects(runWithOverride('/manifest.webmanifest', () => response(200, '{}', 'text/plain')), /manifest.webmanifest no devolvió el tipo de contenido esperado/));
});

test('falla ante contratos PWA incompletos o respuesta cacheable', async t => {
  await t.test('rechaza contrato incompleto del manifiesto', async () => assert.rejects(runWithOverride('/manifest.webmanifest', () => response(200, { start_url: '/', scope: '/', display: 'browser', icons: [] }, 'application/manifest+json')), /contrato de instalación/));
  await t.test('rechaza service worker sin no-cache', async () => assert.rejects(runWithOverride('/service-worker.js', () => response(200, "self.addEventListener('fetch', () => {});", 'text/javascript', { 'cache-control': 'public, max-age=3600' })), /Cache-Control no-cache/));
});

test('falla ante PNG inválido, con dimensiones erróneas o mayor de 128 KiB', async t => {
  await t.test('rechaza firma inválida', async () => assert.rejects(runWithOverride('/icon-192.png', () => response(200, png(192, { signature: false }), 'image/png')), /firma PNG válida/));
  await t.test('rechaza dimensiones incorrectas', async () => assert.rejects(runWithOverride('/icon-192.png', () => response(200, png(192, { width: 191 }), 'image/png')), /dimensiones 192x192/));
  await t.test('rechaza tamaño excesivo', async () => assert.rejects(runWithOverride('/icon-192.png', () => response(200, png(192, { bytes: 128 * 1024 + 1 }), 'image/png')), /supera 128 KiB/));
});

test('reintenta un error de red y respeta el límite', async () => {
  let calls = 0;
  await assert.rejects(request('https://example.invalid', '/', { attempts: 2, retryDelayMs: 0, delayImpl: async () => {}, fetchImpl: async () => { calls += 1; throw new TypeError('network unavailable'); } }), /network unavailable/);
  assert.equal(calls, 2);
});

test('limita la lectura incluso si las cabeceras llegan y el cuerpo queda colgado', async () => {
  const hangingResponse = new Response(new ReadableStream({ pull: () => new Promise(() => {}) }), { status: 200, headers: { 'content-type': 'text/html' } });
  await assert.rejects(request('https://example.invalid', '/', { attempts: 1, timeoutMs: 20, fetchImpl: async () => hangingResponse }), /abort|aborted|time/i);
});

test('cancela la respuesta que anuncia un body superior al límite', async () => {
  let cancelled = false;
  let signal;
  await assert.rejects(request('https://example.invalid', '/offline.html', {
    attempts: 1,
    fetchImpl: async (_url, options) => {
      signal = options.signal;
      return new Response(new ReadableStream({ cancel: () => { cancelled = true; } }), { status: 200, headers: { 'content-type': 'text/html', 'content-length': String(1024 * 1024 + 1) } });
    }
  }), /supera 1 MiB/);
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, true);
});

test('corta con un presupuesto global agotado', async () => {
  await assert.rejects(request('https://example.invalid', '/', { deadlineAt: Date.now() - 1, fetchImpl: successfulFetch }), /presupuesto global/);
});

