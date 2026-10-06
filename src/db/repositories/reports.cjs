'use strict';

const { createHash } = require('node:crypto');
const { AppError } = require('../../errors.cjs');

const SQL = Object.freeze({
  create: 'SELECT * FROM app_private.create_content_report($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::bytea,$7::uuid)',
  list: 'SELECT * FROM app_private.list_content_reports($1::uuid,$2::text,$3::integer)',
  decide: 'SELECT * FROM app_private.decide_content_report($1::uuid,$2::uuid,$3::bigint,$4::text,$5::text,$6::uuid,$7::bytea,$8::uuid)'
});

function hash(value) { return createHash('sha256').update(JSON.stringify(value), 'utf8').digest(); }

function mapReportError(error) {
  const message = error?.message;
  if (error?.code === '42501' && message === 'authentication_required') throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Debes iniciar sesión.');
  if (error?.code === '42501' && message === 'report_review_conflict') throw new AppError(403, 'REPORT_REVIEW_CONFLICT', 'No puedes revisar un reporte propio ni uno sobre tu aportación.');
  if (error?.code === '42501') throw new AppError(403, 'MODERATION_REQUIRED', 'No tienes permiso de moderación.');
  if (error?.code === '23505' && message === 'idempotency_conflict') throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Esa clave ya se utilizó con otros datos.');
  if (error?.code === '23505' && message === 'pending_report_exists') throw new AppError(409, 'PENDING_REPORT_EXISTS', 'Ya tienes un reporte pendiente para esta aportación.');
  if (error?.code === '40001' || message === 'report_conflict') throw new AppError(412, 'REPORT_CONFLICT', 'El reporte cambió. Actualiza la cola antes de continuar.');
  if (error?.code === 'P0001' && message === 'report_rate_limited') throw new AppError(429, 'RATE_LIMITED', 'Has alcanzado el límite diario de reportes.', { retryAfter: 3600 });
  if (error?.code === '22023') throw new AppError(422, 'REPORT_INVALID', 'Revisa el motivo y el detalle del reporte.');
  throw new AppError(503, 'REPORTS_UNAVAILABLE', 'Los reportes no están disponibles temporalmente.');
}

function createReportsRepository(database) {
  const query = async (sql, values) => {
    try { return (await database.query(sql, values)).rows; } catch (error) { return mapReportError(error); }
  };
  return {
    create: input => query(SQL.create, [input.sessionId, input.id, input.contributionId, input.reason, input.detail || '', hash({ contributionId:input.contributionId, reason:input.reason, detail:(input.detail || '').trim() }), input.requestId]).then(rows => rows[0]),
    list: input => query(SQL.list, [input.sessionId, input.status || 'pending', input.limit || 50]),
    decide: input => query(SQL.decide, [input.sessionId, input.id, input.version, input.decision, input.reason.trim(), input.requestId, hash({ id:input.id, version:input.version, decision:input.decision, reason:input.reason.trim() }), input.auditRequestId]).then(rows => rows[0])
  };
}

module.exports = { SQL, createReportsRepository, mapReportError };
