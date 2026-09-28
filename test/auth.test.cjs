'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createApp } = require('../src/app.cjs');
const { loadConfig } = require('../src/config.cjs');
const { createAuthRepository } = require('../src/db/repositories/auth.cjs');
const { NETWORK_HASH_WINDOW_MS, createAuthService, deriveAuthKeys, keyedHash, networkIdentityHash, newOpaqueToken, normalizeEmail, verifyCsrf } = require('../src/services/auth.cjs');
const { decryptText } = require('../src/services/email-outbox.cjs');
const { cookieName, parseCookies, sessionCookie } = require('../src/plugins/session.cjs');

const secrets = {
  SESSION_SECRET: 's'.repeat(40),
  CSRF_SECRET: 'c'.repeat(40),
  IDENTITY_ENCRYPTION_KEY: 'ab'.repeat(32),
  IP_HASH_SECRET: 'i'.repeat(40)
};
const config = loadConfig({ NODE_ENV: 'test', ...secrets });
const headers = { host: config.allowedHost, origin: config.publicOrigin };

test('normaliza correo y crea token opaco con 256 bits aleatorios', () => {
  assert.equal(normalizeEmail('  Jesús@Example.COM '), 'jesús@example.com');
  assert.throws(() => normalizeEmail('sin-arroba'), error => error.code === 'INVALID_EMAIL');
  const token = newOpaqueToken({ randomUUID: () => '10000000-0000-4000-8000-000000000001', randomBytes: size => Buffer.alloc(size, 7) });
  assert.equal(token.length, 80);
  assert.equal(token.includes('='), false);
});

test('HMAC de red rota cada 48 horas con reloj controlado', () => {
  const identity = '198.51.100.8';
  const start = NETWORK_HASH_WINDOW_MS * 10_000;
  const first = networkIdentityHash(config.ipHashSecret, identity, start);
  const sameBucket = networkIdentityHash(config.ipHashSecret, identity, start + NETWORK_HASH_WINDOW_MS - 1);
  const nextBucket = networkIdentityHash(config.ipHashSecret, identity, start + NETWORK_HASH_WINDOW_MS);
  assert.deepEqual(sameBucket, first);
  assert.notDeepEqual(nextBucket, first);
});

