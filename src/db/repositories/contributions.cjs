'use strict';

const { AppError } = require('../../errors.cjs');

const SQL = Object.freeze({
  list: 'SELECT * FROM app_private.list_accessibility_contributions($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::integer)',
  get: 'SELECT * FROM app_private.get_accessibility_contribution($1::uuid,$2::uuid)',
  create: 'SELECT * FROM app_private.create_accessibility_contribution($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,$8::jsonb,$9::text,$10::text[],$11::date,$12::text,$13::text,$14::integer,$15::boolean,$16::uuid)',
  createLegacy: 'SELECT * FROM app_private.create_contribution($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,$8::jsonb,$9::uuid)',
  update: 'SELECT * FROM app_private.update_accessibility_contribution($1::uuid,$2::uuid,$3::bigint,$4::text,$5::text,$6::text,$7::jsonb,$8::text,$9::text[],$10::date,$11::text,$12::text,$13::integer,$14::boolean,$15::uuid)',
  updateLegacy: 'SELECT * FROM app_private.update_contribution($1::uuid,$2::uuid,$3::bigint,$4::text,$5::text,$6::jsonb,$7::uuid)',
  transition: 'SELECT * FROM app_private.transition_own_contribution($1::uuid,$2::uuid,$3::bigint,$4::text,$5::uuid)',
  react: 'SELECT * FROM app_private.set_contribution_reaction($1::uuid,$2::uuid,$3::text,$4::boolean,$5::uuid)',
  activity: 'SELECT * FROM app_private.community_activity()',
  history: 'SELECT * FROM app_private.list_contribution_history($1::uuid,$2::uuid)'
});

function mapContributionError(error) {
  const message = error?.message;
  if (error?.code === '42501' && message === 'authentication_required') throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Debes iniciar sesión.');
  if (error?.code === '42501' && message === 'own_contribution_reaction') throw new AppError(403, 'OWN_CONTRIBUTION_REACTION', 'No puedes responder a tu propia aportación.');
  if (error?.code === '42501' && message === 'history_unavailable') throw new AppError(404, 'CONTRIBUTION_NOT_FOUND', 'No encontramos esa aportación.');
  if (error?.code === '23505' && message === 'idempotency_conflict') throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Ese identificador ya pertenece a otra aportación.');
  if (error?.code === '40001' || message === 'contribution_conflict') throw new AppError(412, 'CONTRIBUTION_CONFLICT', 'La aportación cambió. Recarga antes de continuar.');
  if (error?.code === 'P0001' && message?.includes('rate_limited')) throw new AppError(429, 'RATE_LIMITED', 'Has alcanzado el límite temporal.', { retryAfter: 3600 });
  if (['22023', '23514'].includes(error?.code)) throw new AppError(422, 'CONTRIBUTION_INVALID', 'Revisa los datos y la ubicación de la aportación.');
  throw new AppError(503, 'CONTRIBUTIONS_UNAVAILABLE', 'Las aportaciones no están disponibles temporalmente.');
}

function createContributionsRepository(database) {
  const query = async (sql, values) => {
    try { return (await database.query(sql, values)).rows; } catch (error) { return mapContributionError(error); }
  };
  return {
    list: input => query(SQL.list, [input.sessionId || null, input.q || null, input.status || null, input.kind || null, input.conditionType || null, input.lifecycle || null, input.affectedGroup || null, input.limit || 50]),
    get: input => query(SQL.get, [input.sessionId || null, input.id]).then(rows => rows[0]),
    create: input => query(SQL.create, [input.sessionId, input.id, input.cityId, input.zoneId || null, input.kind, input.title, input.description || '', input.geometry, input.conditionType, input.affectedGroups, input.observedOn, input.permanence, input.measurementStatus, input.clearWidthCm ?? null, input.personalDataConfirmed, input.requestId]).then(rows => rows[0]),
    createLegacy: input => query(SQL.createLegacy, [input.sessionId, input.id, input.cityId, input.zoneId || null, input.kind, input.title, input.description || '', input.geometry, input.requestId]).then(rows => rows[0]),
    update: input => query(SQL.update, [input.sessionId, input.id, input.version, input.kind, input.title, input.description || '', input.geometry, input.conditionType, input.affectedGroups, input.observedOn, input.permanence, input.measurementStatus, input.clearWidthCm ?? null, input.personalDataConfirmed, input.requestId]).then(rows => rows[0]),
    updateLegacy: input => query(SQL.updateLegacy, [input.sessionId, input.id, input.version, input.title, input.description || '', input.geometry, input.requestId]).then(rows => rows[0]),
    transition: input => query(SQL.transition, [input.sessionId, input.id, input.version, input.action, input.requestId]).then(rows => rows[0]),
    react: input => query(SQL.react, [input.sessionId, input.id, input.reaction || null, input.remove === true, input.requestId]).then(rows => rows[0]),
    activity: () => query(SQL.activity, []),
    history: input => query(SQL.history, [input.sessionId || null, input.id])
  };
}

module.exports = { SQL, createContributionsRepository, mapContributionError };
