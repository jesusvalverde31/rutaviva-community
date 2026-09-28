'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const path = require('node:path');
const { createEncryptedMagicLink, decryptText, magicLinkEmail } = require('../src/services/email-outbox.cjs');
const { createBrevoClient, createFakeClient, DeliveryError } = require('../src/services/brevo-client.cjs');
const { abortableDelay, createOutboxWorker, logDelivery, safeFailure } = require('../src/services/outbox-worker.cjs');
const { createWorkerLogger } = require('../scripts/run-outbox-worker.cjs');

const key = Buffer.alloc(32, 8);
const eventId = '10000000-0000-4000-8000-000000000001';
const link = `http://127.0.0.1:4329/auth/verify#token=${randomUUID()}.${Buffer.alloc(32, 4).toString('base64url')}`;

function delivery() {
  const encrypted = createEncryptedMagicLink('person@example.invalid', link, key);
  return { event_id: eventId, delivery_key: eventId, attempt: 1, payload_ciphertext: encrypted.ciphertext, payload_nonce: encrypted.nonce, payload_tag: encrypted.tag };
}

function jsonResponse(status, payload) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) };
}

function brevo(fetch, timeoutMs = 1000) {
  return createBrevoClient({ apiKey: 'x'.repeat(32), senderEmail: 'verified@example.test', timeoutMs, fetch });
}

function message() {
  return { ...magicLinkEmail({ to: 'person@example.invalid', template: 'auth.magic_link', link }), deliveryKey: eventId };
}

test('correo incluye HTML y texto, uso único, caducidad y condición loopback', () => {
  const email = magicLinkEmail({ to: 'person@example.invalid', template: 'auth.magic_link', link });
  assert.equal(email.subject, 'Tu enlace para entrar en RutaViva');
  assert.match(email.htmlContent, />Entrar en RutaViva</);
  assert.match(email.htmlContent, /un solo uso/);
  assert.match(email.textContent, /Caduca en 15 minutos/);
  assert.match(email.textContent, /mismo ordenador/);
  assert.match(email.textContent, /Si no lo solicitaste/);
  assert.equal(/<script|https:\/\/[^\s"']+\.(?:png|jpg|css)/i.test(email.htmlContent), false);
});

test('worker reclama una sola vez, descifra en memoria y completa sin PII en logs', async () => {
  let available = delivery(); const sent = []; const completed = []; const logs = [];
  const repository = {
    async claim() { const value = available; available = null; return value; },
    async complete(...args) { completed.push(args); return true; },
    async fail() { throw new Error('no esperado'); }
  };
  const worker = createOutboxWorker({ repository, encryptionKey: key, client: { async send(value) { sent.push(value); return { messageId: 'provider-safe-id' }; } }, logger: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args) } });
  const results = await Promise.all([worker.processOnce(), worker.processOnce()]);
  assert.equal(results.filter(result => result.processed).length, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].deliveryKey, eventId);
  assert.equal(completed.length, 1);
  assert.equal(Buffer.isBuffer(completed[0][3]) && completed[0][3].length === 32, true);
  const serializedLogs = JSON.stringify(logs);
  assert.equal(serializedLogs.includes('person@example.invalid'), false);
  assert.equal(serializedLogs.includes('#token='), false);
  assert.equal(serializedLogs.includes('provider-safe-id'), false);
});

test('worker solo reintenta rechazo 429 y termina resultados ambiguos o payload corrupto', async () => {
  for (const scenario of [
    { client: { send: async () => { throw new DeliveryError('PROVIDER_REJECTED_429', true); } }, expected: ['PROVIDER_REJECTED_429', true, 'pending'] },
    { client: { send: async () => { throw new DeliveryError('PROVIDER_OUTCOME_UNKNOWN', false); } }, expected: ['PROVIDER_OUTCOME_UNKNOWN', false, 'failed'] },
    { corrupt: true, client: { send: async () => { throw new Error('no debe enviar'); } }, expected: ['INVALID_ENCRYPTED_PAYLOAD', false, 'failed'] }
  ]) {
    const item = delivery(); if (scenario.corrupt) item.payload_tag = Buffer.alloc(16);
    const failures = [];
    const worker = createOutboxWorker({ encryptionKey: key, client: scenario.client, repository: {
      claim: async () => item, complete: async () => false,
      fail: async (_id, _worker, _lease, code, retryable) => { failures.push([code, retryable]); return retryable ? 'pending' : 'failed'; }
    } });
    const result = await worker.processOnce();
    assert.deepEqual(failures[0], scenario.expected.slice(0, 2));
    assert.equal(result.status, scenario.expected[2]);
  }
  assert.deepEqual(safeFailure(new Error('email=private@example.invalid')), { code: 'WORKER_FAILURE', retryable: false });
});

