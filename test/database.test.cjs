'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { loadConfig } = require('../src/config.cjs');
const { createDatabasePool, tlsOptions } = require('../src/db/pool.cjs');
const { createReadinessCheck, REQUIRED_FUNCTIONS, REQUIRED_RELATIONS } = require('../src/db/health.cjs');
const { loadMigrationFiles } = require('../src/db/migrator.cjs');
const { decodeCursor, encodeCursor, listZones } = require('../src/db/repositories/zones.cjs');

const runtimePassword = 'r'.repeat(40);
const runtimeUrl = `postgresql://rutaviva_runtime:${runtimePassword}@database.invalid/app`;

test('pool usa TLS verificable, máximo tres conexiones y timeouts', () => {
  let received;
  class FakePool extends EventEmitter { constructor(options) { super(); received = options; } }
  const events = [];
  const config = loadConfig({ DATABASE_URL: runtimeUrl, DATABASE_POOL_MAX: '3' });
  const pool = createDatabasePool(config, { PoolClass: FakePool, onPoolError: event => events.push(event) });
  assert.ok(pool);
  assert.equal(received.max, 3);
  assert.deepEqual(received.ssl, { rejectUnauthorized: true });
  assert.equal(received.connectionTimeoutMillis, 5000);
  assert.equal(received.statement_timeout, 5000);
  assert.equal(JSON.stringify(received).includes('rejectUnauthorized":false'), false);
  assert.equal(tlsOptions(false), false);
  const caFile = path.resolve(__dirname, '..', 'certs', 'supabase-prod-ca-2021.crt');
  const configuredTls = tlsOptions(true, caFile);
  assert.equal(configuredTls.rejectUnauthorized, true);
  assert.match(configuredTls.ca, /BEGIN CERTIFICATE/);
  pool.emit('error', new Error('password and host must never reach callback'));
  assert.deepEqual(events, [{ code: 'DATABASE_POOL_ERROR' }]);
});

test('sin URL no crea pool y readiness queda no preparada', async () => {
  assert.equal(createDatabasePool(loadConfig({})), null);
  assert.deepEqual(await createReadinessCheck(null)(), { ready: false });
});

test('readiness exige PostGIS en extensions y última migración', async () => {
  const directory = path.resolve(__dirname, '..', 'migrations');
  const migrations = loadMigrationFiles(directory).map(({ version, name, checksum }) => ({ version, name, checksum }));
  const rows = REQUIRED_RELATIONS.map(relation_name => ({ effective_role: 'rutaviva_runtime', postgis_ready: true, relation_name, relation_ready: true }));
  const functions = REQUIRED_FUNCTIONS.map(function_name => ({ function_name, function_ready: true, function_executable: true }));
  const fake = (relationRows, migrationRows, functionRows = functions) => ({
    query: async text => String(text).includes('relation_name')
      ? { rows: relationRows }
      : String(text).includes('function_name')
        ? { rows: functionRows }
        : { rows: migrationRows }
  });
  const ok = fake(rows, migrations);
  assert.deepEqual(await createReadinessCheck(ok, { migrationsDirectory: directory })(), {
    ready: true,
    checks: { database: 'ok', role: 'ok', postgis: 'ok', migrations: 'ok', relations: 'ok', functions: 'ok' }
  });
  for (const altered of [
    rows.map((row, index) => index ? row : { ...row, effective_role: 'postgres' }),
    rows.map((row, index) => index ? row : { ...row, postgis_ready: false }),
    rows.slice(1)
  ]) {
    const database = fake(altered, migrations);
    const result = await createReadinessCheck(database, { migrationsDirectory: directory })();
    assert.equal(result.ready, false);
    assert.ok(Object.values(result.checks).includes('failed'));
  }
  const stale = fake(rows, migrations.slice(0, -1));
  assert.equal((await createReadinessCheck(stale, { migrationsDirectory: directory })()).checks.migrations, 'failed');
  assert.equal((await createReadinessCheck(fake(rows, migrations, functions.slice(1)), { migrationsDirectory: directory })()).checks.functions, 'failed');
  assert.equal((await createReadinessCheck(fake(rows, migrations, functions.map((item, index) => index ? item : { ...item, function_executable: false })), { migrationsDirectory: directory })()).checks.functions, 'failed');
});

test('repositorio de zonas parametriza búsqueda, cursor y límite', async () => {
  let call;
  const database = { query: async (text, values) => { call = { text, values }; return { rows: [] }; } };
  const cursor = '20000000-0000-4000-8000-000000000001';
  assert.deepEqual(await listZones(database, { search: "%' OR true --", cursor: encodeCursor({ sortOrder: 20, id: cursor }), limit: 20 }), { data: [], page: { limit: 20, nextCursor: null } });
  assert.equal(call.text.includes("%' OR true --"), false);
  assert.match(call.text, /extensions\.ST_XMin\(extensions\.box3d\(zone\.boundary\)\)/);
  assert.deepEqual(call.values, ['sevilla', "%' OR true --", 20, cursor, 21]);
  assert.deepEqual(decodeCursor(encodeCursor({ sortOrder: 20, id: cursor })), { sortOrder: 20, id: cursor });
  assert.throws(() => decodeCursor('no-es-un-cursor'), error => error.code === 'INVALID_CURSOR');
  for (const sortOrder of [0, 1_000_001, Number.MAX_SAFE_INTEGER + 1, 1.5]) {
    const manipulated = Buffer.from(JSON.stringify({ v: 1, s: sortOrder, i: cursor })).toString('base64url');
    assert.throws(() => decodeCursor(manipulated), error => error.code === 'INVALID_CURSOR');
  }
});
