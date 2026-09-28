'use strict';

const { Client } = require('pg');
const { loadConfig } = require('../src/config.cjs');
const { tlsOptions } = require('../src/db/pool.cjs');
const { deriveAuthKeys, keyedHash, normalizeEmail } = require('../src/services/auth.cjs');

const ALLOWED_ROLES = new Set(['administrator', 'moderator']);
const AUDIT_SOURCE = 'authorized_email_bootstrap';
const CONFIRMATION = 'GRANT_AUTHORIZED_EMAIL_ROLE';
const USAGE = `Uso: --email=CORREO --role=administrator|moderator --confirm=${CONFIRMATION}`;

function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 3 || argv.some(value => typeof value !== 'string')) {
    throw new Error(USAGE);
  }
  const values = new Map();
  for (const argument of argv) {
    const match = /^--(email|role|confirm)=(.+)$/u.exec(argument);
    if (!match || values.has(match[1])) throw new Error(USAGE);
    values.set(match[1], match[2]);
  }
  if (values.size !== 3 || !ALLOWED_ROLES.has(values.get('role')) || values.get('confirm') !== CONFIRMATION) {
    throw new Error(USAGE);
  }
  return { email: normalizeEmail(values.get('email')), role: values.get('role') };
}

function createDatabaseClient(config, ClientClass = Client) {
  return new ClientClass({
    connectionString: config.migrationDatabaseUrl,
    ssl: tlsOptions(config.databaseSsl, config.databaseCaFile),
    connectionTimeoutMillis: config.databaseConnectTimeoutMs,
    query_timeout: config.databaseQueryTimeoutMs,
    statement_timeout: config.databaseQueryTimeoutMs,
    application_name: 'rutaviva-community-role-grant'
  });
}

async function grantRole(client, options) {
  const normalizedEmail = normalizeEmail(options.email);
  const keys = deriveAuthKeys(options.identityEncryptionKey);
  const emailHash = keyedHash(keys.emailIndex, 'email', normalizedEmail);
  let transactionStarted = false;

  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    transactionStarted = true;

    const identities = await client.query(`SELECT identity.id AS identity_id, account.id AS user_id
      FROM app_private.identities AS identity
      JOIN app.users AS account ON account.id = identity.user_id
      WHERE identity.normalized_email_hash = $1
        AND identity.provider = 'email'
        AND account.status = 'active'
      FOR UPDATE OF identity, account`, [emailHash]);
    if (identities.rows.length !== 1) {
      throw new Error('La concesión exige exactamente una identidad vinculada a una cuenta activa.');
    }
    const userId = identities.rows[0].user_id;

    const collaborator = await client.query(`SELECT role_code, revoked_at
      FROM app.user_roles
      WHERE user_id = $1 AND role_code = $2
      FOR UPDATE`, [userId, 'collaborator']);
    if (collaborator.rows.length !== 1 || collaborator.rows[0].revoked_at !== null) {
      throw new Error('La cuenta autorizada debe conservar el rol colaborador activo.');
    }

    const sessions = await client.query(`SELECT id
      FROM app_private.sessions
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND expires_at > clock_timestamp()
        AND idle_expires_at > clock_timestamp()
      ORDER BY id
      FOR UPDATE`, [userId]);
    if (sessions.rows.length < 1) {
      throw new Error('La cuenta autorizada debe tener al menos una sesión activa.');
    }

    const assigned = await client.query(`SELECT role_code, revoked_at
      FROM app.user_roles
      WHERE user_id = $1 AND role_code = $2
      FOR UPDATE`, [userId, options.role]);
    if (assigned.rows.length > 1) throw new Error('El estado del rol solicitado no es válido.');
    if (assigned.rows.length === 1) {
      if (assigned.rows[0].revoked_at !== null) {
        throw new Error('El rol solicitado consta como revocado y no se reactivará automáticamente.');
      }
      await client.query('COMMIT');
      return { changed: false, role: options.role };
    }

    await client.query(`INSERT INTO app.user_roles (user_id, role_code, granted_by)
      VALUES ($1, $2, NULL)`, [userId, options.role]);
    await client.query(`INSERT INTO app_private.audit_events
      (actor_id, action, resource_type, resource_id, details)
      VALUES (NULL, 'auth.role_assigned', 'user', $1,
        jsonb_build_object('role', $2::text, 'source', $3::text))`, [userId, options.role, AUDIT_SOURCE]);
    await client.query('COMMIT');
    return { changed: true, role: options.role };
  } catch (error) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); } catch { /* conserva el error original */ }
    }
    throw error;
  }
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const input = parseArguments(argv);
  const config = (dependencies.loadConfig || loadConfig)(dependencies.env || process.env);
  if (!config.migrationDatabaseConfigured) throw new Error('Falta la conexión de migración.');
  if (!config.identityEncryptionKey) throw new Error('Falta la clave raíz de identidad.');
  const client = dependencies.client || createDatabaseClient(config, dependencies.Client || Client);
  const output = dependencies.stdout || process.stdout;

  try {
    await client.connect();
    const result = await grantRole(client, {
      email: input.email,
      role: input.role,
      identityEncryptionKey: config.identityEncryptionKey
    });
    output.write(result.changed
      ? `Rol ${result.role} concedido mediante bootstrap autorizado.\n`
      : `El rol ${result.role} ya estaba activo; no se modificó nada.\n`);
    return result;
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch(() => {
    process.stderr.write('No se pudo conceder el rol. No se realizó ninguna concesión.\n');
    process.exitCode = 1;
  });
}

module.exports = {
  AUDIT_SOURCE,
  CONFIRMATION,
  createDatabaseClient,
  grantRole,
  main,
  parseArguments
};
