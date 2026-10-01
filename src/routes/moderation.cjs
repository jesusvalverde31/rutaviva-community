'use strict';

const { AppError } = require('../errors.cjs');
const { requireCsrf } = require('../plugins/session.cjs');
const { scoreContributionRow } = require('../services/contribution-score.cjs');

const idParams = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } };
const listQuery = { type: 'object', additionalProperties: false, properties: { status: { type: 'string', enum: ['pending', 'claimed', 'resolved'] }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 } } };
const versionBody = { type: 'object', additionalProperties: false, required: ['version'], properties: { version: { type: 'integer', minimum: 1 } } };
const decisionBody = { type: 'object', additionalProperties: false, required: ['version', 'reason'], properties: { version: { type: 'integer', minimum: 1 }, reason: { type: 'string', minLength: 3, maxLength: 300 } } };
const idempotencyHeaders = { type: 'object', required: ['idempotency-key'], properties: { 'idempotency-key': { type: 'string', format: 'uuid' } } };

function moderationRoutes(app, options) {
  const { repository, authService, config } = options;
  const requireRepository = () => { if (!repository) throw new AppError(503, 'MODERATION_UNAVAILABLE', 'La moderación no está disponible temporalmente.'); };
  const auth = request => requireCsrf(request, config, authService);
  app.get('/api/v1/moderation/cases', { schema: { querystring: listQuery } }, async request => {
    requireRepository();
    if (!request.auth) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Debes iniciar sesión.');
    const rows = await repository.list({ sessionId: request.auth.session_id, ...request.query });
    return { data: rows.map(row => { const confirmations=Number(row.confirmations),rejections=Number(row.rejections);return {
      ...row, caseVersion:Number(row.case_version), contributionVersion:Number(row.contribution_version), confirmations, rejections,
      ownClaim:row.own_claim===true, confidence:scoreContributionRow(row), geometry:JSON.parse(row.geometry),
      conditionType:row.condition_type, affectedGroups:row.affected_groups||[], observedOn:row.observed_on,
      measurementStatus:row.measurement_status, clearWidthCm:row.clear_width_cm===null?null:Number(row.clear_width_cm),
      lifecycle:row.lifecycle_status, resolvedAt:row.resolved_at, personalDataConfirmed:row.personal_data_confirmed===true
    }; }), requestId: request.id };
  });
  app.post('/api/v1/moderation/cases/:id/claim', { schema: { params: idParams, body: versionBody } }, async request => {
    requireRepository(); const actor = auth(request);
    const result = await repository.claim({ sessionId: actor.session_id, id: request.params.id, version: request.body.version, requestId: request.id });
    return { moderationCase: { ...result, version: Number(result.version) }, requestId: request.id };
  });
  for (const decision of ['publish', 'reject']) app.post(`/api/v1/moderation/cases/:id/${decision}`, { schema: { params: idParams, body: decisionBody } }, async request => {
    requireRepository(); const actor = auth(request);
    const result = await repository.decide({ sessionId: actor.session_id, id: request.params.id, version: request.body.version, decision: decision === 'publish' ? 'published' : 'rejected', reason: request.body.reason, requestId: request.id });
    return { moderationCase: { ...result, version: Number(result.version) }, requestId: request.id };
  });
  for (const action of ['resolve','reopen']) app.post(`/api/v1/moderation/contributions/:id/${action}`, { schema: { params: idParams, headers: idempotencyHeaders, body: decisionBody } }, async request => {
    requireRepository(); const actor = auth(request);
    const operation = repository[action] || repository.lifecycle;
    const result = await operation({ sessionId:actor.session_id, id:request.params.id, version:request.body.version, reason:request.body.reason, action, requestId:request.headers['idempotency-key'] });
    return { contribution: { ...result, version:Number(result.version) }, requestId:request.id };
  });
}

module.exports = { idempotencyHeaders, moderationRoutes };
