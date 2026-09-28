'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);
const ENVIRONMENTS = new Set(['development', 'test', 'production']);
const LISTEN_HOSTS = new Set(['127.0.0.1', '0.0.0.0']);
const MIN_MIGRATOR_PASSWORD_LENGTH = 16;
const EMAIL_PROVIDERS = new Set(['disabled', 'fake', 'brevo']);

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

function requiredSecret(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value.length < 32 || value.includes('REPLACE_WITH_SECRET')) {
    throw new ConfigError(`${name} debe contener al menos 32 caracteres no ficticios.`);
  }
}

function secretValue(env, name, nodeEnv) {
  const value = env[name];
  if (!value || value.includes('REPLACE_WITH_SECRET')) {
    if (nodeEnv === 'production') requiredSecret(env, name);
    return null;
  }
  if (value.length < 32) throw new ConfigError(`${name} debe contener al menos 32 caracteres.`);
  return value;
}

function encryptionKey(env, nodeEnv) {
  const value = secretValue(env, 'IDENTITY_ENCRYPTION_KEY', nodeEnv);
  if (!value) return null;
  let decoded;
  if (/^[0-9a-f]{64}$/i.test(value)) decoded = Buffer.from(value, 'hex');
  else {
    try { decoded = Buffer.from(value, 'base64'); } catch { decoded = Buffer.alloc(0); }
  }
  if (decoded.length !== 32) throw new ConfigError('IDENTITY_ENCRYPTION_KEY debe codificar exactamente 32 bytes en hexadecimal o base64.');
  return decoded;
}

function validDatabaseUrl(value) {
  if (!value || value.includes('USER:PASSWORD@HOST')) return false;
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol) && Boolean(url.hostname) && Boolean(url.pathname.slice(1));
  } catch {
    return false;
  }
}

function parsedDatabaseUrl(value) {
  if (!validDatabaseUrl(value)) return null;
  return new URL(value);
}

function decodedCredential(value, name) {
  try { return decodeURIComponent(value); } catch { throw new ConfigError(`${name} contiene codificación no válida.`); }
}

function validateDatabaseIdentity(url, expectedRole, name, allowPoolerSuffix) {
  if (!url) return null;
  const username = decodedCredential(url.username, name);
  const password = decodedCredential(url.password, name);
  const validUsername = username === expectedRole || (allowPoolerSuffix && new RegExp(`^${expectedRole}\\.[a-z0-9]+$`).test(username));
  if (!validUsername) throw new ConfigError(`${name} no usa el rol esperado.`);
  if (password.length < 32 || /^(?:PASSWORD|REPLACE_WITH_SECRET)$/i.test(password)) throw new ConfigError(`${name} requiere una contraseña real de al menos 32 caracteres.`);
  return { username, password };
}

function validateDatabaseTransport(url, sslEnabled, name) {
  if (!url) return;
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) {
    if (url.searchParams.has(key)) throw new ConfigError(`${name} no debe sobrescribir la configuración TLS desde la URL.`);
  }
  if (!sslEnabled && !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new ConfigError(`${name} remota requiere TLS verificable.`);
  }
}

function validateMigrationEndpoint(url) {
  if (!url || ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) return;
  if (url.port !== '5432') {
    throw new ConfigError('MIGRATION_DATABASE_URL remota requiere conexión directa o pooler de sesión en el puerto 5432.');
  }
}

function resolveDatabaseCaFile(env, sslEnabled) {
  const configured = env.DATABASE_CA_FILE;
  if (!configured) return null;
  if (!sslEnabled) throw new ConfigError('DATABASE_CA_FILE requiere DATABASE_SSL=true.');
  if (path.isAbsolute(configured)) throw new ConfigError('DATABASE_CA_FILE debe ser una ruta relativa al proyecto.');
  const root = process.cwd();
  const resolved = path.resolve(root, configured);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new ConfigError('DATABASE_CA_FILE debe permanecer dentro del proyecto.');
  try {
    if (!fs.statSync(resolved).isFile()) throw new Error('not-file');
  } catch {
    throw new ConfigError('DATABASE_CA_FILE no existe o no es un archivo.');
  }
  return resolved;
}

function boundedInteger(env, name, fallback, minimum, maximum) {
  const text = env[name] || String(fallback);
  if (!/^\d+$/.test(text)) throw new ConfigError(`${name} debe ser un entero.`);
  const value = Number(text);
  if (value < minimum || value > maximum) throw new ConfigError(`${name} fuera de rango.`);
  return value;
}