test('request-link cifra correo y enlace; persiste solo hashes y payload cifrado', async () => {
  let received;
  const repository = { requestMagicLink: async input => { received = input; } };
  let sequence = 0;
  const ids = [
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003'
  ];
  const networkNow = NETWORK_HASH_WINDOW_MS * 20_000;
  const service = createAuthService({
    repository, config,
    randomUUID: () => ids[sequence++],
    randomBytes: size => Buffer.alloc(size, 9),
    now: () => networkNow
  });
  const result = await service.requestLink({
    email: ' Persona@Example.COM ', networkIdentity: '198.51.100.8',
    idempotencyKey: 'idem-auth-0000001', requestId: randomUUID()
  });
  assert.deepEqual(result, { accepted: true });
  assert.equal(received.emailHash.length, 32);
  assert.equal(received.ipHash.length, 32);
  assert.deepEqual(received.ipHash, networkIdentityHash(config.ipHashSecret, '198.51.100.8', networkNow));
  assert.equal(received.globalHash.length, 32);
  assert.equal(received.tokenHash.length, 32);
  const keys = deriveAuthKeys(config.identityEncryptionKey);
  assert.equal(new Set(Object.values(keys).map(key => key.toString('hex'))).size, 4);
  assert.equal(Object.values(keys).some(key => key.equals(config.identityEncryptionKey)), false);
  assert.deepEqual(received.requestHash, keyedHash(keys.requestIndex, 'request-link', 'persona@example.com'));
  assert.equal(decryptText(received.encryptedEmail, keys.identityEncryption), 'persona@example.com');
  const outbox = JSON.parse(decryptText(received.encryptedOutbox, keys.outboxEncryption));
  assert.equal(received.verificationId, decodeURIComponent(outbox.link.split('#token=')[1]).slice(0, 36));
  assert.equal(outbox.to, 'persona@example.com');
  assert.match(outbox.link, /\/auth\/verify#token=/);
  assert.equal(JSON.stringify(received).includes('persona@example.com'), false);
});

test('verificación crea sesión opaca y no acepta token mal formado', async () => {
  const ids = Array.from({ length: 8 }, () => randomUUID());
  let position = 0;
  let received;
  const repository = {
    verifyMagicLink: async input => {
      received = input;
      return { authenticated: true, user_id: input.userId, public_alias: input.publicAlias, user_version: 1, roles: ['collaborator'] };
    }
  };
  const service = createAuthService({ repository, config, randomUUID: () => ids[position++], randomBytes: size => Buffer.alloc(size, 3) });
  const token = newOpaqueToken();
  const result = await service.verify({ token, requestId: randomUUID() });
  assert.equal(result.sessionToken.length, 80);
  assert.equal(received.tokenHash.length, 32);
  assert.equal(received.sessionTokenHash.length, 32);
  assert.equal(received.verificationId, token.slice(0, 36));
  assert.equal(received.ipHash.length, 32);
  assert.match(received.publicAlias, /^Ruta-[0-9a-f]{16}$/);
  assert.equal(result.session.user_version, 1);
  assert.deepEqual(result.session.roles, ['collaborator']);
  await assert.rejects(() => service.verify({ token: 'mal', requestId: randomUUID() }), error => error.code === 'INVALID_OR_EXPIRED_LINK');
});

test('servicio diferencia límites, cuenta no disponible y enlace inválido', async () => {
  const baseRepository = { requestMagicLink: async () => ({ outcome: 'rate_limited', retry_after: 3600 }) };
  const limited = createAuthService({ repository: baseRepository, config });
  await assert.rejects(
    () => limited.requestLink({ email: 'one@example.invalid', networkIdentity: '198.51.100.8', idempotencyKey: 'idem-auth-0000001', requestId: randomUUID() }),
    error => error.status === 429 && error.retryAfter === 3600
  );
  const capacity = createAuthService({ repository: { requestMagicLink: async () => ({ outcome: 'capacity_exhausted', retry_after: 86400 }) }, config });
  await assert.rejects(
    () => capacity.requestLink({ email: 'one@example.invalid', networkIdentity: '198.51.100.8', idempotencyKey: 'idem-auth-0000002', requestId: randomUUID() }),
    error => error.status === 503 && error.code === 'EMAIL_CAPACITY_EXHAUSTED' && error.retryAfter === 86400
  );
  for (const [outcome, status] of [['rate_limited', 429], ['account_unavailable', 403], ['invalid', 401]]) {
    const service = createAuthService({ repository: { verifyMagicLink: async () => ({ outcome, authenticated: false }) }, config });
    await assert.rejects(
      () => service.verify({ token: newOpaqueToken(), networkIdentity: '198.51.100.8', requestId: randomUUID() }),
      error => error.status === status
    );
  }
});

test('API propaga Retry-After y repositorio distingue conflicto de idempotencia', async () => {
  const service = createAuthService({ repository: { requestMagicLink: async () => ({ outcome: 'rate_limited', retry_after: 3600 }) }, config });
  const app = createApp({ config, authService: service, emailDeliveryOperational: true, logger: false });
  try {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/auth/request-link',
      headers: { ...headers, 'idempotency-key': 'idem-rate-0000001' },
      payload: { email: 'rate@example.invalid' }
    });
    assert.equal(response.statusCode, 429);
    assert.equal(response.headers['retry-after'], '3600');
    assert.equal(response.json().code, 'RATE_LIMITED');
  } finally { await app.close(); }

  const capacityService = createAuthService({ repository: { requestMagicLink: async () => ({ outcome: 'capacity_exhausted', retry_after: 86400 }) }, config });
  const capacityApp = createApp({ config, authService: capacityService, emailDeliveryOperational: true, logger: false });
  try {
    const response = await capacityApp.inject({
      method: 'POST', url: '/api/v1/auth/request-link',
      headers: { ...headers, 'idempotency-key': 'idem-capacity-0001' },
      payload: { email: 'capacity@example.invalid' }
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.headers['retry-after'], '86400');
    assert.equal(response.json().code, 'EMAIL_CAPACITY_EXHAUSTED');
  } finally { await capacityApp.close(); }

  const repository = createAuthRepository({ query: async () => { throw { code: 'P0001', message: 'idempotency_conflict' }; } });
  await assert.rejects(
    repository.requestMagicLink({
      verificationId: randomUUID(), outboxId: randomUUID(), emailHash: Buffer.alloc(32), ipHash: Buffer.alloc(32), globalHash: Buffer.alloc(32),
      encryptedEmail: { ciphertext: Buffer.alloc(1), nonce: Buffer.alloc(12), tag: Buffer.alloc(16) }, tokenHash: Buffer.alloc(32),
      encryptedOutbox: { ciphertext: Buffer.alloc(1), nonce: Buffer.alloc(12), tag: Buffer.alloc(16) },
      idempotencyKey: 'idem-conflict-001', requestHash: Buffer.alloc(32), requestId: randomUUID()
    }),
    error => error.status === 409 && error.code === 'IDEMPOTENCY_CONFLICT'
  );
});

