'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app.cjs');
const { loadConfig } = require('../src/config.cjs');

const config = loadConfig({ NODE_ENV: 'test' });
const headers = { host: config.allowedHost };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function withApp(options, run) {
  const app = createApp({ config, logger: false, ...options });
  try { await run(app); } finally { await app.close(); }
}

test('health expone SHA corto normalizado solo con un commit válido de Render',async()=>{const previous=process.env.RENDER_GIT_COMMIT;process.env.RENDER_GIT_COMMIT='ABCDEF1234567890ABCDEF1234567890ABCDEF12';try{await withApp({},async app=>{const response=await app.inject({method:'GET',url:'/api/v1/health',headers});assert.equal(response.statusCode,200);assert.equal(response.json().commit,'abcdef123456');});process.env.RENDER_GIT_COMMIT='not-a-commit';await withApp({},async app=>{const response=await app.inject({method:'GET',url:'/api/v1/health',headers});assert.equal(Object.hasOwn(response.json(),'commit'),false);});}finally{if(previous===undefined)delete process.env.RENDER_GIT_COMMIT;else process.env.RENDER_GIT_COMMIT=previous;}});

test('health confirma vida sin ejecutar readiness', async () => {
  let calls = 0;
  await withApp({ readinessCheck: async () => { calls += 1; return { ready: true }; } }, async app => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health', headers });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'rutaviva-community');
    assert.match(body.requestId, uuid);
    assert.equal(response.headers['x-request-id'], body.requestId);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(calls, 0);
  });
});

test('health incluye CSP y cabeceras defensivas', async () => withApp({}, async app => {
  const response = await app.inject({ method: 'GET', url: '/api/v1/health', headers });
  assert.match(response.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'DENY');
}));

test('ready devuelve 503 honesto mientras no hay base', async () => withApp({}, async app => {
  const response = await app.inject({ method: 'GET', url: '/api/v1/ready', headers });
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers['retry-after'], '5');
  const body = response.json();
  assert.equal(body.code, 'SERVICE_NOT_READY');
  assert.equal(body.requestId, response.headers['x-request-id']);
  assert.equal(JSON.stringify(body).includes('stack'), false);
}));

test('bootstrap y zones devuelven 503 seguro sin base', async () => withApp({}, async app => {
  for (const url of ['/api/v1/bootstrap', '/api/v1/zones']) {
    const response = await app.inject({ method: 'GET', url, headers });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().code, 'DATABASE_UNAVAILABLE');
    assert.equal(response.body.includes('postgres'), false);
  }
}));

test('bootstrap y zones solo devuelven el contrato público', async () => {
  const queries = [];
  const database = {
    async query(text, values) {
      queries.push({ text, values });
      if (String(text).includes('COUNT(zone.id)')) return { rows: [{ id: 'city', slug: 'sevilla', name: 'Sevilla', countryCode: 'ES', isApproximate: true, latitude: 37.3891, longitude: -5.9845, zoneCount: 1 }] };
      return { rows: [{ id: '20000000-0000-4000-8000-000000000001', slug: 'triana', name: 'Área piloto aproximada — Triana', sortOrder: 20, isApproximate: true, bbox: [-6.025, 37.372, -6, 37.402] }] };
    }
  };
  await withApp({ database }, async app => {
    let response = await app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().service, 'rutaviva-community');
    assert.equal(response.json().apiVersion, 'v1');
    assert.equal(response.json().pilot.slug, 'sevilla');
    assert.match(response.json().advertencia, /Ruta orientativa/);
    assert.equal(response.body.includes('boundary'), false);
    response = await app.inject({ method: 'GET', url: '/api/v1/zones?q=Triana&limit=1', headers });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.length, 1);
    assert.deepEqual(response.json().data[0].bbox, [-6.025, 37.372, -6, 37.402]);
    assert.equal(response.body.includes('boundary'), false);
    assert.deepEqual(queries.find(call => Array.isArray(call.values) && call.values.length === 5)?.values, ['sevilla', 'Triana', null, null, 2]);
  });
});

test('zones valida filtros antes de consultar', async () => withApp({ database: { query: async () => { throw new Error('no debe ejecutarse'); } } }, async app => {
  const response = await app.inject({ method: 'GET', url: '/api/v1/zones?limit=101', headers });
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().code, 'VALIDATION_ERROR');
}));

test('zones rechaza cursor manipulado sin consultar', async () => {
  let calls = 0;
  await withApp({ database: { query: async () => { calls += 1; return { rows: [] }; } } }, async app => {
    for (const cursor of [
      'manipulado',
      Buffer.from(JSON.stringify({ v: 1, s: 1_000_001, i: '20000000-0000-4000-8000-000000000001' })).toString('base64url')
    ]) {
      const response = await app.inject({ method: 'GET', url: `/api/v1/zones?cursor=${cursor}`, headers });
      assert.equal(response.statusCode, 422);
      assert.equal(response.json().code, 'INVALID_CURSOR');
    }
    assert.equal(calls, 0);
  });
});

