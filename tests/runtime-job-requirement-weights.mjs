import assert from "node:assert/strict";
import fs from "node:fs";
import postgres from "postgres";

const local = fs.existsSync(".dev.vars") ? fs.readFileSync(".dev.vars", "utf8") : "";
const url = process.env.DATABASE_URL || local.match(/^DATABASE_URL\s*=\s*(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL is required");
const sql = postgres(url, { max: 1 });
const rollback = new Error("Rollback test fixtures");
try {
  await sql.begin(async tx => {
    const [user] = await tx`SELECT id FROM users ORDER BY id LIMIT 1`;
    assert.ok(user, "An existing user is required");
    for (const weights of [[], [40, 60], [40, 50]]) {
      const [job] = await tx`INSERT INTO job_openings(title,status,created_by_user_id) VALUES ('Requirement validation regression','draft',${user.id}) RETURNING id`;
      for (const weight of weights) {
        await tx`INSERT INTO job_requirements(job_id,category,name,weight) VALUES (${job.id},'other','Test requirement',${weight})`;
      }
      const publish = () => tx.savepoint(sp => sp`UPDATE job_openings SET status='open',published_at=CURRENT_TIMESTAMP WHERE id=${job.id} RETURNING status`);
      if (weights.length && weights.reduce((a, b) => a + b, 0) !== 100) {
        await assert.rejects(publish, error => error.code === "23514");
      } else {
        assert.equal((await publish())[0].status, "open");
      }
    }
    throw rollback;
  }).catch(error => { if (error !== rollback) throw error; });
  console.log("PASS: empty and valid requirements publish; invalid totals rejected; all fixtures rolled back.");
} finally {
  await sql.end();
}
