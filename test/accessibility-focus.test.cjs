'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createApp } = require('../src/app.cjs');
const { loadConfig } = require('../src/config.cjs');
const { decorateContribution } = require('../src/services/contribution-score.cjs');
const { contributionEffect, segmentPolicy } = require('../src/services/route-engine.cjs');

const root = path.resolve(__dirname, '..');
const details = { conditionType:'narrow_passage',affectedGroups:['wheelchair','visual'],observedOn:'2026-09-30',permanence:'permanent',measurementStatus:'unmeasured',clearWidthCm:null,personalDataConfirmed:true };

function appWith(repository) {
  const config=loadConfig({NODE_ENV:'test'});
  const authService={authenticate:async()=>({session_id:randomUUID(),user_id:randomUUID(),roles:['collaborator']}),csrfFor:()=> 'csrf'};
  return { app:createApp({config,logger:false,authService,contributionsRepository:repository}),config };
}

test('taxonomía de accesibilidad queda alineada en API, formulario y migración',()=>{
  const route=fs.readFileSync(path.join(root,'src/routes/contributions.cjs'),'utf8');
  const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
  const migration=fs.readFileSync(path.join(root,'migrations/021_accessibility_focus.sql'),'utf8');
  for(const value of ['narrow_passage','step_or_curb','damaged_surface','difficult_slope','orientation','crossing','temporary_block','poor_lighting','favorable_segment','other']){
    assert.ok(route.includes(value));assert.ok(html.includes(value));assert.ok(migration.includes(value));
  }
});

test('API acepta una observación estructurada y la entrega al repositorio',async()=>{
  let received;const repository={list:async()=>[],activity:async()=>[],create:async input=>{received=input;return{id:input.id,status:'draft',version:1};}};
  const {app,config}=appWith(repository);try{const response=await app.inject({method:'POST',url:'/api/v1/contributions',headers:{host:config.allowedHost,origin:config.publicOrigin,cookie:'rv_session=opaque','x-csrf-token':'csrf','idempotency-key':randomUUID()},payload:{cityId:randomUUID(),kind:'barrier',title:'Paso estrecho observado',geometry:{type:'Point',coordinates:[-5.99,37.39]},...details}});assert.equal(response.statusCode,201);assert.deepEqual(received.affectedGroups,['wheelchair','visual']);assert.equal(received.personalDataConfirmed,true);}finally{await app.close();}
});

test('API exige confirmación de privacidad cuando recibe datos de accesibilidad',async()=>{
  const {app,config}=appWith({list:async()=>[],activity:async()=>[],create:async()=>{throw new Error('no debe crear');}});try{const response=await app.inject({method:'POST',url:'/api/v1/contributions',headers:{host:config.allowedHost,origin:config.publicOrigin,cookie:'rv_session=opaque','x-csrf-token':'csrf','idempotency-key':randomUUID()},payload:{cityId:randomUUID(),kind:'barrier',title:'Paso estrecho observado',geometry:{type:'Point',coordinates:[-5.99,37.39]},...details,personalDataConfirmed:false}});assert.equal(response.statusCode,422);assert.equal(response.json().code,'ACCESSIBILITY_DETAILS_REQUIRED');}finally{await app.close();}
});

test('solo el atajo histórico conserva el cuerpo antiguo sin detalles',async()=>{
  const {app,config}=appWith({list:async()=>[],activity:async()=>[],createLegacy:async()=>{throw new Error('no debe crear');}});try{const response=await app.inject({method:'POST',url:'/api/v1/contributions',headers:{host:config.allowedHost,origin:config.publicOrigin,cookie:'rv_session=opaque','x-csrf-token':'csrf','idempotency-key':randomUUID()},payload:{cityId:randomUUID(),kind:'barrier',title:'Barrera sin detalles',geometry:{type:'Point',coordinates:[-5.99,37.39]}}});assert.equal(response.statusCode,422);assert.equal(response.json().code,'ACCESSIBILITY_DETAILS_REQUIRED');}finally{await app.close();}
});

test('API rechaza anchura declarada como no medida',async()=>{
  const {app,config}=appWith({list:async()=>[],activity:async()=>[],create:async()=>{throw new Error('no debe crear');}});try{const response=await app.inject({method:'POST',url:'/api/v1/contributions',headers:{host:config.allowedHost,origin:config.publicOrigin,cookie:'rv_session=opaque','x-csrf-token':'csrf','idempotency-key':randomUUID()},payload:{cityId:randomUUID(),kind:'barrier',title:'Paso estrecho observado',geometry:{type:'Point',coordinates:[-5.99,37.39]},...details,clearWidthCm:80}});assert.equal(response.statusCode,422);assert.equal(response.json().code,'MEASUREMENT_INVALID');}finally{await app.close();}
});

