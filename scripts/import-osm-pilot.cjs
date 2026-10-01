'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { tlsOptions } = require('../src/db/pool.cjs');

const BBOX = Object.freeze({ south: 37.376, west: -6.010, north: 37.405, east: -5.978 });
const MAX_NODES = 15_000; const MAX_SEGMENTS = 30_000;
const CITY_ID = '10000000-0000-4000-8000-000000000001';
const ZONE_ID = '20000000-0000-4000-8000-000000000001';
const USER_AGENT = 'RutaViva-Community/0.6 (+https://github.com/jesusvalverde31/rutaviva-community)';
const OVERPASS_ENDPOINTS = Object.freeze(['https://z.overpass-api.de/api/interpreter','https://lz4.overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter']);
const OSM_API_ENDPOINT = 'https://api.openstreetmap.org/api/0.6/map';
const ALLOWED_HIGHWAYS = new Set(['footway','path','pedestrian','living_street','residential','service','steps','track','unclassified','tertiary','secondary','primary']);

function deterministicUuid(value) {
  const hex = createHash('sha256').update(String(value)).digest('hex').slice(0, 32).split('');
  hex[12] = '4'; hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  return `${hex.slice(0,8).join('')}-${hex.slice(8,12).join('')}-${hex.slice(12,16).join('')}-${hex.slice(16,20).join('')}-${hex.slice(20).join('')}`;
}

function insideBbox(node) { return node.lat >= BBOX.south && node.lat <= BBOX.north && node.lon >= BBOX.west && node.lon <= BBOX.east; }

function buildOverpassQuery(bbox = BBOX) {
  const { south, west, north, east } = bbox;
  const highways=[...ALLOWED_HIGHWAYS].join('|');
  return `[out:json][timeout:90];way[highway~"^(${highways})$"](${south},${west},${north},${east});(._;>;);out body qt;`;
}

function isWalkable(tags = {}) {
  const majorRoadWithoutFootEvidence = ['primary','secondary','tertiary'].includes(tags.highway) && !tags.sidewalk && !['yes','designated'].includes(tags.foot);
  return ALLOWED_HIGHWAYS.has(tags.highway) && !majorRoadWithoutFootEvidence && !['private','no'].includes(tags.access) && tags.foot !== 'no' && tags.area !== 'yes' && tags.motorroad !== 'yes';
}

function accessibility(tags = {}) {
  const incline = String(tags.incline || '').toLowerCase(); const numericIncline = Number.parseFloat(incline.replace('%',''));
  const steep = ['steep','up','down'].includes(incline) || (Number.isFinite(numericIncline) && Math.abs(numericIncline) > 8);
  const difficultSurface = ['cobblestone','sett','gravel','fine_gravel','sand','ground','unpaved'].includes(tags.surface);
  if (tags.highway === 'steps' || ['no','limited'].includes(tags.wheelchair) || steep || difficultSurface) return 'barrier';
  if (tags.wheelchair === 'yes' || ['yes','designated'].includes(tags.foot) && tags.highway !== 'steps') return 'compatible';
  return 'unknown';
}

function nodePolicy(tags = {}) {
  if (['private','no'].includes(tags.access) || tags.foot === 'no') return { excluded:true, accessibilityStatus:'barrier' };
  if (['stile','turnstile'].includes(tags.barrier)) return { excluded:false, accessibilityStatus:'barrier' };
  if (tags.barrier === 'bollard') return { excluded:false, accessibilityStatus:tags.wheelchair === 'yes' ? 'compatible' : 'barrier' };
  if (tags.barrier === 'gate') return { excluded:false, accessibilityStatus:tags.wheelchair === 'yes' ? 'compatible' : tags.wheelchair === 'no' ? 'barrier' : 'unknown' };
  if (['raised','rolled'].includes(tags.kerb)) return { excluded:false, accessibilityStatus:'barrier' };
  if (['lowered','flush','no'].includes(tags.kerb) || tags.wheelchair === 'yes') return { excluded:false, accessibilityStatus:'compatible' };
  const status = accessibility(tags); return { excluded:false, accessibilityStatus:status === 'unknown' ? 'neutral' : status };
}

