'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { AppError } = require('../errors.cjs');
const { decodeCursor, encodeCursor } = require('../db/repositories/zones.cjs');
const { createStatsRepository } = require('../db/repositories/stats.cjs');
const { getMethodology } = require('../services/methodology.cjs');

const openapiDocument = fs.readFileSync(path.join(__dirname, '..', '..', 'openapi', 'openapi.json'));
const CACHE_TTL_MS = 5 * 60 * 1000; const STATIC_TTL_MS = 60 * 60 * 1000; const MAX_CACHE_ENTRIES = 50;
const leaderboardQuerySchema = { type:'object',additionalProperties:false,properties:{cursor:{type:'string',minLength:1,maxLength:256,pattern:'^[A-Za-z0-9_-]+$'},limit:{type:'integer',minimum:1,maximum:100,default:20}} };

function etagOf(serialized) { return `"${createHash('sha256').update(serialized,'utf8').digest('hex')}"`; }
function nullableNumber(value) { return value === null || value === undefined ? null : Number(value); }

function credibilityRoutes(app, options) {
  const { database, config } = options;
  const repository = Object.hasOwn(options,'statsRepository') ? options.statsRepository : (database ? createStatsRepository(database) : null);
  const cache = new Map();
  const requireRepository = () => { if (!repository) throw new AppError(503,'DATABASE_UNAVAILABLE','Las estadísticas públicas no están disponibles temporalmente.'); };
  const readCache = key => { const entry=cache.get(key);if(!entry||entry.expires<=Date.now()){if(entry)cache.delete(key);return null;}return entry; };
  const writeCache = (key,entry) => { if(cache.size>=MAX_CACHE_ENTRIES)cache.delete(cache.keys().next().value);cache.set(key,entry); };
  async function sendCached(request,reply,key,maxAge,ttl,build){let entry=readCache(key);if(!entry){const payload=await build();const etag=etagOf(JSON.stringify(payload));entry={payload,etag,expires:Date.now()+ttl};writeCache(key,entry);}reply.header('ETag',entry.etag);reply.header('Cache-Control',`public, max-age=${maxAge}`);if(request.headers['if-none-match']===entry.etag)return reply.code(304).send();return reply.send({...entry.payload,requestId:request.id});}

  app.get('/api/v1/stats', async (request,reply) => {
    requireRepository();
    return sendCached(request,reply,'stats',300,CACHE_TTL_MS,async()=>{const row=await repository.stats();const suppressed=row?.privacy_suppressed===true;const published=nullableNumber(row?.published_count);const pending=nullableNumber(row?.pending_count);const rejected=nullableNumber(row?.rejected_count);const decided=(published??0)+(rejected??0);return {published,pending,rejected,publicationRate:!suppressed&&decided>0?Math.round((published/decided)*1000)/1000:null,avgResolutionHours:nullableNumber(row?.avg_resolution_hours),networkVersion:row?.network_version||null,pilotEmpty:row?.pilot_empty===true,privacySuppressed:suppressed,notice:suppressed?'Hay actividad, pero ocultamos los recuentos hasta alcanzar cinco participantes.':row?.pilot_empty===true?'Piloto recién abierto: todavía no hay aportaciones publicadas ni pendientes.':null,advertencia:'Ruta orientativa: comprueba siempre el entorno y la señalización.'};});
  });

  async function leaderboardRows(){requireRepository();return repository.leaderboard();}
  const publicZone = zone => ({id:zone.id,slug:zone.slug,name:zone.name,sortOrder:Number(zone.sort_order),isApproximate:zone.is_approximate===true,bbox:Array.isArray(zone.bbox)?zone.bbox.map(Number):zone.bbox,published:nullableNumber(zone.published_count),pending:nullableNumber(zone.pending_count),lastActivity:zone.last_activity||null,privacySuppressed:zone.privacy_suppressed===true});

  app.get('/api/v1/zones/leaderboard',{schema:{querystring:leaderboardQuerySchema}},async(request,reply)=>{const limit=request.query.limit??20;const cursorKey=request.query.cursor||'first';return sendCached(request,reply,`leaderboard:${cursorKey}:${limit}`,300,CACHE_TTL_MS,async()=>{let cursor=null;try{cursor=decodeCursor(request.query.cursor);}catch(error){if(error?.code==='INVALID_CURSOR')throw new AppError(422,'INVALID_CURSOR','El cursor de paginación no es válido.');throw error;}const ordered=[...(await leaderboardRows())].sort((left,right)=>Number(left.sort_order)-Number(right.sort_order)||String(left.id).localeCompare(String(right.id)));const after=cursor?ordered.filter(zone=>Number(zone.sort_order)>cursor.sortOrder||(Number(zone.sort_order)===cursor.sortOrder&&String(zone.id)>cursor.id)):ordered;const page=after.slice(0,limit).map(publicZone);return {data:page,page:{limit,nextCursor:after.length>limit?encodeCursor({sortOrder:page.at(-1).sortOrder,id:page.at(-1).id}):null}};});});

  app.get('/api/v1/zones/:slug',{schema:{params:{type:'object',additionalProperties:false,required:['slug'],properties:{slug:{type:'string',minLength:1,maxLength:80,pattern:'^[a-z0-9]+(?:-[a-z0-9]+)*$'}}}}},async(request,reply)=>sendCached(request,reply,`zone:${request.params.slug}`,300,CACHE_TTL_MS,async()=>{const zone=(await leaderboardRows()).find(row=>row.slug===request.params.slug);if(!zone)throw new AppError(404,'ZONE_NOT_FOUND','No encontramos esa zona del piloto.');return {...publicZone(zone),advertencia:'Ruta orientativa: comprueba siempre el entorno y la señalización.'};}));

  app.get('/api/v1/methodology',async(request,reply)=>sendCached(request,reply,'methodology',3600,STATIC_TTL_MS,async()=>getMethodology()));
  app.get('/api/v1/activity/summary',async(request,reply)=>{requireRepository();return sendCached(request,reply,'activity-summary',300,CACHE_TTL_MS,async()=>{const windows=(await repository.summary()).sort((a,b)=>Number(a.window_days)-Number(b.window_days)).map(row=>({days:Number(row.window_days),published:nullableNumber(row.published_count),submitted:nullableNumber(row.submitted_count),resolved:nullableNumber(row.resolved_count),privacySuppressed:row.privacy_suppressed===true}));return {windows,pilotEmpty:windows.every(item=>!item.privacySuppressed&&item.published===0&&item.submitted===0&&item.resolved===0)};});});

  const openapiEtag=etagOf(openapiDocument);
  app.get('/api/v1/openapi.json',async(request,reply)=>{reply.header('ETag',openapiEtag);reply.header('Cache-Control','public, max-age=3600');if(request.headers['if-none-match']===openapiEtag)return reply.code(304).send();return reply.type('application/json; charset=utf-8').send(openapiDocument);});
  app.get('/sitemap.xml',async(request,reply)=>{const origin=config?.publicOrigin||'http://127.0.0.1:4329';const body=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${origin}/</loc></url>\n</urlset>`;const etag=etagOf(body);reply.header('ETag',etag);reply.header('Cache-Control','public, max-age=3600');if(request.headers['if-none-match']===etag)return reply.code(304).send();return reply.type('application/xml; charset=utf-8').send(body);});
  app.get('/robots.txt',async(request,reply)=>{const origin=config?.publicOrigin||'http://127.0.0.1:4329';const body=`User-agent: *\nAllow: /\nDisallow: /api/v1/auth/\nDisallow: /auth/verify\nSitemap: ${origin}/sitemap.xml\n`;const etag=etagOf(body);reply.header('ETag',etag);reply.header('Cache-Control','public, max-age=3600');if(request.headers['if-none-match']===etag)return reply.code(304).send();return reply.type('text/plain; charset=utf-8').send(body);});
}

module.exports = { credibilityRoutes, leaderboardQuerySchema, nullableNumber };