test('fallo de complete después de aceptación queda ambiguo y no se reintenta', async () => {
  const failures = [];
  const worker = createOutboxWorker({ encryptionKey: key, client: { send: async () => ({ messageId: 'accepted-id' }) }, repository: {
    claim: async () => delivery(), complete: async () => false,
    fail: async (_id, _worker, _lease, code, retryable) => { failures.push([code, retryable]); return 'lease_lost'; }
  } });
  const result = await worker.processOnce();
  assert.deepEqual(failures, [['PROVIDER_OUTCOME_UNKNOWN', false]]);
  assert.deepEqual(result, { processed: true, status: 'lease_lost', failureCode: 'PROVIDER_OUTCOME_UNKNOWN' });
});

test('cliente Brevo usa body.headers.idempotencyKey exacto y payload mínimo', async () => {
  let request;
  const client = brevo(async (url, options) => { request = { url, options }; return jsonResponse(201, { messageId: 'provider-message' }); });
  await client.send(message());
  const body = JSON.parse(request.options.body);
  assert.equal(request.url, 'https://api.brevo.com/v3/smtp/email');
  assert.deepEqual(body.headers, { idempotencyKey: eventId });
  assert.equal(body.to[0].email, 'person@example.invalid');
  assert.equal(request.options.redirect, 'error');
  assert.ok(request.options.signal);
});

test('duplicate_parameter confirma aceptación previa sin filtrar cuerpo', async () => {
  const result = await brevo(async () => jsonResponse(400, { code: 'duplicate_parameter', message: 'private provider text' })).send(message());
  assert.deepEqual(result, { messageId: `duplicate-${eventId}`, duplicate: true });
});

test('respuesta 2xx con messageId vacío o en blanco queda ambigua y terminal', async () => {
  for (const messageId of ['', '   \t\r\n']) {
    await assert.rejects(
      () => brevo(async () => jsonResponse(201, { messageId })).send(message()),
      error => error.code === 'PROVIDER_OUTCOME_UNKNOWN' && error.retryable === false
    );
  }
  const accepted = await brevo(async () => jsonResponse(201, { messageId: '  provider-message  ' })).send(message());
  assert.deepEqual(accepted, { messageId: 'provider-message', duplicate: false });
});

test('messageId aplica el límite de 500 caracteres después de normalizar', async () => {
  await assert.rejects(
    () => brevo(async () => jsonResponse(201, { messageId: 'x'.repeat(501) })).send(message()),
    error => error.code === 'PROVIDER_OUTCOME_UNKNOWN' && error.retryable === false
  );
  const normalized = 'x'.repeat(500);
  const accepted = await brevo(async () => jsonResponse(201, { messageId: `  ${normalized}\t` })).send(message());
  assert.deepEqual(accepted, { messageId: normalized, duplicate: false });
});

test('red, timeout, 408 y 5xx quedan terminales; solo 429 reintenta', async () => {
  const cases = [
    [async () => { throw new Error('network with private@example.invalid'); }, 'PROVIDER_OUTCOME_UNKNOWN', false],
    [async () => jsonResponse(408, { code: 'timeout' }), 'PROVIDER_OUTCOME_UNKNOWN', false],
    [async () => jsonResponse(503, { code: 'unavailable' }), 'PROVIDER_OUTCOME_UNKNOWN', false],
    [async () => jsonResponse(429, { code: 'rate_limit' }), 'PROVIDER_REJECTED_429', true]
  ];
  for (const [fetch, code, retryable] of cases) {
    await assert.rejects(() => brevo(fetch).send(message()), error => error.code === code && error.retryable === retryable);
  }
});

