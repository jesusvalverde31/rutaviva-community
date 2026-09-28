'use strict';

const { AppError } = require('../../errors.cjs');

const SQL = Object.freeze({
  list: 'SELECT * FROM app_private.list_moderation_cases($1::uuid,$2::text,$3::integer)',
  claim: 'SELECT * FROM app_private.claim_moderation_case($1::uuid,$2::uuid,$3::bigint,$4::uuid)',
  decide: 'SELECT * FROM app_private.decide_moderation_case($1::uuid,$2::uuid,$3::bigint,$4::text,$5::text,$6::uuid)'
});

function mapModerationError(error) {
  if (error?.code === '42501' && error?.message === 'own_contribution_moderation') throw new AppError(403, 'OWN_CONTRIBUTION_MODERATION', 'No puedes revisar tu propia aportación.');
  if (error?.code === '42501') throw new AppError(403, 'MODERATION_REQUIRED', 'No tienes permiso de moderación.');
  if (error?.code === '40001' || error?.message === 'moderation_conflict') throw new AppError(412, 'MODERATION_CONFLICT', 'Otro moderador actualizó este caso.');
  if (error?.code === '22023') throw new AppError(422, 'MODERATION_INVALID', 'Revisa la decisión y su motivo.');
  throw new AppError(503, 'MODERATION_UNAVAILABLE', 'La moderación no está disponible temporalmente.');
}

function createModerationRepository(database) {
  const query = async (sql, values) => {
    try { return (await database.query(sql, values)).rows; } catch (error) { return mapModerationError(error); }
  };
  return {
    list: input => query(SQL.list, [input.sessionId, input.status || null, input.limit || 50]),
    claim: input => query(SQL.claim, [input.sessionId, input.id, input.version, input.requestId]).then(rows => rows[0]),
    decide: input => query(SQL.decide, [input.sessionId, input.id, input.version, input.decision, input.reason, input.requestId]).then(rows => rows[0])
  };
}

module.exports = { SQL, createModerationRepository, mapModerationError };
