'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ConfigError, loadConfig } = require('../src/config.cjs');
const { start } = require('../iniciar.cjs');
const {
  createRuntimeEnvironment,
  parseRuntimeEnv
} = require('../src/runtime-env.cjs');

const runtimePassword = 'r'.repeat(40);
const migratorPassword = 'm'.repeat(40);
const runtimeUrl = `postgresql://rutaviva_runtime:${runtimePassword}@database.invalid/app`;
const poolerUrl = `postgresql://rutaviva_runtime.projectref:${runtimePassword}@database.invalid/app`;
const migratorUrl = `postgresql://migration_owner:${migratorPassword}@database.invalid:5432/app`;
const providerMigratorUrl = `postgresql://migration_owner:${'m'.repeat(16)}@database.invalid:5432/app`;

test('configuración de desarrollo usa escucha local segura', () => {
  const config = loadConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 4329);
  assert.equal(config.publicOrigin, 'http://127.0.0.1:4329');
  assert.equal(config.databaseConfigured, false);
  assert.equal(config.migrationDatabaseConfigured, false);
  assert.equal(config.databasePoolMax, 3);
  assert.equal(config.databaseSsl, true);
  assert.equal(config.databaseRuntimeRole, 'rutaviva_runtime');
  assert.equal(config.trustProxy, false);
});

test('rechaza entorno, host, puerto y origen inválidos', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'otro' }), ConfigError);
  assert.throws(() => loadConfig({ HOST: '192.168.1.2' }), ConfigError);
  assert.throws(() => loadConfig({ PORT: '80' }), ConfigError);
  assert.throws(() => loadConfig({ PUBLIC_ORIGIN: 'file:///tmp' }), ConfigError);
  assert.throws(() => loadConfig({ DATABASE_SSL: 'maybe' }), ConfigError);
  assert.throws(() => loadConfig({ DATABASE_SSL: 'false', DATABASE_CA_FILE: 'certs/supabase-prod-ca-2021.crt' }), ConfigError);
  assert.throws(() => loadConfig({ DATABASE_CA_FILE: '../outside.crt' }), ConfigError);
  assert.equal(loadConfig({ DATABASE_CA_FILE: 'certs/supabase-prod-ca-2021.crt' }).databaseCaFile, path.resolve('certs/supabase-prod-ca-2021.crt'));
  assert.throws(() => loadConfig({ DATABASE_POOL_MAX: '4' }), ConfigError);
  assert.throws(() => loadConfig({ DATABASE_URL: `${runtimeUrl}?sslmode=no-verify` }), ConfigError);
  assert.throws(() => loadConfig({ DATABASE_URL: runtimeUrl, DATABASE_SSL: 'false' }), ConfigError);
  assert.equal(loadConfig({ DATABASE_URL: runtimeUrl.replace('database.invalid', '127.0.0.1'), DATABASE_SSL: 'false' }).databaseSsl, false);
  assert.throws(() => loadConfig({ DATABASE_RUNTIME_ROLE: 'postgres' }), ConfigError);
  assert.throws(() => loadConfig({ TRUST_PROXY_HOPS: '1' }), ConfigError);
  assert.throws(() => loadConfig({ DATABASE_URL: `postgresql://postgres:${runtimePassword}@database.invalid/app` }), ConfigError);
  assert.throws(() => loadConfig({ DATABASE_URL: 'postgresql://rutaviva_runtime:short@database.invalid/app' }), ConfigError);
  assert.throws(() => loadConfig({ DATABASE_URL: runtimeUrl, MIGRATION_DATABASE_URL: runtimeUrl }), ConfigError);
  assert.throws(() => loadConfig({ DATABASE_URL: runtimeUrl, MIGRATION_DATABASE_URL: `postgresql://rutaviva_runtime.other:${migratorPassword}@database.invalid/app` }), ConfigError);
  assert.equal(loadConfig({ DATABASE_URL: poolerUrl }).databaseConfigured, true);
  assert.equal(loadConfig({ DATABASE_URL: runtimeUrl.replace('database.invalid', 'database.invalid:6543') }).databaseConfigured, true);
  assert.throws(() => loadConfig({ MIGRATION_DATABASE_URL: migratorUrl.replace(':5432', ':6543') }), ConfigError);
  assert.throws(() => loadConfig({ MIGRATION_DATABASE_URL: migratorUrl.replace(':5432', '') }), ConfigError);
  assert.throws(() => loadConfig({ MIGRATION_DATABASE_URL: providerMigratorUrl.replace('m'.repeat(16), 'm'.repeat(15)) }), ConfigError);
  assert.equal(loadConfig({ MIGRATION_DATABASE_URL: providerMigratorUrl }).migrationDatabaseConfigured, true);
  assert.equal(loadConfig({ MIGRATION_DATABASE_URL: migratorUrl.replace('database.invalid:5432', '127.0.0.1:6543'), DATABASE_SSL: 'false' }).migrationDatabaseConfigured, true);
});

