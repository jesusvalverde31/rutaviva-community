'use strict';

const path = require('node:path');
const { ConfigError, loadConfig } = require('../src/config.cjs');
const { MigrationError, runMigrations } = require('../src/db/migrator.cjs');

async function main() {
  const config = loadConfig();
  if (!config.migrationDatabaseConfigured) throw new MigrationError('MIGRATION_DATABASE_NOT_CONFIGURED');
  const result = await runMigrations({
    connectionString: config.migrationDatabaseUrl,
    ssl: config.databaseSsl,
    caFile: config.databaseCaFile,
    connectionTimeoutMillis: config.databaseConnectTimeoutMs,
    queryTimeoutMillis: config.databaseQueryTimeoutMs,
    runtimeRole: config.databaseRuntimeRole,
    runtimePassword: config.databaseRuntimePassword,
    migrationsDirectory: path.resolve(__dirname, '..', 'migrations')
  });
  process.stdout.write(`Migraciones verificadas: ${result.total}; aplicadas ahora: ${result.executed.length}.\n`);
}

if (require.main === module) {
  main().catch(error => {
    const code = error instanceof MigrationError
      ? error.code
      : error instanceof ConfigError
        ? 'MIGRATION_CONFIGURATION_INVALID'
        : 'MIGRATION_UNEXPECTED_FAILURE';
    process.stderr.write(`No se pudieron aplicar las migraciones: ${code}.\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
