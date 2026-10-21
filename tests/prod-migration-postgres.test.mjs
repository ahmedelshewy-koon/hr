// End-to-end checks of the 0052-0054 production package against a real PostgreSQL. Skipped unless a disposable
// cluster is provided (trust auth for user postgres on 127.0.0.1):
//   HR_MIGRATION_TEST_PG_BIN=<directory with psql>  HR_MIGRATION_TEST_PG_PORT=<port>  npm test
// It builds a production-like fixture (0000-0051 replayed, a ledger with 0000-0030 plus two rows from a foreign
// journal), then runs the package's real SQL and shell functions: divergent and changed ledgers are refused, the
// happy path keeps every existing ledger row, ordering is safe for Drizzle's own migrator, and logical rollback is
// refused whenever an object 0052-0054 introduced holds data.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { loadJournal, ledgerFingerprint } from "../ops/prod-migration-0052-0054/lineage.mjs";

const BIN = process.env.HR_MIGRATION_TEST_PG_BIN, PORT = process.env.HR_MIGRATION_TEST_PG_PORT;
const skip = !(BIN && PORT) && "set HR_MIGRATION_TEST_PG_BIN and HR_MIGRATION_TEST_PG_PORT to run against a disposable PostgreSQL";
const PSQL = BIN ? join(BIN, process.platform === "win32" ? "psql.exe" : "psql") : "";
const env = { ...process.env, PGCLIENTENCODING: "UTF8" };
const slash = p => p.replace(/\\/g, "/");
const journal = loadJournal(".");
const UNKNOWN = [{ created_at: 1791298824926, hash: "a".repeat(64) }, { created_at: 1791372110232, hash: "b".repeat(64) }];
let repo, pkg, originalLedger;

function psql(db, sql, { ok = true } = {}) {
  const r = spawnSync(PSQL, ["-h", "127.0.0.1", "-p", PORT, "-U", "postgres", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", db], { input: sql, env, encoding: "utf8" });
  if (ok && r.status !== 0) throw new Error(`psql ${db} failed: ${r.stderr}`);
  return { ...r, stdout: r.stdout.replace(/\r\n/g, "\n") };
}
const copyDb = (from, to) => psql("postgres", `DROP DATABASE IF EXISTS ${to}; CREATE DATABASE ${to} TEMPLATE ${from};`);

/** Runs commands with the package's shell functions sourced; psql_to targets the given test databases. */
function sh(commands, runDir) {
  const script = `set -Eeuo pipefail
source "${pkg}/hr-migrate-0052-0054.sh"
psql_to() { local t="$1"; shift; local db="\${t#*:}"; "$PSQL" -h 127.0.0.1 -p "$PGPORT" -U postgres -X -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }
RUN_DIR="${runDir}"; mkdir -p "$RUN_DIR"
${commands}`;
  return spawnSync("bash", ["-c", script], { env: { ...env, PSQL: slash(PSQL), PGPORT: PORT }, encoding: "utf8" });
}

test("setup: production-like fixture and a package copy with a test attestation", { skip }, () => {
  repo = slash(mkdtempSync(join(tmpdir(), "hr-mig-")));
  pkg = `${repo}/ops/prod-migration-0052-0054`;
  mkdirSync(`${repo}/drizzle-postgres/meta`, { recursive: true }); mkdirSync(pkg, { recursive: true });
  const lf = (from, to) => writeFileSync(to, readFileSync(from, "utf8").replace(/\r\n/g, "\n"));
  for (const f of readdirSync("drizzle-postgres").filter(f => f.endsWith(".sql"))) lf(`drizzle-postgres/${f}`, `${repo}/drizzle-postgres/${f}`);
  lf("drizzle-postgres/meta/_journal.json", `${repo}/drizzle-postgres/meta/_journal.json`);
  lf("ops/hr-schema-contract.json", `${repo}/ops/hr-schema-contract.json`);
  mkdirSync(`${repo}/app/api/hr`, { recursive: true });
  lf("app/api/hr/route.ts", `${repo}/app/api/hr/route.ts`);
  for (const f of readdirSync("ops/prod-migration-0052-0054", { withFileTypes: true })) {
    if (f.isDirectory()) cpSync(`ops/prod-migration-0052-0054/${f.name}`, `${pkg}/${f.name}`, { recursive: true });   // evidence: byte-exact
    else lf(`ops/prod-migration-0052-0054/${f.name}`, `${pkg}/${f.name}`);
  }

  psql("postgres", "DROP DATABASE IF EXISTS hrmig_base; CREATE DATABASE hrmig_base;");
  for (const e of journal.filter(e => e.idx <= 51)) {
    if (e.idx === 31) psql("hrmig_base", "INSERT INTO roles (name) SELECT n FROM (VALUES ('Super Admin'),('HR Manager')) v(n) WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = n);");
    psql("hrmig_base", `BEGIN;\n${readFileSync(`drizzle-postgres/${e.tag}.sql`, "utf8")}\nCOMMIT;`);
  }
  // Production's application has run its runtime seed for this release (seed_version current), as the preflight requires.
  const seedVersion = /const SEED_VERSION = "([^"]+)"/.exec(readFileSync("app/api/hr/route.ts", "utf8"))[1];
  psql("hrmig_base", `INSERT INTO system_settings (setting_key, value_json, created_at, updated_at) VALUES ('seed_version', '${seedVersion}', now(), now())
    ON CONFLICT (setting_key) DO UPDATE SET value_json = excluded.value_json;`);
  const rows = journal.filter(e => e.idx <= 30).map(e => `('${e.hash}', ${e.when})`).concat(UNKNOWN.map(u => `('${u.hash}', ${u.created_at})`));
  psql("hrmig_base", `CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ${rows.join(",")};`);
  originalLedger = psql("hrmig_base", "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id").stdout.trim();
  const ledger = originalLedger.split("\n").map(l => { const [id, hash, c] = l.split("|"); return { id: +id, hash, created_at: +c }; });
  writeFileSync(`${pkg}/ledger-attestations.json`, JSON.stringify({
    production_ledger: { fingerprint: ledgerFingerprint(ledger) },
    rows: UNKNOWN.map(u => ({ ...u, decision: "accept", identified_as: "test fixture foreign journal" })), data_checks: [],
  }));
});

