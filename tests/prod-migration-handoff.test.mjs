// Release-package checks added for the one-window administrator handoff: the runtime reseed never overwrites
// permissions, the Stage 1 evidence bundle is verified before anything is committed, the job-history and RBAC
// approvals are separate, and ADMIN_HANDOFF.md only names commands, options and files that exist.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadJournal, ledgerFingerprint, parseReconTsv, renderApprovalRequests, approvalEntries, reconciliationStatus,
  scanStartupPaths, ingestBundle, renderStage1Summary, classifyLedger, DATA_CHECKS, RECOVERED_FILES, sha256,
} from "../ops/prod-migration-0052-0054/lineage.mjs";
import { SEED_PERMISSION_SQL, seedPermissionRows } from "../app/api/hr/role-permission-seed.ts";

const PKG = "ops/prod-migration-0052-0054";
const read = path => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const slash = p => p.replace(/\\/g, "/");
const journal = loadJournal(".");
const known = JSON.parse(read(`${PKG}/known-migration-versions.json`)).versions;
const W32 = 1791298824926, W33 = 1791372110232;

/* ---------- runtime reseed ---------- */

test("the runtime reseed is insert-only: a SEED_VERSION bump never overwrites an existing permission", () => {
  assert.match(SEED_PERMISSION_SQL, /^INSERT INTO permissions \(role_id,module,action,allowed\) VALUES \(\?,\?,\?,\?\) ON CONFLICT\(role_id,module,action\) DO NOTHING$/);
  const route = read("app/api/hr/route.ts");
  const seed = route.slice(route.indexOf("async function ensureSeed("), route.indexOf("async function ensureDemoData("));
  assert.ok(seed.length > 1000, "ensureSeed located");
  // The only upsert left is the seed marker itself.
  assert.deepEqual([...seed.matchAll(/"([^"]*DO UPDATE[^"]*)"/gi)].map(m => /setting_key,value_json[\s\S]*'seed_version'/.test(m[1])), [true], "no permission upsert in the reseed");
  assert.doesNotMatch(seed, /UPDATE permissions/i);
  for (const m of seed.matchAll(/"([^"]*INTO permissions[^"]*)"/g)) assert.match(m[1], /INSERT OR IGNORE|DO NOTHING/, m[1]);
  assert.match(seed, /seedPermissionRows\(role\.id,moduleDefaults,ACTIONS\)\) await d1\.prepare\(SEED_PERMISSION_SQL\)/);
  // The only permission DELETE is the removal of the legacy roles' rows; customized rows of current roles are untouched.
  assert.deepEqual([...seed.matchAll(/DELETE FROM permissions[^"]*/g)].map(m => m[0]), ["DELETE FROM permissions WHERE role_id IN (SELECT id FROM roles WHERE name IN ('Admin','HR','Direct Manager'))"]);
  // The Permissions screen still updates rows on purpose; that path is an authenticated administrator action, not the reseed.
  assert.match(route, /for\(const p of values\) await d1\.prepare\("INSERT INTO permissions \(role_id,module,action,allowed\) VALUES \(\?,\?,\?,\?\) ON CONFLICT\(role_id,module,action\) DO UPDATE/);
});

test("seedPermissionRows: an explicit 0 for every non-default action, 1 for the defaults", () => {
  assert.deepEqual(seedPermissionRows(7, { payroll: [], staffing_blueprint: ["view"] }, ["view", "edit"]),
    [[7, "payroll", "view", 0], [7, "payroll", "edit", 0], [7, "staffing_blueprint", "view", 1], [7, "staffing_blueprint", "edit", 0]]);
});

/* ---------- separate approvals ---------- */

const RECON_TSV = ["JH\t17\tAC-002\tactive\tPROPOSED\t1\t\t4\t\t9\t\t2025-12-01\tstart_date", "JH\t18\tAC-003\tactive\tMISSING_SOURCE\t1\t\t4\t\t9\t\t\t",
  "RBAC\t3\tHR Manager\tadministrative_decisions\tview\t1\tPROPOSED_INSERT\t\t0041_employee_profile_and_decisions",
  "RBAC\t5\tEmployee\tstaffing_blueprint\tedit\t0\tPROPOSED_INSERT\t\t0042_staffing_blueprint",
  "RBAC\t3\tHR Manager\tstaffing_blueprint\tview\t1\tPRESERVED_CUSTOM\t0\t0042_staffing_blueprint",
  "COUNT\temployees_without_job_history\t2", `SUMMARY\t1\t1\t${"a".repeat(32)}\t2\t1\t1\t0\t${"b".repeat(32)}`].join("\n");

test("job history and RBAC get separate approval requests with exact rows, fingerprints and the entry to commit", () => {
  const before = parseReconTsv(RECON_TSV);
  const { jobHistoryMd, rbacMd } = renderApprovalRequests(before);
  assert.match(jobHistoryMd, /^# Approval request 1 of 2: job-history reconciliation/);
  assert.match(jobHistoryMd, new RegExp(`Fingerprint: \`${"a".repeat(32)}\``));
  assert.match(jobHistoryMd, /\| 17 \| AC-002 \| 1 \| {2}\| 4 \| {2}\| 9 \| {2}\| 2025-12-01 \| start_date \|/);
  assert.match(jobHistoryMd, /MISSING_SOURCE employees: decision needed[\s\S]*18 \(AC-003\)[\s\S]*0041_job_history_backfill/);
  assert.doesNotMatch(jobHistoryMd, /administrative_decisions/, "the job-history request says nothing about access");
  assert.match(rbacMd, /^# Approval request 2 of 2: RBAC reconciliation/);
  assert.match(rbacMd, /## Access grants \(allowed=1\)[^#]*administrative_decisions:view/);
  assert.match(rbacMd, /## Explicit denials \(allowed=0\)[^#]*staffing_blueprint:edit/);
  assert.match(rbacMd, /## Existing rows kept unchanged \(PRESERVED_CUSTOM\)[^#]*staffing_blueprint:view \| 0 \(seed would be 1\)/);
  assert.doesNotMatch(rbacMd, /AC-002/, "the RBAC request says nothing about employees");
  for (const md of [jobHistoryMd, rbacMd]) assert.match(md, /\| APPROVE \/ REJECT \| \| \|/);
});

test("the approval entries, once committed, approve exactly the current proposal and nothing after it changes", () => {
  const before = parseReconTsv(RECON_TSV);
  const entries = approvalEntries(before);
  assert.deepEqual(entries.job_history.employee_ids, [17], "MISSING_SOURCE employees are never part of the approval");
  assert.deepEqual(entries.rbac.rows, ["HR Manager:administrative_decisions:view=1", "Employee:staffing_blueprint:edit=0"]);
  const committed = JSON.parse(read(`${PKG}/reconciliation-approval.json`));
  const approval = { job_history: { ...committed.job_history, ...entries.job_history }, rbac: { ...committed.rbac, ...entries.rbac } };
  const st = reconciliationStatus({ ...before.summary, jh: { ...before.summary.jh, missing_source: 0 } }, approval);
  assert.equal(st.job_history.state, "approved and current");
  assert.equal(st.rbac.state, "approved and current");
  const drift = reconciliationStatus({ ...before.summary, rbac: { ...before.summary.rbac, fp: "c".repeat(32) } }, approval);
  assert.equal(drift.rbac.covers, null);
});

/* ---------- startup paths ---------- */

test("startup-path scan flags every way of running Drizzle migrations and nothing else", () => {
  const clean = scanStartupPaths("[Service]\nExecStart=/usr/bin/node /opt/sanaa-hr/app/server.js\nEnvironmentFile=/etc/sanaa-hr/hr.env\n0 3 * * * /usr/local/bin/backup.sh");
  assert.equal(clean.clean, true);
  for (const bad of ["ExecStartPre=/usr/bin/npx drizzle-kit migrate", "ExecStartPre=npm run db:migrate", "*/5 * * * * cd /opt && npx drizzle-kit push",
    "node -e \"require('drizzle-orm/postgres-js/migrator')\"", "await migrate(db, {})", "npm run prod-migrate"]) {
    const r = scanStartupPaths(`ExecStart=/usr/bin/node a.js\n${bad}`);
    assert.equal(r.clean, false, bad);
    assert.equal(r.flagged[0].line, 2);
  }
});

/* ---------- Stage 1 bundle -> developer ingest ---------- */

/** A temporary repo copy (journal, migrations, package decisions) and a Stage 1 bundle whose recovered files explain rows 32/33. */
function fixture({ tamper = false } = {}) {
  const root = slash(mkdtempSync(join(tmpdir(), "hr-handoff-")));
  const repo = `${root}/repo`, pkg = `${repo}/${PKG}`, bundle = `${root}/evidence-run`;
  mkdirSync(`${repo}/drizzle-postgres/meta`, { recursive: true }); mkdirSync(pkg, { recursive: true });
  cpSync("drizzle-postgres", `${repo}/drizzle-postgres`, { recursive: true });
  for (const f of ["known-migration-versions.json", "ledger-attestations.json", "reconciliation-approval.json"]) cpSync(`${PKG}/${f}`, `${pkg}/${f}`);
  const ev = `${bundle}/evidence-bundle/vps-lineage`;
  mkdirSync(`${ev}/meta`, { recursive: true });
  const f31 = Buffer.from('CREATE TABLE "a" ("id" serial PRIMARY KEY);\r\n--> statement-breakpoint\r\nCREATE TABLE "b" ("id" serial);\r\n');
  const f32 = Buffer.from('ALTER TABLE "attendance_devices" ADD COLUMN "country" text;\n');
  const j = Buffer.from(JSON.stringify({ version: "7", dialect: "postgresql", entries: [
    { idx: 31, version: "7", when: W32, tag: "0031_vps_current_schema", breakpoints: true },
    { idx: 32, version: "7", when: W33, tag: "0032_vps_attendance_device_country", breakpoints: true }] }, null, 2));
  writeFileSync(`${ev}/0031_vps_current_schema.sql`, f31); writeFileSync(`${ev}/0032_vps_attendance_device_country.sql`, f32); writeFileSync(`${ev}/meta/_journal.json`, j);
  writeFileSync(`${ev}/SOURCE.txt`, [`# collected`, `${sha256(f31)}  0031_vps_current_schema.sql  mtime=x  owner=root:root  bytes=${f31.length}`,
    `${sha256(f32)}  0032_vps_attendance_device_country.sql  mtime=x  owner=root:root  bytes=${f32.length}`, `${sha256(j)}  meta/_journal.json  mtime=x  owner=root:root  bytes=${j.length}`, ""].join("\n"));
  if (tamper) writeFileSync(`${ev}/0032_vps_attendance_device_country.sql`, Buffer.from('ALTER TABLE "attendance_devices" ADD COLUMN "country" text;\r\n'));
  const ledger = journal.filter(e => e.idx <= 30).map((e, i) => ({ id: i + 1, hash: e.hash, created_at: e.when }))
    .concat([{ id: 32, hash: sha256(f31), created_at: W32 }, { id: 33, hash: sha256(f32), created_at: W33 }]);
  writeFileSync(`${bundle}/ledger.tsv`, ledger.map(r => `${r.id}\t${r.hash}\t${r.created_at}`).join("\n") + "\n");
  writeFileSync(`${bundle}/data-checks.tsv`, DATA_CHECKS.map(c => `${c.id}\tPASS\tok`).join("\n") + "\n");
  writeFileSync(`${bundle}/recon.tsv`, RECON_TSV + "\n");
  return { repo, pkg, bundle, ev, ledger, f31 };
}

test("ingest: recovered files that match SOURCE.txt and the ledger explain rows 32/33; dry run writes nothing", () => {
  const { pkg, bundle, ledger } = fixture();
  const r = ingestBundle({ bundle, pkgDir: pkg });
  assert.equal(r.ok, true, r.problems.join("; "));
  assert.deepEqual(r.recovered, [32, 33]);
  assert.equal(r.fingerprint, ledgerFingerprint(ledger));
  assert.equal(r.written, false);
  assert.equal(existsSync(`${pkg}/evidence/vps-lineage/0031_vps_current_schema.sql`), false);
  // Without the reviewed fingerprint and approvals nothing is verified yet: ingesting is not approving.
  assert.equal(r.result.verified, false);
  assert.match(r.result.reasons.join("\n"), /has not been attested/);
});

test("ingest --write copies the recovered files byte for byte (CRLF kept) and refuses to overwrite different content", () => {
  const { pkg, bundle, f31 } = fixture();
  const r = ingestBundle({ bundle, pkgDir: pkg, write: true });
  assert.equal(r.written, true);
  assert.ok(readFileSync(`${pkg}/evidence/vps-lineage/0031_vps_current_schema.sql`).equals(f31));
  for (const f of [...RECOVERED_FILES, "SOURCE.txt"]) assert.ok(existsSync(`${pkg}/evidence/vps-lineage/${f}`), f);
  assert.equal(ingestBundle({ bundle, pkgDir: pkg, write: true }).ok, true, "re-ingesting identical files is idempotent");
  writeFileSync(`${pkg}/evidence/vps-lineage/0031_vps_current_schema.sql`, "changed");
  const again = ingestBundle({ bundle, pkgDir: pkg, write: true });
  assert.equal(again.ok, false);
  assert.match(again.problems.join("\n"), /already exists with different content/);
});

test("ingest refuses a bundle whose files no longer match SOURCE.txt (altered in transit, e.g. line endings)", () => {
  const { pkg, bundle } = fixture({ tamper: true });
  const r = ingestBundle({ bundle, pkgDir: pkg, write: true });
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /0032_vps_attendance_device_country\.sql: sha256 .* differs from SOURCE\.txt/);
  assert.equal(existsSync(`${pkg}/evidence/vps-lineage`), false);
});

test("with the ingested files, the reviewed fingerprint and both approvals, the lineage verifies; without any one it does not", () => {
  const { pkg, bundle, ledger } = fixture();
  ingestBundle({ bundle, pkgDir: pkg, write: true });
  const att = JSON.parse(readFileSync(`${pkg}/ledger-attestations.json`, "utf8"));
  const recon = parseReconTsv(RECON_TSV.replace(/^JH\t18.*\n/m, "").replace(`SUMMARY\t1\t1\t`, `SUMMARY\t1\t0\t`));
  const entries = approvalEntries(recon);
  const failing = DATA_CHECKS.map(c => ({ id: c.id, status: c.reconciledBy ? "FAIL" : "PASS", evidence: "" }));
  const evidence = JSON.parse(JSON.stringify(ingestBundle({ bundle, pkgDir: pkg }).result.evidence));
  const run = (attestations, approval) => classifyLedger({ ledger, journal, known, attestations, dataChecks: failing, evidence, recon: recon.summary, approval });
  const full = { ...att, production_ledger: { fingerprint: ledgerFingerprint(ledger) } };
  assert.equal(run(full, entries).verified, true, run(full, entries).reasons.join("; "));
  assert.equal(run(att, entries).verified, false, "fingerprint not attested");
  assert.equal(run(full, { job_history: entries.job_history }).verified, false, "RBAC not approved");
  assert.equal(run(full, { rbac: entries.rbac }).verified, false, "job history not approved");
});

test("STAGE1_SUMMARY lists the values to copy and only genuine blockers", () => {
  const { pkg, bundle } = fixture();
  const r = ingestBundle({ bundle, pkgDir: pkg });
  const base = { lineage: r.result, provisional: r.result, recon: parseReconTsv(RECON_TSV), runtime: { dbSeedVersion: "s", releaseSeedVersion: "s" },
    startup: { clean: true, flagged: [] }, candidate: "git_sha: abc\nCANDIDATE=PASS\n", deployer: { sha: "d", pinned: "d" }, manifest: { ok: true, problems: [] } };
  const { md, blockers } = renderStage1Summary(base);
  assert.match(md, new RegExp(`Ledger fingerprint \\| \`${r.fingerprint}\``));
  assert.deepEqual(blockers, ["1 employee(s) are MISSING_SOURCE: HR/business decision A or B in APPROVAL_JOB_HISTORY.md."]);
  const bad = renderStage1Summary({ ...base, runtime: { dbSeedVersion: "old", releaseSeedVersion: "new" }, startup: { clean: false, flagged: [{ line: 4, text: "x" }] },
    candidate: "CANDIDATE=FAIL\n", deployer: { sha: "e", pinned: "d" }, manifest: null }).blockers.join("\n");
  for (const re of [/seed_version mismatch/, /startup-paths\.txt lines 4/, /candidate release's schema-audit files differ/, /deployer changed/, /were not collected/]) assert.match(bad, re);
});

/* ---------- shell helpers (Stage 1 collection) ---------- */

function sh(commands) {
  const script = `set -Eeuo pipefail\nsource "${slash(process.cwd())}/${PKG}/hr-migrate-0052-0054.sh"\nRUN_DIR=""\n${commands}`;
  return spawnSync("bash", ["-c", script], { encoding: "utf8" });
}

test("collect_recovered copies byte-exact and writes a SOURCE.txt that ingest accepts", () => {
  const { ev } = fixture();
  const out = slash(mkdtempSync(join(tmpdir(), "hr-collect-")));
  writeFileSync(`${ev}/ORIGIN.txt`, "/opt/sanaa-hr/vps-drizzle/ (found by DevOps)\n");
  const r = sh(`collect_recovered "${ev}" "${out}/vps-lineage"`);
  assert.equal(r.status, 0, r.stderr);
  for (const f of RECOVERED_FILES) assert.ok(readFileSync(`${out}/vps-lineage/${f}`).equals(readFileSync(`${ev}/${f}`)), f);
  const source = readFileSync(`${out}/vps-lineage/SOURCE.txt`, "utf8");
  assert.match(source, /# {3}\/opt\/sanaa-hr\/vps-drizzle\//);
  assert.match(source, /^[0-9a-f]{64} {2}0031_vps_current_schema\.sql {2}mtime=\S+ {2}owner=\S+ {2}bytes=\d+$/m);
  const missing = sh(`rm "${ev}/meta/_journal.json"; collect_recovered "${ev}" "${out}/again"`);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /recovered file missing: .*meta\/_journal\.json/);
});

test("candidate_check passes only for a release with the reviewed schema-audit files and the same SEED_VERSION", () => {
  const cand = slash(mkdtempSync(join(tmpdir(), "hr-cand-")));
  mkdirSync(`${cand}/ops`); mkdirSync(`${cand}/app/api/hr`, { recursive: true });
  for (const f of ["ops/hr-schema-audit.sh", "ops/hr-schema-contract.json"]) writeFileSync(`${cand}/${f}`, read(f));
  writeFileSync(`${cand}/app/api/hr/route.ts`, read("app/api/hr/route.ts"));
  const ok = sh(`candidate_check "${cand}" "${cand}/c.txt"; cat "${cand}/c.txt"`);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /ops\/hr-schema-audit\.sh [0-9a-f]{64} MATCH/);
  assert.match(ok.stdout, /^CANDIDATE=PASS$/m);
  writeFileSync(`${cand}/app/api/hr/route.ts`, 'const SEED_VERSION = "bumped";\n');
  assert.match(sh(`candidate_check "${cand}" "${cand}/c.txt"; cat "${cand}/c.txt"`).stdout, /^CANDIDATE=FAIL$/m);
});

/* ---------- the handoff document ---------- */

test("ADMIN_HANDOFF.md names only real commands, options, confirmations and files, and every approval checkpoint", () => {
  const doc = read(`${PKG}/ADMIN_HANDOFF.md`), script = read(`${PKG}/hr-migrate-0052-0054.sh`);
  const commands = [...script.matchAll(/^\s{4}(\w+)\)\s+cmd_/gm)].map(m => m[1]);
  assert.deepEqual(commands.sort(), ["apply", "evidence", "postdeploy", "preflight", "rehearse", "rollback"]);
  const used = [...doc.matchAll(/hr-migrate-0052-0054\.sh\s+(\w+)/g)].map(m => m[1]);
  for (const c of used) assert.ok(commands.includes(c), `handoff uses unknown command ${c}`);
  for (const c of commands) assert.ok(used.includes(c), `handoff never shows ${c}`);
  const options = [...script.matchAll(/^\s+(--[a-z0-9-]+)\)/gm)].map(m => m[1]);
  for (const o of doc.matchAll(/\s(--[a-z][a-z0-9-]+)/g)) if (!["--quiet", "--format", "--write", "--bundle", "--clean", "--accept-catalog-drift-never"].includes(o[1])) assert.ok(options.includes(o[1]), `handoff uses unknown option ${o[1]}`);
  assert.match(doc, /--confirm APPLY-0052-0054-ON-sanaa_hr/); assert.match(script, /CONFIRM_APPLY="APPLY-0052-0054-ON-\$DB"/);
  assert.match(doc, /--confirm ROLLBACK-0052-0054-ON-sanaa_hr/);
  for (const cp of ["CHECKPOINT A", "CHECKPOINT B", "CHECKPOINT C", "CHECKPOINT D"]) assert.match(doc, new RegExp(cp));
  for (const f of doc.matchAll(/`((?:[\w-]+\/)*[\w.-]+\.(?:sql|json|mjs|sh|md))`/g)) {
    const name = f[1];
    if (/^(0031_vps|0032_vps|_journal|SOURCE|ORIGIN|STAGE1_SUMMARY|LINEAGE_REPORT|ADMIN_ACTION_REPORT|RECONCILIATION_|APPROVAL_|DISCOVERY|lineage\.json|runtime\.json|POSTDEPLOY)/.test(name.split("/").at(-1))) continue;   // run outputs
    assert.ok(existsSync(name) || existsSync(`${PKG}/${name}`), `handoff references missing file ${name}`);
  }
  const files = readdirSync(PKG);
  assert.ok(files.includes("ADMIN_HANDOFF.md") && files.includes("access-snapshot.sql"));
});

test("the shell and lineage.mjs agree on the recovered files and the read-only Stage 1 never writes to the database", () => {
  const script = read(`${PKG}/hr-migrate-0052-0054.sh`);
  assert.deepEqual(/RECOVERED_FILES=\(([^)]*)\)/.exec(script)[1].split(/\s+/), RECOVERED_FILES);
  const evidence = script.slice(script.indexOf("cmd_evidence() {"), script.indexOf("cmd_preflight() {"));
  assert.doesNotMatch(evidence, /run_migration|run_rollback_sql|take_backup|systemctl (stop|start|restart)|COMMIT/);
  const snap = read(`${PKG}/access-snapshot.sql`).replace(/--[^\n]*/g, "");
  assert.doesNotMatch(snap, /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i);
  const post = script.slice(script.indexOf("cmd_postdeploy() {"), script.indexOf("cmd_rollback() {"));
  assert.doesNotMatch(post, /run_migration|run_rollback_sql|systemctl (stop|start|restart)|hr_managers_sql "\$HR_MANAGERS" \|/);
  const apply = script.slice(script.indexOf("cmd_apply() {"), script.indexOf("cmd_postdeploy() {"));
  assert.ok(apply.indexOf("access_snapshot prod") > apply.indexOf("HR_VALIDATION=PASS") && apply.indexOf("access_snapshot prod") < apply.indexOf("restore_service\n"),
    "the access snapshot is taken after validation and before HR is restarted");
});
