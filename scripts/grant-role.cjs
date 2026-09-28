'use strict';

const { Client } = require('pg');
const { loadConfig } = require('../src/config.cjs');
const { tlsOptions } = require('../src/db/pool.cjs');

async function main(argv = process.argv.slice(2)) {
  const allowed = new Set(['administrator', 'moderator']);
  const roleArg = argv.find(value => value.startsWith('--role='));
  const role = roleArg?.slice(7);
  if (!argv.includes('--sole-user') || !allowed.has(role) || !argv.includes('--confirm=GRANT_EXISTING_SOLE_USER')) {
    throw new Error('Uso: --sole-user --role=administrator|moderator --confirm=GRANT_EXISTING_SOLE_USER');
  }
  const config = loadConfig(process.env);
  if (!config.migrationDatabaseConfigured) throw new Error('Falta la conexión de migración.');
  const client = new Client({
    connectionString: config.migrationDatabaseUrl,
    ssl: tlsOptions(config.databaseSsl, config.databaseCaFile),
    connectionTimeoutMillis: config.databaseConnectTimeoutMs,
    query_timeout: config.databaseQueryTimeoutMs,
    statement_timeout: config.databaseQueryTimeoutMs,
    application_name: 'rutaviva-community-role-grant'
  });
  try {
    await client.connect();
    await client.query('BEGIN');
    const users = await client.query("SELECT id FROM app.users WHERE status='active' ORDER BY created_at FOR UPDATE");
    if (users.rows.length !== 1) throw new Error('La concesión exige exactamente una cuenta activa.');
    const userId = users.rows[0].id;
    const grant = await client.query(`WITH changed AS (
      INSERT INTO app.user_roles (user_id,role_code,granted_by) VALUES ($1,$2,$1)
      ON CONFLICT (user_id,role_code) DO UPDATE
      SET revoked_at=NULL, granted_at=clock_timestamp(), granted_by=excluded.granted_by
      WHERE app.user_roles.revoked_at IS NOT NULL
      RETURNING user_id
    ) SELECT EXISTS(SELECT 1 FROM changed) AS changed`, [userId, role]);
    if (grant.rows[0].changed) {
      await client.query(`INSERT INTO app_private.audit_events (actor_id,action,resource_type,resource_id,details)
        VALUES ($1,'auth.role_assigned','user',$1,jsonb_build_object('role',$2::text))`, [userId, role]);
    }
    await client.query('COMMIT');
    process.stdout.write(grant.rows[0].changed
      ? `Rol ${role} concedido a la única cuenta activa.\n`
      : `El rol ${role} ya estaba activo; no se modificó nada.\n`);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* conexión no iniciada */ }
    throw error;
  } finally { await client.end().catch(() => {}); }
}

if (require.main === module) main().catch(error => { process.stderr.write(`No se pudo conceder el rol: ${error.message}\n`); process.exitCode=1; });
module.exports = { main };