test("data checks fail when a data step of an unrecorded migration is missing, and lineage then refuses", { skip }, () => {
  copyDb("hrmig_base", "hrmig_nodata");
  psql("hrmig_nodata", "DELETE FROM permissions WHERE module = 'administrative_decisions';");
  const r = sh(`lineage_check clone:hrmig_nodata "$RUN_DIR" || echo "rc=$?"`, `${repo}/run-nodata`);
  assert.match(r.stdout, /rc=4/);
  assert.match(r.stderr, /LINEAGE=UNVERIFIED/);
  assert.match(readFileSync(`${repo}/run-nodata/data-checks.tsv`, "utf8"), /0041_admin_decisions_permissions\tFAIL\t0 of 4/);
  assert.match(readFileSync(`${repo}/run-nodata/ADMIN_ACTION_REPORT.md`, "utf8"), /data check 0041_admin_decisions_permissions is FAIL/);
});

test("Drizzle's own migrator on the unmodified divergent ledger applies 0054 only and skips 0052/0053 (the hazard)", { skip }, async () => {
  copyDb("hrmig_base", "hrmig_hazard");
  const sql = postgres({ host: "127.0.0.1", port: +PORT, user: "postgres", database: "hrmig_hazard", max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: `${repo}/drizzle-postgres` });
    const [{ n, head }] = await sql`SELECT count(*)::int n, max(created_at)::text head FROM drizzle.__drizzle_migrations`;
    const [{ ts }] = await sql`SELECT to_regclass('public.timesheets') IS NOT NULL AS ts`;
    assert.equal(n, 34);
    assert.equal(head, String(journal.at(-1).when));
    assert.equal(ts, false, "0052 was skipped, exactly as LINEAGE_REPORT warns");
  } finally { await sql.end(); }
});

test("the migration transaction refuses a ledger that differs from the attested one, and changes nothing", { skip }, () => {
  copyDb("hrmig_base", "hrmig_changed");
  psql("hrmig_changed", "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('c', 1791300000001);");
  const r = sh(`LINEAGE_JSON=/dev/null; capture_rollback_pre clone:hrmig_changed "$RUN_DIR/vars.sql"
    lineage_check clone:hrmig_changed "$RUN_DIR" || true
    run_migration clone:hrmig_changed "$RUN_DIR/m.log" COMMIT`, `${repo}/run-changed`);
  assert.notEqual(r.status, 0);
  assert.match(readFileSync(`${repo}/run-changed/m.log`, "utf8"), /GUARD: drizzle.__drizzle_migrations differs from the attested ledger/);
  assert.equal(psql("hrmig_changed", "SELECT to_regclass('public.timesheets') IS NULL").stdout.trim(), "t");
});