function combineAccessibility(wayStatus, ...nodeStatuses) {
  const statuses = [wayStatus, ...nodeStatuses].filter(status => status && status !== 'neutral');
  if (statuses.includes('barrier')) return 'barrier';
  if (statuses.includes('unknown')) return 'unknown';
  return statuses.includes('compatible') ? 'compatible' : 'unknown';
}

function lighting(tags = {}) { return tags.lit === 'yes' ? 'lit' : tags.lit === 'no' ? 'poor' : 'unknown'; }

function haversineMeters(first, second) {
  const radians = value => value * Math.PI / 180; const radius = 6_371_000;
  const deltaLatitude = radians(second.latitude - first.latitude); const deltaLongitude = radians(second.longitude - first.longitude);
  const value = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude)) * Math.sin(deltaLongitude / 2) ** 2;
  return Math.max(0.01, Math.round(2 * radius * Math.asin(Math.sqrt(value)) * 100) / 100);
}

function parseOverpass(payload) {
  if (!payload || !Array.isArray(payload.elements)) throw new Error('OVERPASS_RESPONSE_INVALID');
  const sourceTimestamp = String(payload.osm3s?.timestamp_osm_base || '');
  if (!sourceTimestamp || Number.isNaN(Date.parse(sourceTimestamp))) throw new Error('OSM_TIMESTAMP_INVALID');
  const sourceDate = sourceTimestamp.slice(0, 10);
  const allNodes = new Map(payload.elements.filter(item => item.type === 'node' && Number.isFinite(item.lat) && Number.isFinite(item.lon) && insideBbox(item) && !nodePolicy(item.tags).excluded).map(item => [item.id, { ...item, policy:nodePolicy(item.tags) }]));
  const ways = payload.elements.filter(item => item.type === 'way' && Array.isArray(item.nodes) && item.nodes.length >= 2 && isWalkable(item.tags));
  const requiredNodeIds = new Set(ways.flatMap(way => way.nodes));
  const nodes = [...requiredNodeIds].map(id => allNodes.get(id)).filter(Boolean).map(node => ({ sourceId: node.id, id: deterministicUuid(`osm-node:${sourceTimestamp}:${node.id}`), latitude: node.lat, longitude: node.lon, accessibilityStatus:node.policy.accessibilityStatus }));
  const nodeBySource = new Map(nodes.map(node => [node.sourceId, node])); const segments = [];
  for (const way of ways.sort((a,b) => a.id-b.id)) {
    const tags = way.tags || {}; const footDirection = tags['oneway:foot'];
    for (let index = 0; index < way.nodes.length - 1; index += 1) {
      const source = nodeBySource.get(way.nodes[index]); const target = nodeBySource.get(way.nodes[index + 1]); if (!source || !target) continue;
      const directions = footDirection === 'yes' ? [[source,target,0]] : footDirection === '-1' ? [[target,source,1]] : [[source,target,0],[target,source,1]];
      for (const [from,to,direction] of directions) segments.push({
        id: deterministicUuid(`osm-segment:${sourceTimestamp}:${way.id}:${index}:${direction}`), wayId: way.id, sequence: index * 2 + direction,
        sourceNodeId: from.id, targetNodeId: to.id, name: tags.name || null,
        distanceMeters: haversineMeters(from, to),
        accessibilityStatus: combineAccessibility(accessibility(tags), source.accessibilityStatus, target.accessibilityStatus), lightingStatus: lighting(tags),
        coordinates: [[from.longitude,from.latitude],[to.longitude,to.latitude]]
      });
    }
  }
  if (nodes.length < 2 || !segments.length) throw new Error('OSM_NETWORK_EMPTY');
  if (nodes.length > MAX_NODES || segments.length > MAX_SEGMENTS) throw new Error(`OSM_NETWORK_LIMIT_EXCEEDED_${nodes.length}_NODES_${segments.length}_SEGMENTS`);
  return { nodes, segments, sourceDate, sourceTimestamp };
}

function retryAfterMilliseconds(response, now = Date.now()) {
  const raw = response.headers?.get?.('retry-after'); const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(30_000, seconds * 1000);
  const dateValue = Date.parse(raw); return Number.isFinite(dateValue) ? Math.max(30_000, dateValue - now) : 30_000;
}