test('producción requiere proxy, HTTPS, base y secretos reales', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), ConfigError);
  const common = { NODE_ENV: 'production', HOST: '0.0.0.0', PUBLIC_ORIGIN: 'https://rutaviva.example', TRUST_PROXY_HOPS: '1', DATABASE_URL: runtimeUrl };
  assert.throws(() => loadConfig(common), ConfigError);
  const secrets = { SESSION_SECRET: 'a'.repeat(32), CSRF_SECRET: 'b'.repeat(32), IDENTITY_ENCRYPTION_KEY: 'c1'.repeat(32), IP_HASH_SECRET: 'd'.repeat(32) };
  const config = loadConfig({ ...common, ...secrets });
  assert.equal(config.databaseConfigured, true);
  assert.equal(config.publicOrigin, 'https://rutaviva.example');
  assert.equal(config.trustProxy, 1);
  assert.throws(() => loadConfig({ ...common, ...secrets, TRUST_PROXY_HOPS: '2' }), ConfigError);
});

test('la configuración no expone secretos en su representación pública', () => {
  const key = 'SESSION_' + 'SECRET';
  const config = loadConfig({ [key]: 'x'.repeat(40), DATABASE_URL: runtimeUrl, MIGRATION_DATABASE_URL: migratorUrl });
  assert.equal(Object.getOwnPropertyDescriptor(config, 'sessionSecret').enumerable, false);
  assert.equal(config.sessionSecret, 'x'.repeat(40));
  assert.equal(JSON.stringify(config).includes('x'.repeat(40)), false);
  assert.equal(JSON.stringify(config).includes(runtimeUrl), false);
  assert.equal(config.databaseUrl, runtimeUrl);
  assert.equal(config.databaseRuntimePassword, runtimePassword);
});

test('claves de autenticación se validan sin exponerlas', () => {
  assert.throws(() => loadConfig({ IDENTITY_ENCRYPTION_KEY: 'not-a-32-byte-key'.repeat(2) }), ConfigError);
  const config = loadConfig({
    SESSION_SECRET: 's'.repeat(40), CSRF_SECRET: 'c'.repeat(40),
    IDENTITY_ENCRYPTION_KEY: 'ab'.repeat(32), IP_HASH_SECRET: 'i'.repeat(40)
  });
  assert.equal(config.identityEncryptionKey.length, 32);
  assert.equal(JSON.stringify(config).includes('ab'.repeat(32)), false);
});

test('correo queda desactivado por defecto y Brevo requiere configuración explícita', () => {
  assert.equal(loadConfig({ NODE_ENV: 'test' }).emailDeliveryEnabled, false);
  assert.throws(() => loadConfig({ NODE_ENV: 'development', EMAIL_PROVIDER: 'fake' }), ConfigError);
  assert.throws(() => loadConfig({ NODE_ENV: 'test', EMAIL_PROVIDER: 'brevo' }), ConfigError);
  const authSecrets = { SESSION_SECRET: 's'.repeat(40), CSRF_SECRET: 'c'.repeat(40), IDENTITY_ENCRYPTION_KEY: 'ab'.repeat(32), IP_HASH_SECRET: 'i'.repeat(40) };
  const fake = loadConfig({ NODE_ENV: 'test', EMAIL_PROVIDER: 'fake', DATABASE_URL: runtimeUrl, ...authSecrets });
  assert.equal(fake.authenticationOperational, true);
  assert.equal(fake.emailDeliveryOperational, false);
  const brevo = loadConfig({ NODE_ENV: 'test', EMAIL_PROVIDER: 'brevo', DATABASE_URL: runtimeUrl, ...authSecrets, BREVO_API_KEY: 'k'.repeat(32), BREVO_SENDER: 'verified@example.test' });
  assert.equal(brevo.emailDeliveryOperational, true);
  assert.equal(Object.getOwnPropertyDescriptor(brevo, 'brevoApiKey').enumerable, false);
  assert.equal(JSON.stringify(brevo).includes('k'.repeat(32)), false);
});

