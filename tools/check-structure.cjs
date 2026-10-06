'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const required = [
  '.gitignore', '.gitattributes', '.env.example', 'AGENTS.md', 'BRIEF.md', 'TAREAS.md',
  'README.md', 'LICENSE', 'package.json', 'docs/ARQUITECTURA.md',
  'docs/MODELO-DATOS.md', 'docs/CONTRATO-API.md', 'docs/SEGURIDAD.md',
  'docs/PRIVACIDAD.md', 'docs/MODERACION.md', 'docs/RETENCION.md',
  'docs/REGISTRO-RIESGOS.md', 'docs/DECISIONES.md', 'src/README.md',
  'migrations/README.md', 'test/structure.test.cjs', 'tools/check-structure.cjs',
  'package-lock.json', 'src/config.cjs', 'src/runtime-env.cjs', 'src/errors.cjs', 'src/app.cjs',
  'src/server.cjs', 'src/plugins/security.cjs', 'openapi/openapi.json',
  'test/config.test.cjs', 'test/server.test.cjs', 'src/db/pool.cjs',
  'src/db/health.cjs', 'src/db/migrator.cjs', 'src/db/repositories/zones.cjs',
  'src/routes/public.cjs', 'scripts/migrate.cjs', 'migrations/001_postgis.sql',
  'migrations/002_territory.sql', 'migrations/003_operations.sql',
  'migrations/004_seed_sevilla.sql', 'test/database.test.cjs',
  'test/migrations.test.cjs', 'test/database.integration.test.cjs',
  'certs/supabase-prod-ca-2021.crt', 'migrations/005_identity_access.sql',
  'migrations/006_auth_function_hardening.sql',
  'src/db/repositories/auth.cjs', 'src/services/auth.cjs',
  'src/services/email-outbox.cjs', 'src/plugins/session.cjs',
  'src/routes/auth.cjs', 'test/auth.test.cjs', 'test/auth.integration.test.cjs'
  , 'migrations/007_email_delivery.sql', 'src/db/repositories/outbox.cjs'
  , 'src/services/brevo-client.cjs', 'src/services/outbox-worker.cjs'
  , 'scripts/run-outbox-worker.cjs', 'src/routes/web.cjs', 'public/index.html'
  , 'public/styles.css', 'public/app.js', 'iniciar.cjs'
  , 'ABRIR-RUTAVIVA-COMMUNITY.cmd', 'test/email-worker.test.cjs'
  , 'test/email-worker.integration.test.cjs', 'test/web.test.cjs'
  , 'migrations/008_email_delivery_fail_closed.sql'
  , '.github/workflows/ci.yml', '.node-version', 'render.yaml', 'THIRD_PARTY_NOTICES.md'
  , 'docs/DESPLIEGUE.md', 'docs/PILOTO-SEVILLA.md'
  , 'migrations/009_community_contributions.sql', 'migrations/010_moderation_and_scoring.sql'
  , 'migrations/011_community_integrity.sql'
  , 'migrations/012_moderation_queue_projection.sql'
  , 'migrations/013_contribution_audit_and_lock_order.sql'
  , 'migrations/014_reaction_rate_limit_disambiguation.sql'
  , 'scripts/build-map-assets.cjs', 'scripts/grant-role.cjs', 'public/map.js'
  , 'src/db/repositories/contributions.cjs', 'src/db/repositories/moderation.cjs'
  , 'src/services/contribution-score.cjs', 'src/routes/contributions.cjs', 'src/routes/moderation.cjs'
  , 'public/contribution-recovery.mjs'
  , 'test/contributions.test.cjs', 'test/contributions.integration.test.cjs'
  , 'test/moderation.test.cjs', 'test/deployment.test.cjs', 'test/load.test.cjs'
  , 'test/grant-role.test.cjs'
  , 'migrations/015_route_network.sql', 'migrations/016_route_planning.sql'
  , 'scripts/import-osm-pilot.cjs', 'src/services/route-engine.cjs'
  , 'src/db/repositories/routes.cjs', 'src/routes/routes.cjs'
  , 'test/route-engine.test.cjs', 'test/routes.integration.test.cjs', 'test/import-osm.test.cjs'
  , 'docs/DATOS-OSM.md'
  , 'migrations/017_public_credibility.sql', 'src/db/repositories/stats.cjs'
  , 'src/services/methodology.cjs', 'src/routes/credibility.cjs', 'test/credibility.test.cjs'
  , 'docs/PRESENTACION-COMERCIAL.md'
  , 'scripts/inspect-route-schema.cjs'
  , 'migrations/018_postgis_operator_resolution.sql'
  , 'migrations/019_route_network_capacity.sql'
  , 'migrations/020_snap_route_points_fields.sql'
  , 'docs/VALIDACION-PILOTO-REAL.md'
  , 'migrations/021_accessibility_focus.sql'
  , 'migrations/022_route_network_operator_fix.sql'
  , 'migrations/023_content_reports.sql'
  , 'test/accessibility-focus.test.cjs'
  , '.github/CODEOWNERS', '.github/pull_request_template.md'
  , '.github/ISSUE_TEMPLATE/bug_report.yml', '.github/ISSUE_TEMPLATE/feature_request.yml'
  , '.github/ISSUE_TEMPLATE/config.yml', '.github/dependabot.yml'
  , '.github/workflows/production-smoke.yml'
  , 'scripts/smoke-production.cjs', 'test/production-smoke.test.cjs'
  , 'scripts/smoke-session.cjs', 'test/session-smoke.test.cjs'
  , 'src/db/repositories/reports.cjs', 'src/routes/reports.cjs'
  , 'test/reports.test.cjs', 'test/reports.integration.test.cjs'
  , 'public/manifest.webmanifest', 'public/service-worker.js', 'public/offline.html'
  , 'public/icon-192.png', 'public/icon-512.png'
  , 'SECURITY.md', 'CONTRIBUTING.md'
  , 'docs/OPERACION-PRODUCCION.md', 'docs/RECUPERACION-Y-ROLLBACK.md'
  , 'docs/CHECKLIST-RELEASE.md'
];

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /(?:github_pat_|ghp_|sk_live_|sk_test_)[A-Za-z0-9_-]{12,}/,
  /(?:api[_-]?key|secret|token)\s*[=:]\s*(?!REPLACE_WITH_SECRET)["']?[A-Za-z0-9_-]{20,}/i
];
const usersPattern = '[A-Z]' + ':[\\\\/]Users[\\\\/]';
const portableDrivePattern = '(?:^|[^A-Za-z])' + 'M' + ':[\\\\/]';
const privatePathPatterns = [new RegExp(usersPattern, 'i'), new RegExp(portableDrivePattern, 'i')];
const expectedEnvironment = {
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: '4329',
  PUBLIC_ORIGIN: 'http://127.0.0.1:4329',
  TRUST_PROXY_HOPS: '0',
  DATABASE_URL: 'postgresql://USER:PASSWORD@HOST:5432/DATABASE',
  MIGRATION_DATABASE_URL: 'postgresql://MIGRATOR:PASSWORD@HOST:5432/DATABASE',
  DATABASE_RUNTIME_ROLE: 'rutaviva_runtime',
  DATABASE_SSL: 'true',
  DATABASE_CA_FILE: 'certs/supabase-prod-ca-2021.crt',
  DATABASE_POOL_MAX: '3',
  DATABASE_CONNECT_TIMEOUT_MS: '5000',
  DATABASE_QUERY_TIMEOUT_MS: '5000',
  SESSION_SECRET: 'REPLACE_WITH_SECRET',
  CSRF_SECRET: 'REPLACE_WITH_SECRET',
  IDENTITY_ENCRYPTION_KEY: 'REPLACE_WITH_SECRET',
  IP_HASH_SECRET: 'REPLACE_WITH_SECRET',
  BREVO_API_KEY: 'REPLACE_WITH_SECRET',
  BREVO_SENDER: 'no-reply@example.invalid',
  BREVO_SENDER_NAME: 'RutaViva',
  EMAIL_PROVIDER: 'disabled',
  EMAIL_POLL_MS: '1000',
  EMAIL_LEASE_SECONDS: '60',
  EMAIL_TIMEOUT_MS: '10000',
  MAP_TILE_URL: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  LOG_LEVEL: 'info'
};

