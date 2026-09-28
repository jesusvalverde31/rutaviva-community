'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { loadConfig } = require('../src/config.cjs');
const { tlsOptions } = require('../src/db/pool.cjs');
const { createAuthRepository } = require('../src/db/repositories/auth.cjs');
const { createOutboxRepository } = require('../src/db/repositories/outbox.cjs');

function encrypted() { return { ciphertext: randomBytes(64), nonce: randomBytes(12), tag: randomBytes(16) }; }
function linkInput() {
  return {
    verificationId: randomUUID(), outboxId: randomUUID(), emailHash: randomBytes(32), ipHash: randomBytes(32), globalHash: randomBytes(32),
    encryptedEmail: encrypted(), tokenHash: randomBytes(32), encryptedOutbox: encrypted(),
    idempotencyKey: `delivery-${randomUUID()}`, requestHash: randomBytes(32), requestId: randomUUID()
  };
}

test('integración real del outbox usa leases, backoff, terminal y rollback', { timeout: 120_000 }, async t => {
  const config = loadConfig();
  assert.equal(config.migrationDatabaseConfigured, true);
  const owner = new Client({
    connectionString: config.migrationDatabaseUrl,
    ssl: tlsOptions(config.databaseSsl, config.databaseCaFile),
    connectionTimeoutMillis: config.databaseConnectTimeoutMs,
    query_timeout: config.databaseQueryTimeoutMs,
    statement_timeout: config.databaseQueryTimeoutMs,
    application_name: 'rutaviva-community-email-integration'
  });
  await owner.connect(); await owner.query('BEGIN');
  const auth = createAuthRepository(owner); const outbox = createOutboxRepository(owner);
  try {
    await t.test('un claim activo no puede reclamarse otra vez y exige token de lease', async () => {
      const link = linkInput(); await auth.requestMagicLink(link);
      const worker = randomUUID(); const lease = randomUUID();
      const first = await outbox.claim(worker, lease, 60);
      assert.equal(first.event_id, link.outboxId); assert.equal(first.delivery_key, link.outboxId); assert.equal(first.attempt, 1);
      assert.equal(await outbox.claim(randomUUID(), randomUUID(), 60), null);
      assert.equal(await outbox.complete(first.event_id, worker, randomUUID(), randomBytes(32), randomUUID()), false);
      assert.equal(await outbox.complete(first.event_id, worker, lease, randomBytes(32), randomUUID()), true);
      assert.equal(await outbox.complete(first.event_id, worker, lease, randomBytes(32), randomUUID()), false);
    });

    await t.test('rechazos 429 aplican backoff y el quinto es terminal', async () => {
      const link = linkInput(); await auth.requestMagicLink(link);
      const worker = randomUUID();
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        await owner.query('UPDATE app_private.outbox_events SET available_at = clock_timestamp() WHERE id = $1', [link.outboxId]);
        const lease = randomUUID(); const claimed = await outbox.claim(worker, lease, 60);
        assert.equal(claimed.attempt, attempt);
        const status = await outbox.fail(claimed.event_id, worker, lease, 'PROVIDER_REJECTED_429', true, randomUUID());
        assert.equal(status, attempt < 5 ? 'pending' : 'failed');
        const state = await owner.query('SELECT status, available_at > clock_timestamp() AS backed_off FROM app_private.outbox_events WHERE id = $1', [link.outboxId]);
        assert.equal(state.rows[0].status, attempt < 5 ? 'pending' : 'failed');
        assert.equal(state.rows[0].backed_off, true);
      }
    });

    await t.test('lease caducado se recupera como resultado ambiguo terminal sin reenviar', async () => {
      const link = linkInput(); await auth.requestMagicLink(link);
      const claimed = await outbox.claim(randomUUID(), randomUUID(), 60);
      assert.equal(claimed.event_id, link.outboxId);
      await owner.query("UPDATE app_private.outbox_events SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1", [link.outboxId]);
      assert.equal(await outbox.claim(randomUUID(), randomUUID(), 60), null);
      const state = await owner.query('SELECT status, last_failure_code, lease_token FROM app_private.outbox_events WHERE id = $1', [link.outboxId]);
      assert.deepEqual(state.rows[0], { status: 'failed', last_failure_code: 'PROVIDER_OUTCOME_UNKNOWN', lease_token: null });
      const audit = await owner.query("SELECT details FROM app_private.audit_events WHERE resource_id = $1 AND action = 'email.delivery_failed'", [link.outboxId]);
      assert.equal(audit.rows.some(row => row.details.failure_code === 'PROVIDER_OUTCOME_UNKNOWN'), true);
    });

    await t.test('verificaciones canceladas no se entregan y se auditan sin PII', async () => {
      const link = linkInput(); await auth.requestMagicLink(link);
      await owner.query('UPDATE app_private.email_verifications SET revoked_at = clock_timestamp() WHERE id = $1', [link.verificationId]);
      assert.equal(await outbox.claim(randomUUID(), randomUUID(), 60), null);
      const state = await owner.query('SELECT status FROM app_private.outbox_events WHERE id = $1', [link.outboxId]);
      assert.equal(state.rows[0].status, 'cancelled');
      const audit = await owner.query("SELECT details FROM app_private.audit_events WHERE resource_id = $1 AND action = 'email.delivery_cancelled'", [link.outboxId]);
      assert.equal(audit.rows.length, 1);
      assert.equal(JSON.stringify(audit.rows[0]).includes('@'), false);
    });
  } finally { await owner.query('ROLLBACK'); await owner.end(); }
});
