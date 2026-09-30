// Applies only additive learning changes. The SQL is idempotent, so the regular
// Drizzle migrator can later process the full journal, including earlier entries.
import fs from "node:fs";
import postgres from "postgres";

const local = fs.existsSync(".dev.vars") ? fs.readFileSync(".dev.vars", "utf8") : "";
const url = process.env.DATABASE_URL || local.match(/^DATABASE_URL\s*=\s*(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL is required");
const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  await sql.begin(async tx => {
    for (const name of ["0025_training_program_details.sql", "0026_training_evaluation_certificates.sql"]) {
      const source = fs.readFileSync(new URL(`../drizzle-postgres/${name}`, import.meta.url), "utf8");
      for (const statement of source.split("--> statement-breakpoint")) {
        if (statement.trim()) await tx.unsafe(statement);
      }
      console.log(`Applied ${name}`);
    }
  });
} finally {
  await sql.end();
}
