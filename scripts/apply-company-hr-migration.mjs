import fs from "node:fs";
import postgres from "postgres";

const local = fs.existsSync(".dev.vars") ? fs.readFileSync(".dev.vars", "utf8") : "";
const url = process.env.DATABASE_URL || local.match(/^DATABASE_URL\s*=\s*(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if(!url) throw new Error("DATABASE_URL is required");
const sql = postgres(url, {max:1, connect_timeout:10});
try {
  await sql.begin(async tx => {
    const [before] = await tx`SELECT count(*)::int AS employees FROM employees`;
    const migration = fs.readFileSync("drizzle-postgres/0029_employee_company_hr.sql", "utf8");
    for(const statement of migration.split("--> statement-breakpoint").filter(part => part.trim())) await tx.unsafe(statement);
    const [after] = await tx`SELECT count(*)::int AS employees FROM employees`;
    if(before.employees !== after.employees) throw new Error("Employee count changed unexpectedly");
    console.log(JSON.stringify({migration:"0029_employee_company_hr",employeesPreserved:after.employees}));
  });
} finally { await sql.end({timeout:5}); }
