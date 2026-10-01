'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createModerationRepository, mapModerationError, SQL } = require('../src/db/repositories/moderation.cjs');
const { decorateContribution } = require('../src/services/contribution-score.cjs');
const { createApp } = require('../src/app.cjs');
const { loadConfig } = require('../src/config.cjs');

test('contrato de moderación usa una transición idempotente parametrizada', () => {
  assert.match(SQL.list, /list_moderation_cases\(\$1::uuid/);
  assert.match(SQL.claim, /claim_moderation_case/);
  assert.match(SQL.decide, /decide_moderation_case/);
  assert.match(SQL.lifecycle, /set_accessibility_lifecycle[\s\S]*\$7::bytea/);
});

test('conflictos, idempotencia y auto-revisión se convierten en errores seguros', () => {
  assert.throws(() => mapModerationError({ code:'40001', message:'moderation_conflict' }), error => error.status===412&&error.code==='MODERATION_CONFLICT');
  assert.throws(() => mapModerationError({ code:'40001', message:'contribution_conflict' }), error => error.status===412&&error.code==='CONTRIBUTION_CONFLICT');
  assert.throws(() => mapModerationError({ code:'23505', message:'idempotency_conflict' }), error => error.status===409&&error.code==='IDEMPOTENCY_CONFLICT');
  assert.throws(() => mapModerationError({ code:'42501', message:'own_contribution_moderation' }), error => error.status===403&&error.code==='OWN_CONTRIBUTION_MODERATION');
});

test('repositorio genera la misma huella para el mismo request y distingue otra acción', async () => {
  const calls=[];const repository=createModerationRepository({query:async(text,values)=>{calls.push({text,values});return{rows:[{id:values[1],lifecycle_status:values[3]==='resolve'?'resolved':'open',version:4}]};}});
  const input={sessionId:randomUUID(),id:randomUUID(),version:3,reason:'  Comprobación presencial  ',requestId:randomUUID()};
  await repository.resolve(input);await repository.resolve(input);await repository.reopen(input);
  assert.deepEqual(calls[0].values[6],calls[1].values[6]);
  assert.notDeepEqual(calls[0].values[6],calls[2].values[6]);
  assert.equal(calls[0].values[4],'Comprobación presencial');
});

test('cola proyecta evidencia accesible sin exponer identificador del autor', async () => {
  const config=loadConfig({NODE_ENV:'test'});const row={id:randomUUID(),contribution_id:randomUUID(),case_status:'claimed',case_version:'2',contribution_version:'7',title:'Paso estrecho',description:'Estructura observable',kind:'barrier',contribution_status:'under_review',zone_name:'Macarena',geometry:'{"type":"Point","coordinates":[-5.99,37.4]}',author_alias:'Ruta-demo',confirmations:'5',rejections:'0',own_claim:true,created_at:new Date(Date.now()-180*86_400_000).toISOString(),updated_at:new Date().toISOString(),condition_type:'narrow_passage',affected_groups:['wheelchair','visual'],observed_on:'2026-09-30',permanence:'permanent',measurement_status:'estimated',clear_width_cm:'82',lifecycle_status:'open',resolved_at:null,personal_data_confirmed:true};
  const authService={authenticate:async()=>({session_id:randomUUID(),user_id:randomUUID(),roles:['administrator']}),csrfFor:()=> 'csrf'};
  const app=createApp({config,logger:false,authService,moderationRepository:{list:async()=>[row]}});
  try{const response=await app.inject({method:'GET',url:'/api/v1/moderation/cases',headers:{host:config.allowedHost,cookie:'rv_session=opaque'}});assert.equal(response.statusCode,200);const item=response.json().data[0];assert.equal(item.ownClaim,true);assert.equal(item.caseVersion,2);assert.equal(item.contributionVersion,7);assert.equal(item.conditionType,'narrow_passage');assert.deepEqual(item.affectedGroups,['wheelchair','visual']);assert.equal(item.clearWidthCm,82);assert.equal(item.personalDataConfirmed,true);assert.deepEqual(item.confidence,decorateContribution(row).confidence);assert.equal(Object.hasOwn(item,'author_id'),false);}finally{await app.close();}
});

test('resolver y reabrir exigen Idempotency-Key y trasladan versión, motivo y clave', async () => {
  const config=loadConfig({NODE_ENV:'test'});const received=[];const moderationRepository={resolve:async input=>{received.push(input);return{id:input.id,lifecycle_status:'resolved',version:4};},reopen:async input=>{received.push(input);return{id:input.id,lifecycle_status:'open',version:5};}};
  const authService={authenticate:async()=>({session_id:randomUUID(),user_id:randomUUID(),roles:['moderator']}),csrfFor:()=> 'csrf'};const app=createApp({config,logger:false,authService,moderationRepository});
  const baseHeaders={host:config.allowedHost,origin:config.publicOrigin,cookie:'rv_session=opaque','x-csrf-token':'csrf','content-type':'application/json'};const id=randomUUID();
  try{
    const missing=await app.inject({method:'POST',url:`/api/v1/moderation/contributions/${id}/resolve`,headers:baseHeaders,payload:{version:3,reason:'Retirada en comprobación presencial'}});assert.equal(missing.statusCode,422);
    for(const [action,version] of [['resolve',3],['reopen',4]]){const key=randomUUID();const response=await app.inject({method:'POST',url:`/api/v1/moderation/contributions/${id}/${action}`,headers:{...baseHeaders,'idempotency-key':key},payload:{version,reason:'Comprobación presencial documentada'}});assert.equal(response.statusCode,200);assert.equal(received.at(-1).requestId,key);assert.equal(received.at(-1).action,action);}
    assert.equal(received.length,2);
  }finally{await app.close();}
});