async function fetchOverpass(fetchImpl = fetch, options = {}) {
  const endpoints = options.endpoint ? [options.endpoint] : (options.endpoints || OVERPASS_ENDPOINTS); const attempts = options.attempts || endpoints.length;
  const delay = options.delay || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))); const now = options.now || Date.now;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const endpoint=endpoints[(attempt-1)%endpoints.length];
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), options.timeoutMs || 120_000);
    try {
      const response = await fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', 'user-agent': USER_AGENT }, body: new URLSearchParams({ data: buildOverpassQuery(options.bbox || BBOX) }), signal: controller.signal });
      if (!response.ok) { const error = new Error(`OVERPASS_HTTP_${response.status}`); error.status = response.status; error.retryAfterMs = response.status === 429 ? retryAfterMilliseconds(response, now()) : 0; throw error; }
      return await response.json();
    } catch (error) {
      const terminalClientError = Number.isInteger(error.status) && error.status >= 400 && error.status < 500 && error.status !== 429;
      if (attempt === attempts || terminalClientError) throw error;
      await delay(error.status === 429 ? error.retryAfterMs : attempt * 1000);
    } finally { clearTimeout(timer); }
  }
  throw new Error('OVERPASS_UNAVAILABLE');
}

function overpassTiles(bbox = BBOX, divisions = 4) {
  const tiles=[];const latitudeStep=(bbox.north-bbox.south)/divisions;const longitudeStep=(bbox.east-bbox.west)/divisions;
  for(let row=0;row<divisions;row+=1)for(let column=0;column<divisions;column+=1)tiles.push({south:bbox.south+latitudeStep*row,west:bbox.west+longitudeStep*column,north:row===divisions-1?bbox.north:bbox.south+latitudeStep*(row+1),east:column===divisions-1?bbox.east:bbox.west+longitudeStep*(column+1)});
  return tiles;
}

function mergeOverpassPayloads(payloads, options = {}) {
  if (!payloads.length) throw new Error('OVERPASS_RESPONSE_INVALID');
  const timestamps=payloads.map(payload=>String(payload?.osm3s?.timestamp_osm_base||''));
  if(timestamps.some(timestamp=>Number.isNaN(Date.parse(timestamp))))throw new Error('OSM_TIMESTAMP_INVALID');
  const earliest=Math.min(...timestamps.map(Date.parse));const latest=Math.max(...timestamps.map(Date.parse));
  if(latest-earliest>6*60*60*1000)throw new Error('OSM_SNAPSHOT_INCONSISTENT');
  const now=options.now||Date.now;if(now()-latest>7*24*60*60*1000)throw new Error('OSM_SNAPSHOT_STALE');
  const elements=new Map();for(const payload of payloads){if(!Array.isArray(payload.elements))throw new Error('OVERPASS_RESPONSE_INVALID');for(const item of payload.elements)elements.set(`${item.type}:${item.id}`,item);}
  return{osm3s:{timestamp_osm_base:new Date(earliest).toISOString()},elements:[...elements.values()]};
}

function decodeXml(value){return String(value).replaceAll('&quot;','"').replaceAll('&apos;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');}
function xmlAttributes(source){const attributes={};for(const match of String(source).matchAll(/([:\w-]+)="([^"]*)"/g))attributes[match[1]]=decodeXml(match[2]);return attributes;}
function xmlTags(source){const tags={};for(const match of String(source||'').matchAll(/<tag\b([^>]*?)\/?\s*>/g)){const attributes=xmlAttributes(match[1]);if(attributes.k!==undefined&&attributes.v!==undefined)tags[attributes.k]=attributes.v;}return tags;}
function parseOsmXml(xml){
  const elements=[];const source=String(xml||'');
  for(const match of source.matchAll(/<node\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/node>)/g)){const attributes=xmlAttributes(match[1]);const id=Number(attributes.id),lat=Number(attributes.lat),lon=Number(attributes.lon);if(Number.isSafeInteger(id)&&Number.isFinite(lat)&&Number.isFinite(lon))elements.push({type:'node',id,lat,lon,tags:xmlTags(match[2])});}
  for(const match of source.matchAll(/<way\b([^>]*?)>([\s\S]*?)<\/way>/g)){const attributes=xmlAttributes(match[1]);const id=Number(attributes.id);if(!Number.isSafeInteger(id))continue;const nodes=[...match[2].matchAll(/<nd\b([^>]*?)\/?\s*>/g)].map(item=>Number(xmlAttributes(item[1]).ref)).filter(Number.isSafeInteger);const tags=xmlTags(match[2]);if(nodes.length>=2&&isWalkable(tags))elements.push({type:'way',id,nodes,tags});}
  return elements;
}