test('API rechaza combinaciones incoherentes de condición, clase y geometría',async()=>{
  const {app,config}=appWith({list:async()=>[],activity:async()=>[],create:async()=>{throw new Error('no debe crear');}});const headers={host:config.allowedHost,origin:config.publicOrigin,cookie:'rv_session=opaque','x-csrf-token':'csrf','idempotency-key':randomUUID()};
  try{for(const payload of [
    {kind:'accessible',conditionType:'narrow_passage',geometry:{type:'LineString',coordinates:[[-5.99,37.39],[-5.98,37.39]]}},
    {kind:'barrier',conditionType:'poor_lighting',geometry:{type:'Point',coordinates:[-5.99,37.39]}},
    {kind:'closure',conditionType:'temporary_block',geometry:{type:'LineString',coordinates:[[-5.99,37.39],[-5.98,37.39]]}}
  ]){const response=await app.inject({method:'POST',url:'/api/v1/contributions',headers,payload:{cityId:randomUUID(),title:'Condición incoherente',...details,...payload}});assert.equal(response.statusCode,422);assert.equal(response.json().code,'ACCESSIBILITY_COMBINATION_INVALID');}}
  finally{await app.close();}
});

test('PATCH de borrador traslada todos los campos estructurados con esquema cerrado',async()=>{
  let received;const {app,config}=appWith({list:async()=>[],activity:async()=>[],update:async input=>{received=input;return{id:input.id,status:'draft',version:2};}});const id=randomUUID();
  try{const response=await app.inject({method:'PATCH',url:`/api/v1/contributions/${id}`,headers:{host:config.allowedHost,origin:config.publicOrigin,cookie:'rv_session=opaque','x-csrf-token':'csrf','content-type':'application/json'},payload:{version:1,kind:'barrier',title:'Paso estrecho corregido',description:'Observación corregida',geometry:{type:'Point',coordinates:[-5.99,37.39]},...details,measurementStatus:'estimated',clearWidthCm:82}});assert.equal(response.statusCode,200);assert.equal(received.conditionType,'narrow_passage');assert.equal(received.kind,'barrier');assert.equal(received.clearWidthCm,82);const partial=await app.inject({method:'PATCH',url:`/api/v1/contributions/${id}`,headers:{host:config.allowedHost,origin:config.publicOrigin,cookie:'rv_session=opaque','x-csrf-token':'csrf','content-type':'application/json'},payload:{version:1,title:'Paso estrecho corregido',geometry:{type:'Point',coordinates:[-5.99,37.39]},measurementStatus:'measured'}});assert.equal(partial.statusCode,422);assert.equal(partial.json().code,'ACCESSIBILITY_DETAILS_REQUIRED');}finally{await app.close();}
});

test('filtros combinados se parametrizan sin interpolación',async()=>{
  let input;const {app,config}=appWith({list:async value=>{input=value;return[];},activity:async()=>[]});try{const response=await app.inject({method:'GET',url:'/api/v1/contributions?conditionType=narrow_passage&lifecycle=open&affectedGroup=visual&q=metal',headers:{host:config.allowedHost}});assert.equal(response.statusCode,200);assert.equal(input.conditionType,'narrow_passage');assert.equal(input.lifecycle,'open');assert.equal(input.affectedGroup,'visual');}finally{await app.close();}
});

test('decoración pública expone evidencia y conserva valores por defecto históricos',()=>{
  const current=decorateContribution({id:'1',title:'Paso',description:'',kind:'barrier',status:'published',geometry:'{"type":"Point","coordinates":[0,0]}',version:1,condition_type:'narrow_passage',affected_groups:['visual'],measurement_status:'measured',lifecycle_status:'open'});
  assert.equal(current.conditionType,'narrow_passage');assert.deepEqual(current.affectedGroups,['visual']);assert.equal(current.measurementStatus,'measured');
  const legacy=decorateContribution({id:'2',title:'Atajo',description:'',kind:'shortcut',status:'published',geometry:'{"type":"Point","coordinates":[0,0]}',version:1});assert.equal(legacy.conditionType,'other');assert.deepEqual(legacy.affectedGroups,[]);
});

test('observación publicada sin medición penaliza pero no excluye',()=>{
  const policy=segmentPolicy({distanceMeters:100,accessibilityStatus:'compatible',lightingStatus:'lit',contributions:[{kind:'barrier',status:'published',measurementStatus:'unmeasured',confidence:.9,lifecycle:'open'}]},'accessible');
  assert.equal(policy.excluded,false);assert.ok(policy.cost>100);assert.match(policy.factors[0].label,/sin medición/);
});

test('la variante conservadora no excluye por comunidad y una resolución deja de afectar',()=>{
  const base={distanceMeters:100,accessibilityStatus:'compatible',lightingStatus:'lit'};
  const measured=segmentPolicy({...base,contributions:[{kind:'barrier',status:'published',measurementStatus:'measured',confidence:.8,lifecycle:'open'}]},'accessible');assert.equal(measured.excluded,false);assert.ok(measured.cost>100);
  assert.equal(segmentPolicy({...base,contributions:[{kind:'barrier',status:'published',measurementStatus:'measured',confidence:.8,lifecycle:'resolved'}]},'accessible').excluded,false);
  assert.equal(contributionEffect({kind:'closure',status:'submitted',measurementStatus:'measured',confidence:1}),null);
  assert.equal(contributionEffect({kind:'barrier',status:'published',measurementStatus:'measured',confidence:1,lifecycleStatus:'resolved'}),null);
});

test('interfaz no incluye fotos y explica estados mediante texto además del color',()=>{
  const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
  assert.doesNotMatch(html,/type="file"/);for(const text of ['Comunicar una barrera','Publicada significa revisada, no certificada','No indica nada sobre ti'])assert.ok(html.includes(text),text);for(const text of ['Observada sin medir','Publicada','Resuelta'])assert.ok(app.includes(text),text);
});
