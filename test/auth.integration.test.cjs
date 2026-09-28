'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { loadConfig } = require('../src/config.cjs');
const { createDatabasePool, tlsOptions } = require('../src/db/pool.cjs');
const { createAuthRepository } = require('../src/db/repositories/auth.cjs');
const { REQUIRED_FUNCTIONS } = require('../src/db/health.cjs');

function encrypted() {
  return { ciphertext: randomBytes(48), nonce: randomBytes(12), tag: randomBytes(16) };
}

function requestInput(overrides = {}) {
  const verificationId = overrides.verificationId || randomUUID();
  return {
    verificationId,
    outboxId: randomUUID(),
    emailHash: randomBytes(32),
    ipHash: randomBytes(32),
    globalHash: randomBytes(32),
    encryptedEmail: encrypted(),
    tokenHash: randomBytes(32),
    encryptedOutbox: encrypted(),
    idempotencyKey: `integration-${randomUUID()}`,
    requestHash: randomBytes(32),
    requestId: randomUUID(),
    ...overrides
  };
}

function verifyInput(link, overrides = {}) {
  const userId = overrides.userId || randomUUID();
  return {
    verificationId: link.verificationId,
    tokenHash: link.tokenHash,
    ipHash: randomBytes(32),
    userId,
    identityId: randomUUID(),
    sessionId: randomUUID(),
    sessionTokenHash: randomBytes(32),
    publicAlias: `Ruta-${userId.replaceAll('-', '').slice(0, 16)}`,
    requestId: randomUUID(),
    ...overrides
  };
}