test("happy path: every existing ledger row preserved, only 0052-0054 recorded, nothing pending for Drizzle", { skip }, async () => {
  copyDb("hrmig_base", "hrmig_apply");
  const r = sh(`capture_rollback_pre clone:hrmig_apply "$RUN_DIR/rollback-vars.sql"
    lineage_check clone:hrmig_apply "$RUN_DIR"
    run_migration clone:hrmig_apply "$RUN_DIR/migration.log" COMMIT
    capture_rollback_baseline clone:hrmig_apply "$RUN_DIR/rollback-vars.sql"
    run_validate_sql clone:hrmig_apply`, `${repo}/run-apply`);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const log = readFileSync(`${repo}/run-apply/migration.log`, "utf8");
  for (const marker of ["HR_GUARDS=PASS", "HR_LEDGER=RECORDED_0052_0054", "HR_VALIDATION=PASS", "HR_DATA_PRESERVATION=PASS"]) assert.match(log, new RegExp(marker));
  const after = psql("hrmig_apply", "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id").stdout.trim().split("\n");
  assert.equal(after.slice(0, 33).join("\n"), originalLedger, "existing rows must be byte-for-byte unchanged");
  assert.deepEqual(after.slice(33).map(l => l.split("|").slice(1).join("|")),
    journal.filter(e => e.idx >= 52).map(e => `${e.hash}|${e.when}`));
  assert.ok(+psql("hrmig_apply", "SELECT count(*) FROM hr_ops.migration_audit WHERE event = 'existing_ledger_row'").stdout.trim() === 33);
  // Drizzle's own migrator: nothing to apply now; a future migration newer than 0054 is the only one applied.
  copyDb("hrmig_apply", "hrmig_future");
  const future = `${repo}/future-migrations`;
  mkdirSync(`${future}/meta`, { recursive: true });
  for (const e of journal) copyFileSync(`${repo}/drizzle-postgres/${e.tag}.sql`, `${future}/${e.tag}.sql`);
  writeFileSync(`${future}/0055_probe.sql`, 'CREATE TABLE "hr_future_probe" ("id" serial PRIMARY KEY);');
  const j = JSON.parse(readFileSync(`${repo}/drizzle-postgres/meta/_journal.json`, "utf8"));
  j.entries.push({ idx: 55, version: "7", when: journal.at(-1).when + 1000, tag: "0055_probe", breakpoints: true });
  writeFileSync(`${future}/meta/_journal.json`, JSON.stringify(j));
  for (const [db, folder, expectRows] of [["hrmig_apply", `${repo}/drizzle-postgres`, 36], ["hrmig_future", future, 37]]) {
    const sql = postgres({ host: "127.0.0.1", port: +PORT, user: "postgres", database: db, max: 1, onnotice: () => {} });
    try {
      await migrate(drizzle(sql), { migrationsFolder: folder });
      const [{ n }] = await sql`SELECT count(*)::int n FROM drizzle.__drizzle_migrations`;
      assert.equal(n, expectRows, `${db}: Drizzle applied an unexpected set of migrations`);
    } finally { await sql.end(); }
  }
});

