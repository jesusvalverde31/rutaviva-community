'use strict';

const { AppError } = require('../errors.cjs');
const { requireCsrf } = require('../plugins/session.cjs');

const UUID = { type:'string', format:'uuid' };
const idParams = { type:'object', additionalProperties:false, required:['id'], properties:{ id:UUID } };
const reportBody = { type:'object', additionalProperties:false, required:['reason'], properties:{ reason:{ type:'string', enum:['personal_data','abusive','dangerous','spam','other'] }, detail:{ type:'string', maxLength:500, default:'' } } };
const listQuery = { type:'object', additionalProperties:false, properties:{ status:{ type:'string', enum:['pending','resolved','dismissed'], default:'pending' }, limit:{ type:'integer', minimum:1, maximum:100, default:50 } } };
const decisionBody = { type:'object', additionalProperties:false, required:['version','reason'], properties:{ version:{ type:'integer', minimum:1 }, reason:{ type:'string', minLength:3, maxLength:300 } } };
const idempotencyHeaders = { type:'object', required:['idempotency-key'], properties:{ 'idempotency-key':UUID } };

function reportsRoutes(app, options) {
  const { repository, authService, config } = options;
  const available = () => { if (!repository) throw new AppError(503, 'REPORTS_UNAVAILABLE', 'Los reportes no están disponibles temporalmente.'); };
  const auth = request => requireCsrf(request, config, authService);
  app.post('/api/v1/contributions/:id/reports', { schema:{ params:idParams, headers:idempotencyHeaders, body:reportBody } }, async (request, reply) => {
    available(); const actor=auth(request);
    const result=await repository.create({ sessionId:actor.session_id, id:request.headers['idempotency-key'], contributionId:request.params.id, ...request.body, requestId:request.id });
    reply.code(201); return { report:{ id:result.id, status:result.status, version:Number(result.version) }, requestId:request.id };
  });
  app.get('/api/v1/moderation/reports', { schema:{ querystring:listQuery } }, async request => {
    available(); if(!request.auth)throw new AppError(401,'AUTHENTICATION_REQUIRED','Debes iniciar sesión.');
    const rows=await repository.list({ sessionId:request.auth.session_id, ...request.query });
    return { data:rows.map(row=>({ id:row.id, contributionId:row.contribution_id, reason:row.reason, detail:row.detail, status:row.status, version:Number(row.version), contributionVersion:Number(row.contribution_version), title:row.title, createdAt:row.created_at })), requestId:request.id };
  });
  for(const decision of ['dismiss','resolve'])app.post(`/api/v1/moderation/reports/:id/${decision}`, { schema:{ params:idParams, headers:idempotencyHeaders, body:decisionBody } }, async request => {
    available(); const actor=auth(request);
    const result=await repository.decide({ sessionId:actor.session_id, id:request.params.id, version:request.body.version, decision, reason:request.body.reason, requestId:request.headers['idempotency-key'], auditRequestId:request.id });
    return { report:{ id:result.id, status:result.status, version:Number(result.version), contributionStatus:result.contribution_status, contributionVersion:Number(result.contribution_version) }, requestId:request.id };
  });
}

module.exports = { decisionBody, reportBody, reportsRoutes };
