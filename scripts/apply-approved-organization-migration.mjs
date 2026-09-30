import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import postgres from 'postgres';

// One-shot execution of the exact SQL explicitly approved in this task.
// Does not run the general migration runner, seeds, mapping or cleanup.
if(process.argv[2]!=='--apply-approved-0030')throw new Error('Explicit execution flag required');
const root='outputs/organization-implementation';
const link=JSON.parse(fs.readFileSync(`${root}/latest-live-preflight.json`,'utf8'));
const pre=JSON.parse(fs.readFileSync(link.reportPath,'utf8'));
const expected='3aa2e4ffdc337c085aa45dac244ae0568b0448515efb02fac90f50364f11446a';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const source=fs.readFileSync('drizzle-postgres/0030_organizational_assignments.sql');
if(!pre.passed||Date.now()-Date.parse(pre.at)>15*60*1000||hash(source)!==expected||pre.migrationSha256!==expected)throw new Error('Preflight expired or SQL changed');
if(hash(fs.readFileSync(pre.backup.path))!==pre.backup.sha256)throw new Error('Backup changed');
const journal=JSON.parse(fs.readFileSync('drizzle-postgres/meta/_journal.json','utf8')).entries;
if(journal.length!==31||journal.at(-1).tag!=='0030_organizational_assignments')throw new Error('Migration set changed');
const url=fs.readFileSync('.dev.vars','utf8').match(/^DATABASE_URL\s*=\s*(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g,'');
const target=new URL(url);
if(target.hostname!=='127.0.0.1'||target.port!=='5545'||target.pathname!=='/koon_hr'||decodeURIComponent(target.username)!=='koon_hr_admin')throw new Error('Target changed');
const quote=value=>'"'+value.replaceAll('"','""')+'"';
async function inventory(tx){
  const result=[];
  for(const table of pre.baseline){
    const [row]=await tx.unsafe(`SELECT count(*)::int AS count,md5(coalesce(string_agg(row_to_json(r)::text,E'\\n' ORDER BY row_to_json(r)::text),'')) AS hash FROM (SELECT ${table.columns.map(quote).join(',')} FROM ${quote(table.table_schema)}.${quote(table.table_name)}) r`);
    result.push({...table,...row});
  }
  return result;
}
const differences=(rows,includeJournal=false)=>rows.filter((r,i)=>(includeJournal||r.table_schema!=='drizzle')&&(r.hash!==pre.baseline[i].hash||r.count!==pre.baseline[i].count)).map(r=>r.table_schema+'.'+r.table_name);
async function integrity(tx){
  const employees=await tx`SELECT id,manager_id,company_id,department_id,job_title_id FROM employees ORDER BY id`;
  const ids=new Set(employees.map(e=>e.id)),byId=new Map(employees.map(e=>[e.id,e]));
  const self=employees.filter(e=>e.id===e.manager_id).map(e=>e.id),missing=employees.filter(e=>e.manager_id&&!ids.has(e.manager_id)).map(e=>e.id),cycles=[];
  for(const e of employees){const seen=new Set();let cursor=e.id;while(cursor&&byId.has(cursor)){if(seen.has(cursor)){cycles.push(e.id);break;}seen.add(cursor);cursor=byId.get(cursor).manager_id;}}
  const [orphans]=await tx`SELECT count(*) FILTER (WHERE e.company_id IS NOT NULL AND c.id IS NULL)::int AS company,count(*) FILTER (WHERE e.department_id IS NOT NULL AND d.id IS NULL)::int AS department,count(*) FILTER (WHERE e.job_title_id IS NOT NULL AND j.id IS NULL)::int AS job_title FROM employees e LEFT JOIN companies c ON c.id=e.company_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN job_titles j ON j.id=e.job_title_id`;
  return {employeeCount:employees.length,assignmentHash:hash(JSON.stringify(employees)),selfManagers:self,missingManagers:missing,cycleAffectedEmployees:cycles,orphanedLegacyReferences:orphans};
}
const sql=postgres(url,{max:1,connect_timeout:10});
const report={startedAt:new Date().toISOString(),preflight:link.reportPath,migration:pre.migration,migrationSha256:expected,backup:pre.backup,committed:false};
try{
  await sql.begin(async tx=>{
    await tx`SET LOCAL lock_timeout='5s'`;
    await tx`SET LOCAL statement_timeout='60s'`;
    await tx`SELECT pg_advisory_xact_lock(78231)`;
    const [server]=await tx`SELECT current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port`;
    if(JSON.stringify(server)!==JSON.stringify(pre.server))throw new Error('Actual server changed');
    report.server=server;
    for(const table of pre.baseline){await tx.unsafe(`LOCK TABLE ${quote(table.table_schema)}.${quote(table.table_name)} IN ${['companies','departments','employees','__drizzle_migrations'].includes(table.table_name)?'ACCESS EXCLUSIVE':'SHARE'} MODE`);}
    const before=await inventory(tx);
    if(differences(before,true).length)throw new Error('Data changed since preflight; refresh backup and rerun preflight');
    const tables=await tx`SELECT table_schema,table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema IN ('public','drizzle') ORDER BY table_schema,table_name`;
    if(JSON.stringify(tables.map(t=>t.table_schema+'.'+t.table_name))!==JSON.stringify(pre.baseline.map(t=>t.table_schema+'.'+t.table_name)))throw new Error('Table set changed since rehearsal');
    const entries=await tx`SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id`;
    if(JSON.stringify(entries)!==JSON.stringify(pre.journal))throw new Error('Migration history changed');
    report.integrityBefore=await integrity(tx);
    for(const statement of source.toString().split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await tx.unsafe(statement);
    await tx`INSERT INTO drizzle.__drizzle_migrations (hash,created_at) VALUES (${expected},${journal.at(-1).when})`;
    const after=await inventory(tx);
    if(differences(after).length)throw new Error('Preservation failure; transaction rolls back');
    report.integrityAfter=await integrity(tx);
    if(JSON.stringify(report.integrityBefore)!==JSON.stringify(report.integrityAfter))throw new Error('Assignment or manager preservation failure');
    report.existingPublicTablesPreserved=after.filter(t=>t.table_schema==='public').length;
  });
  report.committed=true;
  report.committedAt=new Date().toISOString();
  // Fresh read-only verification after commit.
  report.post=await sql.begin('isolation level repeatable read read only',async tx=>{
    const after=await inventory(tx);
    const entries=await tx`SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id`;
    const tables=[...source.toString().matchAll(/CREATE TABLE "([^"]+)"/g)].map(m=>m[1]);
    const columns=[...source.toString().matchAll(/ALTER TABLE "([^"]+)" ADD COLUMN "([^"]+)"/g)].map(m=>({table:m[1],column:m[2]}));
    const newTables=[];for(const table of tables){const [r]=await tx.unsafe(`SELECT count(*)::int AS count FROM ${quote(table)}`);newTables.push({table,...r});}
    const addedColumns=[];for(const c of columns){const found=await tx`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=${c.table} AND column_name=${c.column}`;addedColumns.push({...c,present:found.length===1});}
    const [assigned]=await tx`SELECT count(*)::int AS populated_new_assignments FROM employees WHERE branch_id IS NOT NULL OR section_id IS NOT NULL OR team_id IS NOT NULL OR position_id IS NOT NULL OR grade_id IS NOT NULL OR work_location_id IS NOT NULL OR assignment_effective_date IS NOT NULL`;
    return {at:new Date().toISOString(),journal:entries,oldJournalPreserved:JSON.stringify(entries.slice(0,30))===JSON.stringify(pre.journal),differences:differences(after),existingTableCounts:after.filter(t=>t.table_schema==='public').map(t=>({table:t.table_name,count:t.count,hash:t.hash})),newTables,addedColumns,integrity:await integrity(tx),...assigned};
  });
  report.passed=report.post.journal.length===31&&report.post.journal.at(-1).hash===expected&&report.post.oldJournalPreserved&&report.post.differences.length===0&&report.post.addedColumns.every(c=>c.present)&&report.post.newTables.every(t=>t.count===0)&&report.post.populated_new_assignments===0&&JSON.stringify(report.post.integrity)===JSON.stringify(report.integrityBefore);
}catch(error){report.error=error.message;process.exitCode=1;}
finally{
  fs.writeFileSync(path.join(pre.dir,'execution.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,post:report.post?{...report.post,existingTableCounts:undefined,journal:{count:report.post.journal.length,last:report.post.journal.at(-1)}}:undefined},null,2));
  await sql.end({timeout:5});
}
if(!report.passed)process.exitCode=1;