test('CSRF cambia entre sesiones y se compara en tiempo constante', () => {
  const service = createAuthService({ repository: {}, config });
  const expiry = '2026-10-01T00:00:00.000Z';
  const first = service.csrfFor({ session_id: '10000000-0000-4000-8000-000000000001', session_expires_at: expiry });
  const second = service.csrfFor({ session_id: '10000000-0000-4000-8000-000000000002', session_expires_at: expiry });
  assert.notEqual(first, second);
  assert.equal(first.length, 43);
  assert.equal(verifyCsrf(first, first), true);
  assert.equal(verifyCsrf(first, second), false);
});

test('cookies separan desarrollo y producción y el parser ignora codificación inválida', () => {
  assert.equal(cookieName(config), 'rv_session');
  assert.match(sessionCookie(config, 'abc'), /^rv_session=abc; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
  const production = loadConfig({
    NODE_ENV: 'production', HOST: '0.0.0.0', PUBLIC_ORIGIN: 'https://rutaviva.example', TRUST_PROXY_HOPS: '1',
    DATABASE_URL: `postgresql://rutaviva_runtime:${'r'.repeat(40)}@database.invalid/app`, ...secrets
  });
  assert.equal(cookieName(production), '__Host-rv_session');
  assert.match(sessionCookie(production, 'abc'), /; Secure$/);
  assert.deepEqual(parseCookies('one=1; broken=%ZZ; two=hello%20world'), { one: '1', two: 'hello world' });
});

test('API mantiene 202 anti-enumeración, fragmento fuera del servidor y cookie HttpOnly', async () => {
  const session = {
    session_id: randomUUID(), user_id: randomUUID(), public_alias: 'Ruta-demo', user_status: 'active',
    user_version: 1, session_expires_at: new Date(Date.now() + 60_000).toISOString(), roles: ['collaborator']
  };
  let requestCount = 0;
  const token = newOpaqueToken();
  const authService = {
    requestLink: async () => { requestCount += 1; return { accepted: true }; },
    verify: async () => ({ sessionToken: token, session }),
    authenticate: async supplied => supplied === token ? session : null,
    csrfFor: () => 'csrf-synthetic',
    listSessions: async () => [{ id: session.session_id, created_at: '2026-01-01', last_seen_at: '2026-01-02', expires_at: '2026-02-01', current_session: true }],
    revokeSession: async () => true
  };
  const app = createApp({ config, authService, emailDeliveryOperational: true, logger: false });
  try {
    let response = await app.inject({ method: 'POST', url: '/api/v1/auth/request-link', headers: { ...headers, 'idempotency-key': 'idem-auth-0000001' }, payload: { email: 'one@example.invalid' } });
    assert.equal(response.statusCode, 202);
    assert.equal(response.json().accepted, true);
    response = await app.inject({ method: 'POST', url: '/api/v1/auth/request-link', headers: { ...headers, 'idempotency-key': 'idem-auth-0000002' }, payload: { email: 'other@example.invalid' } });
    assert.equal(response.statusCode, 202);
    assert.equal(requestCount, 2);

    response = await app.inject({ method: 'POST', url: '/api/v1/auth/verify', headers, payload: { token: newOpaqueToken() } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().authenticated, true);
    assert.equal(response.json().user.version, 1);
    assert.equal(response.json().user.status, 'active');
    assert.match(response.headers['set-cookie'], /^rv_session=.*HttpOnly; SameSite=Lax/);
    assert.equal(response.body.includes(token), false);
  } finally { await app.close(); }
});

test('sesiones exigen cookie; mutaciones además Origin y CSRF', async () => {
  const token = newOpaqueToken();
  const session = {
    session_id: randomUUID(), user_id: randomUUID(), public_alias: 'Ruta-demo', user_status: 'active',
    user_version: 7, session_expires_at: new Date(Date.now() + 60_000).toISOString(), roles: ['collaborator']
  };
  let revocations = 0;
  let sessionActive = true;
  const authService = {
    authenticate: async supplied => supplied === token && sessionActive ? session : null,
    csrfFor: () => 'csrf-synthetic',
    listSessions: async () => [{ id: session.session_id, created_at: 'a', last_seen_at: 'b', expires_at: 'c', current_session: true }],
    revokeSession: async () => { revocations += 1; sessionActive = false; return true; }
  };
  const app = createApp({ config, authService, logger: false });
  const authenticated = { ...headers, cookie: `rv_session=${encodeURIComponent(token)}` };
  try {
    let response = await app.inject({ method: 'GET', url: '/api/v1/users/me', headers });
    assert.equal(response.statusCode, 401);
    response = await app.inject({ method: 'GET', url: '/api/v1/users/me', headers: authenticated });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().user.alias, 'Ruta-demo');
    assert.equal(response.json().user.version, 7);
    response = await app.inject({ method: 'GET', url: '/api/v1/auth/csrf', headers: authenticated });
    assert.equal(response.json().csrfToken, 'csrf-synthetic');
    response = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: authenticated });
    assert.equal(response.statusCode, 403);
    response = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { ...authenticated, 'x-csrf-token': 'wrong' } });
    assert.equal(response.statusCode, 403);
    response = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { ...authenticated, 'x-csrf-token': 'csrf-synthetic' } });
    assert.equal(response.statusCode, 204);
    assert.equal(revocations, 1);
    assert.match(response.headers['set-cookie'], /Max-Age=0/);
    response = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { ...authenticated, 'x-csrf-token': 'csrf-synthetic' } });
    assert.equal(response.statusCode, 204);
    assert.equal(revocations, 1);
    assert.match(response.headers['set-cookie'], /Max-Age=0/);
    response = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers });
    assert.equal(response.statusCode, 204);
    assert.match(response.headers['set-cookie'], /Max-Age=0/);
    response = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { host: config.allowedHost, origin: 'https://evil.invalid' } });
    assert.equal(response.statusCode, 403);
  } finally { await app.close(); }
});

