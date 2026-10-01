'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { createApp } = require('../src/app.cjs');
const { loadConfig } = require('../src/config.cjs');
const { tlsOptions } = require('../src/db/pool.cjs');

const connectionString = process.env.MIGRATION_DATABASE_URL;
const CITY_ID='10000000-0000-4000-8000-000000000001'; const ZONE_ID='20000000-0000-4000-8000-000000000001';

test('red real: publicación, snap, rutas directa/accesible, solape y rollback', { skip:!connectionString, timeout:30_000 }, async()=>{
  const client=new Client({connectionString,ssl:tlsOptions(process.env.DATABASE_SSL!=='false',process.env.DATABASE_CA_FILE||null)});
  await client.connect();
  const releaseId=randomUUID(); const version=`integration-${releaseId}`;
  const ids=Array.from({length:4},()=>randomUUID()); const segmentIds=Array.from({length:4},()=>randomUUID());
  try{
    await client.query('BEGIN');
    await client.query("UPDATE app.network_releases SET status='retired',published_at=NULL WHERE zone_id=$1 AND status='published'",[ZONE_ID]);
    await client.query("INSERT INTO app.network_releases(id,city_id,zone_id,version,source_date,bbox,status,node_count,segment_count,published_at) VALUES($1,$2,$3,$4,current_date,ARRAY[-6.010,37.376,-5.978,37.405]::double precision[],'published',4,4,clock_timestamp())",[releaseId,CITY_ID,ZONE_ID,version]);
    const positions=[[-5.995,37.390],[-5.994,37.390],[-5.993,37.390],[-5.994,37.391]];
    for(let index=0;index<ids.length;index+=1)await client.query('INSERT INTO app.route_nodes(id,city_id,position,is_published,release_id,source_node_id) VALUES($1,$2,extensions.ST_SetSRID(extensions.ST_MakePoint($3,$4),4326),true,$5,$6)',[ids[index],CITY_ID,positions[index][0],positions[index][1],releaseId,-100-index]);
    const edges=[[0,1,'barrier'],[1,2,'barrier'],[0,3,'compatible'],[3,2,'compatible']];
    for(let index=0;index<edges.length;index+=1){const [from,to,status]=edges[index];await client.query(`INSERT INTO app.route_segments(id,city_id,source_node_id,target_node_id,geometry,distance_meters,accessibility_status,lighting_status,is_published,release_id,source_way_id,source_sequence,name)
      VALUES($1,$2,$3,$4,extensions.ST_SetSRID(extensions.ST_MakeLine(extensions.ST_MakePoint($5,$6),extensions.ST_MakePoint($7,$8)),4326),1,$9,'lit',true,$10,$11,$12,$13)`,[segmentIds[index],CITY_ID,ids[from],ids[to],positions[from][0],positions[from][1],positions[to][0],positions[to][1],status,releaseId,-200-index,index,`Tramo ${index+1}`]);}

    const status=await client.query('SELECT * FROM app_private.route_network_status()');
    assert.equal(status.rows[0].release_id,releaseId);
    const rows=await client.query('SELECT * FROM app_private.get_route_network($1,$2,$3,$4,$5)',[-5.995,37.390,-5.993,37.390,75]);
    assert.equal(rows.rows.length,4); assert.ok(rows.rows.every(row=>row.release_id===releaseId));
    const overlaps=await client.query(`SELECT
      app_private.contribution_affects_segment(extensions.ST_GeomFromText('LINESTRING(-5.995 37.390,-5.9945 37.390)',4326),extensions.ST_GeomFromText('LINESTRING(-5.995 37.390,-5.994 37.390)',4326),88) AS substantial,
      app_private.contribution_affects_segment(extensions.ST_GeomFromText('LINESTRING(-5.994 37.3899,-5.994 37.3901)',4326),extensions.ST_GeomFromText('LINESTRING(-5.995 37.390,-5.994 37.390)',4326),88) AS crossing`);
    assert.equal(overlaps.rows[0].substantial,true); assert.equal(overlaps.rows[0].crossing,false);

    const config=loadConfig({NODE_ENV:'test'}); const app=createApp({config,database:client,logger:false,routeRateLimiter:async()=>({allowed:true,retryAfter:0})});
    try{const payload={origin:{longitude:-5.995,latitude:37.390},destination:{longitude:-5.993,latitude:37.390}};const response=await app.inject({method:'POST',url:'/api/v1/routes/search',headers:{host:config.allowedHost,'content-type':'application/json'},payload});assert.equal(response.statusCode,200,response.body);const body=response.json();assert.ok(body.routes.direct.distanceMeters<body.routes.accessible.distanceMeters);assert.equal(body.routes.direct.segments.length,2);assert.equal(body.routes.accessible.segments.length,2);const cached=await app.inject({method:'POST',url:'/api/v1/routes/search',headers:{host:config.allowedHost,'content-type':'application/json'},payload});assert.equal(cached.statusCode,200,cached.body);assert.deepEqual(cached.json().routes,body.routes);}
    finally{await app.close();}
    await client.query('ROLLBACK');
    const residue=await client.query('SELECT count(*)::integer AS count FROM app.network_releases WHERE id=$1',[releaseId]);assert.equal(residue.rows[0].count,0);
  }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}
  finally{await client.end();}
});
