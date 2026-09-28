'use strict';

const { activateRuntimeEnvironment } = require('../src/runtime-env.cjs');
const directEnvironment = require.main === module ? activateRuntimeEnvironment() : null;
const { loadConfig } = require('../src/config.cjs');
const { createDatabasePool } = require('../src/db/pool.cjs');
const { createOutboxRepository } = require('../src/db/repositories/outbox.cjs');
const { createBrevoClient, createFakeClient } = require('../src/services/brevo-client.cjs');
const { createOutboxWorker } = require('../src/services/outbox-worker.cjs');
const { deriveAuthKeys } = require('../src/services/auth.cjs');

function createWorkerLogger(outputs = {}) {
  const stdout = outputs.stdout || process.stdout;
  const stderr = outputs.stderr || process.stderr;
  const write = (stream, level, fields) => {
    const event = { level, component: 'email_outbox' };
    if (typeof fields?.eventId === 'string' && /^[0-9a-f-]{36}$/i.test(fields.eventId)) event.eventId = fields.eventId;
    if (Number.isInteger(fields?.attempt) && fields.attempt >= 0 && fields.attempt <= 10) event.attempt = fields.attempt;
    if (typeof fields?.failureCode === 'string' && /^[A-Z0-9_]{1,64}$/.test(fields.failureCode)) event.failureCode = fields.failureCode;
    if (['sent', 'pending', 'failed', 'cancelled', 'lease_lost'].includes(fields?.status)) event.status = fields.status;
    stream.write(`${JSON.stringify(event)}\n`);
  };
  return {
    info: fields => write(stdout, 'info', fields),
    warn: fields => write(stderr, 'warn', fields),
    error: fields => write(stderr, 'error', fields)
  };
}

async function startWorker(options = {}) {
  const config = options.config || loadConfig(options.env || directEnvironment || process.env);
  if (!config.emailDeliveryEnabled) return { enabled: false };
  const database = options.database || createDatabasePool(config);
  if (!database) throw new Error('Base de datos no configurada para el worker.');
  const client = options.client || (config.emailProvider === 'fake'
    ? createFakeClient()
    : createBrevoClient({
        apiKey: config.brevoApiKey,
        senderEmail: config.brevoSenderEmail,
        senderName: config.brevoSenderName,
        timeoutMs: config.emailTimeoutMs
      }));
  const controller = new AbortController();
  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    controller.abort();
  }
  const onSigint = () => { void shutdown(); };
  const onSigterm = () => { void shutdown(); };
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  const worker = createOutboxWorker({
    repository: createOutboxRepository(database), client,
    encryptionKey: deriveAuthKeys(config.identityEncryptionKey).outboxEncryption,
    leaseSeconds: config.emailLeaseSeconds,
    logger: options.logger || createWorkerLogger()
  });
  try {
    await worker.run({ signal: controller.signal, idleMs: config.emailPollMs });
    return { enabled: true };
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    if (!options.database) await database.end();
  }
}

if (require.main === module) {
  startWorker({ env: directEnvironment }).catch(error => {
    process.stderr.write(`No se pudo iniciar el worker de correo: ${error.name}.\n`);
    process.exitCode = 1;
  });
}

module.exports = { createWorkerLogger, startWorker };