const unsafe = [
  ["hr_managers holds a row", "INSERT INTO hr_managers (user_id) SELECT min(id) FROM users;"],
  ["portal_session_activity holds a session", "INSERT INTO portal_session_activity (token_hash, user_id) SELECT 'x', min(id) FROM users;"],
  ["user_permissions holds a grant", "INSERT INTO user_permissions (user_id, menu_item) SELECT min(id), 'payrollRun' FROM users;"],
  ["a new employees column was filled", "UPDATE employees SET termination_date = '2026-12-31' WHERE id = (SELECT min(id) FROM employees);"],
  ["a seeded permission was changed", "UPDATE permissions SET allowed = 0 WHERE id = (SELECT max(id) FROM permissions);"],
  ["the SAR currency rate was changed", "UPDATE payroll_currencies SET sar_rate = 2 WHERE code = 'SAR';"],
];
for (const [name, mutation] of unsafe) {
  test(`logical rollback is refused when ${name}`, { skip }, () => {
    copyDb("hrmig_apply", "hrmig_rb");
    psql("hrmig_rb", mutation);
    const r = sh(`run_rollback_sql clone:hrmig_rb "${repo}/run-apply/rollback-vars.sql" test-rollback`, `${repo}/run-rb`);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /ROLLBACK REFUSED/);
    assert.equal(psql("hrmig_rb", "SELECT to_regclass('public.timesheets') IS NOT NULL AND (SELECT count(*) FROM drizzle.__drizzle_migrations) = 36").stdout.trim(), "t");
  });
}

// ---------- historical data reconciliation (0041 job history, 0041/0042 RBAC) ----------
const summaryOf = path => {
  const f = readFileSync(path, "utf8").split(/\r?\n/).find(l => l.startsWith("SUMMARY\t")).split("\t");
  return { jhProposed: +f[1], jhMissing: +f[2], jhFp: f[3], rbacInsert: +f[4], rbacGrants: +f[5], rbacPreserved: +f[6], rbacRoleMissing: +f[7], rbacFp: f[8] };
};
const tableText = (db, table) => psql(db, `SELECT md5(coalesce(string_agg(t::text, chr(10) ORDER BY t.id), '')) FROM ${table} t`).stdout.trim();
let gapIds;
function writeApproval(s, { jh = true, rbac = true } = {}) {
  writeFileSync(`${pkg}/reconciliation-approval.json`, JSON.stringify({
    job_history: { decision: jh ? "approved" : "pending", proposal_fingerprint: jh ? s.jhFp : null },
    rbac: { decision: rbac ? "approved" : "pending", proposal_fingerprint: rbac ? s.rbacFp : null },
  }));
}

test("reconciliation proposal on production-like gaps: exact rows, missing source never inserted, custom RBAC preserved", { skip }, () => {
  copyDb("hrmig_base", "hrmig_gaps");
  const ids = psql("hrmig_gaps", "SELECT id FROM employees WHERE employment_status <> 'deleted' ORDER BY id LIMIT 3").stdout.trim().split("\n").map(Number);
  gapIds = { fromStart: ids[0], missing: ids[1], fromAssignment: ids[2] };
  psql("hrmig_gaps", `
    DELETE FROM employee_job_history WHERE employee_id IN (${ids.join(",")});
    UPDATE employees SET start_date = '', assignment_effective_date = NULL WHERE id = ${gapIds.missing};
    UPDATE employees SET assignment_effective_date = '2026-03-15' WHERE id = ${gapIds.fromAssignment};
    DELETE FROM permissions WHERE module = 'administrative_decisions';
    DELETE FROM permissions WHERE module = 'staffing_blueprint' AND role_id IN (SELECT id FROM roles WHERE name IN ('Department Manager','Employee'));
    INSERT INTO permissions (role_id, module, action, allowed) SELECT id, 'administrative_decisions', 'view', 0 FROM roles WHERE name = 'HR Manager';
    INSERT INTO permissions (role_id, module, action, allowed) SELECT id, 'staffing_blueprint', 'view', 1 FROM roles WHERE name = 'Employee';`);
  const r = sh(`recon_proposal clone:hrmig_gaps "$RUN_DIR/recon.tsv"; node "$HERE/lineage.mjs" recon-render --recon "$RUN_DIR/recon.tsv" --out "$RUN_DIR"`, `${repo}/run-gaps`);
  assert.equal(r.status, 0, r.stderr);
  const s = summaryOf(`${repo}/run-gaps/recon.tsv`);
  assert.deepEqual([s.jhProposed, s.jhMissing], [2, 1]);
  assert.deepEqual([s.rbacInsert, s.rbacGrants, s.rbacPreserved, s.rbacRoleMissing], [14, 3, 2, 0]);
  const tsv = readFileSync(`${repo}/run-gaps/recon.tsv`, "utf8");
  assert.match(tsv, new RegExp(`^JH\\t${gapIds.missing}\\t[^\\n]*\\tMISSING_SOURCE\\t`, "m"));
  assert.match(tsv, new RegExp(`^JH\\t${gapIds.fromAssignment}\\t[^\\n]*\\t2026-03-15\\tassignment_effective_date$`, "m"));
  assert.match(tsv, /^RBAC\t\d+\tHR Manager\tadministrative_decisions\tview\t1\tPRESERVED_CUSTOM\t0\t/m);
  assert.match(tsv, /^RBAC\t\d+\tEmployee\tstaffing_blueprint\tview\t0\tPRESERVED_CUSTOM\t1\t/m);
  const md = readFileSync(`${repo}/run-gaps/RECONCILIATION_PROPOSAL.md`, "utf8");
  assert.match(md, /Proposed inserts: \*\*2\*\*/);
  assert.match(md, /\*\*MISSING_SOURCE\*\*/);
});