test('sin secretos ni base, autenticación responde indisponible sin afectar health', async () => {
  const app = createApp({ config: loadConfig({ NODE_ENV: 'test' }), logger: false });
  try {
    const health = await app.inject({ method: 'GET', url: '/api/v1/health', headers: { host: config.allowedHost } });
    assert.equal(health.statusCode, 200);
    const response = await app.inject({
      method: 'POST', url: '/api/v1/auth/request-link',
      headers: { ...headers, 'idempotency-key': 'idem-auth-0000001' }, payload: { email: 'one@example.invalid' }
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().code, 'EMAIL_DELIVERY_NOT_CONFIGURED');
  } finally { await app.close(); }
});

test('request-link falla cerrado sin entrega operativa y no invoca el servicio', async () => {
  let calls = 0;
  const authService = { requestLink: async () => { calls += 1; } };
  const app = createApp({ config, authService, logger: false });
  try {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/auth/request-link',
      headers: { ...headers, 'idempotency-key': 'idem-disabled-0001' },
      payload: { email: 'never-persisted@example.invalid' }
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().code, 'EMAIL_DELIVERY_NOT_CONFIGURED');
    assert.equal(calls, 0);
  } finally { await app.close(); }
});

test('health no consulta sesión aunque llegue una cookie antigua', async () => {
  const authService = { authenticate: async () => { throw new Error('no debe consultarse'); } };
  const app = createApp({ config, authService, logger: false });
  try {
    const response = await app.inject({
      method: 'GET', url: '/api/v1/health', headers: { ...headers, cookie: 'rv_session=old' }
    });
    assert.equal(response.statusCode, 200);
  } finally { await app.close(); }
});

test('proxy queda cerrado en desarrollo y limitado a un salto en producción', async () => {
  const observed = [];
  const authService = { requestLink: async input => { observed.push(input.networkIdentity); } };
  let app = createApp({ config, authService, emailDeliveryOperational: true, logger: false });
  try {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/auth/request-link', remoteAddress: '127.0.0.9',
      headers: { ...headers, 'x-forwarded-for': '203.0.113.40', 'idempotency-key': 'idem-proxy-000001' },
      payload: { email: 'one@example.invalid' }
    });
    assert.equal(response.statusCode, 202);
    assert.equal(observed.pop(), '127.0.0.9');
  } finally { await app.close(); }

  const production = loadConfig({
    NODE_ENV: 'production', HOST: '0.0.0.0', PUBLIC_ORIGIN: 'https://rutaviva.example', TRUST_PROXY_HOPS: '1',
    DATABASE_URL: `postgresql://rutaviva_runtime:${'r'.repeat(40)}@database.invalid/app`, ...secrets
  });
  app = createApp({ config: production, authService, emailDeliveryOperational: true, logger: false });
  try {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/auth/request-link', remoteAddress: '127.0.0.9',
      headers: { host: production.allowedHost, origin: production.publicOrigin, 'x-forwarded-for': '203.0.113.40', 'idempotency-key': 'idem-proxy-000002' },
      payload: { email: 'two@example.invalid' }
    });
    assert.equal(response.statusCode, 202);
    assert.equal(observed.pop(), '203.0.113.40');
  } finally { await app.close(); }
});
