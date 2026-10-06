'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');

const RUNTIME_ENV_KEYS = Object.freeze([
  'NODE_ENV', 'HOST', 'PORT', 'PUBLIC_ORIGIN', 'RENDER_EXTERNAL_HOSTNAME', 'RENDER_GIT_COMMIT', 'TRUST_PROXY_HOPS',
  'DATABASE_URL', 'DATABASE_RUNTIME_ROLE', 'DATABASE_SSL', 'DATABASE_CA_FILE',
  'DATABASE_POOL_MAX', 'DATABASE_CONNECT_TIMEOUT_MS', 'DATABASE_QUERY_TIMEOUT_MS',
  'SESSION_SECRET', 'CSRF_SECRET', 'IDENTITY_ENCRYPTION_KEY', 'IP_HASH_SECRET',
  'BREVO_API_KEY', 'BREVO_SENDER', 'BREVO_SENDER_NAME', 'EMAIL_PROVIDER',
  'EMAIL_POLL_MS', 'EMAIL_LEASE_SECONDS', 'EMAIL_TIMEOUT_MS',
  'MAP_TILE_URL', 'LOG_LEVEL'
]);
const SYSTEM_ENV_KEYS = Object.freeze(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'ComSpec', 'PATHEXT']);

function ownString(source, name, caseInsensitive = false) {
  if (!source || typeof source !== 'object') return undefined;
  if (Object.hasOwn(source, name) && typeof source[name] === 'string') return source[name];
  if (!caseInsensitive) return undefined;
  const actual = Object.keys(source).find(key => key.toLowerCase() === name.toLowerCase());
  return actual && typeof source[actual] === 'string' ? source[actual] : undefined;
}

function parseRuntimeEnv(content) {
  if (typeof content !== 'string') throw new TypeError('El contenido del entorno debe ser texto.');
  return parseEnv(content);
}

function createRuntimeEnvironment({ fileEnv = {}, parentEnv = {} } = {}) {
  const environment = {};
  for (const name of SYSTEM_ENV_KEYS) {
    const value = ownString(parentEnv, name, true);
    if (value !== undefined) environment[name] = value;
  }
  for (const name of RUNTIME_ENV_KEYS) {
    const fileValue = ownString(fileEnv, name);
    if (fileValue !== undefined) environment[name] = fileValue;
    const parentValue = ownString(parentEnv, name);
    if (parentValue !== undefined) environment[name] = parentValue;
  }
  return environment;
}

function loadRuntimeEnvironment(options = {}) {
  const envFile = options.envFile || path.resolve(__dirname, '..', '.env');
  let fileEnv = {};
  try { fileEnv = parseRuntimeEnv(fs.readFileSync(envFile, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return createRuntimeEnvironment({ fileEnv, parentEnv: options.parentEnv || process.env });
}

function replaceEnvironment(target, environment) {
  if (!target || typeof target !== 'object') throw new TypeError('Se requiere un entorno mutable.');
  for (const name of Object.keys(target)) delete target[name];
  Object.assign(target, environment);
  return target;
}

function activateRuntimeEnvironment(options = {}) {
  const environment = loadRuntimeEnvironment(options);
  replaceEnvironment(options.targetEnv || process.env, environment);
  return environment;
}

module.exports = {
  RUNTIME_ENV_KEYS,
  SYSTEM_ENV_KEYS,
  activateRuntimeEnvironment,
  createRuntimeEnvironment,
  loadRuntimeEnvironment,
  parseRuntimeEnv,
  replaceEnvironment
};