test("approved reconciliation is applied exactly, audited, preserves explicit denials and custom grants, and is idempotent", { skip }, () => {
  const s = summaryOf(`${repo}/run-gaps/recon.tsv`);
  writeApproval(s);
  const att = JSON.parse(readFileSync(`${pkg}/ledger-attestations.json`, "utf8"));
  att.data_checks = [{ id: "0041_job_history_backfill", decision: "accept", reason: "test: one employee has no source date" }];
  writeFileSync(`${pkg}/ledger-attestations.json`, JSON.stringify(att));
  copyDb("hrmig_gaps", "hrmig_gaps_apply");
  const jhBefore = tableText("hrmig_gaps_apply", "employee_job_history"), permBefore = tableText("hrmig_gaps_apply", "permissions");
  const r = sh(`capture_rollback_pre clone:hrmig_gaps_apply "$RUN_DIR/rollback-vars.sql"
    lineage_check clone:hrmig_gaps_apply "$RUN_DIR"
    run_migration clone:hrmig_gaps_apply "$RUN_DIR/migration.log" COMMIT
    capture_rollback_baseline clone:hrmig_gaps_apply "$RUN_DIR/rollback-vars.sql"`, `${repo}/run-gaps-apply`);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const log = readFileSync(`${repo}/run-gaps-apply/migration.log`, "utf8");
  assert.match(log, /HR_RECON_APPLIED job_history_inserted=2 still_without_history=1 \(missing_source=1\) rbac_inserted=14 rbac_still_missing=0 existing_rows_changed=0/);
  assert.match(log, /HR_DATA_PRESERVATION=PASS/);
  const q = sql => psql("hrmig_gaps_apply", sql).stdout.trim();
  assert.equal(q(`SELECT count(*) FROM employee_job_history WHERE employee_id = ${gapIds.missing}`), "0", "no history may be invented without a source date");
  assert.equal(q(`SELECT start_date || '|' || change_reason FROM employee_job_history WHERE employee_id = ${gapIds.fromAssignment}`), "2026-03-15|current_assignment");
  assert.equal(q(`SELECT start_date FROM employee_job_history WHERE employee_id = ${gapIds.fromStart}`), q(`SELECT start_date FROM employees WHERE id = ${gapIds.fromStart}`));
  assert.equal(q("SELECT allowed FROM permissions p JOIN roles r ON r.id = p.role_id WHERE r.name = 'HR Manager' AND module = 'administrative_decisions' AND action = 'view'"), "0", "explicit denial preserved");
  assert.equal(q("SELECT allowed FROM permissions p JOIN roles r ON r.id = p.role_id WHERE r.name = 'Employee' AND module = 'staffing_blueprint' AND action = 'view'"), "1", "custom grant preserved");
  assert.equal(q("SELECT count(*) FROM hr_ops.migration_audit WHERE event = 'recon_job_history'"), "2");
  assert.equal(q("SELECT count(*) FROM hr_ops.migration_audit WHERE event = 'recon_rbac'"), "14");
  // Idempotent: computing the proposal again on the reconciled database proposes nothing new.
  const again = sh(`recon_proposal clone:hrmig_gaps_apply "$RUN_DIR/recon-after.tsv"`, `${repo}/run-gaps-apply`);
  assert.equal(again.status, 0, again.stderr);
  const after = summaryOf(`${repo}/run-gaps-apply/recon-after.tsv`);
  assert.deepEqual([after.jhProposed, after.jhMissing, after.rbacInsert], [0, 1, 0]);
  // Clean rollback removes exactly the reconciliation rows and restores both tables byte for byte.
  copyDb("hrmig_gaps_apply", "hrmig_gaps_rb");
  const rb = sh(`run_rollback_sql clone:hrmig_gaps_rb "${repo}/run-gaps-apply/rollback-vars.sql" test-rollback`, `${repo}/run-gaps-rb`);
  assert.equal(rb.status, 0, rb.stdout + rb.stderr);
  assert.equal(tableText("hrmig_gaps_rb", "employee_job_history"), jhBefore);
  assert.equal(tableText("hrmig_gaps_rb", "permissions"), permBefore);
});

