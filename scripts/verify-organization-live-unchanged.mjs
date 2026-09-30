import fs from 'node:fs';
import postgres from 'postgres';

// Read-only verification; never imports or invokes a migration runner.
const root='outputs/organization-implementation';
const config=JSON.parse(fs.readFileSync(`${root}/latest-rehearsal.json`,'utf8'));
const rehearsal=JSON.parse(fs.readFileSync(config.reportPath,'utf8'));
const vars=fs.readFileSync('.dev.vars','utf8');
const url=vars.match(/^DATABASE_URL\s*=\s*(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g,'');
const target=new URL(url);
if(target.hostname!==rehearsal.liveTarget.host||Number(target.port)!==rehearsal.liveTarget.port||decodeURIComponent(target.pathname.slice(1))!==rehearsal.liveTarget.database)throw new Error('Target differs from rehearsal');
const sql=postgres(url,{max:1});
const quote=value=>'"'+value.replaceAll('"','""')+'"';
try{
  const result=await sql.begin('isolation level repeatable read read only',async tx=>{
    const differences=[];
    for(const table of rehearsal.baseline){
      const [row]=await tx.unsafe(`SELECT count(*)::int AS count,md5(coalesce(string_agg(row_to_json(r)::text,E'\\n' ORDER BY row_to_json(r)::text),'')) AS hash FROM (SELECT ${table.columns.map(quote).join(',')} FROM ${quote(table.table_schema)}.${quote(table.table_name)}) r`);
      if(row.count!==table.count||row.hash!==table.hash)differences.push(`${table.table_schema}.${table.table_name}`);
    }
    const [state]=await tx`SELECT current_database() AS database, current_user AS username, inet_server_port() AS port, to_regclass('public.positions') IS NOT NULL AS organization_migration_present, (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS migration_count`;
    return {verifiedAt:new Date().toISOString(),target:rehearsal.liveTarget,state,differences,unchanged:differences.length===0&&!state.organization_migration_present&&state.migration_count===rehearsal.preservation.migrationCountBefore};
  });
  fs.writeFileSync(`${root}/live-readonly-verification.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
  if(!result.unchanged)process.exitCode=1;
}finally{await sql.end({timeout:5});}
