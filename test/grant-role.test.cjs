'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveAuthKeys, keyedHash } = require('../src/services/auth.cjs');
const {
  AUDIT_SOURCE,
  CONFIRMATION,
  grantRole,
  main,
  parseArguments
} = require('../scripts/grant-role.cjs');

const USER_ID = '10000000-0000-4000-8000-000000000001';
const SESSION_ID = '10000000-0000-4000-8000-000000000002';
const IDENTITY_ID = '10000000-0000-4000-8000-000000000003';
const ROOT_KEY = Buffer.alloc(32, 7);

function fakeClient(options = {}) {
  const calls = [];
  const client = {
    calls,
    connected: 0,
    ended: 0,
    async connect() {
      this.connected += 1;
      if (options.connectError) throw options.connectError;
    },
    async end() { this.ended += 1; },
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (sql.startsWith('BEGIN')) return { rows: [] };
      if (sql.includes('FROM app_private.identities')) {
        return { rows: options.identities || [{ identity_id: IDENTITY_ID, user_id: USER_ID }] };
      }
      if (sql.includes('FROM app_private.sessions')) {
        return { rows: options.sessions || [{ id: SESSION_ID }] };
      }
      if (sql.includes('FROM app.user_roles') && parameters[1] === 'collaborator') {
        return { rows: options.collaborator || [{ role_code: 'collaborator', revoked_at: null }] };
      }
      if (sql.includes('FROM app.user_roles')) return { rows: options.assigned || [] };
      if (options.failOnInsert && sql.includes('INSERT INTO app.user_roles')) throw options.failOnInsert;
      return { rows: [] };
    }
  };
  return client;
}

function roleOptions(overrides = {}) {
  return {
    email: 'persona@example.com',
    role: 'moderator',
    identityEncryptionKey: ROOT_KEY,
    ...overrides
  };
}

test('rechaza argumentos ausentes, duplicados, desconocidos o sin confirmación exacta', () => {
  const invalid = [
    [],
    ['--email=persona@example.com', '--role=moderator'],
    ['--email=persona@example.com', '--role=owner', `--confirm=${CONFIRMATION}`],
    ['--email=persona@example.com', '--role=moderator', '--confirm=SI'],
    ['--email=persona@example.com', '--email=otra@example.com', '--role=moderator'],
    ['--email=persona@example.com', '--role=moderator', `--confirm=${CONFIRMATION}`, '--extra=1']
  ];
  for (const argv of invalid) assert.throws(() => parseArguments(argv), /Uso:/);
  assert.deepEqual(parseArguments([
    '--role=administrator',
    `--confirm=${CONFIRMATION}`,
    '--email=  Persona@Example.COM '
  ]), { email: 'persona@example.com', role: 'administrator' });
});

test('selecciona la identidad mediante el mismo HMAC de correo de autenticación', async () => {
  const client = fakeClient({ assigned: [{ role_code: 'moderator', revoked_at: null }] });
  await grantRole(client, roleOptions());
  const identityQuery = client.calls.find(call => call.sql.includes('FROM app_private.identities'));
  const expected = keyedHash(deriveAuthKeys(ROOT_KEY).emailIndex, 'email', 'persona@example.com');
  assert.deepEqual(identityQuery.parameters, [expected]);
  assert.match(identityQuery.sql, /normalized_email_hash = \$1/);
  assert.match(client.calls[0].sql, /SERIALIZABLE/);
});

test('un rol activo es idempotente y no cambia fechas ni duplica auditoría', async () => {
  const client = fakeClient({ assigned: [{ role_code: 'moderator', revoked_at: null }] });
  const result = await grantRole(client, roleOptions());
  assert.deepEqual(result, { changed: false, role: 'moderator' });
  assert.equal(client.calls.some(call => call.sql.includes('INSERT INTO app.user_roles')), false);
  assert.equal(client.calls.some(call => call.sql.includes('INSERT INTO app_private.audit_events')), false);
  assert.equal(client.calls.some(call => call.sql === 'COMMIT'), true);
  assert.equal(client.calls.some(call => call.sql === 'ROLLBACK'), false);
});

test('un rol revocado aborta y revierte sin reactivarlo', async () => {
  const client = fakeClient({ assigned: [{ role_code: 'moderator', revoked_at: new Date().toISOString() }] });
  await assert.rejects(grantRole(client, roleOptions()), /revocado/);
  assert.equal(client.calls.some(call => call.sql === 'ROLLBACK'), true);
  assert.equal(client.calls.some(call => call.sql === 'COMMIT'), false);
  assert.equal(client.calls.some(call => call.sql.includes('INSERT INTO app.user_roles')), false);
  assert.equal(client.calls.some(call => /UPDATE\s+app\.user_roles/i.test(call.sql)), false);
});

test('una concesión nueva usa bootstrap NULL y auditoría sin PII', async () => {
  const client = fakeClient();
  const result = await grantRole(client, roleOptions());
  assert.deepEqual(result, { changed: true, role: 'moderator' });

  const insert = client.calls.find(call => call.sql.includes('INSERT INTO app.user_roles'));
  assert.match(insert.sql, /granted_by\)\s*VALUES \(\$1, \$2, NULL\)/);
  assert.deepEqual(insert.parameters, [USER_ID, 'moderator']);

  const audit = client.calls.find(call => call.sql.includes('INSERT INTO app_private.audit_events'));
  assert.match(audit.sql, /VALUES \(NULL, 'auth\.role_assigned'/);
  assert.match(audit.sql, /'role', \$2::text, 'source', \$3::text/);
  assert.deepEqual(audit.parameters, [USER_ID, 'moderator', AUDIT_SOURCE]);
  assert.equal(audit.parameters.includes('persona@example.com'), false);
  assert.equal(audit.parameters.some(value => Buffer.isBuffer(value)), false);
  assert.equal(client.calls.some(call => call.sql === 'COMMIT'), true);
});

test('exige colaborador activo y al menos una sesión activa', async () => {
  const withoutCollaborator = fakeClient({ collaborator: [] });
  await assert.rejects(grantRole(withoutCollaborator, roleOptions()), /colaborador activo/);
  assert.equal(withoutCollaborator.calls.at(-1).sql, 'ROLLBACK');

  const withoutSession = fakeClient({ sessions: [] });
  await assert.rejects(grantRole(withoutSession, roleOptions()), /sesión activa/);
  assert.equal(withoutSession.calls.at(-1).sql, 'ROLLBACK');
});

test('main cierra siempre la conexión y su salida no revela identidad', async () => {
  const client = fakeClient({ assigned: [{ role_code: 'moderator', revoked_at: null }] });
  let output = '';
  const config = {
    migrationDatabaseConfigured: true,
    identityEncryptionKey: ROOT_KEY
  };
  await main([
    '--email=persona@example.com',
    '--role=moderator',
    `--confirm=${CONFIRMATION}`
  ], {
    client,
    loadConfig: () => config,
    stdout: { write: value => { output += value; } }
  });
  assert.equal(client.connected, 1);
  assert.equal(client.ended, 1);
  assert.doesNotMatch(output, /persona|example|10000000/i);

  const failed = fakeClient({ connectError: new Error('fallo sintético') });
  await assert.rejects(main([
    '--email=persona@example.com',
    '--role=moderator',
    `--confirm=${CONFIRMATION}`
  ], { client: failed, loadConfig: () => config }), /fallo sintético/);
  assert.equal(failed.ended, 1);
});
