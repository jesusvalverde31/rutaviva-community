'use strict';

const { createHash, createHmac, hkdfSync, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { AppError } = require('../errors.cjs');
const { createEncryptedMagicLink, encryptText } = require('./email-outbox.cjs');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/i;
const NETWORK_HASH_WINDOW_MS = 48 * 60 * 60 * 1000;

function normalizeEmail(value) {
  if (typeof value !== 'string') throw new AppError(422, 'INVALID_EMAIL', 'El correo no es válido.');
  const normalized = value.trim().normalize('NFKC').toLowerCase();
  if (normalized.length < 3 || normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) {
    throw new AppError(422, 'INVALID_EMAIL', 'El correo no es válido.');
  }
  return normalized;
}

function sha256(value) {
  return createHash('sha256').update(value).digest();
}

function keyedHash(secret, purpose, value) {
  return createHmac('sha256', secret).update(`${purpose}\0${value}`).digest();
}

function deriveAuthKeys(rootKey) {
  if (!Buffer.isBuffer(rootKey) || rootKey.length !== 32) throw new TypeError('La clave raíz de identidad debe contener 32 bytes.');
  const salt = Buffer.from('rutaviva-community/auth/v1', 'utf8');
  const derive = label => Buffer.from(hkdfSync('sha256', rootKey, salt, Buffer.from(label, 'utf8'), 32));
  return Object.freeze({
    emailIndex: derive('email-index-hmac'),
    requestIndex: derive('request-index-hmac'),
    identityEncryption: derive('identity-aes-256-gcm'),
    outboxEncryption: derive('outbox-aes-256-gcm')
  });
}

function networkIdentityHash(secret, identity, nowValue = Date.now()) {
  const milliseconds = nowValue instanceof Date ? nowValue.getTime() : Number(nowValue);
  if (!Number.isFinite(milliseconds)) throw new TypeError('El reloj de red no es válido.');
  const bucket = Math.floor(milliseconds / NETWORK_HASH_WINDOW_MS);
  return keyedHash(secret, `network-48h:${bucket}`, identity || 'unknown');
}

function newOpaqueToken(options = {}) {
  return `${(options.randomUUID || randomUUID)()}.${(options.randomBytes || randomBytes)(32).toString('base64url')}`;
}

function verifyCsrf(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string') return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

function createAuthService(options) {
  const { repository, config } = options;
  const ids = options.randomUUID || randomUUID;
  const bytes = options.randomBytes || randomBytes;
  const now = options.now || Date.now;
  let derivedKeys;

  function ensureConfigured() {
    if (!repository || !config.sessionSecret || !config.csrfSecret || !config.identityEncryptionKey || !config.ipHashSecret) {
      throw new AppError(503, 'AUTHENTICATION_NOT_CONFIGURED', 'El acceso todavía no está configurado.');
    }
    if (!derivedKeys) derivedKeys = deriveAuthKeys(config.identityEncryptionKey);
    return derivedKeys;
  }

  return {
    async requestLink({ email, networkIdentity, idempotencyKey, requestId }) {
      const keys = ensureConfigured();
      const normalizedEmail = normalizeEmail(email);
      const token = newOpaqueToken({ randomUUID: ids, randomBytes: bytes });
      const emailHash = keyedHash(keys.emailIndex, 'email', normalizedEmail);
      const ipHash = networkIdentityHash(config.ipHashSecret, networkIdentity, now());
      const link = `${config.publicOrigin}/auth/verify#token=${encodeURIComponent(token)}`;
      const encryptedEmail = encryptText(normalizedEmail, keys.identityEncryption, { randomBytes: bytes });
      const encryptedOutbox = createEncryptedMagicLink(normalizedEmail, link, keys.outboxEncryption, { randomBytes: bytes });
      const persisted = await repository.requestMagicLink({
        verificationId: token.slice(0, 36), outboxId: ids(), emailHash, ipHash,
        globalHash: keyedHash(config.ipHashSecret, 'global', 'auth.request_link'), encryptedEmail,
        tokenHash: sha256(token), encryptedOutbox, idempotencyKey,
        requestHash: keyedHash(keys.requestIndex, 'request-link', normalizedEmail), requestId
      });
      if (persisted?.outcome === 'rate_limited') {
        throw new AppError(429, 'RATE_LIMITED', 'Demasiadas solicitudes. Inténtalo de nuevo más tarde.', { retryAfter: Number(persisted.retry_after) || 900 });
      }
      if (persisted?.outcome === 'capacity_exhausted') {
        throw new AppError(503, 'EMAIL_CAPACITY_EXHAUSTED', 'El envío de enlaces ha alcanzado su capacidad temporal.', { retryAfter: Number(persisted.retry_after) || 86400 });
      }
      return { accepted: true };
    },
    async verify({ token, networkIdentity, requestId }) {
      ensureConfigured();
      if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw new AppError(401, 'INVALID_OR_EXPIRED_LINK', 'El enlace no es válido o ha caducado.');
      const sessionToken = newOpaqueToken({ randomUUID: ids, randomBytes: bytes });
      const userId = ids();
      const result = await repository.verifyMagicLink({
        verificationId: token.slice(0, 36), tokenHash: sha256(token),
        ipHash: networkIdentityHash(config.ipHashSecret, networkIdentity, now()),
        userId, identityId: ids(), sessionId: ids(),
        sessionTokenHash: keyedHash(config.sessionSecret, 'session', sessionToken), publicAlias: `Ruta-${userId.replaceAll('-', '').slice(0, 16)}`, requestId
      });
      if (result?.outcome === 'rate_limited') throw new AppError(429, 'RATE_LIMITED', 'Demasiados intentos. Inténtalo de nuevo más tarde.', { retryAfter: 900 });
      if (result?.outcome === 'account_unavailable') throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'La cuenta no está disponible.');
      if (!result?.authenticated) throw new AppError(401, 'INVALID_OR_EXPIRED_LINK', 'El enlace no es válido o ha caducado.');
      return { sessionToken, session: result };
    },
    async authenticate(sessionToken) {
      ensureConfigured();
      if (typeof sessionToken !== 'string' || !TOKEN_PATTERN.test(sessionToken)) return null;
      return repository.authenticate(keyedHash(config.sessionSecret, 'session', sessionToken));
    },
    csrfFor(session) {
      ensureConfigured();
      const expiresAt = new Date(session.session_expires_at).toISOString();
      return createHmac('sha256', config.csrfSecret)
        .update(`csrf\0${session.session_id}\0${expiresAt}`)
        .digest('base64url');
    },
    listSessions: sessionId => repository.listSessions(sessionId),
    revokeSession: (actorSessionId, targetSessionId, requestId) => repository.revokeSession(actorSessionId, targetSessionId, requestId)
  };
}

module.exports = { NETWORK_HASH_WINDOW_MS, TOKEN_PATTERN, createAuthService, deriveAuthKeys, keyedHash, networkIdentityHash, newOpaqueToken, normalizeEmail, sha256, verifyCsrf };
