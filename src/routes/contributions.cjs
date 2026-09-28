'use strict';

const { AppError } = require('../errors.cjs');
const { requireCsrf } = require('../plugins/session.cjs');
const { decorateContribution } = require('../services/contribution-score.cjs');

const UUID = { type: 'string', format: 'uuid' };
const idParams = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: UUID } };
const position = { type: 'array', minItems: 2, maxItems: 2, items: [{ type: 'number', minimum: -180, maximum: 180 }, { type: 'number', minimum: -90, maximum: 90 }], additionalItems: false };
const geometry = { oneOf: [
  { type: 'object', additionalProperties: false, required: ['type', 'coordinates'], properties: { type: { const: 'Point' }, coordinates: position } },
  { type: 'object', additionalProperties: false, required: ['type', 'coordinates'], properties: { type: { const: 'LineString' }, coordinates: { type: 'array', minItems: 2, maxItems: 50, items: position } } }
] };
const contributionBody = {
  type: 'object', additionalProperties: false, required: ['cityId', 'kind', 'title', 'geometry'],
  properties: {
    cityId: UUID, zoneId: { anyOf: [UUID, { type: 'null' }] },
    kind: { type: 'string', enum: ['shortcut', 'accessible', 'barrier', 'closure', 'lighting'] },
    title: { type: 'string', minLength: 5, maxLength: 80 },
    description: { type: 'string', maxLength: 500, default: '' }, geometry
  }
};
const updateBody = {
  type: 'object', additionalProperties: false, required: ['version', 'title', 'geometry'],
  properties: { version: { type: 'integer', minimum: 1 }, title: { type: 'string', minLength: 5, maxLength: 80 }, description: { type: 'string', maxLength: 500, default: '' }, geometry }
};
const versionBody = { type: 'object', additionalProperties: false, required: ['version'], properties: { version: { type: 'integer', minimum: 1 } } };
const reactionBody = { type: 'object', additionalProperties: false, required: ['reaction'], properties: { reaction: { type: 'string', enum: ['confirm', 'reject'] } } };
const listQuery = {
  type: 'object', additionalProperties: false,
  properties: {
    q: { type: 'string', minLength: 1, maxLength: 80 },
    status: { type: 'string', enum: ['draft', 'submitted', 'under_review', 'published', 'rejected', 'withdrawn'] },
    kind: { type: 'string', enum: ['shortcut', 'accessible', 'barrier', 'closure', 'lighting'] },
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 }
  }
};
const createHeaders = { type: 'object', required: ['idempotency-key'], properties: { 'idempotency-key': { type: 'string', format: 'uuid' } } };

function contributionsRoutes(app, options) {
  const { repository, authService, config } = options;
  const requireRepository = () => { if (!repository) throw new AppError(503, 'CONTRIBUTIONS_UNAVAILABLE', 'Las aportaciones no están disponibles temporalmente.'); };
  const auth = request => requireCsrf(request, config, authService);
  const list = async request => {
    requireRepository();
    const rows = await repository.list({ sessionId: request.auth?.session_id, ...request.query });
    return rows.map(decorateContribution);
  };

  app.get('/api/v1/contributions', { schema: { querystring: listQuery } }, async request => ({ data: await list(request), requestId: request.id }));
  app.get('/api/v1/contributions/:id', { schema: { params: idParams } }, async request => {
    requireRepository();
    const row = await repository.get({ sessionId: request.auth?.session_id, id: request.params.id });
    if (!row) throw new AppError(404, 'CONTRIBUTION_NOT_FOUND', 'No encontramos esa aportación.');
    return { contribution: decorateContribution(row), requestId: request.id };
  });
  app.get('/api/v1/contributions/:id/history', { schema: { params: idParams } }, async request => {
    requireRepository();
    const rows = await repository.history({ sessionId: request.auth?.session_id, id: request.params.id });
    return { data: rows.map(row => ({ action: row.action, fromStatus: row.from_status, toStatus: row.to_status, version: Number(row.version), occurredAt: row.occurred_at })), requestId: request.id };
  });
  app.get('/api/v1/community/activity', async request => {
    requireRepository();
    const data = await repository.activity();
    return { data: data.map(row => ({ day: row.day, received: Number(row.received), published: Number(row.published), pending: Number(row.pending) })), requestId: request.id };
  });
  app.post('/api/v1/contributions', { schema: { headers: createHeaders, body: contributionBody } }, async (request, reply) => {
    requireRepository(); const actor = auth(request);
    const result = await repository.create({ sessionId: actor.session_id, id: request.headers['idempotency-key'], ...request.body, requestId: request.id });
    reply.code(201); return { contribution: { id: result.id, status: result.status, version: Number(result.version) }, requestId: request.id };
  });
  app.patch('/api/v1/contributions/:id', { schema: { params: idParams, body: updateBody } }, async request => {
    requireRepository(); const actor = auth(request);
    const result = await repository.update({ sessionId: actor.session_id, id: request.params.id, ...request.body, requestId: request.id });
    return { contribution: { ...result, version: Number(result.version) }, requestId: request.id };
  });
  for (const action of ['submit', 'withdraw']) app.post(`/api/v1/contributions/:id/${action}`, { schema: { params: idParams, body: versionBody } }, async request => {
    requireRepository(); const actor = auth(request);
    const result = await repository.transition({ sessionId: actor.session_id, id: request.params.id, version: request.body.version, action, requestId: request.id });
    return { contribution: { ...result, version: Number(result.version) }, requestId: request.id };
  });
  app.post('/api/v1/contributions/:id/reaction', { schema: { params: idParams, body: reactionBody } }, async request => {
    requireRepository(); const actor = auth(request);
    const result = await repository.react({ sessionId: actor.session_id, id: request.params.id, reaction: request.body.reaction, requestId: request.id });
    return { reaction: { confirmations: Number(result.confirmations), rejections: Number(result.rejections), value: result.my_reaction }, requestId: request.id };
  });
  app.delete('/api/v1/contributions/:id/reaction', { schema: { params: idParams } }, async (request, reply) => {
    requireRepository(); const actor = auth(request);
    await repository.react({ sessionId: actor.session_id, id: request.params.id, remove: true, requestId: request.id });
    reply.code(204).send();
  });
}

module.exports = { contributionBody, contributionsRoutes, geometry, listQuery };