async function directVerification(owner, input, options = {}) {
  await owner.query(`
    INSERT INTO app_private.email_verifications (
      id, normalized_email_hash, email_ciphertext, email_nonce, email_tag,
      token_hash, created_at, expires_at, revoked_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [
    input.verificationId, input.emailHash, input.encryptedEmail.ciphertext,
    input.encryptedEmail.nonce, input.encryptedEmail.tag, input.tokenHash,
    options.createdAt || new Date(Date.now() - 60_000),
    options.expiresAt || new Date(Date.now() + 15 * 60_000),
    options.revokedAt || null
  ]);
}

async function deniedInSavepoint(client, name, sql, values = []) {
  await client.query(`SAVEPOINT ${name}`);
  await assert.rejects(client.query(sql, values), error => error?.code === '42501' || error?.code === '23514');
  await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
  await client.query(`RELEASE SAVEPOINT ${name}`);
}

test('integración real de identidad y sesiones siempre revierte sus datos', { timeout: 120_000 }, async t => {
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
    application_name: 'rutaviva-community-auth-integration-owner'
  });
  const runtime = createDatabasePool(config);
  assert.ok(runtime);
  await owner.connect();
  const repository = createAuthRepository(owner);
  await owner.query('BEGIN');

  try {
    await t.test('runtime tiene EXECUTE exacto y no puede leer ni escribir tablas privadas', async () => {
      const privileges = await owner.query(`
        SELECT signature,
          to_regprocedure(signature) IS NOT NULL AS function_ready,
          has_function_privilege('rutaviva_runtime', to_regprocedure(signature), 'EXECUTE') AS executable
        FROM unnest($1::text[]) signature
      `, [REQUIRED_FUNCTIONS]);
      assert.equal(privileges.rows.length, REQUIRED_FUNCTIONS.length);
      assert.equal(privileges.rows.every(row => row.function_ready && row.executable), true);
      const internal = await owner.query(`
        SELECT signature, has_function_privilege('rutaviva_runtime', signature, 'EXECUTE') AS executable
        FROM unnest($1::regprocedure[]) signature
      `, [[
        'app_private.consume_rate_limit(text,bytea,integer,integer)',
        'app_private.constant_time_equal_32(bytea,bytea)'
      ]]);
      assert.equal(internal.rows.every(row => row.executable === false), true);
      const sameHash = randomBytes(32);
      const otherHash = Buffer.from(sameHash);
      otherHash[31] ^= 1;
      const comparison = await owner.query(`
        SELECT app_private.constant_time_equal_32($1, $1) AS equal,
               app_private.constant_time_equal_32($1, $2) AS different,
               app_private.constant_time_equal_32($1, $3) AS invalid_length
      `, [sameHash, otherHash, randomBytes(31)]);
      assert.deepEqual(comparison.rows[0], { equal: true, different: false, invalid_length: false });

      const connection = await runtime.connect();
      try {
        await connection.query('BEGIN');
        await assert.rejects(connection.query('SELECT * FROM app_private.identities'), error => error?.code === '42501');
        await connection.query('ROLLBACK');
        await connection.query('BEGIN');
        await assert.rejects(
          connection.query("INSERT INTO app.users (id, public_alias) VALUES ($1, 'No permitido')", [randomUUID()]),
          error => error?.code === '42501'
        );
        await connection.query('ROLLBACK');
        await connection.query('BEGIN');
        const link = requestInput();
        const runtimeRepository = createAuthRepository(connection);
        assert.deepEqual(await runtimeRepository.requestMagicLink(link), { accepted: true });
        await connection.query('ROLLBACK');
      } finally { connection.release(); }
    });

    await t.test('idempotencia repite, conflicto falla y el token solo se consume una vez', async () => {
      const link = requestInput();
      assert.deepEqual(await repository.requestMagicLink(link), { accepted: true });
      assert.deepEqual(await repository.requestMagicLink(link), { accepted: true });
      const counts = await owner.query(`
        SELECT
          (SELECT count(*)::integer FROM app_private.email_verifications WHERE id = $1) AS links,
          (SELECT count(*)::integer FROM app_private.outbox_events WHERE id = $2) AS outbox
      `, [link.verificationId, link.outboxId]);
      assert.deepEqual(counts.rows[0], { links: 1, outbox: 1 });

      const conflictingLink = requestInput({
        idempotencyKey: link.idempotencyKey,
        globalHash: link.globalHash
      });
      assert.notDeepEqual(conflictingLink.emailHash, link.emailHash);
      await owner.query('SAVEPOINT idempotency_conflict');
      await assert.rejects(
        repository.requestMagicLink(conflictingLink),
        error => error.code === 'IDEMPOTENCY_CONFLICT' && error.status === 409
      );
      await owner.query('ROLLBACK TO SAVEPOINT idempotency_conflict');
      await owner.query('RELEASE SAVEPOINT idempotency_conflict');

      const verification = verifyInput(link);
      const first = await repository.verifyMagicLink(verification);
      assert.equal(first.outcome, 'authenticated');
      assert.equal(first.authenticated, true);
      assert.equal(first.user_version, '1');
      assert.deepEqual(first.roles, ['collaborator']);
      const audit = await owner.query(`
        SELECT action, details FROM app_private.audit_events
        WHERE request_id = $1 ORDER BY id
      `, [verification.requestId]);
      assert.deepEqual(audit.rows.map(row => row.action), [
        'auth.email_verified', 'auth.role_assigned', 'auth.session_created'
      ]);
      assert.deepEqual(audit.rows[1].details, { role: 'collaborator' });
      assert.deepEqual(audit.rows[2].details, { roles: ['collaborator'] });
      assert.doesNotMatch(JSON.stringify(audit.rows.map(row => row.details)), /email|token|network|ip/i);
      const consumedOutbox = await owner.query('SELECT status FROM app_private.outbox_events WHERE verification_id = $1', [link.verificationId]);
      assert.deepEqual(consumedOutbox.rows[0], { status: 'cancelled' });
      const replay = await repository.verifyMagicLink({ ...verification, sessionId: randomUUID(), sessionTokenHash: randomBytes(32) });
      assert.equal(replay.outcome, 'invalid');
      assert.equal(replay.authenticated, false);
    });

    await t.test('hash erróneo suma cinco intentos y revoca sin revelar estado', async () => {
      const link = requestInput();
      await repository.requestMagicLink(link);
      const verification = verifyInput(link, { tokenHash: randomBytes(32) });
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const result = await repository.verifyMagicLink(verification);
        assert.equal(result.outcome, 'invalid');
      }
      const row = await owner.query('SELECT attempts, revoked_at IS NOT NULL AS revoked FROM app_private.email_verifications WHERE id = $1', [link.verificationId]);
      assert.deepEqual(row.rows[0], { attempts: 5, revoked: true });
      const outbox = await owner.query('SELECT status FROM app_private.outbox_events WHERE verification_id = $1', [link.verificationId]);
      assert.deepEqual(outbox.rows[0], { status: 'cancelled' });
    });

    await t.test('límites por correo, red, reserva global y verificación son persistentes', async () => {
      const emailHash = randomBytes(32);
      const ipHash = randomBytes(32);
      const globalHash = randomBytes(32);
      for (let index = 0; index < 4; index += 1) {
        const result = await repository.requestMagicLink(requestInput({ emailHash, ipHash, globalHash }));
        assert.deepEqual(result, { accepted: true });
      }
      const counters = await owner.query(`
        SELECT operation, hits FROM app_private.rate_limit_buckets
        WHERE identity_hash = $1 OR identity_hash = $2 OR identity_hash = $3
        ORDER BY operation
      `, [emailHash, ipHash, globalHash]);
      assert.deepEqual(Object.fromEntries(counters.rows.map(row => [row.operation, row.hits])), {
        'auth.request_link.email': 4,
        'auth.request_link.global': 3,
        'auth.request_link.network': 4
      });
      const outboxStates = await owner.query(`
        SELECT outbox.status, count(*)::integer AS total
        FROM app_private.outbox_events outbox
        JOIN app_private.email_verifications verification ON verification.id = outbox.verification_id
        WHERE verification.normalized_email_hash = $1
        GROUP BY outbox.status
        ORDER BY outbox.status
      `, [emailHash]);
      assert.deepEqual(Object.fromEntries(outboxStates.rows.map(row => [row.status, row.total])), {
        cancelled: 2,
        pending: 1
      });

      const networkHash = randomBytes(32);
      const networkGlobal = randomBytes(32);
      for (let index = 0; index < 10; index += 1) {
        assert.deepEqual(await repository.requestMagicLink(requestInput({ ipHash: networkHash, globalHash: networkGlobal })), { accepted: true });
      }
      const networkLimited = await repository.requestMagicLink(requestInput({ ipHash: networkHash, globalHash: networkGlobal }));
      assert.equal(networkLimited.outcome, 'rate_limited');
      assert.equal(networkLimited.retry_after, 3600);
      const globalCounter = await owner.query("SELECT hits FROM app_private.rate_limit_buckets WHERE operation = 'auth.request_link.global' AND identity_hash = $1", [networkGlobal]);
      assert.equal(globalCounter.rows[0].hits, 10);

      const saturatedGlobal = randomBytes(32);
      for (let index = 0; index < 250; index += 1) {
        await owner.query("SELECT app_private.consume_rate_limit('auth.request_link.global', $1, 86400, 250)", [saturatedGlobal]);
      }
      const globalLimited = await repository.requestMagicLink(requestInput({ globalHash: saturatedGlobal }));
      assert.equal(globalLimited.outcome, 'capacity_exhausted');
      assert.equal(globalLimited.retry_after, 86400);

      const verifyNetwork = randomBytes(32);
      for (let index = 0; index < 20; index += 1) {
        await owner.query("SELECT app_private.consume_rate_limit('auth.verify.network', $1, 900, 20)", [verifyNetwork]);
      }
      const verifyLimited = await repository.verifyMagicLink(verifyInput(requestInput(), { ipHash: verifyNetwork }));
      assert.equal(verifyLimited.outcome, 'rate_limited');
    });

    await t.test('caducado, revocado y cuenta suspendida tienen outcomes definidos', async () => {
      for (const state of ['expired', 'revoked']) {
        const link = requestInput();
        await directVerification(owner, link, state === 'expired'
          ? { createdAt: new Date(Date.now() - 20 * 60_000), expiresAt: new Date(Date.now() - 5 * 60_000) }
          : { revokedAt: new Date() });
        const result = await repository.verifyMagicLink(verifyInput(link));
        assert.equal(result.outcome, 'invalid');
      }

      const initial = requestInput();
      await directVerification(owner, initial);
      const created = await repository.verifyMagicLink(verifyInput(initial));
      await owner.query("UPDATE app.users SET status = 'suspended' WHERE id = $1", [created.user_id]);
      const second = requestInput({ emailHash: initial.emailHash });
      await directVerification(owner, second);
      const denied = await repository.verifyMagicLink(verifyInput(second));
      assert.equal(denied.outcome, 'account_unavailable');
      assert.equal(denied.authenticated, false);
    });

    await t.test('sexta sesión revoca la más antigua y touch escribe como máximo cada cinco minutos', async () => {
      const firstLink = requestInput();
      await directVerification(owner, firstLink);
      const firstInput = verifyInput(firstLink);
      const first = await repository.verifyMagicLink(firstInput);
      const userId = first.user_id;
      const sessions = [{ id: first.session_id, tokenHash: firstInput.sessionTokenHash }];
      for (let index = 0; index < 5; index += 1) {
        const link = requestInput({ emailHash: firstLink.emailHash });
        await directVerification(owner, link);
        const input = verifyInput(link, { userId });
        const created = await repository.verifyMagicLink(input);
        assert.equal(created.outcome, 'authenticated');
        sessions.push({ id: created.session_id, tokenHash: input.sessionTokenHash });
      }
      const state = await owner.query(`
        SELECT id, revoked_at IS NULL AS active, revoke_reason
        FROM app_private.sessions WHERE user_id = $1 ORDER BY created_at, id
      `, [userId]);
      assert.equal(state.rows.length, 6);
      assert.equal(state.rows.filter(row => row.active).length, 5);
      assert.equal(state.rows.filter(row => row.revoke_reason === 'session_limit').length, 1);
      const limitAudit = await owner.query(`
        SELECT resource_id, details FROM app_private.audit_events
        WHERE actor_id = $1 AND action = 'auth.session_revoked' AND details->>'reason' = 'session_limit'
      `, [userId]);
      assert.equal(limitAudit.rows.length, 1);
      assert.equal(state.rows.some(row => row.id === limitAudit.rows[0].resource_id && row.revoke_reason === 'session_limit'), true);

      const activeSession = sessions.find(item => state.rows.some(row => row.id === item.id && row.active));
      const before = await owner.query('SELECT last_seen_at FROM app_private.sessions WHERE id = $1', [activeSession.id]);
      assert.ok(await repository.authenticate(activeSession.tokenHash));
      const unchanged = await owner.query('SELECT last_seen_at FROM app_private.sessions WHERE id = $1', [activeSession.id]);
      assert.equal(unchanged.rows[0].last_seen_at.getTime(), before.rows[0].last_seen_at.getTime());
      await owner.query("UPDATE app_private.sessions SET last_seen_at = clock_timestamp() - interval '6 minutes' WHERE id = $1", [activeSession.id]);
      assert.ok(await repository.authenticate(activeSession.tokenHash));
      const touched = await owner.query('SELECT last_seen_at FROM app_private.sessions WHERE id = $1', [activeSession.id]);
      assert.ok(touched.rows[0].last_seen_at > new Date(Date.now() - 60_000));
    });

    await t.test('listar y revocar rechazan actor vencido, inactivo o suspendido', async () => {
      const link = requestInput();
      await directVerification(owner, link);
      const input = verifyInput(link);
      const created = await repository.verifyMagicLink(input);
      const actor = created.session_id;
      const target = actor;

      await owner.query(`UPDATE app_private.sessions SET created_at = clock_timestamp() - interval '40 days',
        last_seen_at = clock_timestamp() - interval '8 days', idle_expires_at = clock_timestamp() - interval '2 days',
        expires_at = clock_timestamp() - interval '1 day' WHERE id = $1`, [actor]);
      assert.deepEqual(await repository.listSessions(actor), []);
      assert.equal(await repository.revokeSession(actor, target, randomUUID()), false);

      await owner.query(`UPDATE app_private.sessions SET created_at = clock_timestamp() - interval '1 day',
        last_seen_at = clock_timestamp() - interval '8 days', idle_expires_at = clock_timestamp() - interval '1 minute',
        expires_at = clock_timestamp() + interval '20 days' WHERE id = $1`, [actor]);
      assert.deepEqual(await repository.listSessions(actor), []);
      assert.equal(await repository.revokeSession(actor, target, randomUUID()), false);

      await owner.query(`UPDATE app_private.sessions SET last_seen_at = clock_timestamp(),
        idle_expires_at = clock_timestamp() + interval '7 days' WHERE id = $1`, [actor]);
      await owner.query("UPDATE app.users SET status = 'suspended' WHERE id = $1", [created.user_id]);
      assert.deepEqual(await repository.listSessions(actor), []);
      assert.equal(await repository.revokeSession(actor, target, randomUUID()), false);
    });

    await t.test('rol system no puede asignarse a un usuario', async () => {
      const userId = randomUUID();
      await owner.query("INSERT INTO app.users (id, public_alias) VALUES ($1, 'Ruta-sistema')", [userId]);
      await deniedInSavepoint(owner, 'system_role', "INSERT INTO app.user_roles (user_id, role_code) VALUES ($1, 'system')", [userId]);
    });
  } finally {
    await owner.query('ROLLBACK');
    await owner.end();
    await runtime.end();
  }
});
