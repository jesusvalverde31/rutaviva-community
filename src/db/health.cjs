'use strict';

const path = require('node:path');
const { loadMigrationFiles } = require('./migrator.cjs');

const REQUIRED_RELATIONS = [
  'app.cities',
  'app.zones',
  'app.route_nodes',
  'app.route_segments',
  'app.network_releases',
  'app.users',
  'app.roles',
  'app.permissions',
  'app.user_roles',
  'app.contributions',
  'app.contribution_reactions',
  'app_private.schema_migrations',
  'app_private.audit_events',
  'app_private.identities',
  'app_private.email_verifications',
  'app_private.sessions',
  'app_private.outbox_events',
  'app_private.api_idempotency',
  'app_private.rate_limit_buckets',
  'app_private.contribution_history',
  'app_private.moderation_cases',
  'app_private.moderation_decisions'
];

const REQUIRED_FUNCTIONS = [
  'app_private.request_magic_link(uuid,uuid,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,text,bytea,uuid)',
  'app_private.verify_magic_link(uuid,bytea,bytea,uuid,uuid,uuid,bytea,text,uuid)',
  'app_private.authenticate_session(bytea)',
  'app_private.list_sessions(uuid)',
  'app_private.revoke_session(uuid,uuid,uuid)'
  ,'app_private.claim_email_delivery(uuid,uuid,integer)'
  ,'app_private.complete_email_delivery(uuid,uuid,uuid,bytea,uuid)'
  ,'app_private.fail_email_delivery(uuid,uuid,uuid,text,boolean,uuid)'
  ,'app_private.list_contributions(uuid,text,text,text,integer)'
  ,'app_private.create_contribution(uuid,uuid,uuid,uuid,text,text,text,jsonb,uuid)'
  ,'app_private.update_contribution(uuid,uuid,bigint,text,text,jsonb,uuid)'
  ,'app_private.transition_own_contribution(uuid,uuid,bigint,text,uuid)'
  ,'app_private.set_contribution_reaction(uuid,uuid,text,boolean,uuid)'
  ,'app_private.list_moderation_cases(uuid,text,integer)'
  ,'app_private.claim_moderation_case(uuid,uuid,bigint,uuid)'
  ,'app_private.decide_moderation_case(uuid,uuid,bigint,text,text,uuid)'
  ,'app_private.community_activity()'
  ,'app_private.get_contribution(uuid,uuid)'
  ,'app_private.list_contribution_history(uuid,uuid)'
];

const READINESS_SQL = `
SELECT
  current_user AS effective_role,
  EXISTS (
    SELECT 1
    FROM pg_extension extension
    JOIN pg_namespace namespace ON namespace.oid = extension.extnamespace
    WHERE extension.extname = 'postgis' AND namespace.nspname = 'extensions'
  ) AS postgis_ready,
  relation_name,
  to_regclass(relation_name) IS NOT NULL AS relation_ready
FROM unnest($1::text[]) AS relation_name
`;

const MIGRATIONS_SQL = 'SELECT version, name, checksum FROM app_private.schema_migrations ORDER BY version';
const FUNCTIONS_SQL = `
SELECT
  function_name,
  to_regprocedure(function_name) IS NOT NULL AS function_ready,
  CASE
    WHEN to_regprocedure(function_name) IS NULL THEN false
    ELSE has_function_privilege(current_user, to_regprocedure(function_name), 'EXECUTE')
  END AS function_executable
FROM unnest($1::text[]) AS function_name
`;

function exactMigrations(actual, expected) {
  return actual.length === expected.length && actual.every((row, index) => (
    row.version === expected[index].version
    && row.name === expected[index].name
    && row.checksum === expected[index].checksum
  ));
}

function createReadinessCheck(database, options = {}) {
  if (!database) return async () => ({ ready: false });
  const runtimeRole = options.runtimeRole || 'rutaviva_runtime';
  const migrationsDirectory = options.migrationsDirectory || path.resolve(__dirname, '..', '..', 'migrations');
  const expectedMigrations = loadMigrationFiles(migrationsDirectory);
  return async function readinessCheck() {
    const status = await database.query(READINESS_SQL, [REQUIRED_RELATIONS]);
    const applied = await database.query(MIGRATIONS_SQL);
    const functions = await database.query(FUNCTIONS_SQL, [REQUIRED_FUNCTIONS]);
    const relationsReady = status.rows.length === REQUIRED_RELATIONS.length
      && status.rows.every(row => row.relation_ready === true);
    const roleReady = status.rows.length > 0
      && status.rows.every(row => row.effective_role === runtimeRole);
    const postgisReady = status.rows.length > 0
      && status.rows.every(row => row.postgis_ready === true);
    const migrationsReady = exactMigrations(applied.rows, expectedMigrations);
    const functionsReady = functions.rows.length === REQUIRED_FUNCTIONS.length
      && functions.rows.every(row => row.function_ready === true && row.function_executable === true);
    const ready = relationsReady && roleReady && postgisReady && migrationsReady && functionsReady;
    return {
      ready,
      checks: ready ? { database: 'ok', role: 'ok', postgis: 'ok', migrations: 'ok', relations: 'ok', functions: 'ok' } : undefined
    };
  };
}

module.exports = {
  MIGRATIONS_SQL,
  FUNCTIONS_SQL,
  READINESS_SQL,
  REQUIRED_FUNCTIONS,
  REQUIRED_RELATIONS,
  createReadinessCheck,
  exactMigrations
};
