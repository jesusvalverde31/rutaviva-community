'use strict';

const { randomBytes, randomUUID } = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { createDatabasePool, tlsOptions } = require('../src/db/pool.cjs');
const { loadConfig } = require('../src/config.cjs');

const config = loadConfig(process.env);

async function expectSqlState(client, name, expectedCode, operation) {
  await client.query(`SAVEPOINT ${name}`);
  let error;
  try {
    await operation();
  } catch (caught) {
    error = caught;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
  await client.query(`RELEASE SAVEPOINT ${name}`);
  assert.ok(error, `La operación ${name} debía fallar`);
  assert.equal(error.code, expectedCode);
}

test('integración comunitaria expone relaciones, funciones y consultas públicas sin persistir', async t => {
  if (!config.databaseConfigured) {
    t.skip('DATABASE_URL no configurada');
    return;
  }
  const pool = createDatabasePool(config);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const relations = await client.query("SELECT to_regclass('app.contributions') AS contributions,to_regclass('app_private.moderation_cases') AS moderation");
    assert.ok(relations.rows[0].contributions);
    assert.ok(relations.rows[0].moderation);
    const functions = await client.query("SELECT to_regprocedure('app_private.list_contributions(uuid,text,text,text,integer)') IS NOT NULL AS list_ready,to_regprocedure('app_private.community_activity()') IS NOT NULL AS activity_ready");
    assert.equal(functions.rows[0].list_ready, true);
    assert.equal(functions.rows[0].activity_ready, true);
    const list = await client.query('SELECT * FROM app_private.list_contributions(NULL,NULL,NULL,NULL,20)');
    assert.ok(Array.isArray(list.rows));
    const activity = await client.query('SELECT * FROM app_private.community_activity()');
    assert.equal(activity.rows.length, 7);
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
});

test('flujo comunitario real es idempotente, moderado, auditado y revierte sus datos', { timeout: 30_000 }, async t => {
  if (!config.migrationDatabaseConfigured) {
    t.skip('MIGRATION_DATABASE_URL no configurada');
    return;
  }

  const client = new Client({
    connectionString: config.migrationDatabaseUrl,
    ssl: tlsOptions(config.databaseSsl, config.databaseCaFile),
    connectionTimeoutMillis: config.databaseConnectTimeoutMs,
    statement_timeout: config.databaseQueryTimeoutMs,
    application_name: 'rutaviva-community-integration-flow'
  });
  const authorId = randomUUID();
  const moderatorId = randomUUID();
  const voterId = randomUUID();
  const authorSession = randomUUID();
  const moderatorSession = randomUUID();
  const voterSession = randomUUID();
  const contributionId = randomUUID();
  const withdrawnId = randomUUID();

  try {
    await client.connect();
    await client.query('BEGIN');

    const pilot = await client.query("SELECT id, extensions.ST_AsGeoJSON(center)::jsonb AS geometry FROM app.cities WHERE slug='sevilla'");
    assert.equal(pilot.rowCount, 1);
    const cityId = pilot.rows[0].id;
    const geometry = pilot.rows[0].geometry;

    await client.query(
      'INSERT INTO app.users (id,public_alias) VALUES ($1,$2),($3,$4),($5,$6)',
      [authorId, `Autor ${authorId.slice(0, 8)}`, moderatorId, `Moderador ${moderatorId.slice(0, 8)}`, voterId, `Vecino ${voterId.slice(0, 8)}`]
    );
    await client.query(
      "INSERT INTO app.user_roles (user_id,role_code) VALUES ($1,'collaborator'),($2,'moderator'),($3,'collaborator')",
      [authorId, moderatorId, voterId]
    );
    await client.query(
      "INSERT INTO app_private.sessions (id,user_id,token_hash,idle_expires_at,expires_at) VALUES ($1,$2,$3,clock_timestamp()+interval '1 day',clock_timestamp()+interval '7 days'),($4,$5,$6,clock_timestamp()+interval '1 day',clock_timestamp()+interval '7 days'),($7,$8,$9,clock_timestamp()+interval '1 day',clock_timestamp()+interval '7 days')",
      [authorSession, authorId, randomBytes(32), moderatorSession, moderatorId, randomBytes(32), voterSession, voterId, randomBytes(32)]
    );

    const createValues = [authorSession, contributionId, cityId, null, 'shortcut', 'Atajo comunitario comprobado', 'Recorrido de prueba integral', geometry, randomUUID()];
    const createSql = 'SELECT * FROM app_private.create_contribution($1,$2,$3,$4,$5,$6,$7,$8,$9)';
    const created = await client.query(createSql, createValues);
    assert.equal(created.rows[0].status, 'draft');
    assert.equal(Number(created.rows[0].version), 1);

    const replay = await client.query(createSql, createValues);
    assert.deepEqual(replay.rows, created.rows);
    await expectSqlState(client, 'idempotency_conflict', '23505', () => client.query(createSql, [...createValues.slice(0, 5), 'Título distinto', ...createValues.slice(6)]));

    const updated = await client.query(
      'SELECT * FROM app_private.update_contribution($1,$2,$3,$4,$5,$6,$7)',
      [authorSession, contributionId, 1, 'Atajo comunitario revisado', 'Descripción revisada sin datos personales', geometry, randomUUID()]
    );
    assert.equal(Number(updated.rows[0].version), 2);
    await expectSqlState(client, 'stale_update', '40001', () => client.query(
      'SELECT * FROM app_private.update_contribution($1,$2,$3,$4,$5,$6,$7)',
      [authorSession, contributionId, 1, 'Cambio obsoleto', '', geometry, randomUUID()]
    ));

    const submitted = await client.query(
      "SELECT * FROM app_private.transition_own_contribution($1,$2,$3,'submit',$4)",
      [authorSession, contributionId, 2, randomUUID()]
    );
    assert.equal(submitted.rows[0].status, 'submitted');
    assert.equal(Number(submitted.rows[0].version), 3);

    const anonymous = await client.query('SELECT id FROM app_private.list_contributions(NULL,NULL,NULL,NULL,100) WHERE id=$1', [contributionId]);
    assert.equal(anonymous.rowCount, 0);
    const ownerView = await client.query('SELECT id,own FROM app_private.list_contributions($1,NULL,NULL,NULL,100) WHERE id=$2', [authorSession, contributionId]);
    assert.equal(ownerView.rows[0].own, true);

    await expectSqlState(client, 'self_moderation', '42501', () => client.query(
      'SELECT * FROM app_private.claim_moderation_case($1,$2,$3,$4)',
      [authorSession, contributionId, 1, randomUUID()]
    ));
    const claimed = await client.query(
      'SELECT * FROM app_private.claim_moderation_case($1,$2,$3,$4)',
      [moderatorSession, contributionId, 1, randomUUID()]
    );
    assert.equal(claimed.rows[0].status, 'claimed');
    assert.equal(Number(claimed.rows[0].version), 2);
    await expectSqlState(client, 'stale_claim', '40001', () => client.query(
      'SELECT * FROM app_private.claim_moderation_case($1,$2,$3,$4)',
      [moderatorSession, contributionId, 1, randomUUID()]
    ));

    const decided = await client.query(
      "SELECT * FROM app_private.decide_moderation_case($1,$2,$3,'published',$4,$5)",
      [moderatorSession, contributionId, 2, 'Validación integral automatizada', randomUUID()]
    );
    assert.equal(decided.rows[0].contribution_status, 'published');

    const reaction = await client.query(
      "SELECT * FROM app_private.set_contribution_reaction($1,$2,'confirm',false,$3)",
      [voterSession, contributionId, randomUUID()]
    );
    assert.equal(Number(reaction.rows[0].confirmations), 1);
    const historyBeforeReplay = await client.query('SELECT count(*)::integer AS total FROM app_private.contribution_history WHERE contribution_id=$1', [contributionId]);
    await client.query(
      "SELECT * FROM app_private.set_contribution_reaction($1,$2,'confirm',false,$3)",
      [voterSession, contributionId, randomUUID()]
    );
    const historyAfterReplay = await client.query('SELECT count(*)::integer AS total FROM app_private.contribution_history WHERE contribution_id=$1', [contributionId]);
    assert.equal(historyAfterReplay.rows[0].total, historyBeforeReplay.rows[0].total);

    const publicView = await client.query('SELECT status FROM app_private.get_contribution(NULL,$1)', [contributionId]);
    assert.equal(publicView.rows[0].status, 'published');
    const publicHistory = await client.query('SELECT * FROM app_private.list_contribution_history(NULL,$1)', [contributionId]);
    assert.ok(publicHistory.rowCount >= 5);
    await expectSqlState(client, 'append_only_history', '55000', () => client.query(
      'UPDATE app_private.contribution_history SET action=action WHERE contribution_id=$1',
      [contributionId]
    ));

    const secondValues = [authorSession, withdrawnId, cityId, null, 'barrier', 'Barrera temporal de prueba', 'Debe resolverse al retirar', geometry, randomUUID()];
    await client.query(createSql, secondValues);
    await client.query("SELECT * FROM app_private.transition_own_contribution($1,$2,1,'submit',$3)", [authorSession, withdrawnId, randomUUID()]);
    const withdrawn = await client.query("SELECT * FROM app_private.transition_own_contribution($1,$2,2,'withdraw',$3)", [authorSession, withdrawnId, randomUUID()]);
    assert.equal(withdrawn.rows[0].status, 'withdrawn');
    const withdrawnCase = await client.query('SELECT status FROM app_private.moderation_cases WHERE contribution_id=$1', [withdrawnId]);
    assert.equal(withdrawnCase.rows[0].status, 'resolved');

    const audit = await client.query("SELECT action,details::text AS details FROM app_private.audit_events WHERE resource_id=$1 AND action='contribution.updated'", [contributionId]);
    assert.equal(audit.rowCount, 1);
    assert.doesNotMatch(audit.rows[0].details, /geometry|coordinates|@/i);

    await client.query('ROLLBACK');
    const residue = await client.query('SELECT count(*)::integer AS total FROM app.contributions WHERE id=ANY($1::uuid[])', [[contributionId, withdrawnId]]);
    assert.equal(residue.rows[0].total, 0);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
});