async function fetchOsmApiSnapshot(fetchImpl=fetch,options={}){
  const payloads=[];const tiles=overpassTiles(options.bbox||BBOX);const now=options.now||Date.now;
  for(let index=0;index<tiles.length;index+=1){const tile=tiles[index];const bbox=[tile.west,tile.south,tile.east,tile.north].join(',');let response;let lastError;
    for(let attempt=1;attempt<=2;attempt+=1){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),options.timeoutMs||60_000);try{response=await fetchImpl(`${options.endpoint||OSM_API_ENDPOINT}?bbox=${encodeURIComponent(bbox)}`,{headers:{'user-agent':USER_AGENT},signal:controller.signal});if(!response.ok){const error=new Error(`OSM_API_HTTP_${response.status}`);error.status=response.status;throw error;}break;}catch(error){lastError=error;if(attempt===2||Number.isInteger(error.status)&&error.status>=400&&error.status<500&&error.status!==429)throw error;await (options.delay||(()=>Promise.resolve()))(attempt*1000);}finally{clearTimeout(timer);}}
    if(!response)throw lastError||new Error('OSM_API_UNAVAILABLE');const xml=await response.text();if(xml.length>25_000_000)throw new Error('OSM_API_TILE_TOO_LARGE');const timestamp=response.headers?.get?.('date')||new Date(now()).toISOString();payloads.push({osm3s:{timestamp_osm_base:timestamp},elements:parseOsmXml(xml)});options.onProgress?.({tile:index+1,total:tiles.length});}
  return mergeOverpassPayloads(payloads,{now});
}

async function fetchOverpassSnapshot(fetchImpl=fetch,options={}){
  const endpoints=options.endpoints||OVERPASS_ENDPOINTS;let lastError;
  for(const endpoint of endpoints){try{const payloads=[];const tiles=overpassTiles(options.bbox||BBOX);const progress={completed:0,total:tiles.length};
    const fetchTile=async(bbox,depth)=>{try{const payload=await fetchOverpass(fetchImpl,{endpoint,bbox,attempts:1,delay:options.delay,now:options.now,timeoutMs:options.timeoutMs||120_000});progress.completed+=1;options.onProgress?.({tile:progress.completed,total:progress.total});return[payload];}catch(error){const splittable=depth<2&&(!Number.isInteger(error.status)||error.status>=500);if(!splittable)throw error;const subdivisions=overpassTiles(bbox,2);progress.total+=subdivisions.length-1;const nested=[];for(const subdivision of subdivisions)nested.push(...await fetchTile(subdivision,depth+1));return nested;}};
    for(const tile of tiles)payloads.push(...await fetchTile(tile,0));return mergeOverpassPayloads(payloads,{now:options.now});}catch(error){lastError=error;}}
  throw lastError||new Error('OVERPASS_UNAVAILABLE');
}

