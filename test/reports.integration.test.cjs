'use strict';

const { randomBytes, randomUUID } = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { tlsOptions } = require('../src/db/pool.cjs');
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

test('flujo real de reportes conserva el contenido hasta una decisión humana independiente', { timeout: 30_000 }, async t => {
  if (!config.migrationDatabaseConfigured) {
    t.skip('MIGRATION_DATABASE_URL no configurada');
    return;
  }

  const client = new Client({
    connectionString: config.migrationDatabaseUrl,
    ssl: tlsOptions(config.databaseSsl, config.databaseCaFile),
    connectionTimeoutMillis: config.databaseConnectTimeoutMs,
    statement_timeout: config.databaseQueryTimeoutMs,
    application_name: 'rutaviva-content-reports-integration'
  });
  const authorId = randomUUID();
  const publisherId = randomUUID();
  const reporterId = randomUUID();
  const reviewerId = randomUUID();
  const authorSession = randomUUID();
  const publisherSession = randomUUID();
  const reporterSession = randomUUID();
  const reviewerSession = randomUUID();
  const contributionId = randomUUID();
  const reportId = randomUUID();

  try {
    await client.connect();
    await client.query('BEGIN');
    const pilot = await client.query("SELECT id,extensions.ST_AsGeoJSON(center)::jsonb AS geometry FROM app.cities WHERE slug='sevilla'");
    assert.equal(pilot.rowCount, 1);

    await client.query(
      'INSERT INTO app.users(id,public_alias) VALUES($1,$2),($3,$4),($5,$6),($7,$8)',
      [
        authorId, `Autor ${authorId.slice(0, 8)}`,
        publisherId, `Publicador ${publisherId.slice(0, 8)}`,
        reporterId, `Reportante ${reporterId.slice(0, 8)}`,
        reviewerId, `Revisor ${reviewerId.slice(0, 8)}`
      ]
    );
    await client.query(
      "INSERT INTO app.user_roles(user_id,role_code) VALUES($1,'collaborator'),($1,'moderator'),($2,'moderator'),($3,'moderator'),($4,'moderator')",
      [authorId, publisherId, reporterId, reviewerId]
    );
    await client.query(
      "INSERT INTO app_private.sessions(id,user_id,token_hash,idle_expires_at,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 day',clock_timestamp()+interval '7 days'),($4,$5,$6,clock_timestamp()+interval '1 day',clock_timestamp()+interval '7 days'),($7,$8,$9,clock_timestamp()+interval '1 day',clock_timestamp()+interval '7 days'),($10,$11,$12,clock_timestamp()+interval '1 day',clock_timestamp()+interval '7 days')",
      [
        authorSession, authorId, randomBytes(32),
        publisherSession, publisherId, randomBytes(32),
        reporterSession, reporterId, randomBytes(32),
        reviewerSession, reviewerId, randomBytes(32)
      ]
    );

    const created = await client.query(
      'SELECT * FROM app_private.create_contribution($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [authorSession, contributionId, pilot.rows[0].id, null, 'shortcut', 'Paso publicado para reporte', 'Flujo integral reversible', pilot.rows[0].geometry, randomUUID()]
    );
    assert.equal(created.rows[0].status, 'draft');
    await client.query("SELECT * FROM app_private.transition_own_contribution($1,$2,1,'submit',$3)", [authorSession, contributionId, randomUUID()]);
    const claimed = await client.query('SELECT * FROM app_private.claim_moderation_case($1,$2,$3,$4)', [publisherSession, contributionId, 1, randomUUID()]);
    await client.query("SELECT * FROM app_private.decide_moderation_case($1,$2,$3,'published',$4,$5)", [publisherSession, contributionId, Number(claimed.rows[0].version), 'Publicación para comprobar reportes', randomUUID()]);

    const requestHash = randomBytes(32);
    const reportValues = [reporterSession, reportId, contributionId, 'dangerous', 'Requiere comprobación presencial', requestHash, randomUUID()];
    const reportSql = 'SELECT * FROM app_private.create_content_report($1,$2,$3,$4,$5,$6,$7)';
    const report = await client.query(reportSql, reportValues);
    assert.equal(report.rows[0].status, 'pending');
    const reportReplay = await client.query(reportSql, reportValues);
    assert.deepEqual(reportReplay.rows, report.rows);

    const stillPublished = await client.query('SELECT status FROM app.contributions WHERE id=$1', [contributionId]);
    assert.equal(stillPublished.rows[0].status, 'published');
    const visible = await client.query('SELECT id FROM app_private.list_contributions(NULL,NULL,NULL,NULL,100) WHERE id=$1', [contributionId]);
    assert.equal(visible.rowCount, 1);
    await expectSqlState(client, 'duplicate_pending_report', '23505', () => client.query(
      reportSql,
      [reporterSession, randomUUID(), contributionId, 'spam', '', randomBytes(32), randomUUID()]
    ));

    const reporterQueue = await client.query("SELECT * FROM app_private.list_content_reports($1,'pending',100) WHERE id=$2", [reporterSession, reportId]);
    assert.equal(reporterQueue.rowCount, 0);
    const reviewerQueue = await client.query("SELECT * FROM app_private.list_content_reports($1,'pending',100) WHERE id=$2", [reviewerSession, reportId]);
    assert.equal(reviewerQueue.rowCount, 1);
    assert.equal(Object.hasOwn(reviewerQueue.rows[0], 'reporter_id'), false);

    const decisionSql = 'SELECT * FROM app_private.decide_content_report($1,$2,$3,$4,$5,$6,$7,$8)';
    await expectSqlState(client, 'author_report_review', '42501', () => client.query(
      decisionSql,
      [authorSession, reportId, 1, 'resolve', 'Autor no puede revisar', randomUUID(), randomBytes(32), randomUUID()]
    ));
    await expectSqlState(client, 'reporter_report_review', '42501', () => client.query(
      decisionSql,
      [reporterSession, reportId, 1, 'resolve', 'Reportante no puede revisar', randomUUID(), randomBytes(32), randomUUID()]
    ));

    const decisionId = randomUUID();
    const decisionHash = randomBytes(32);
    const decisionValues = [reviewerSession, reportId, 1, 'resolve', 'Riesgo confirmado tras revisión humana', decisionId, decisionHash, randomUUID()];
    const decided = await client.query(decisionSql, decisionValues);
    assert.equal(decided.rows[0].status, 'resolved');
    assert.equal(decided.rows[0].contribution_status, 'withdrawn');
    const historyBeforeReplay = await client.query('SELECT count(*)::integer AS total FROM app_private.contribution_history WHERE contribution_id=$1', [contributionId]);
    const decisionReplay = await client.query(decisionSql, decisionValues);
    assert.deepEqual(decisionReplay.rows, decided.rows);
    const historyAfterReplay = await client.query('SELECT count(*)::integer AS total FROM app_private.contribution_history WHERE contribution_id=$1', [contributionId]);
    assert.equal(historyAfterReplay.rows[0].total, historyBeforeReplay.rows[0].total);
    const noLongerPublic = await client.query('SELECT id FROM app_private.list_contributions(NULL,NULL,NULL,NULL,100) WHERE id=$1', [contributionId]);
    assert.equal(noLongerPublic.rowCount, 0);

    const audit = await client.query("SELECT action,details::text AS details FROM app_private.audit_events WHERE resource_id=$1 AND action='content_report.resolved'", [reportId]);
    assert.equal(audit.rowCount, 1);
    assert.doesNotMatch(audit.rows[0].details, /Riesgo confirmado|reportante|reviewer/i);

    await client.query('ROLLBACK');
    const residue = await client.query('SELECT count(*)::integer AS total FROM app.contributions WHERE id=$1', [contributionId]);
    assert.equal(residue.rows[0].total, 0);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
});
