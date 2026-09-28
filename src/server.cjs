'use strict';

const { activateRuntimeEnvironment } = require('./runtime-env.cjs');
const directEnvironment = require.main === module ? activateRuntimeEnvironment() : null;
const { createApp } = require('./app.cjs');
const { loadConfig } = require('./config.cjs');
const { createDatabasePool } = require('./db/pool.cjs');

async function start(options = {}) {
  const config = options.config || loadConfig(options.env || directEnvironment || process.env);
  let app;
  const database = createDatabasePool(config, {
    onPoolError: event => app?.log.error(event, 'database pool unavailable')
  });
  app = createApp({ config, database, ownsDatabase: Boolean(database) });
  let closing = false;

  async function shutdown(signal) {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'graceful shutdown');
    const timer = setTimeout(() => process.exit(1), 10_000);
    timer.unref();
    try { await app.close(); } finally { clearTimeout(timer); }
  }

  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  await app.listen({ host: config.host, port: config.port });
  return app;
}

if (require.main === module) {
  start({ env: directEnvironment }).catch(error => {
    process.stderr.write(`No se pudo iniciar RutaViva Community: ${error.name}.\n`);
    process.exitCode = 1;
  });
}

module.exports = { start };