test("logical rollback is refused once a reconciled job-history row was changed by the application", { skip }, () => {
  copyDb("hrmig_gaps_apply", "hrmig_gaps_rb2");
  psql("hrmig_gaps_rb2", `UPDATE employee_job_history SET end_date = '2026-12-31' WHERE employee_id = ${gapIds.fromStart};`);
  const r = sh(`run_rollback_sql clone:hrmig_gaps_rb2 "${repo}/run-gaps-apply/rollback-vars.sql" test-rollback`, `${repo}/run-gaps-rb2`);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /ROLLBACK REFUSED/);
});

for (const [name, change, message] of [
  ["an employee gained history after approval (duplicate prevention)", () => `INSERT INTO employee_job_history (employee_id, start_date, change_reason) VALUES (${gapIds.fromStart}, '2026-01-01', 'manual');`, /job-history proposal differs from the approved one/],
  ["a permission was edited after approval (RBAC conflict)", () => "INSERT INTO permissions (role_id, module, action, allowed) SELECT id, 'administrative_decisions', 'view', 0 FROM roles WHERE name = 'Department Manager';", /RBAC proposal differs from the approved one/],
]) {
  test(`the reconciliation is refused, with nothing applied, when ${name}`, { skip }, () => {
    copyDb("hrmig_gaps", "hrmig_gaps_drift");
    psql("hrmig_gaps_drift", change());
    const r = sh(`capture_rollback_pre clone:hrmig_gaps_drift "$RUN_DIR/vars.sql"
      lineage_check clone:hrmig_gaps_drift "$RUN_DIR" || true
      LINEAGE_JSON="$RUN_DIR/lineage.json"
      run_migration clone:hrmig_gaps_drift "$RUN_DIR/m.log" COMMIT`, `${repo}/run-drift`);
    assert.notEqual(r.status, 0);
    assert.match(readFileSync(`${repo}/run-drift/m.log`, "utf8"), message);
    assert.equal(psql("hrmig_gaps_drift", "SELECT to_regclass('public.timesheets') IS NULL AND (SELECT count(*) FROM drizzle.__drizzle_migrations) = 33").stdout.trim(), "t");
  });
}

test("without approval the gaps are reported and the lineage stays unverified (fail-closed)", { skip }, () => {
  writeApproval(summaryOf(`${repo}/run-gaps/recon.tsv`), { jh: false, rbac: false });
  const r = sh(`lineage_check clone:hrmig_gaps "$RUN_DIR" || echo "rc=$?"`, `${repo}/run-unapproved`);
  assert.match(r.stdout, /rc=4/);
  const report = readFileSync(`${repo}/run-unapproved/ADMIN_ACTION_REPORT.md`, "utf8");
  assert.match(report, /0041_admin_decisions_permissions is FAIL .* not covered by an approved reconciliation \(proposal [0-9a-f]{32} not approved/);
  assert.match(report, /0042_staffing_blueprint_permissions is FAIL/);
});

test("clean logical rollback restores the attested ledger exactly and appends an audit event", { skip }, () => {
  copyDb("hrmig_apply", "hrmig_rb_clean");
  const r = sh(`run_rollback_sql clone:hrmig_rb_clean "${repo}/run-apply/rollback-vars.sql" test-rollback`, `${repo}/run-rb-clean`);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /HR_ROLLBACK=PASS/);
  assert.equal(psql("hrmig_rb_clean", "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id").stdout.trim(), originalLedger);
  assert.equal(psql("hrmig_rb_clean", "SELECT to_regclass('public.timesheets') IS NULL AND (SELECT count(*) FROM hr_ops.migration_audit WHERE event = 'rollback') = 1").stdout.trim(), "t");
});