async function publishNetwork(client, network, options = {}) {
  const releaseId = options.releaseId || randomUUID(); const version = options.version || `osm-${network.sourceTimestamp.replace(/[^0-9]/g,'').slice(0,14)}-${releaseId.slice(0,8)}`;
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='120s'");
    await client.query('SELECT pg_advisory_xact_lock($1,$2)', [1_385_445_286, 29]);
    await client.query('INSERT INTO app.network_releases(id,city_id,zone_id,version,source_date,bbox,status) VALUES($1,$2,$3,$4,$5,$6::double precision[],\'draft\')', [releaseId,CITY_ID,ZONE_ID,version,network.sourceDate,[BBOX.west,BBOX.south,BBOX.east,BBOX.north]]);
    const nodeRows = network.nodes.map(node => ({ id:node.id, source_id:node.sourceId, latitude:node.latitude, longitude:node.longitude }));
    await client.query(`INSERT INTO app.route_nodes(id,city_id,position,is_published,release_id,source_node_id)
      SELECT item.id::uuid,$1,extensions.ST_SetSRID(extensions.ST_MakePoint(item.longitude,item.latitude),4326),true,$2,item.source_id
      FROM jsonb_to_recordset($3::jsonb) AS item(id text,source_id bigint,latitude double precision,longitude double precision)`, [CITY_ID,releaseId,JSON.stringify(nodeRows)]);
    const segmentRows = network.segments.map(segment => ({ id:segment.id, source_node_id:segment.sourceNodeId, target_node_id:segment.targetNodeId, source_lon:segment.coordinates[0][0], source_lat:segment.coordinates[0][1], target_lon:segment.coordinates[1][0], target_lat:segment.coordinates[1][1], distance_meters:segment.distanceMeters, accessibility_status:segment.accessibilityStatus, lighting_status:segment.lightingStatus, way_id:segment.wayId, sequence:segment.sequence, name:segment.name }));
    await client.query(`INSERT INTO app.route_segments(id,city_id,source_node_id,target_node_id,geometry,distance_meters,accessibility_status,lighting_status,is_published,release_id,source_way_id,source_sequence,name)
      SELECT item.id::uuid,$1,item.source_node_id::uuid,item.target_node_id::uuid,
        extensions.ST_SetSRID(extensions.ST_MakeLine(extensions.ST_MakePoint(item.source_lon,item.source_lat),extensions.ST_MakePoint(item.target_lon,item.target_lat)),4326),
        item.distance_meters,item.accessibility_status,item.lighting_status,true,$2,item.way_id,item.sequence,item.name
      FROM jsonb_to_recordset($3::jsonb) AS item(id text,source_node_id text,target_node_id text,source_lon double precision,source_lat double precision,target_lon double precision,target_lat double precision,distance_meters numeric,accessibility_status text,lighting_status text,way_id bigint,sequence integer,name text)`, [CITY_ID,releaseId,JSON.stringify(segmentRows)]);
    await client.query('UPDATE app.network_releases SET status=\'retired\',published_at=NULL WHERE zone_id=$1 AND status=\'published\'', [ZONE_ID]);
    await client.query('UPDATE app.network_releases SET status=\'published\',node_count=$2,segment_count=$3,published_at=clock_timestamp() WHERE id=$1', [releaseId,network.nodes.length,network.segments.length]);
    await client.query('COMMIT'); return { releaseId, version, nodes: network.nodes.length, segments: network.segments.length };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

async function main() {
  if (!process.env.MIGRATION_DATABASE_URL) throw new Error('MIGRATION_DATABASE_URL_REQUIRED');
  const progress=step=>process.stdout.write(`Tesela OSM ${step.tile}/${step.total} validada.\n`);let payload;
  try{payload=await fetchOsmApiSnapshot(fetch,{onProgress:progress});}
  catch(error){process.stderr.write(`API OSM no disponible (${error.message}); probando Overpass.\n`);payload=await fetchOverpassSnapshot(fetch,{onProgress:progress});}
  const network = parseOverpass(payload);
  const client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL, ssl: tlsOptions(process.env.DATABASE_SSL !== 'false', process.env.DATABASE_CA_FILE || null), application_name: 'rutaviva-osm-importer' });
  try { await client.connect(); const result = await publishNetwork(client, network); process.stdout.write(`Red OSM publicada: ${result.nodes} nodos, ${result.segments} tramos, versión ${result.version}.\n`); } finally { await client.end(); }
}

if (require.main === module) main().catch(error => { process.stderr.write(`Importación cancelada: ${error.message}\n`); process.exitCode = 1; });

module.exports = { BBOX, MAX_NODES, MAX_SEGMENTS, OSM_API_ENDPOINT, OVERPASS_ENDPOINTS, USER_AGENT, accessibility, buildOverpassQuery, combineAccessibility, deterministicUuid, fetchOsmApiSnapshot, fetchOverpass, fetchOverpassSnapshot, haversineMeters, insideBbox, isWalkable, lighting, mergeOverpassPayloads, nodePolicy, overpassTiles, parseOsmXml, parseOverpass, publishNetwork, retryAfterMilliseconds };