function filesIn(directory, prefix = '') {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!prefix && (['.git', '.npm-cache'].includes(entry.name) || entry.name.startsWith('node_modules'))) continue;
    if (entry.isDirectory() && relative === 'public/vendor') continue;
    if (!prefix && entry.isFile() && entry.name !== '.env.example' && /^\.env(?:\.|$)/.test(entry.name)) continue;
    if (entry.isDirectory()) found.push(...filesIn(path.join(directory, entry.name), relative));
    else if (entry.isFile()) found.push(relative);
  }
  return found.sort();
}

function parseEnvironment(content) {
  return content.trimEnd().split(/\r?\n/).map(line => {
    const separator = line.indexOf('=');
    return separator === -1 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1)];
  });
}

function inspect() {
  const problems = [];
  if (Number(process.versions.node.split('.')[0]) < 24) problems.push('Node.js debe ser 24 o superior.');
  const actualFiles = filesIn(root);
  if (JSON.stringify(actualFiles) !== JSON.stringify([...required].sort())) problems.push('El conjunto de archivos no coincide exactamente con la fundación aprobada.');
  for (const file of required) {
    const full = path.join(root, file);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) problems.push(`Falta ${file}.`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const expectedDependencies = { '@fastify/helmet': '13.1.1', fastify: '5.12.5', 'maplibre-gl': '6.10.0', pg: '8.23.0' };
  if (JSON.stringify(pkg.dependencies || {}) !== JSON.stringify(expectedDependencies) || Object.keys(pkg.devDependencies || {}).length) problems.push('Las dependencias no coinciden con las aprobadas.');
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  if (JSON.stringify(lock.packages?.['']?.dependencies || {}) !== JSON.stringify(expectedDependencies)) problems.push('El lockfile no fija las dependencias directas aprobadas.');
  const incompleteLockEntries = Object.entries(lock.packages || {}).filter(([name, value]) => name && (!value.resolved || !value.integrity));
  if (incompleteLockEntries.length) problems.push(`El lockfile contiene ${incompleteLockEntries.length} paquetes sin origen o integridad.`);
  for (const file of actualFiles) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    if (path.extname(file).toLowerCase() === '.cmd') continue;
    const content = fs.readFileSync(full, 'utf8');
    if (secretPatterns.some(pattern => pattern.test(content))) problems.push(`Posible secreto en ${file}.`);
    if (privatePathPatterns.some(pattern => pattern.test(content))) problems.push(`Ruta privada en ${file}.`);
  }
  const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  if (JSON.stringify(parseEnvironment(env)) !== JSON.stringify(Object.entries(expectedEnvironment))) problems.push('.env.example no coincide con la plantilla ficticia aprobada.');
  if (!fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/).includes('.env')) problems.push('.env no está ignorado.');
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  if (!readme.includes('Supabase Free con PostgreSQL/PostGIS') || !readme.includes('interfaz web responsive')) problems.push('README no declara con precisión el alcance ejecutable verificado.');
  if (!readme.includes('RutaViva no garantiza seguridad')) problems.push('README no contiene la advertencia obligatoria.');
  if (!readme.includes('rutaviva_runtime') || !readme.includes('credenciales distintas')) problems.push('README no explica la separación mínima de roles.');
  if (!readme.includes('EMAIL_PROVIDER=disabled')) problems.push('README no declara el modo seguro sin proveedor.');
  return problems;
}

if (require.main === module) {
  const problems = inspect();
  if (problems.length) {
    for (const problem of problems) console.error(problem);
    process.exitCode = 1;
  } else {
    console.log(`Estructura válida: ${required.length} archivos, Node ${process.versions.node}, dependencias fijadas y aprobadas.`);
  }
}

module.exports = { expectedEnvironment, filesIn, inspect, parseEnvironment, privatePathPatterns, required };
