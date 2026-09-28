'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Client } = require('pg');
const { tlsOptions } = require('./pool.cjs');

const LOCK_KEYS = [1_385_445_286, 22];
const FILE_PATTERN = /^(\d{3})_([a-z0-9_]+)\.sql$/;
const RUNTIME_ROLE = 'rutaviva_runtime';
const ENSURE_RUNTIME_ROLE_SQL = `
DO $role$
DECLARE
  role_password text := current_setting('rutaviva.runtime_password', true);
  role_state record;
BEGIN
  IF role_password IS NULL OR char_length(role_password) < 32 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'runtime role password is invalid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rutaviva_runtime') THEN
    EXECUTE format(
      'CREATE ROLE rutaviva_runtime WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
      role_password
    );
  ELSE
    SELECT rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls
      INTO STRICT role_state
      FROM pg_roles
      WHERE rolname = 'rutaviva_runtime';
    IF role_state.rolsuper
       OR role_state.rolinherit
       OR role_state.rolcreaterole
       OR role_state.rolcreatedb
       OR NOT role_state.rolcanlogin
       OR role_state.rolreplication
       OR role_state.rolbypassrls THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'runtime role attributes are unsafe';
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_auth_members membership
    JOIN pg_roles member_role ON member_role.oid = membership.member
    WHERE member_role.rolname = 'rutaviva_runtime'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'runtime role membership is not allowed';
  END IF;
END;
$role$;
`;

class MigrationError extends Error {
  constructor(code, options = {}) {
    super(code, options);
    this.name = 'MigrationError';
    this.code = code;
  }
}

function checksum(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function loadMigrationFiles(directory) {
  const names = fs.readdirSync(directory).filter(name => name.endsWith('.sql')).sort();
  const migrations = names.map(name => {
    const match = FILE_PATTERN.exec(name);
    if (!match) throw new MigrationError('INVALID_MIGRATION_FILENAME');
    const sql = fs.readFileSync(path.join(directory, name), 'utf8');
    if (/^\s*(?:BEGIN|COMMIT|ROLLBACK)(?:\s+(?:WORK|TRANSACTION))?\s*;/im.test(sql)) throw new MigrationError('TRANSACTION_CONTROL_NOT_ALLOWED');
    return { version: Number(match[1]), name, sql, checksum: checksum(sql) };
  });
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) throw new MigrationError('MIGRATION_SEQUENCE_GAP');
  });
  return migrations;
}

function verifyApplied(migrations, appliedRows) {
  const byVersion = new Map(migrations.map(migration => [migration.version, migration]));
  let expected = 1;
  for (const row of appliedRows) {
    if (row.version !== expected) throw new MigrationError('APPLIED_MIGRATION_GAP');
    const migration = byVersion.get(row.version);
    if (!migration || migration.name !== row.name) throw new MigrationError('UNKNOWN_APPLIED_MIGRATION');
    if (migration.checksum !== row.checksum) throw new MigrationError('MIGRATION_CHECKSUM_MISMATCH');
    expected += 1;
  }
}

async function runMigrations(options) {
  if (options.runtimeRole !== RUNTIME_ROLE || typeof options.runtimePassword !== 'string' || options.runtimePassword.length < 32) {
    throw new MigrationError('RUNTIME_ROLE_CONFIGURATION_INVALID');
  }
  const migrations = loadMigrationFiles(options.migrationsDirectory);
  const client = options.client || new Client({
    connectionString: options.connectionString,
    ssl: tlsOptions(options.ssl, options.caFile),
    connectionTimeoutMillis: options.connectionTimeoutMillis,
    query_timeout: options.queryTimeoutMillis,
    statement_timeout: options.queryTimeoutMillis,
    application_name: 'rutaviva-community-migrator'
  });
  const ownsClient = !options.client;
  let locked = false;
  try {
    if (ownsClient) await client.connect();
    await client.query('SELECT pg_advisory_lock($1, $2)', LOCK_KEYS);
    locked = true;
    await client.query('BEGIN');
    try {
      await client.query('CREATE SCHEMA IF NOT EXISTS app_private');
      await client.query(`
        CREATE TABLE IF NOT EXISTS app_private.schema_migrations (
          version integer PRIMARY KEY CHECK (version > 0),
          name text NOT NULL UNIQUE,
          checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new MigrationError('MIGRATION_METADATA_FAILED', { cause: error });
    }

    const applied = await client.query('SELECT version, name, checksum FROM app_private.schema_migrations ORDER BY version');
    verifyApplied(migrations, applied.rows);
    await client.query('BEGIN');
    try {
      await client.query("SELECT set_config('rutaviva.runtime_password', $1, true)", [options.runtimePassword]);
      await client.query(ENSURE_RUNTIME_ROLE_SQL);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new MigrationError('RUNTIME_ROLE_SETUP_FAILED', { cause: error });
    }
    const appliedVersions = new Set(applied.rows.map(row => row.version));
    const executed = [];
    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue;
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO app_private.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [migration.version, migration.name, migration.checksum]
        );
        await client.query('COMMIT');
        executed.push(migration.version);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new MigrationError('MIGRATION_FAILED', { cause: error });
      }
    }
    return { total: migrations.length, executed };
  } finally {
    if (locked) {
      try { await client.query('SELECT pg_advisory_unlock($1, $2)', LOCK_KEYS); } catch { /* la conexión se cerrará */ }
    }
    if (ownsClient) await client.end();
  }
}

module.exports = {
  LOCK_KEYS,
  ENSURE_RUNTIME_ROLE_SQL,
  MigrationError,
  RUNTIME_ROLE,
  checksum,
  loadMigrationFiles,
  runMigrations,
  verifyApplied
};