test('lease de correo conserva al menos diez segundos sobre el timeout completo', () => {
  assert.equal(loadConfig({ NODE_ENV: 'test', EMAIL_LEASE_SECONDS: '30', EMAIL_TIMEOUT_MS: '20000' }).emailLeaseSeconds, 30);
  assert.throws(() => loadConfig({ NODE_ENV: 'test', EMAIL_LEASE_SECONDS: '30', EMAIL_TIMEOUT_MS: '20001' }), ConfigError);
});

test('entorno runtime aplica allowlist, precedencia del shell y separación del migrador', () => {
  const fileEnv = parseRuntimeEnv([
    'NODE_ENV=test',
    'PORT=4329',
    'PUBLIC_ORIGIN=http://127.0.0.1:4329',
    'EMAIL_PROVIDER=disabled',
    `DATABASE_URL=${runtimeUrl}`,
    `MIGRATION_DATABASE_URL=${migratorUrl}`,
    'UNRELATED_SECRET=file-private'
  ].join('\n'));
  const runtime = createRuntimeEnvironment({ fileEnv, parentEnv: {
    Path: 'synthetic-path', PORT: '4331', PUBLIC_ORIGIN: 'http://127.0.0.1:4331',
    RENDER_GIT_COMMIT: 'abcdef1234567890abcdef1234567890abcdef12',
    MIGRATION_DATABASE_URL: migratorUrl, UNRELATED_SECRET: 'shell-private',
    NODE_OPTIONS: '--require=not-allowed.cjs'
  } });
  assert.equal(runtime.PORT, '4331');
  assert.equal(runtime.PUBLIC_ORIGIN, 'http://127.0.0.1:4331');
  assert.equal(runtime.PATH, 'synthetic-path');
  assert.equal(runtime.DATABASE_URL, runtimeUrl);
  assert.equal(runtime.RENDER_GIT_COMMIT, 'abcdef1234567890abcdef1234567890abcdef12');
  assert.equal(Object.hasOwn(runtime, 'MIGRATION_DATABASE_URL'), false);
  assert.equal(Object.hasOwn(runtime, 'UNRELATED_SECRET'), false);
  assert.equal(Object.hasOwn(runtime, 'NODE_OPTIONS'), false);
  assert.equal(loadConfig(runtime).migrationDatabaseConfigured, false);

  const spawned = [];
  const fakeSpawn = (_command, _arguments, options) => {
    spawned.push(options.env);
    return { killed: false, once() {}, kill() { this.killed = true; } };
  };
  const target = { MIGRATION_DATABASE_URL: migratorUrl, UNRELATED_SECRET: 'private', PATH: 'old' };
  start({
    runtimeEnvironmentOptions: {
      envFile: path.join(__dirname, '.runtime-env-does-not-exist'),
      parentEnv: {
        Path: 'synthetic-path', NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '4329',
        RENDER_GIT_COMMIT: 'abcdef1234567890abcdef1234567890abcdef12',
        PUBLIC_ORIGIN: 'http://127.0.0.1:4329', EMAIL_PROVIDER: 'fake', DATABASE_URL: runtimeUrl,
        MIGRATION_DATABASE_URL: migratorUrl, UNRELATED_SECRET: 'shell-private',
        NODE_OPTIONS: '--require=not-allowed.cjs'
      },
      targetEnv: target
    },
    spawn: fakeSpawn,
    signalTarget: null
  });
  assert.equal(Object.hasOwn(target, 'MIGRATION_DATABASE_URL'), false);
  assert.equal(Object.hasOwn(target, 'UNRELATED_SECRET'), false);
  assert.equal(Object.hasOwn(target, 'NODE_OPTIONS'), false);
  assert.equal(loadConfig(target).migrationDatabaseConfigured, false);
  assert.equal(target.RENDER_GIT_COMMIT, 'abcdef1234567890abcdef1234567890abcdef12');
  assert.equal(spawned.length, 2);
  for (const childEnv of spawned) {
    assert.equal(Object.hasOwn(childEnv, 'MIGRATION_DATABASE_URL'), false);
    assert.equal(Object.hasOwn(childEnv, 'UNRELATED_SECRET'), false);
    assert.equal(Object.hasOwn(childEnv, 'NODE_OPTIONS'), false);
    assert.equal(childEnv.RENDER_GIT_COMMIT, 'abcdef1234567890abcdef1234567890abcdef12');
    assert.equal(loadConfig(childEnv).migrationDatabaseConfigured, false);
  }
});