test('ready devuelve 200 solo con comprobación satisfactoria', async () => withApp({ readinessCheck: async () => ({ ready: true, checks: { database: 'ok' } }) }, async app => {
  const response = await app.inject({ method: 'GET', url: '/api/v1/ready', headers });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().checks, { database: 'ok' });
}));

test('excepción o timeout de readiness mantienen el mismo error público', async () => {
  for (const options of [
    { readinessCheck: async () => { throw new Error('db.internal:5432 secret'); } },
    { readinessCheck: () => new Promise(() => {}), readinessTimeoutMs: 10 }
  ]) {
    await withApp(options, async app => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/ready', headers });
      assert.equal(response.statusCode, 503);
      assert.equal(response.json().code, 'SERVICE_NOT_READY');
      assert.equal(response.body.includes('db.internal'), false);
    });
  }
});

test('rechaza Host y Origin distintos del origen configurado', async () => withApp({}, async app => {
  let response = await app.inject({ method: 'GET', url: '/api/v1/health', headers: { host: 'evil.example' } });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, 'INVALID_HOST');
  response = await app.inject({ method: 'GET', url: '/api/v1/health', headers: { ...headers, origin: 'https://evil.example' } });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().code, 'INVALID_ORIGIN');
}));

test('404 conserva el contrato de error y requestId', async () => withApp({}, async app => {
  let response = await app.inject({ method: 'GET', url: '/api/v1/no-existe', headers });
  assert.equal(response.statusCode, 404);
  assert.equal(response.headers['content-type'].startsWith('application/problem+json'), true);
  assert.equal(response.json().code, 'ROUTE_NOT_FOUND');
  assert.equal(response.json().requestId, response.headers['x-request-id']);
  response = await app.inject({ method: 'GET', url: '/api/v1/%ZZ', headers });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, 'MALFORMED_URL');
  assert.equal(response.json().requestId, response.headers['x-request-id']);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
}));

test('límite de cuerpo, media type y JSON inválido producen errores seguros', async () => withApp({}, async app => {
  app.post('/api/v1/test-body', async request => request.body);
  let response = await app.inject({ method: 'POST', url: '/api/v1/test-body', headers: { ...headers, 'content-type': 'application/json' }, payload: JSON.stringify({ value: 'x'.repeat(70_000) }) });
  assert.equal(response.statusCode, 413);
  assert.equal(response.json().code, 'PAYLOAD_TOO_LARGE');
  response = await app.inject({ method: 'POST', url: '/api/v1/test-body', headers: { ...headers, 'content-type': 'application/xml' }, payload: '<x />' });
  assert.equal(response.statusCode, 415);
  response = await app.inject({ method: 'POST', url: '/api/v1/test-body', headers: { ...headers, 'content-type': 'application/json' }, payload: '{' });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, 'INVALID_JSON');
  response = await app.inject({ method: 'POST', url: '/api/v1/test-body', headers: { ...headers, 'content-type': 'application/json' }, payload: '' });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, 'INVALID_JSON');
}));

test('un fallo interno no filtra respuesta, logs, URL ni IP', async () => {
  const logLines = [];
  const stream = { write: chunk => { logLines.push(String(chunk)); } };
  const syntheticToken = 'SYNTHETIC_' + 'TOKEN_ONLY';
  await withApp({ logger: { level: 'info', stream } }, async app => {
  app.get('/api/v1/test-error', async () => { throw new Error('password=private file.cjs:99'); });
  await app.inject({ method: 'GET', url: `/api/v1/health?token=${syntheticToken}&email=synthetic@example.invalid`, headers, remoteAddress: '203.0.113.42' });
  const response = await app.inject({ method: 'GET', url: '/api/v1/test-error', headers, remoteAddress: '203.0.113.42' });
  assert.equal(response.statusCode, 500);
  assert.equal(response.json().code, 'INTERNAL_ERROR');
  assert.equal(response.body.includes('private'), false);
  assert.equal(response.body.includes('file.cjs'), false);
  const logs = logLines.join('');
  assert.equal(logs.includes(syntheticToken), false);
  assert.equal(logs.includes('synthetic@example.invalid'), false);
  assert.equal(logs.includes('203.0.113.42'), false);
  assert.equal(logs.includes('password=private'), false);
  assert.equal(logs.includes('file.cjs'), false);
  assert.match(logs, /"errorCode":"INTERNAL_ERROR"/);
  });
});