test('timeout cubre cabeceras rápidas y body colgado; shutdown aborta lectura en curso', async () => {
  const hangingResponse = { ok: true, status: 201, text: async () => new Promise(() => {}) };
  await assert.rejects(() => brevo(async () => hangingResponse, 20).send(message()), error => error.code === 'PROVIDER_OUTCOME_UNKNOWN' && !error.retryable);
  const controller = new AbortController();
  const sending = brevo(async () => hangingResponse, 5000).send(message(), { signal: controller.signal });
  controller.abort(new Error('shutdown'));
  await assert.rejects(sending, error => error.code === 'PROVIDER_OUTCOME_UNKNOWN' && !error.retryable);
});

test('sleep del worker retira listeners tanto al vencer como al abortar', async () => {
  class CountingSignal extends EventTarget {
    constructor() { super(); this.aborted = false; this.listeners = 0; }
    addEventListener(type, listener, options) { if (type === 'abort') this.listeners += 1; super.addEventListener(type, listener, options); }
    removeEventListener(type, listener, options) { if (type === 'abort') this.listeners -= 1; super.removeEventListener(type, listener, options); }
  }
  const signal = new CountingSignal();
  for (let index = 0; index < 100; index += 1) await abortableDelay(1, signal);
  assert.equal(signal.listeners, 0);
  const waiting = abortableDelay(10_000, signal);
  signal.aborted = true; signal.dispatchEvent(new Event('abort'));
  await waiting;
  assert.equal(signal.listeners, 0);
});

test('sleep vacío mantiene vivo el proceso standalone del worker', async () => {
  const projectRoot = path.resolve(__dirname, '..');
  const child = spawn(process.execPath, ['-e', "require('./src/services/outbox-worker.cjs').abortableDelay(10000)"], {
    cwd: projectRoot,
    stdio: 'ignore',
    windowsHide: true
  });
  try {
    await once(child, 'spawn');
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(child.exitCode, null, 'el proceso terminó mientras esperaba con la bandeja vacía');
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await once(child, 'exit');
    }
  }
});

test('logger aplica allowlist explícita y descarta PII aunque se le entregue', () => {
  const logs = [];
  logDelivery({ warn: (...args) => logs.push(args) }, 'warn', {
    eventId, attempt: 1, failureCode: 'PROVIDER_OUTCOME_UNKNOWN', status: 'failed',
    email: 'private@example.invalid', token: '#token=private', providerBody: 'private'
  }, 'email delivery failed');
  const serialized = JSON.stringify(logs);
  assert.equal(serialized.includes('private@example.invalid'), false);
  assert.equal(serialized.includes('#token='), false);
  assert.equal(serialized.includes('providerBody'), false);
  assert.deepEqual(logs[0][0], { eventId, attempt: 1, failureCode: 'PROVIDER_OUTCOME_UNKNOWN', status: 'failed' });
  const writes = [];
  createWorkerLogger({ stdout: { write: value => writes.push(value) }, stderr: { write: value => writes.push(value) } })
    .warn({ eventId, attempt: 1, failureCode: 'PROVIDER_OUTCOME_UNKNOWN', status: 'failed', email: 'private@example.invalid' });
  assert.equal(writes.join('').includes('private@example.invalid'), false);
  assert.deepEqual(JSON.parse(writes[0]), { level: 'warn', component: 'email_outbox', eventId, attempt: 1, failureCode: 'PROVIDER_OUTCOME_UNKNOWN', status: 'failed' });
});

test('proveedor fake no realiza red y conserva la clave de entrega', async () => {
  const client = createFakeClient();
  const result = await client.send({ deliveryKey: eventId, to: 'person@example.invalid' });
  assert.equal(client.sent.length, 1);
  assert.equal(result.messageId, `fake-${eventId}`);
});

test('descifrado rechaza clave incorrecta', () => {
  const encrypted = createEncryptedMagicLink('person@example.invalid', link, key);
  assert.throws(() => decryptText(encrypted, Buffer.alloc(32, 2)));
});
