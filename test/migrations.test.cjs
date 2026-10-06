'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ENSURE_RUNTIME_ROLE_SQL, MigrationError, checksum, loadMigrationFiles, runMigrations, verifyApplied } = require('../src/db/migrator.cjs');

const migrationsDirectory = path.resolve(__dirname, '..', 'migrations');
const runtimePassword = 'r'.repeat(40);
const runtimeOptions = { runtimeRole: 'rutaviva_runtime', runtimePassword };

test('carga veintitrés migraciones continuas y conserva inmutables las aplicadas', () => {
  const migrations = loadMigrationFiles(migrationsDirectory);
  assert.deepEqual(migrations.map(item => item.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
  assert.equal(migrations[4].checksum, 'f01bed78ca59b7cee3d0a6ff97f093742d455ba2a9b5f812fea692ef75476a07');
  assert.match(checksum('ruta viva'), /^[0-9a-f]{64}$/);
  assert.equal(migrations[3].sql.includes('route_segments'), false);
  assert.match(migrations[3].sql, /aproximado/i);
  assert.match(migrations[0].sql, /postgis must be installed in extensions schema/);
  assert.match(migrations[0].sql, /REVOKE ALL ON SCHEMA app FROM PUBLIC/);
  assert.doesNotMatch(migrations[0].sql, /REVOKE ALL ON SCHEMA extensions FROM PUBLIC/);
  assert.match(migrations[0].sql, /GRANT SELECT ON app_private\.schema_migrations TO rutaviva_runtime/);
  assert.match(migrations[1].sql, /GRANT SELECT ON app\.cities, app\.zones TO rutaviva_runtime/);
  assert.match(migrations[1].sql, /ST_CoveredBy/);
  assert.match(migrations[1].sql, /ST_Length/);
  assert.match(migrations[1].sql, /referenced route node cannot move/);
  assert.match(migrations[1].sql, /CREATE TRIGGER cities_validate_boundary_change[\s\S]*BEFORE UPDATE OF boundary ON app\.cities/);
  assert.match(migrations[1].sql, /EXISTS \(SELECT 1 FROM app\.zones[\s\S]*EXISTS \(SELECT 1 FROM app\.route_nodes[\s\S]*EXISTS \(SELECT 1 FROM app\.route_segments/);
  assert.match(migrations[1].sql, /BEFORE INSERT OR UPDATE OF city_id, source_node_id, target_node_id, geometry, distance_meters/);
  const territorySql = migrations[1].sql;
  assert.equal((territorySql.match(/FOR UPDATE\s+LOOP/g) || []).length, 4);
  assert.match(territorySql, /validate_zone_boundary[\s\S]*SELECT city\.id, city\.boundary[\s\S]*ORDER BY city\.id\s+FOR UPDATE\s+LOOP[\s\S]*city_boundary := locked_city\.boundary/);
  assert.match(territorySql, /validate_route_node[\s\S]*ORDER BY city\.id\s+FOR UPDATE\s+LOOP[\s\S]*referenced route node cannot move/);
  const segmentValidator = territorySql.slice(
    territorySql.indexOf('CREATE OR REPLACE FUNCTION app_private.validate_segment_endpoints'),
    territorySql.indexOf('CREATE TRIGGER route_segments_validate_endpoints')
  );
  assert.ok(segmentValidator.indexOf('ORDER BY node.id') < segmentValidator.indexOf('ORDER BY city.id'));
  assert.ok(segmentValidator.indexOf('ORDER BY city.id') < segmentValidator.indexOf('segment endpoints must belong to its city'));
  assert.match(segmentValidator, /source_position := locked_node\.position/);
  assert.match(segmentValidator, /target_position := locked_node\.position/);
  assert.match(segmentValidator, /city_boundary := locked_city\.boundary/);
  assert.match(territorySql, /El UPDATE ya bloquea esta ciudad[\s\S]*Los triggers hijos toman el mismo/);
  assert.match(migrations[1].sql, /CREATE TABLE app\.zones[\s\S]*sort_order integer NOT NULL/);
  assert.doesNotMatch(migrations[1].sql, /CREATE TABLE app\.cities[\s\S]*?sort_order integer NOT NULL[\s\S]*?CREATE TABLE app\.zones/);
  assert.doesNotMatch(migrations.slice(0, 3).map(item => item.sql).join('\n'), /GRANT (?:INSERT|UPDATE|DELETE|CREATE) .*rutaviva_runtime/i);
  assert.match(migrations[4].sql, /SECURITY DEFINER/g);
  assert.match(migrations[4].sql, /SET search_path = pg_catalog/g);
  assert.match(migrations[4].sql, /GRANT EXECUTE ON FUNCTION app_private\.request_magic_link/);
  assert.doesNotMatch(migrations[4].sql, /GRANT (?:INSERT|UPDATE|DELETE) ON .*rutaviva_runtime/i);
  assert.match(migrations[4].sql, /interval '15 minutes'/);
  assert.match(migrations[4].sql, /active\.position >= 5/);
  const identitySql = migrations[4].sql;
  const requestSection = identitySql.slice(identitySql.indexOf('CREATE OR REPLACE FUNCTION app_private.request_magic_link'), identitySql.indexOf('CREATE OR REPLACE FUNCTION app_private.verify_magic_link'));
  const verifySection = identitySql.slice(identitySql.indexOf('CREATE OR REPLACE FUNCTION app_private.verify_magic_link'), identitySql.indexOf('CREATE OR REPLACE FUNCTION app_private.authenticate_session'));
  const sessionSection = identitySql.slice(identitySql.indexOf('CREATE OR REPLACE FUNCTION app_private.authenticate_session'), identitySql.indexOf('CREATE OR REPLACE FUNCTION app_private.list_sessions'));
  const compareSection = identitySql.slice(identitySql.indexOf('CREATE OR REPLACE FUNCTION app_private.constant_time_equal_32'), identitySql.indexOf('CREATE OR REPLACE FUNCTION app_private.verify_magic_link'));
  assert.match(identitySql, /CREATE TABLE app\.users[\s\S]*public_alias text NOT NULL UNIQUE/);
  assert.match(identitySql, /CREATE TABLE app\.user_roles[\s\S]*CHECK \(role_code <> 'system'\)/);
  assert.match(identitySql, /CREATE TABLE app_private\.email_verifications[\s\S]*revoked_at timestamptz/);
  const firstRequestLock = requestSection.indexOf('pg_advisory_xact_lock');
  const secondRequestLock = requestSection.indexOf('pg_advisory_xact_lock', firstRequestLock + 1);
  assert.ok(firstRequestLock >= 0 && secondRequestLock > firstRequestLock);
  assert.match(requestSection.slice(firstRequestLock, secondRequestLock), /encode\(p_global_hash, 'hex'\)[\s\S]*p_idempotency_key/);
  assert.match(requestSection.slice(secondRequestLock, requestSection.indexOf('DELETE FROM app_private.api_idempotency')), /encode\(p_email_hash, 'hex'\)/);
  assert.ok(secondRequestLock < requestSection.indexOf('FOR UPDATE;'));
  assert.equal((requestSection.match(/scope_hash = p_global_hash/g) || []).length, 2);
  assert.doesNotMatch(requestSection, /scope_hash = p_email_hash/);
  assert.match(identitySql, /CREATE TABLE app_private\.outbox_events[\s\S]*verification_id uuid NOT NULL UNIQUE REFERENCES app_private\.email_verifications/);
  assert.match(identitySql, /status IN \('pending', 'processing', 'sent', 'failed', 'cancelled'\)/);
  assert.match(requestSection, /WITH revoked AS \([\s\S]*SET revoked_at = clock_timestamp\(\)[\s\S]*SET status = 'cancelled'[\s\S]*outbox\.verification_id = revoked\.id/);
  assert.doesNotMatch(requestSection, /SKIP LOCKED/);
  assert.ok(requestSection.indexOf("auth.request_link.email") < requestSection.indexOf("auth.request_link.network"));
  assert.ok(requestSection.indexOf("auth.request_link.network") < requestSection.indexOf("auth.request_link.global"));
  assert.doesNotMatch(requestSection.slice(
    requestSection.indexOf("email_allowed := app_private.consume_rate_limit"),
    requestSection.indexOf("ip_allowed := app_private.consume_rate_limit")
  ), /IF email_allowed/);
  assert.match(requestSection, /auth\.request_link\.global'[\s\S]*86400, 250/);
  assert.match(requestSection, /IF NOT ip_allowed THEN[\s\S]*'rate_limited'[\s\S]*'capacity_exhausted'[\s\S]*86400/);
  assert.match(compareSection, /octet_length\(p_left\) <> 32[\s\S]*FOR position IN 0\.\.31 LOOP[\s\S]*get_byte\(p_left, position\) # get_byte\(p_right, position\)/);
  assert.doesNotMatch(compareSection, /SECURITY DEFINER/);
  assert.match(identitySql, /REVOKE ALL ON FUNCTION app_private\.constant_time_equal_32\(bytea, bytea\) FROM PUBLIC, rutaviva_runtime/);
  assert.match(verifySection, /IF NOT app_private\.constant_time_equal_32\(verification\.token_hash, p_token_hash\) THEN/);
  assert.doesNotMatch(verifySection, /verification\.token_hash <> p_token_hash/);
  assert.match(verifySection, /SET attempts = least\(attempts \+ 1, 5\)/);
  assert.match(verifySection, /SET status = 'cancelled'[\s\S]*outbox\.verification_id = verification\.id[\s\S]*failed\.revoked_at IS NOT NULL/);
  assert.match(verifySection, /auth\.verify\.network', p_ip_hash, 900, 20/);
  assert.ok(firstRequestLock < requestSection.indexOf('FOR UPDATE;'));
  assert.ok(secondRequestLock < requestSection.indexOf('WITH revoked AS'));
  assert.ok(verifySection.indexOf('pg_advisory_xact_lock') < verifySection.indexOf('FOR UPDATE;'));
  assert.match(verifySection, /SELECT candidate\.normalized_email_hash INTO candidate_email_hash[\s\S]*pg_advisory_xact_lock[\s\S]*SELECT \* INTO verification[\s\S]*FOR UPDATE/);
  assert.doesNotMatch(verifySection, /SET attempts = attempts \+ 1, consumed_at/);
  assert.match(verifySection, /SET consumed_at = clock_timestamp\(\)[\s\S]*SET status = 'cancelled'[\s\S]*outbox\.verification_id = verification\.id/);
  assert.match(verifySection, /auth\.email_verified[\s\S]*auth\.role_assigned[\s\S]*'role', 'collaborator'/);
  assert.match(verifySection, /auth\.session_revoked[\s\S]*'reason', 'session_limit'/);
  assert.match(verifySection, /auth\.session_created[\s\S]*jsonb_build_object\('roles', selected_roles\)/);
  assert.match(verifySection, /user_version bigint[\s\S]*selected_user\.version/);
  assert.match(verifySection, /'rate_limited'[\s\S]*'invalid'[\s\S]*'account_unavailable'[\s\S]*'authenticated'/);
  assert.match(sessionSection, /last_seen_at <= clock_timestamp\(\) - interval '5 minutes'/);
  assert.match(sessionSection, /user_version bigint[\s\S]*selected_user\.version/);
  assert.doesNotMatch(sessionSection, /INTO\s+selected_session\s*,\s*selected_user/);
  assert.match(sessionSection, /SELECT account\.\* INTO selected_user[\s\S]*account\.status = 'active'[\s\S]*FOR SHARE OF account[\s\S]*SELECT session\.\* INTO selected_session[\s\S]*session\.user_id = selected_user\.id[\s\S]*FOR UPDATE OF session/);
  assert.match(identitySql, /list_sessions[\s\S]*actor\.expires_at > clock_timestamp\(\)[\s\S]*actor\.idle_expires_at > clock_timestamp\(\)[\s\S]*account\.status = 'active'/);
  const hardeningSql = migrations[5].sql;
  assert.match(hardeningSql, /CREATE OR REPLACE FUNCTION app_private\.verify_magic_link/);
  assert.match(hardeningSql, /SELECT locked_verification\.\* INTO verification[\s\S]*WHERE locked_verification\.id = p_verification_id[\s\S]*FOR UPDATE OF locked_verification/);
  assert.match(hardeningSql, /PERFORM locked_session\.id[\s\S]*locked_session\.user_id = selected_user\.id[\s\S]*ORDER BY locked_session\.id[\s\S]*FOR UPDATE OF locked_session/);
  assert.match(hardeningSql, /active_session\.user_id = selected_user\.id[\s\S]*revoked_session\.id = active\.id/);
  assert.doesNotMatch(hardeningSql, /PERFORM\s+id\b|WHERE\s+user_id\s*=|ORDER BY\s+id\b|SELECT\s+\*\s+INTO\s+verification/);
  assert.match(hardeningSql, /REVOKE ALL ON FUNCTION app_private\.verify_magic_link[\s\S]*FROM PUBLIC/);
  assert.match(hardeningSql, /GRANT EXECUTE ON FUNCTION app_private\.verify_magic_link[\s\S]*TO rutaviva_runtime/);
  for (const invariant of ['auth.email_verified', 'auth.role_assigned', 'auth.session_revoked', 'auth.session_created', 'constant_time_equal_32', 'pg_advisory_xact_lock']) {
    assert.equal(hardeningSql.includes(invariant), true, invariant);
  }
  const deliverySql = migrations[6].sql;
  assert.match(deliverySql, /FOR UPDATE OF outbox SKIP LOCKED/);
  assert.match(deliverySql, /status = 'processing'[\s\S]*lease_token/);
  assert.match(deliverySql, /WHEN 1 THEN clock_timestamp\(\) \+ interval '1 minute'/);
  assert.match(deliverySql, /selected_attempt < 5/);
  assert.match(deliverySql, /email\.delivery_(?:sent|failed|cancelled|retry_scheduled)/);
  assert.match(deliverySql, /GRANT EXECUTE ON FUNCTION app_private\.claim_email_delivery/);
  assert.doesNotMatch(deliverySql, /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON .*rutaviva_runtime/i);
  const failClosedSql = migrations[7].sql;
  assert.match(failClosedSql, /status = 'failed'[\s\S]*last_failure_code = 'PROVIDER_OUTCOME_UNKNOWN'/);
  assert.doesNotMatch(failClosedSql, /SET status = 'pending'[\s\S]*lease_expires_at <=/);
  assert.match(failClosedSql, /outbox_sent_has_provider_hash/);
  assert.match(failClosedSql, /p_provider_message_hash IS NULL/);
  assert.match(migrations[8].sql, /CREATE TABLE app\.contributions/);
  assert.match(migrations[8].sql, /SECURITY DEFINER/);
  assert.doesNotMatch(migrations[8].sql, /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON .*rutaviva_runtime/i);
  assert.match(migrations[9].sql, /own_contribution_moderation/);
  assert.match(migrations[9].sql, /moderation_decisions_append_only/);
  assert.match(migrations[10].sql, /contribution\.status = 'published'/);
  assert.match(migrations[10].sql, /idempotency_conflict/);
  assert.match(migrations[10].sql, /list_contribution_history/);
  assert.equal((migrations[10].sql.match(/changed_contribution\.id IS NULL/g) || []).length, 2);
  assert.match(migrations[11].sql, /own_claim boolean/);
  assert.doesNotMatch(migrations[11].sql, /author_id uuid/);
  assert.match(migrations[12].sql, /contribution\.updated/);
  assert.match(migrations[13].sql, /event\.actor_id=v_actor_id/);
  assert.doesNotMatch(migrations[13].sql, /event\.actor_id=actor_id/);
  assert.ok(migrations[12].sql.indexOf('FOR UPDATE OF contribution') < migrations[12].sql.indexOf("SET status='claimed'"));
  assert.match(migrations[14].sql, /CREATE TABLE app\.network_releases/);
  assert.match(migrations[14].sql, /REVOKE ALL ON app\.route_nodes, app\.route_segments FROM rutaviva_runtime/);
  assert.match(migrations[15].sql, /CREATE OR REPLACE FUNCTION app_private\.get_route_network/);
  assert.match(migrations[15].sql, /contribution\.status='published'/);
  assert.doesNotMatch(migrations[15].sql, /GRANT SELECT ON app\.(?:route_nodes|route_segments|network_releases)/);
  assert.match(migrations[16].sql, /CREATE OR REPLACE FUNCTION app_private\.community_stats/);
  assert.match(migrations[16].sql, /participant_count BETWEEN 1 AND 4/);
  assert.match(migrations[16].sql, /city_id='10000000-0000-4000-8000-000000000001'/);
  assert.doesNotMatch(migrations[16].sql, /GRANT SELECT ON app\./);
  assert.match(migrations[17].sql, /REVOKE CREATE ON SCHEMA extensions FROM PUBLIC, rutaviva_runtime/);
  assert.equal((migrations[17].sql.match(/SET search_path = pg_catalog, extensions/g)||[]).length,2);
  assert.match(migrations[18].sql, /node_count BETWEEN 0 AND 15000/);
  assert.match(migrations[18].sql, /segment_count BETWEEN 0 AND 30000/);
  assert.match(migrations[20].sql, /ADD COLUMN condition_type/);
  assert.match(migrations[20].sql, /personal_data_confirmed boolean NOT NULL DEFAULT false/);
  assert.match(migrations[20].sql, /create_accessibility_contribution/);
  assert.match(migrations[20].sql, /CREATE OR REPLACE FUNCTION app_private\.create_contribution[\s\S]*p_kind<>'shortcut'/);
  assert.match(migrations[20].sql, /update_accessibility_contribution/);
  assert.match(migrations[20].sql, /set_accessibility_lifecycle/);
  assert.match(migrations[20].sql, /contribution_lifecycle_requests/);
  assert.match(migrations[20].sql, /'reopened'/);
  assert.match(migrations[20].sql, /CREATE OR REPLACE FUNCTION app_private\.get_route_network/);
  assert.match(migrations[20].sql, /'measurementStatus',item\.measurement_status,'lifecycleStatus',item\.lifecycle_status/);
  assert.match(migrations[20].sql, /DROP FUNCTION app_private\.list_moderation_cases/);
  assert.match(migrations[20].sql, /condition_type text,affected_groups text\[\],observed_on date/);
  assert.ok(migrations[20].sql.indexOf("contribution-create:'||p_id") < migrations[20].sql.indexOf('SELECT contribution.* INTO existing'));
  assert.equal((migrations[20].sql.match(/contribution-create:'\|\|p_id/g)||[]).length,2);
  assert.doesNotMatch(migrations[20].sql, /DROP (?:TABLE|COLUMN)/i);
  assert.match(migrations[21].sql, /CREATE OR REPLACE FUNCTION app_private\.get_route_network/);
  assert.equal((migrations[21].sql.match(/OPERATOR\(extensions\.<->\)/g)||[]).length,2);
  assert.match(migrations[21].sql, /'measurementStatus',item\.measurement_status,'lifecycleStatus',item\.lifecycle_status/);
  assert.doesNotMatch(migrations[21].sql, /ORDER BY node\.position<->/);
  assert.doesNotMatch(migrations[21].sql, /DROP (?:TABLE|COLUMN)/i);
});

test('rechaza huecos, control transaccional y checksum alterado', () => {
  const temporary = fs.mkdtempSync(path.resolve(__dirname, '..', '.test-migrations-'));
  try {
    fs.writeFileSync(path.join(temporary, '002_gap.sql'), 'SELECT 1;\n');
    assert.throws(() => loadMigrationFiles(temporary), error => error.code === 'MIGRATION_SEQUENCE_GAP');
    fs.renameSync(path.join(temporary, '002_gap.sql'), path.join(temporary, '001_bad.sql'));
    fs.writeFileSync(path.join(temporary, '001_bad.sql'), 'BEGIN; SELECT 1; COMMIT;\n');
    assert.throws(() => loadMigrationFiles(temporary), error => error.code === 'TRANSACTION_CONTROL_NOT_ALLOWED');
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  assert.throws(
    () => verifyApplied([{ version: 1, name: '001_one.sql', checksum: 'a' }], [{ version: 1, name: '001_one.sql', checksum: 'b' }]),
    error => error.code === 'MIGRATION_CHECKSUM_MISMATCH'
  );
});

test('migrador bloquea, aplica en orden e inserta checksum parametrizado', async () => {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (String(text).startsWith('SELECT version')) return { rows: [] };
      return { rows: [] };
    }
  };
  const result = await runMigrations({ client, migrationsDirectory, ...runtimeOptions });
  assert.deepEqual(result, { total: 23, executed: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23] });
  assert.match(calls[0].text, /pg_advisory_lock/);
  const passwordCall = calls.find(call => String(call.text).includes("set_config('rutaviva.runtime_password'"));
  assert.deepEqual(passwordCall.values, [runtimePassword]);
  assert.equal(calls.some(call => String(call.text).includes(runtimePassword)), false);
  assert.match(ENSURE_RUNTIME_ROLE_SQL, /NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS/);
  assert.match(ENSURE_RUNTIME_ROLE_SQL, /FROM pg_auth_members membership/);
  assert.match(ENSURE_RUNTIME_ROLE_SQL, /runtime role attributes are unsafe/);
  assert.match(ENSURE_RUNTIME_ROLE_SQL, /CREATE ROLE rutaviva_runtime[\s\S]*PASSWORD %L/);
  assert.doesNotMatch(ENSURE_RUNTIME_ROLE_SQL, /ALTER ROLE/);
  const inserts = calls.filter(call => String(call.text).startsWith('INSERT INTO app_private.schema_migrations'));
  assert.equal(inserts.length, 23);
  assert.deepEqual(inserts.map(call => call.values[0]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
  assert.equal(calls.some(call => String(call.text).includes('pg_advisory_unlock')), true);
});

test('un error de migración ejecuta ROLLBACK, no COMMIT posterior', async () => {
  const calls = [];
  let migrationSqlSeen = false;
  const client = {
    async query(text) {
      calls.push(String(text));
      if (String(text).startsWith('SELECT version')) return { rows: [] };
      if (String(text).includes('CREATE EXTENSION')) {
        migrationSqlSeen = true;
        throw new Error('detalle privado del proveedor');
      }
      return { rows: [] };
    }
  };
  await assert.rejects(() => runMigrations({ client, migrationsDirectory, ...runtimeOptions }), error => error instanceof MigrationError && error.code === 'MIGRATION_FAILED');
  assert.equal(migrationSqlSeen, true);
  const failureIndex = calls.findIndex(call => call.includes('CREATE EXTENSION'));
  assert.equal(calls[failureIndex + 1], 'ROLLBACK');
  assert.equal(calls.slice(failureIndex + 1).includes('COMMIT'), false);
});

test('migrador rechaza rol o contraseña de ejecución inseguros antes de conectar', async () => {
  await assert.rejects(
    () => runMigrations({ client: { query: async () => ({ rows: [] }) }, migrationsDirectory, runtimeRole: 'postgres', runtimePassword }),
    error => error.code === 'RUNTIME_ROLE_CONFIGURATION_INVALID'
  );
  await assert.rejects(
    () => runMigrations({ client: { query: async () => ({ rows: [] }) }, migrationsDirectory, runtimeRole: 'rutaviva_runtime', runtimePassword: 'short' }),
    error => error.code === 'RUNTIME_ROLE_CONFIGURATION_INVALID'
  );
});

test('checksum alterado detiene el proceso antes de cambiar el rol runtime', async () => {
  const calls = [];
  const client = {
    async query(text) {
      calls.push(String(text));
      if (String(text).startsWith('SELECT version')) {
        return { rows: [{ version: 1, name: '001_postgis.sql', checksum: '0'.repeat(64) }] };
      }
      return { rows: [] };
    }
  };
  await assert.rejects(
    () => runMigrations({ client, migrationsDirectory, ...runtimeOptions }),
    error => error.code === 'MIGRATION_CHECKSUM_MISMATCH'
  );
  assert.equal(calls.some(call => call.includes('runtime_password')), false);
});

test('migración 023 mantiene reportes privados y decisión humana sin retirada automática',()=>{const sql=fs.readFileSync(path.join(migrationsDirectory,'023_content_reports.sql'),'utf8');assert.match(sql,/CREATE TABLE app_private\.content_reports/);assert.match(sql,/status text NOT NULL DEFAULT 'pending'/);assert.match(sql,/CREATE UNIQUE INDEX content_reports_one_pending_idx/);assert.match(sql,/IF p_decision='resolve' THEN[\s\S]*status='withdrawn'/);const createBody=sql.slice(sql.indexOf('CREATE FUNCTION app_private.create_content_report'),sql.indexOf('CREATE FUNCTION app_private.list_content_reports'));assert.doesNotMatch(createBody,/UPDATE app\.contributions/);assert.match(sql,/reporter_id<>actor_id AND contribution\.author_id<>actor_id/);assert.match(sql,/REVOKE ALL ON app_private\.content_reports,app_private\.content_report_decision_requests FROM PUBLIC,rutaviva_runtime/);assert.match(sql,/GRANT EXECUTE ON FUNCTION app_private\.decide_content_report/);assert.match(sql,/Retención propuesta: 24 meses/);});
