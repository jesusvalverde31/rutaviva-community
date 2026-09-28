'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { decryptText, magicLinkEmail } = require('./email-outbox.cjs');
const { DeliveryError } = require('./brevo-client.cjs');

const DELIVERY_STATUSES = new Set(['sent', 'pending', 'failed', 'cancelled', 'lease_lost']);

function safeFailure(error) {
  if (error instanceof DeliveryError && /^[A-Z0-9_]{1,64}$/.test(error.code)) {
    return { code: error.code, retryable: error.retryable === true };
  }
  if (error instanceof SyntaxError || error instanceof TypeError) return { code: 'INVALID_ENCRYPTED_PAYLOAD', retryable: false };
  return { code: 'WORKER_FAILURE', retryable: false };
}

function logDelivery(logger, level, values, message) {
  if (!logger || typeof logger[level] !== 'function') return;
  const safe = {};
  if (typeof values.eventId === 'string' && /^[0-9a-f-]{36}$/i.test(values.eventId)) safe.eventId = values.eventId;
  if (Number.isInteger(values.attempt) && values.attempt >= 0 && values.attempt <= 10) safe.attempt = values.attempt;
  if (typeof values.failureCode === 'string' && /^[A-Z0-9_]{1,64}$/.test(values.failureCode)) safe.failureCode = values.failureCode;
  if (DELIVERY_STATUSES.has(values.status)) safe.status = values.status;
  logger[level](safe, message);
}

function abortableDelay(milliseconds, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise(resolve => {
    let settled = false;
    let timer;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => finish();
    timer = setTimeout(finish, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function createOutboxWorker(options) {
  const { repository, client, encryptionKey } = options;
  if (!repository || !client || !Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) {
    throw new TypeError('El worker de correo no está configurado.');
  }
  const workerId = options.workerId || randomUUID();
  const leaseSeconds = options.leaseSeconds || 60;
  const logger = options.logger || { info() {}, warn() {}, error() {} };

  async function processOnce(processOptions = {}) {
    if (processOptions.signal?.aborted) return { processed: false };
    const leaseToken = randomUUID();
    const delivery = await repository.claim(workerId, leaseToken, leaseSeconds);
    if (!delivery) return { processed: false };
    const requestId = randomUUID();
    let providerAccepted = false;
    try {
      let payload;
      try {
        let plaintext = decryptText({
          ciphertext: delivery.payload_ciphertext,
          nonce: delivery.payload_nonce,
          tag: delivery.payload_tag
        }, encryptionKey);
        payload = JSON.parse(plaintext);
        plaintext = null;
      } catch (cause) { throw new DeliveryError('INVALID_ENCRYPTED_PAYLOAD', false, { cause }); }
      const email = magicLinkEmail(payload);
      const response = await client.send({ ...email, deliveryKey: String(delivery.delivery_key) }, { signal: processOptions.signal });
      providerAccepted = true;
      const providerHash = createHash('sha256').update(response.messageId).digest();
      const completed = await repository.complete(delivery.event_id, workerId, leaseToken, providerHash, requestId);
      if (!completed) throw new DeliveryError('PROVIDER_OUTCOME_UNKNOWN', false);
      logDelivery(logger, 'info', { eventId: delivery.event_id, attempt: Number(delivery.attempt), status: 'sent' }, 'email delivery completed');
      return { processed: true, status: 'sent' };
    } catch (error) {
      const failure = providerAccepted
        ? { code: 'PROVIDER_OUTCOME_UNKNOWN', retryable: false }
        : safeFailure(error);
      const status = await repository.fail(delivery.event_id, workerId, leaseToken, failure.code, failure.retryable, requestId);
      logDelivery(logger, 'warn', { eventId: delivery.event_id, attempt: Number(delivery.attempt), failureCode: failure.code, status }, 'email delivery failed');
      return { processed: true, status, failureCode: failure.code };
    }
  }

  async function run({ signal, idleMs = 1000 } = {}) {
    while (!signal?.aborted) {
      let result;
      try { result = await processOnce({ signal }); }
      catch { logDelivery(logger, 'error', { failureCode: 'OUTBOX_DATABASE_UNAVAILABLE' }, 'outbox worker iteration failed'); }
      if (!result?.processed && !signal?.aborted) await abortableDelay(idleMs, signal);
    }
  }

  return { processOnce, run, workerId };
}

module.exports = { abortableDelay, createOutboxWorker, logDelivery, safeFailure };
