'use strict';

const fs = require('node:fs');
const { Pool } = require('pg');

function tlsOptions(enabled, caFile = null) {
  if (!enabled) return false;
  return {
    rejectUnauthorized: true,
    ...(caFile ? { ca: fs.readFileSync(caFile, 'utf8') } : {})
  };
}

function createDatabasePool(config, options = {}) {
  if (!config.databaseConfigured || !config.databaseUrl) return null;
  const PoolClass = options.PoolClass || Pool;
  const pool = new PoolClass({
    connectionString: config.databaseUrl,
    ssl: tlsOptions(config.databaseSsl, config.databaseCaFile),
    max: config.databasePoolMax,
    connectionTimeoutMillis: config.databaseConnectTimeoutMs,
    idleTimeoutMillis: 10_000,
    query_timeout: config.databaseQueryTimeoutMs,
    statement_timeout: config.databaseQueryTimeoutMs,
    application_name: 'rutaviva-community-api',
    allowExitOnIdle: true
  });
  const onPoolError = typeof options.onPoolError === 'function' ? options.onPoolError : () => {};
  pool.on('error', () => onPoolError({ code: 'DATABASE_POOL_ERROR' }));
  return pool;
}

module.exports = { createDatabasePool, tlsOptions };
