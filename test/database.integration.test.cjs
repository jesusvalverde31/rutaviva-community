'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { loadConfig } = require('../src/config.cjs');
const { createApp } = require('../src/app.cjs');
const { createDatabasePool, tlsOptions } = require('../src/db/pool.cjs');
const { loadMigrationFiles } = require('../src/db/migrator.cjs');

const root = path.resolve(__dirname, '..');

async function expectSqlState(client, savepoint, sql, values, expectedCode) {
  await client.query(`SAVEPOINT ${savepoint}`);
  let captured;
  try {
    await client.query(sql, values);
  } catch (error) {
    captured = error;
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  }
  assert.equal(captured?.code, expectedCode);
}

test('integración real PostgreSQL/PostGIS de Supabase', { timeout: 60_000 }, async t => {
  const config = loadConfig();
  assert.equal(config.databaseConfigured, true);
  assert.equal(config.migrationDatabaseConfigured, true);
  const ssl = tlsOptions(config.databaseSsl, config.databaseCaFile);
  const owner = new Client({
    connectionString: config.migrationDatabaseUrl,
    ssl,
    connectionTimeoutMillis: config.databaseConnectTimeoutMs,
    query_timeout: config.databaseQueryTimeoutMs,
    statement_timeout: config.databaseQueryTimeoutMs,
    application_name: 'rutaviva-community-integration-owner'
  });
  const runtime = createDatabasePool(config);
  assert.ok(runtime);
  await owner.connect();

  try {
    await t.test('TLS, sesión propietaria y sesión runtime conectan', async () => {
      const ownerState = await owner.query('SELECT current_user, current_database()');
      const runtimeState = await runtime.query('SELECT current_user, current_database()');
      assert.match(ownerState.rows[0].current_user, /^postgres(?:\.|$)/);
      assert.equal(ownerState.rows[0].current_database, 'postgres');
      assert.equal(runtimeState.rows[0].current_user, 'rutaviva_runtime');
      assert.equal(runtimeState.rows[0].current_database, 'postgres');
    });

    await t.test('rol runtime conserva atributos mínimos y cero membresías', async () => {
      const role = await owner.query(`
        SELECT rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls
        FROM pg_roles WHERE rolname = $1
      `, ['rutaviva_runtime']);
      assert.deepEqual(role.rows, [{
        rolsuper: false,
        rolinherit: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolcanlogin: true,
        rolreplication: false,
        rolbypassrls: false
      }]);
      const memberships = await owner.query(`
        SELECT count(*)::integer AS total
        FROM pg_auth_members membership
        JOIN pg_roles member_role ON member_role.oid = membership.member
        WHERE member_role.rolname = $1
      `, ['rutaviva_runtime']);
      assert.equal(memberships.rows[0].total, 0);
    });

    await t.test('PostGIS, relaciones, índices y checksums de migraciones son exactos', async () => {
      const postgis = await owner.query(`
        SELECT namespace.nspname AS schema_name
        FROM pg_extension extension
        JOIN pg_namespace namespace ON namespace.oid = extension.extnamespace
        WHERE extension.extname = 'postgis'
      `);
      assert.deepEqual(postgis.rows, [{ schema_name: 'extensions' }]);
      const expected = loadMigrationFiles(path.join(root, 'migrations')).map(({ version, name, checksum }) => ({ version, name, checksum }));
      const applied = await owner.query('SELECT version, name, checksum FROM app_private.schema_migrations ORDER BY version');
      assert.deepEqual(applied.rows, expected);
      const indexes = await owner.query(`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'app' AND indexname = ANY($1::text[])
        ORDER BY indexname
      `, [[
        'cities_boundary_gist', 'route_nodes_position_gist',
        'route_segments_geometry_gist', 'zones_boundary_gist'
      ]]);
      assert.deepEqual(indexes.rows.map(row => row.indexname), [
        'cities_boundary_gist', 'route_nodes_position_gist',
        'route_segments_geometry_gist', 'zones_boundary_gist'
      ]);
    });

    await t.test('runtime puede leer exclusivamente los datos públicos necesarios', async () => {
      const city = await runtime.query('SELECT slug, is_approximate FROM app.cities ORDER BY slug');
      const zones = await runtime.query('SELECT slug, sort_order FROM app.zones ORDER BY sort_order');
      assert.deepEqual(city.rows, [{ slug: 'sevilla', is_approximate: true }]);
      assert.equal(zones.rows.length, 3);
      assert.deepEqual(zones.rows.map(row => row.sort_order), [10, 20, 30]);
    });

    await t.test('runtime no puede escribir, truncar ni crear objetos', async () => {
      const connection = await runtime.connect();
      try {
        await connection.query('BEGIN');
        await assert.rejects(
          connection.query('DELETE FROM app.zones'),
          error => error?.code === '42501'
        );
        await connection.query('ROLLBACK');
        await connection.query('BEGIN');
        await assert.rejects(
          connection.query('TRUNCATE app.zones'),
          error => error?.code === '42501'
        );
        await connection.query('ROLLBACK');
        await connection.query('BEGIN');
        await assert.rejects(
          connection.query('CREATE TABLE app.integration_forbidden (id integer)'),
          error => error?.code === '42501'
        );
        await connection.query('ROLLBACK');
      } finally {
        connection.release();
      }
    });

    await t.test('restricciones geográficas reales rechazan estados incoherentes y recalculan distancia', async () => {
      const cityId = randomUUID();
      const zoneId = randomUUID();
      const sourceId = randomUUID();
      const targetId = randomUUID();
      const segmentId = randomUUID();
      await owner.query('BEGIN');
      try {
        await owner.query(`
          INSERT INTO app.cities (id, slug, name, country_code, center, boundary)
          VALUES ($1, $2, 'Integración', 'ES',
            extensions.ST_GeomFromText('POINT(-5.99 37.39)', 4326),
            extensions.ST_GeomFromText('POLYGON((-6.02 37.36,-5.96 37.36,-5.96 37.42,-6.02 37.42,-6.02 37.36))', 4326))
        `, [cityId, `integration-${cityId}`]);
        await owner.query(`
          INSERT INTO app.zones (id, city_id, slug, name, sort_order, boundary)
          VALUES ($1, $2, 'centro', 'Centro', 1,
            extensions.ST_Multi(extensions.ST_GeomFromText('POLYGON((-6.00 37.38,-5.98 37.38,-5.98 37.40,-6.00 37.40,-6.00 37.38))', 4326)))
        `, [zoneId, cityId]);
        await expectSqlState(owner, 'outside_zone', `
          INSERT INTO app.zones (id, city_id, slug, name, sort_order, boundary)
          VALUES ($1, $2, 'fuera', 'Fuera', 2,
            extensions.ST_Multi(extensions.ST_GeomFromText('POLYGON((-6.20 37.50,-6.18 37.50,-6.18 37.52,-6.20 37.52,-6.20 37.50))', 4326)))
        `, [randomUUID(), cityId], '23514');
        await owner.query(`
          INSERT INTO app.route_nodes (id, city_id, position, is_published)
          VALUES
            ($1, $3, extensions.ST_GeomFromText('POINT(-5.990 37.390)', 4326), true),
            ($2, $3, extensions.ST_GeomFromText('POINT(-5.989 37.391)', 4326), true)
        `, [sourceId, targetId, cityId]);
        await owner.query(`
          INSERT INTO app.route_segments (id, city_id, source_node_id, target_node_id, geometry, distance_meters, is_published)
          VALUES ($1, $2, $3, $4,
            extensions.ST_GeomFromText('LINESTRING(-5.990 37.390,-5.989 37.391)', 4326), 1, true)
        `, [segmentId, cityId, sourceId, targetId]);
        const initial = await owner.query('SELECT distance_meters::float8 AS distance FROM app.route_segments WHERE id = $1', [segmentId]);
        assert.ok(initial.rows[0].distance > 100);
        await owner.query('UPDATE app.route_segments SET distance_meters = 1 WHERE id = $1', [segmentId]);
        const recalculated = await owner.query('SELECT distance_meters::float8 AS distance FROM app.route_segments WHERE id = $1', [segmentId]);
        assert.equal(recalculated.rows[0].distance, initial.rows[0].distance);
        await expectSqlState(owner, 'move_node', `
          UPDATE app.route_nodes
          SET position = extensions.ST_GeomFromText('POINT(-5.988 37.392)', 4326)
          WHERE id = $1
        `, [sourceId], '55000');
        await expectSqlState(owner, 'shrink_city', `
          UPDATE app.cities
          SET boundary = extensions.ST_GeomFromText('POLYGON((-5.995 37.385,-5.985 37.385,-5.985 37.395,-5.995 37.395,-5.995 37.385))', 4326)
          WHERE id = $1
        `, [cityId], '23514');
      } finally {
        await owner.query('ROLLBACK');
      }
      const rolledBack = await owner.query('SELECT count(*)::integer AS total FROM app.cities WHERE id = $1', [cityId]);
      assert.equal(rolledBack.rows[0].total, 0);
    });

    await t.test('ready, bootstrap y zones responden con datos reales', async () => {
      const app = createApp({ config, database: runtime, logger: false, readinessTimeoutMs: 5000 });
      const headers = { host: config.allowedHost };
      try {
        const ready = await app.inject({ method: 'GET', url: '/api/v1/ready', headers });
        assert.equal(ready.statusCode, 200);
        assert.equal(ready.json().status, 'ready');
        assert.equal(ready.json().checks.functions, 'ok');
        const bootstrap = await app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers });
        assert.equal(bootstrap.statusCode, 200);
        assert.equal(bootstrap.json().pilot.slug, 'sevilla');
        assert.equal(bootstrap.json().pilot.zoneCount, 3);
        const zones = await app.inject({ method: 'GET', url: '/api/v1/zones?q=aproximada&limit=2', headers });
        assert.equal(zones.statusCode, 200);
        assert.equal(zones.json().data.length, 2);
        assert.equal(zones.json().page.limit, 2);
      } finally {
        await app.close();
      }
    });

    await t.test('el pool cierra y una conexión nueva vuelve a funcionar', async () => {
      await runtime.end();
      const fresh = createDatabasePool(config);
      try {
        const result = await fresh.query('SELECT current_user');
        assert.equal(result.rows[0].current_user, 'rutaviva_runtime');
      } finally {
        await fresh.end();
      }
    });
  } finally {
    await owner.end();
    if (!runtime.ended) await runtime.end();
  }
});