function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  if (!ENVIRONMENTS.has(nodeEnv)) throw new ConfigError('NODE_ENV no válido.');

  const host = env.HOST || '127.0.0.1';
  if (!LISTEN_HOSTS.has(host)) throw new ConfigError('HOST no permitido.');

  const port = boundedInteger(env, 'PORT', 4329, 1024, 65535);

  const renderHostname = env.RENDER_EXTERNAL_HOSTNAME;
  if (renderHostname && !/^[a-z0-9-]+\.onrender\.com$/.test(renderHostname)) throw new ConfigError('RENDER_EXTERNAL_HOSTNAME no válido.');
  const publicOriginText = env.PUBLIC_ORIGIN || (nodeEnv === 'production' && renderHostname ? `https://${renderHostname}` : `http://${host}:${port}`);
  let publicOrigin;
  try { publicOrigin = new URL(publicOriginText); } catch { throw new ConfigError('PUBLIC_ORIGIN no es una URL válida.'); }
  if (publicOrigin.username || publicOrigin.password || publicOrigin.pathname !== '/' || publicOrigin.search || publicOrigin.hash) throw new ConfigError('PUBLIC_ORIGIN debe contener solo origen.');
  if (!['http:', 'https:'].includes(publicOrigin.protocol)) throw new ConfigError('PUBLIC_ORIGIN requiere HTTP o HTTPS.');

  const logLevel = env.LOG_LEVEL || 'info';
  if (!LEVELS.has(logLevel)) throw new ConfigError('LOG_LEVEL no válido.');

  const trustProxyText = env.TRUST_PROXY_HOPS;
  let trustProxy = false;
  if (nodeEnv === 'production') {
    if (trustProxyText !== '1') throw new ConfigError('Producción requiere TRUST_PROXY_HOPS=1 para confiar solo en el proxy inmediato.');
    trustProxy = 1;
  } else if (trustProxyText !== undefined && trustProxyText !== '0') {
    throw new ConfigError('Desarrollo y test requieren TRUST_PROXY_HOPS=0.');
  }

  const runtimeDatabaseUrl = parsedDatabaseUrl(env.DATABASE_URL);
  const migratorDatabaseUrl = parsedDatabaseUrl(env.MIGRATION_DATABASE_URL);
  const databaseConfigured = Boolean(runtimeDatabaseUrl);
  const migrationDatabaseConfigured = Boolean(migratorDatabaseUrl);
  if (databaseConfigured && migrationDatabaseConfigured && env.DATABASE_URL === env.MIGRATION_DATABASE_URL) {
    throw new ConfigError('Las URLs de ejecución y migración deben usar credenciales distintas.');
  }
  const databaseSslText = env.DATABASE_SSL || 'true';
  if (!['true', 'false'].includes(databaseSslText)) throw new ConfigError('DATABASE_SSL debe ser true o false.');
  const databaseSsl = databaseSslText === 'true';
  const databaseCaFile = resolveDatabaseCaFile(env, databaseSsl);
  const databaseRuntimeRole = env.DATABASE_RUNTIME_ROLE || 'rutaviva_runtime';
  if (databaseRuntimeRole !== 'rutaviva_runtime') throw new ConfigError('DATABASE_RUNTIME_ROLE no permitido.');
  const runtimeIdentity = validateDatabaseIdentity(runtimeDatabaseUrl, databaseRuntimeRole, 'DATABASE_URL', true);
  const migratorIdentity = migratorDatabaseUrl
    ? {
        username: decodedCredential(migratorDatabaseUrl.username, 'MIGRATION_DATABASE_URL'),
        password: decodedCredential(migratorDatabaseUrl.password, 'MIGRATION_DATABASE_URL')
      }
    : null;
  if (migratorIdentity && !migratorIdentity.username) throw new ConfigError('MIGRATION_DATABASE_URL requiere un usuario de migración.');
  if (migratorIdentity && (migratorIdentity.username === databaseRuntimeRole || migratorIdentity.username.startsWith(`${databaseRuntimeRole}.`))) {
    throw new ConfigError('MIGRATION_DATABASE_URL debe usar un rol distinto del rol de ejecución.');
  }
  if (migratorIdentity && (migratorIdentity.password.length < MIN_MIGRATOR_PASSWORD_LENGTH || /^(?:PASSWORD|REPLACE_WITH_SECRET)$/i.test(migratorIdentity.password))) {
    throw new ConfigError(`MIGRATION_DATABASE_URL requiere una contraseña real de al menos ${MIN_MIGRATOR_PASSWORD_LENGTH} caracteres.`);
  }
  validateDatabaseTransport(runtimeDatabaseUrl, databaseSsl, 'DATABASE_URL');
  validateDatabaseTransport(migratorDatabaseUrl, databaseSsl, 'MIGRATION_DATABASE_URL');
  validateMigrationEndpoint(migratorDatabaseUrl);
  const databasePoolMax = boundedInteger(env, 'DATABASE_POOL_MAX', 3, 1, 3);
  const databaseConnectTimeoutMs = boundedInteger(env, 'DATABASE_CONNECT_TIMEOUT_MS', 5000, 500, 30_000);
  const databaseQueryTimeoutMs = boundedInteger(env, 'DATABASE_QUERY_TIMEOUT_MS', 5000, 500, 30_000);
  const emailProvider = env.EMAIL_PROVIDER || 'disabled';
  if (!EMAIL_PROVIDERS.has(emailProvider)) throw new ConfigError('EMAIL_PROVIDER no válido.');
  if (emailProvider === 'fake' && nodeEnv !== 'test') throw new ConfigError('El proveedor fake solo se permite en test.');
  const emailPollMs = boundedInteger(env, 'EMAIL_POLL_MS', 1000, 100, 60_000);
  const emailLeaseSeconds = boundedInteger(env, 'EMAIL_LEASE_SECONDS', 60, 30, 300);
  const emailTimeoutMs = boundedInteger(env, 'EMAIL_TIMEOUT_MS', 10_000, 1000, 30_000);
  if (emailLeaseSeconds * 1000 < emailTimeoutMs + 10_000) {
    throw new ConfigError('EMAIL_LEASE_SECONDS debe superar EMAIL_TIMEOUT_MS con al menos 10 segundos de margen.');
  }
  const brevoSenderEmail = env.BREVO_SENDER || '';
  const brevoSenderName = env.BREVO_SENDER_NAME || 'RutaViva';
  if (emailProvider === 'brevo') {
    if (!env.BREVO_API_KEY || env.BREVO_API_KEY.includes('REPLACE_WITH_SECRET') || env.BREVO_API_KEY.length < 20) {
      throw new ConfigError('Brevo requiere BREVO_API_KEY explícita.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(brevoSenderEmail) || brevoSenderEmail.endsWith('.invalid')) {
      throw new ConfigError('Brevo requiere un remitente verificado.');
    }
  }
  if (nodeEnv === 'production') {
    if (host !== '0.0.0.0') throw new ConfigError('Producción debe escuchar en 0.0.0.0 detrás del proxy TLS.');
    if (publicOrigin.protocol !== 'https:') throw new ConfigError('Producción requiere PUBLIC_ORIGIN HTTPS.');
    if (!databaseConfigured) throw new ConfigError('Producción requiere DATABASE_URL válida.');
    if (!databaseSsl) throw new ConfigError('Producción requiere TLS verificable para PostgreSQL.');
    for (const name of ['SESSION_SECRET', 'CSRF_SECRET', 'IP_HASH_SECRET']) requiredSecret(env, name);
  }

  const mapTileUrl = env.MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  let mapTileOrigin;
  try {
    if (!mapTileUrl.includes('{z}') || !mapTileUrl.includes('{x}') || !mapTileUrl.includes('{y}')) throw new Error('template');
    const parsedTileUrl = new URL(mapTileUrl.replace('{z}', '12').replace('{x}', '2048').replace('{y}', '1536'));
    if (parsedTileUrl.protocol !== 'https:' || parsedTileUrl.username || parsedTileUrl.password || parsedTileUrl.origin !== 'https://tile.openstreetmap.org') throw new Error('transport');
    mapTileOrigin = parsedTileUrl.origin;
  } catch { throw new ConfigError('MAP_TILE_URL debe ser una plantilla HTTPS válida.'); }

  const sessionSecret = secretValue(env, 'SESSION_SECRET', nodeEnv);
  const csrfSecret = secretValue(env, 'CSRF_SECRET', nodeEnv);
  const identityEncryptionKey = encryptionKey(env, nodeEnv);
  const ipHashSecret = secretValue(env, 'IP_HASH_SECRET', nodeEnv);
  const authenticationOperational = databaseConfigured && Boolean(sessionSecret && csrfSecret && identityEncryptionKey && ipHashSecret);
  const emailDeliveryOperational = authenticationOperational && emailProvider === 'brevo';

  const config = {
    nodeEnv,
    host,
    port,
    publicOrigin: publicOrigin.origin,
    allowedHost: publicOrigin.host,
    trustProxy,
    logLevel,
    databaseConfigured,
    migrationDatabaseConfigured,
    databaseRuntimeRole,
    databaseSsl,
    databasePoolMax,
    databaseConnectTimeoutMs,
    databaseQueryTimeoutMs,
    emailProvider,
    emailDeliveryEnabled: emailProvider !== 'disabled',
    authenticationOperational,
    emailDeliveryOperational,
    emailPollMs,
    emailLeaseSeconds,
    emailTimeoutMs,
    brevoSenderEmail,
    brevoSenderName
    ,mapTileUrl
    ,mapTileOrigin
  };
  Object.defineProperties(config, {
    databaseUrl: { value: databaseConfigured ? env.DATABASE_URL : null, enumerable: false },
    migrationDatabaseUrl: { value: migrationDatabaseConfigured ? env.MIGRATION_DATABASE_URL : null, enumerable: false },
    databaseRuntimePassword: { value: runtimeIdentity?.password || null, enumerable: false },
    databaseCaFile: { value: databaseCaFile, enumerable: false },
    sessionSecret: { value: sessionSecret, enumerable: false },
    csrfSecret: { value: csrfSecret, enumerable: false },
    identityEncryptionKey: { value: identityEncryptionKey, enumerable: false },
    ipHashSecret: { value: ipHashSecret, enumerable: false },
    brevoApiKey: { value: emailProvider === 'brevo' ? env.BREVO_API_KEY : null, enumerable: false }
  });
  return Object.freeze(config);
}

module.exports = { ConfigError, loadConfig };
