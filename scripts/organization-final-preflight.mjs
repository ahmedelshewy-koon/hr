import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import postgres from 'postgres';

const root=path.resolve('outputs/organization-implementation');
const latest=JSON.parse(fs.readFileSync(path.join(root,'latest-rehearsal.json'),'utf8'));
const rehearsal=JSON.parse(fs.readFileSync(latest.reportPath,'utf8'));
const expected='3aa2e4ffdc337c085aa45dac244ae0568b0448515efb02fac90f50364f11446a';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const migrationPath='drizzle-postgres/0030_organizational_assignments.sql';
const migration=fs.readFileSync(migrationPath);
if(hash(migration)!==expected)throw new Error('STOP: approved migration hash differs');
const journal=JSON.parse(fs.readFileSync('drizzle-postgres/meta/_journal.json','utf8')).entries;
if(journal.length!==31||journal.at(-1).tag!=='0030_organizational_assignments')throw new Error('STOP: migration set differs');
const url=fs.readFileSync('.dev.vars','utf8').match(/^DATABASE_URL\s*=\s*(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g,'');
const target=new URL(url);
if(target.hostname!=='127.0.0.1'||target.port!=='5545'||target.pathname!=='/koon_hr'||decodeURIComponent(target.username)!=='koon_hr_admin')throw new Error('STOP: configured target differs');
if(rehearsal.rehearsal!=='passed'||rehearsal.migrationSha256!==expected)throw new Error('STOP: rehearsal differs');
const dir=path.join(root,'live-preflight-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(dir,{recursive:true});
const env={...process.env,PGHOST:target.hostname,PGPORT:target.port,PGDATABASE:'koon_hr',PGUSER:'koon_hr_admin',PGPASSWORD:decodeURIComponent(target.password)};
function pg(tool,args){const r=spawnSync('C:/Program Files/PostgreSQL/18/bin/'+tool+'.exe',args,{env,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:20*1024*1024});if(r.status!==0)throw new Error(tool+' failed: '+r.stderr);return r.stdout;}
const normalize=value=>value.replace(/\r\n/g,'\n').split('\n').filter(line=>!line.startsWith('\\restrict ')&&!line.startsWith('\\unrestrict ')&&!line.startsWith('--')).map(line=>line.trimEnd()).filter(Boolean).join('\n');
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const sql=postgres(url,{max:1,connect_timeout:10});
try{
  const report=await sql.begin('isolation level repeatable read read only',async tx=>{
    const [server]=await tx`SELECT current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port`;
    if(server.database!=='koon_hr'||server.role!=='koon_hr_admin'||server.host!=='127.0.0.1'||server.port!==5545)throw new Error('STOP: actual server differs: '+JSON.stringify(server));
    const entries=await tx`SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id`;
    const pending=entries.length===30&&!entries.some(e=>e.hash===expected||Number(e.created_at)===journal.at(-1).when);
    const [snapshot]=await tx`SELECT pg_export_snapshot() AS id`;
    const originalSchema=pg('pg_restore',['--schema-only','--no-owner','--no-privileges','-f','-',rehearsal.backup.path]);
    const currentSchema=pg('pg_dump',['--schema-only','--no-owner','--no-privileges','--snapshot='+snapshot.id]);
    fs.writeFileSync(path.join(dir,'rehearsal-schema.sql'),originalSchema);
    fs.writeFileSync(path.join(dir,'live-schema.sql'),currentSchema);
    const schemaEqual=normalize(originalSchema)===normalize(currentSchema);
    const before=[];
    for(const table of rehearsal.baseline){
      const [row]=await tx.unsafe(`SELECT count(*)::int AS count,md5(coalesce(string_agg(row_to_json(r)::text,E'\\n' ORDER BY row_to_json(r)::text),'')) AS hash FROM (SELECT ${table.columns.map(quote).join(',')} FROM ${quote(table.table_schema)}.${quote(table.table_name)}) r`);
      before.push({...table,...row});
    }
    const dataChanges=before.filter((t,i)=>t.hash!==rehearsal.baseline[i].hash||t.count!==rehearsal.baseline[i].count).map(t=>t.table_schema+'.'+t.table_name);
    let backup=rehearsal.backup;
    if(dataChanges.length){
      const file=path.join(dir,'pre-live-migration.dump');
      pg('pg_dump',['-Fc','--snapshot='+snapshot.id,'-f',file]);
      pg('pg_restore',['--list',file]);
      backup={path:file,bytes:fs.statSync(file).size,sha256:hash(fs.readFileSync(file)),refreshed:true};
    }else if(hash(fs.readFileSync(backup.path))!==backup.sha256)throw new Error('STOP: backup hash differs');
    const ddlOnly=!/\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i.test(migration.toString().replace(/ON (UPDATE|DELETE) no action/gi,''));
    const newTables=[...migration.toString().matchAll(/CREATE TABLE "([^"]+)"/g)].map(m=>m[1]);
    const present=await tx`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=ANY(${newTables})`;
    const checks={exactTarget:true,exactMigration:true,approvedHash:true,notApplied:pending&&present.length===0,schemaUnchanged:schemaEqual,backupCurrent:true,noDataRewrite:ddlOnly};
    return {at:new Date().toISOString(),server,migration:'0030_organizational_assignments',migrationSha256:expected,checks,passed:Object.values(checks).every(Boolean),dataChanges,backup,journal:entries,baseline:before,schemaHash:hash(normalize(currentSchema)),rehearsalReport:latest.reportPath,dir};
  });
  fs.writeFileSync(path.join(dir,'preflight.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(root,'latest-live-preflight.json'),JSON.stringify({reportPath:path.join(dir,'preflight.json')},null,2));
  console.log(JSON.stringify({...report,baseline:undefined,journal:{count:report.journal.length,last:report.journal.at(-1)}},null,2));
  if(!report.passed)process.exitCode=1;
}finally{await sql.end({timeout:5});}
