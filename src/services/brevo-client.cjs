'use strict';

const MAX_RESPONSE_BYTES = 16 * 1024;

class DeliveryError extends Error {
  constructor(code, retryable, options = {}) {
    super('No se pudo determinar una entrega de correo segura.', options);
    this.name = 'DeliveryError';
    this.code = code;
    this.retryable = retryable;
  }
}

function waitWithSignal(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) return Promise.reject(signal.reason || new Error('aborted'));
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason || new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return Promise.race([Promise.resolve(promise), aborted])
    .finally(() => signal.removeEventListener('abort', onAbort));
}

async function readLimitedText(response, signal, limit = MAX_RESPONSE_BYTES) {
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await waitWithSignal(reader.read(), signal);
        if (done) break;
        total += value.byteLength;
        if (total > limit) {
          await reader.cancel();
          throw new Error('response_too_large');
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock?.(); }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
  }
  const text = await waitWithSignal(response.text(), signal);
  if (Buffer.byteLength(text, 'utf8') > limit) throw new Error('response_too_large');
  return text;
}

async function readLimitedJson(response, signal) {
  const text = await readLimitedText(response, signal);
  if (!text) return null;
  return JSON.parse(text);
}

function createFakeClient(options = {}) {
  const sent = options.sent || [];
  return {
    sent,
    async send(message, requestOptions = {}) {
      if (requestOptions.signal?.aborted) throw new DeliveryError('PROVIDER_OUTCOME_UNKNOWN', false);
      sent.push({ ...message });
      return { messageId: `fake-${message.deliveryKey}` };
    }
  };
}

function createBrevoClient(options) {
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch no está disponible.');
  if (typeof options.apiKey !== 'string' || options.apiKey.length < 20) throw new TypeError('Brevo requiere una API key explícita.');
  if (typeof options.senderEmail !== 'string' || !options.senderEmail.includes('@')) throw new TypeError('Brevo requiere un remitente verificado.');
  const timeoutMs = options.timeoutMs || 10_000;
  return {
    async send(message, requestOptions = {}) {
      const controller = new AbortController();
      const externalSignal = requestOptions.signal;
      const forwardAbort = () => controller.abort(externalSignal.reason);
      if (externalSignal?.aborted) forwardAbort();
      else externalSignal?.addEventListener('abort', forwardAbort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error('provider_timeout')), timeoutMs);
      timer.unref?.();
      try {
        const response = await waitWithSignal(fetchImpl('https://api.brevo.com/v3/smtp/email', {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { accept: 'application/json', 'api-key': options.apiKey, 'content-type': 'application/json' },
          body: JSON.stringify({
            sender: { email: options.senderEmail, name: options.senderName || 'RutaViva' },
            to: [{ email: message.to }], subject: message.subject,
            textContent: message.textContent, htmlContent: message.htmlContent,
            headers: { idempotencyKey: message.deliveryKey }
          })
        }), controller.signal);
        const result = await readLimitedJson(response, controller.signal);
        if (!response.ok) {
          if (result?.code === 'duplicate_parameter') return { messageId: `duplicate-${message.deliveryKey}`, duplicate: true };
          if (response.status === 429) throw new DeliveryError('PROVIDER_REJECTED_429', true);
          if (response.status === 408 || response.status >= 500) throw new DeliveryError('PROVIDER_OUTCOME_UNKNOWN', false);
          throw new DeliveryError(`PROVIDER_REJECTED_${response.status}`, false);
        }
        if (typeof result?.messageId !== 'string') {
          throw new DeliveryError('PROVIDER_OUTCOME_UNKNOWN', false);
        }
        const messageId = result.messageId.trim();
        if (messageId.length < 1 || messageId.length > 500) {
          throw new DeliveryError('PROVIDER_OUTCOME_UNKNOWN', false);
        }
        return { messageId, duplicate: false };
      } catch (cause) {
        if (cause instanceof DeliveryError) throw cause;
        throw new DeliveryError('PROVIDER_OUTCOME_UNKNOWN', false, { cause });
      } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener('abort', forwardAbort);
      }
    }
  };
}

module.exports = {
  DeliveryError,
  MAX_RESPONSE_BYTES,
  createBrevoClient,
  createFakeClient,
  readLimitedJson,
  readLimitedText,
  waitWithSignal
};
