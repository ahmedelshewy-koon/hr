import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

// This script only dumps the live target. Every DDL statement runs on a separate local cluster.
const root=path.resolve('outputs/organization-implementation');
const bin='C:/Program Files/PostgreSQL/18/bin';
const vars=fs.readFileSync('.dev.vars','utf8');
const liveUrl=process.env.DATABASE_URL||vars.match(/^DATABASE_URL\s*=\s*(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g,'');
const target=new URL(liveUrl);
if(target.hostname!=='127.0.0.1'||target.port!=='5545')throw new Error('Live target differs from approved assessment endpoint');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const resume=process.argv[2];
const dir=resume?path.resolve(resume):path.join(root,'rehearsal-'+stamp),cluster=path.join(dir,'cluster');
if(!dir.startsWith(root+path.sep))throw new Error('Rehearsal must stay within output directory');
fs.mkdirSync(dir,{recursive:true});
const dump=path.join(dir,'pre-organization.dump');
const clone={host:'127.0.0.1',port:5657,user:'postgres',database:'hr_org_rehearsal'};
const env={...process.env,PGHOST:target.hostname,PGPORT:target.port,PGUSER:decodeURIComponent(target.username),PGPASSWORD:decodeURIComponent(target.password),PGDATABASE:decodeURIComponent(target.pathname.slice(1))};
const run=(name,args,extraEnv=env)=>{
  // A detached PostgreSQL server can inherit pg_ctl's pipes on Windows.
  // File-backed output avoids keeping spawnSync waiting after startup succeeds.
  const output=name==='pg_ctl'?fs.openSync(path.join(dir,'pg-ctl.log'),'a'):null;
  let result;
  try{result=spawnSync(path.join(bin,name+'.exe'),args,{env:extraEnv,encoding:'utf8',windowsHide:true,timeout:120000,...(output!==null?{stdio:['ignore',output,output]}:{})});}
  finally{if(output!==null)fs.closeSync(output);}
  if(result.status!==0)throw new Error(name+' failed: '+(result.stderr||result.error||result.stdout));
  return result.stdout;
};
const quote=value=>'"'+value.replaceAll('"','""')+'"';
async function inventory(sql,baseline){
  const tables=baseline??await sql`SELECT table_schema,table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema IN ('public','drizzle') ORDER BY table_schema,table_name`;
  const result=[];
  for(const table of tables){
    const columns=table.columns??(await sql`SELECT column_name FROM information_schema.columns WHERE table_schema=${table.table_schema} AND table_name=${table.table_name} ORDER BY ordinal_position`).map(c=>c.column_name);
    const [row]=await sql.unsafe(`SELECT count(*)::int AS count,md5(coalesce(string_agg(row_to_json(r)::text,E'\\n' ORDER BY row_to_json(r)::text),'')) AS hash FROM (SELECT ${columns.map(quote).join(',')} FROM ${quote(table.table_schema)}.${quote(table.table_name)}) r`);
    result.push({...table,columns,...row});
  }
  return result;
}
let baseline;
if(!resume){
const live=postgres(liveUrl,{max:1,connect_timeout:10});
try{
  await live.begin('isolation level repeatable read read only',async tx=>{
    const [snapshot]=await tx`SELECT pg_export_snapshot() AS id`;
    baseline=await inventory(tx);
    run('pg_dump',['-Fc','--snapshot='+snapshot.id,'-f',dump]);
  });
}finally{await live.end({timeout:5});}
fs.writeFileSync(path.join(dir,'baseline.json'),JSON.stringify(baseline,null,2));
console.log('Backup completed; restoring into isolated port '+clone.port);
run('initdb',['-D',cluster,'-U','postgres','-A','trust','--encoding=UTF8','--locale=C']);
run('pg_ctl',['-D',cluster,'-l',path.join(dir,'postgres.log'),'-o','-p '+clone.port+' -h 127.0.0.1','-w','start']);
const cloneEnv={...process.env,PGHOST:clone.host,PGPORT:String(clone.port),PGUSER:clone.user,PGPASSWORD:'',PGDATABASE:clone.database};
run('createdb',[clone.database],cloneEnv);
run('pg_restore',['--exit-on-error','--no-owner','--no-privileges','-d',clone.database,dump],cloneEnv);
fs.writeFileSync(path.join(dir,'baseline.json'),JSON.stringify(baseline,null,2));
}
const cloneUrl=`postgresql://postgres@127.0.0.1:${clone.port}/${clone.database}`;
const sql=postgres(cloneUrl,{max:1});
try{
  if(resume){const [server]=await sql`SELECT current_setting('data_directory') AS dir`;if(path.resolve(server.dir)!==path.resolve(cluster))throw new Error('Wrong isolated cluster');baseline=fs.existsSync(path.join(dir,'baseline.json'))?JSON.parse(fs.readFileSync(path.join(dir,'baseline.json'),'utf8')):await inventory(sql);}
  const restored=await inventory(sql,baseline);
  const restoreMismatch=restored.filter((r,i)=>r.count!==baseline[i].count||r.hash!==baseline[i].hash);
  if(restoreMismatch.length)throw new Error('Restore preservation mismatch: '+JSON.stringify(restoreMismatch));
  const migration=fs.readFileSync('drizzle-postgres/0030_organizational_assignments.sql','utf8');
  if(/\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i.test(migration.replace(/ON (UPDATE|DELETE) no action/gi,'')))throw new Error('Unexpected destructive or data-changing SQL; inspect manually');
  await migrate(drizzle(sql),{migrationsFolder:'drizzle-postgres'});
  const after=await inventory(sql,baseline);
  const mismatches=after.filter((r,i)=>r.table_schema!=='drizzle'&&(r.count!==baseline[i].count||r.hash!==baseline[i].hash));
  if(mismatches.length)throw new Error('Migration preservation mismatch: '+JSON.stringify(mismatches));
  const beforeJournal=baseline.find(t=>t.table_schema==='drizzle');
  const [journal]=await sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`;
  if(journal.count!==beforeJournal.count+1)throw new Error('Expected exactly one new migration');
  const oldJournal=await sql.unsafe(`SELECT count(*)::int AS count,md5(coalesce(string_agg(row_to_json(r)::text,E'\\n' ORDER BY row_to_json(r)::text),'')) AS hash FROM (SELECT ${beforeJournal.columns.map(quote).join(',')} FROM drizzle.__drizzle_migrations ORDER BY id LIMIT ${beforeJournal.count}) r`);
  if(oldJournal[0].hash!==beforeJournal.hash)throw new Error('Existing migration history changed');
  await migrate(drizzle(sql),{migrationsFolder:'drizzle-postgres'});
  const [repeat]=await sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`;
  if(repeat.count!==journal.count)throw new Error('Repeated migration changed journal');
  const report={createdAt:new Date().toISOString(),liveTarget:{host:target.hostname,port:Number(target.port),database:decodeURIComponent(target.pathname.slice(1)),user:decodeURIComponent(target.username)},backup:{path:dump,bytes:fs.statSync(dump).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(dump)).digest('hex')},isolatedTarget:clone,cluster,restore:'passed',migration:'0030_organizational_assignments',migrationSha256:crypto.createHash('sha256').update(migration).digest('hex'),rehearsal:'passed',repeatMigration:'no-op',preservation:{tables:baseline.filter(t=>t.table_schema==='public').length,employeeCount:baseline.find(t=>t.table_name==='employees').count,existingRowsAndColumns:'exact match',existingMigrationHistory:'exact match',migrationCountBefore:beforeJournal.count,migrationCountAfter:journal.count},baseline,after};
  fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(root,'latest-rehearsal.json'),JSON.stringify({reportPath:path.join(dir,'report.json'),cloneUrl,cluster},null,2));
  console.log(JSON.stringify({...report,baseline:undefined,after:undefined},null,2));
}finally{await sql.end({timeout:5});}
