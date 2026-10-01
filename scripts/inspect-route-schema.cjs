'use strict';

const { Client } = require('pg');
const { tlsOptions } = require('../src/db/pool.cjs');

const EXPECTED_COLUMNS=['city_id','created_at','id','published_at','status','version'];
const confirm='RENAME_EMPTY_LEGACY_NETWORK_RELEASES';
const quoteIdentifier=value=>`"${String(value).replaceAll('"','""')}"`;

async function inspect(client){
  const migrations=(await client.query('SELECT version,name FROM app_private.schema_migrations ORDER BY version')).rows;
  const exists=(await client.query("SELECT to_regclass('app.network_releases') IS NOT NULL AS present,to_regclass('app.network_releases_pre_bloque29') IS NOT NULL AS archived")).rows[0];
  if(!exists.present)return{migrations,exists,columns:[],rowCount:null,foreignReferences:[],views:[],functions:[],constraints:[],indexes:[]};
  const columns=await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='app' AND table_name='network_releases' ORDER BY column_name");
  const rowCount=await client.query('SELECT count(*)::integer AS count FROM app.network_releases');
  const foreignReferences=await client.query("SELECT namespace.nspname AS schema_name,relation.relname AS relation_name,constraint_item.conname FROM pg_constraint constraint_item JOIN pg_class relation ON relation.oid=constraint_item.conrelid JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE constraint_item.confrelid='app.network_releases'::regclass AND constraint_item.conrelid<>constraint_item.confrelid");
  const views=await client.query("SELECT view_schema,view_name FROM information_schema.view_table_usage WHERE table_schema='app' AND table_name='network_releases'");
  const functions=await client.query("SELECT namespace.nspname AS schema_name,procedure.proname AS function_name FROM pg_proc procedure JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace WHERE procedure.prokind='f' AND pg_get_functiondef(procedure.oid) ILIKE '%app.network_releases%'");
  const constraints=await client.query("SELECT constraint_item.conname,constraint_item.conindid FROM pg_constraint constraint_item WHERE constraint_item.conrelid='app.network_releases'::regclass ORDER BY constraint_item.conname");
  const indexes=await client.query("SELECT index_class.relname AS index_name,index_class.oid AS index_oid FROM pg_index index_item JOIN pg_class index_class ON index_class.oid=index_item.indexrelid WHERE index_item.indrelid='app.network_releases'::regclass ORDER BY index_class.relname");
  return{migrations,exists,columns:columns.rows.map(row=>row.column_name),rowCount:rowCount.rows[0].count,foreignReferences:foreignReferences.rows,views:views.rows,functions:functions.rows,constraints:constraints.rows,indexes:indexes.rows};
}

function safeToRename(report){return report.migrations.length===14&&report.migrations.every((row,index)=>row.version===index+1)&&report.exists.present&&!report.exists.archived&&report.rowCount===0&&JSON.stringify(report.columns)===JSON.stringify(EXPECTED_COLUMNS)&&report.foreignReferences.length===0&&report.views.length===0&&report.functions.length===0;}

async function renameLegacy(client,report){
  if(!safeToRename(report))throw new Error('LEGACY_TABLE_NOT_SAFE_TO_RENAME');
  await client.query('BEGIN');
  try{
    for(let index=0;index<report.constraints.length;index+=1){const item=report.constraints[index];await client.query(`ALTER TABLE app.network_releases RENAME CONSTRAINT ${quoteIdentifier(item.conname)} TO ${quoteIdentifier(`nr_pre_b29_constraint_${index+1}`)}`);}
    const constraintIndexes=new Set(report.constraints.map(item=>Number(item.conindid)).filter(Boolean));
    let indexNumber=0;
    for(const item of report.indexes){if(constraintIndexes.has(Number(item.index_oid)))continue;indexNumber+=1;await client.query(`ALTER INDEX app.${quoteIdentifier(item.index_name)} RENAME TO ${quoteIdentifier(`nr_pre_b29_index_${indexNumber}`)}`);}
    await client.query('ALTER TABLE app.network_releases RENAME TO network_releases_pre_bloque29');
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
}

async function main(){
  if(!process.env.MIGRATION_DATABASE_URL)throw new Error('MIGRATION_DATABASE_URL_REQUIRED');
  const apply=process.argv.includes('--apply');const confirmation=process.argv.find(value=>value.startsWith('--confirm='))?.slice(10);
  const client=new Client({connectionString:process.env.MIGRATION_DATABASE_URL,ssl:tlsOptions(process.env.DATABASE_SSL!=='false',process.env.DATABASE_CA_FILE||null),application_name:'rutaviva-schema-inspector'});
  await client.connect();
  try{
    const report=await inspect(client);const safe=safeToRename(report);
    process.stdout.write(`${JSON.stringify({migrationVersions:report.migrations.map(row=>row.version),tablePresent:report.exists.present,archivePresent:report.exists.archived,columns:report.columns,rowCount:report.rowCount,foreignReferenceCount:report.foreignReferences.length,viewCount:report.views.length,functionDependencyCount:report.functions.length,constraintCount:report.constraints.length,indexCount:report.indexes.length,safeToRename:safe},null,2)}\n`);
    if(apply){if(confirmation!==confirm)throw new Error('EXPLICIT_CONFIRMATION_REQUIRED');await renameLegacy(client,report);process.stdout.write('Tabla heredada vacía archivada como app.network_releases_pre_bloque29.\n');}
  }finally{await client.end();}
}

if(require.main===module)main().catch(error=>{process.stderr.write(`Inspección cancelada: ${error.message}\n`);process.exitCode=1;});

module.exports={EXPECTED_COLUMNS,inspect,renameLegacy,safeToRename};
