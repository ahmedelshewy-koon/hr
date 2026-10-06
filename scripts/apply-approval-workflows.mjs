import fs from 'node:fs';
import postgres from 'postgres';
const local=fs.existsSync('.dev.vars')?fs.readFileSync('.dev.vars','utf8'):'';
const url=process.env.DATABASE_URL||local.match(/^DATABASE_URL\s*=\s*(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g,'');
if(!url)throw new Error('DATABASE_URL is required');
const sql=postgres(url,{max:1,connect_timeout:10});
try{
  await sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(873,0)`;
    const [existing]=await tx`SELECT to_regclass('public.approval_workflows') AS name`;
    if(existing.name){console.log('Approval workflow tables already exist');return;}
    const migration=fs.readFileSync('drizzle-postgres/0036_approval_workflows.sql','utf8');
    for(const statement of migration.split('--> statement-breakpoint').filter(s=>s.trim()))await tx.unsafe(statement);
    console.log('Applied 0036_approval_workflows: three additive tables; existing requests unchanged.');
  });
}finally{await sql.end({timeout:5});}
