import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyLedger, ledgerFingerprint, loadJournal, journalProblems, introducedObjects, psqlVars, auditSql, discoverJournals,
  parseLedgerTsv, parseReconTsv, renderReconciliation, reconciliationStatus, PACKAGE_TAGS, DATA_CHECKS, sha256,
} from "../ops/prod-migration-0052-0054/lineage.mjs";

const PKG = "ops/prod-migration-0052-0054";
const read = path => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const journal = loadJournal(".");
const known = JSON.parse(read(`${PKG}/known-migration-versions.json`)).versions;
const byTag = prefix => journal.find(e => e.tag.startsWith(prefix));
const UNKNOWN_32 = { created_at: 1791298824926, hash: "a".repeat(64) };
const UNKNOWN_33 = { created_at: 1791372110232, hash: "b".repeat(64) };

/** Production as the VPS administrator reported it: 0000-0030 recorded, then two rows from an unknown journal. */
function productionLedger() {
  const rows = journal.filter(e => e.idx <= 30).map((e, i) => ({ id: i + 1, hash: e.hash, created_at: e.when }));
  rows.push({ id: 32, ...UNKNOWN_32 }, { id: 33, ...UNKNOWN_33 });
  return rows;
}
const allPass = DATA_CHECKS.map(c => ({ id: c.id, status: "PASS", evidence: "ok" }));
function attest(ledger, extra = {}) {
  return {
    production_ledger: { fingerprint: ledgerFingerprint(ledger) },
    rows: [{ ...UNKNOWN_32, decision: "accept", identified_as: "vps journal A" }, { ...UNKNOWN_33, decision: "accept", identified_as: "vps journal B" }],
    data_checks: [], ...extra,
  };
}

test("the reported production ledger is NOT verified with the committed (empty) attestations", () => {
  const ledger = productionLedger();
  const att = JSON.parse(read(`${PKG}/ledger-attestations.json`));
  const r = classifyLedger({ ledger, journal, known, attestations: att, dataChecks: allPass });
  assert.equal(r.verified, false);
  assert.deepEqual(r.rows.filter(x => !x.ok).map(x => [x.id, x.class]), [[32, "UNKNOWN_LINEAGE"], [33, "UNKNOWN_LINEAGE"]]);
  assert.match(r.reasons.join("\n"), /has not been attested/);
});

test("divergent history: Drizzle would skip 0052/0053 and apply only 0054; the package makes 0054 the head", () => {
  const r = classifyLedger({ ledger: productionLedger(), journal, known, attestations: {}, dataChecks: allPass });
  assert.equal(r.head, UNKNOWN_33.created_at);
  assert.deepEqual(r.drizzleWouldApply, ["0054_deleted_employee_email"]);
  assert.ok(r.coveredUnrecorded.includes("0052_timesheet_management") && r.coveredUnrecorded.includes("0053_payroll_rebuild"));
  assert.match(r.hazards.join("\n"), /0052_timesheet_management, 0053_payroll_rebuild: drizzle-kit migrate would treat them as applied/);
  assert.equal(r.projectedHead, byTag("0054").when);
  assert.deepEqual(r.projectedPending, []);
  assert.deepEqual(r.outOfBand, journal.filter(e => e.idx >= 31 && e.idx <= 51).map(e => e.tag));
});

test("verified only with row attestations, the exact ledger fingerprint and passing data checks", () => {
  const ledger = productionLedger();
  const r = classifyLedger({ ledger, journal, known, attestations: attest(ledger), dataChecks: allPass });
  assert.equal(r.verified, true, r.reasons.join("; "));
  assert.equal(r.fingerprint, ledgerFingerprint(ledger));
});

test("an attestation for the right timestamp but a different hash does not explain a row", () => {
  const ledger = productionLedger();
  const att = attest(ledger);
  att.rows[0] = { ...att.rows[0], hash: "c".repeat(64) };
  const r = classifyLedger({ ledger, journal, known, attestations: att, dataChecks: allPass });
  assert.equal(r.verified, false);
  assert.equal(r.rows.find(x => x.id === 32).ok, false);
});

test("a ledger that changed after it was attested is refused", () => {
  const ledger = productionLedger();
  const att = attest(ledger);
  const changed = [...ledger, { id: 34, hash: byTag("0054").hash, created_at: byTag("0054").when }];
  const r = classifyLedger({ ledger: changed, journal, known, attestations: att, dataChecks: allPass });
  assert.equal(r.verified, false);
  assert.match(r.reasons.join("\n"), /differs from the attested/);
});

test("unexpected hashes at known timestamps: committed versions (LF or CRLF) are explained, others are not", () => {
  const e = byTag("0017");
  const crlf = sha256(read(`drizzle-postgres/${e.tag}.sql`).replace(/\n/g, "\r\n"));
  const base = [{ id: 1, hash: crlf, created_at: e.when }];
  const r1 = classifyLedger({ ledger: base, journal, known, attestations: {}, dataChecks: [] });
  assert.equal(r1.rows[0].class, "HISTORICAL_VERSION");
  assert.match(r1.rows[0].detail, /crlf/);
  const r2 = classifyLedger({ ledger: [{ id: 1, hash: "d".repeat(64), created_at: e.when }], journal, known, attestations: {}, dataChecks: [] });
  assert.equal(r2.rows[0].class, "TIMESTAMP_KNOWN_HASH_UNKNOWN");
  assert.equal(r2.rows[0].ok, false);
});

test("ordering conflicts are blocking even when attested: newer than the release, package already recorded, duplicates", () => {
  const ledger = productionLedger();
  const cases = [
    [{ id: 34, hash: "e".repeat(64), created_at: byTag("0054").when + 1 }, "NEWER_THAN_RELEASE"],
    [{ id: 34, hash: byTag("0052").hash, created_at: byTag("0052").when }, "PACKAGE_ALREADY_RECORDED"],
    [{ id: 34, hash: "f".repeat(64), created_at: UNKNOWN_33.created_at }, "DUPLICATE_TIMESTAMP"],
  ];
  for (const [row, cls] of cases) {
    const l = [...ledger, row];
    const att = attest(l, { rows: [...attest(l).rows, { created_at: row.created_at, hash: row.hash, decision: "accept" }] });
    const r = classifyLedger({ ledger: l, journal, known, attestations: att, dataChecks: allPass });
    assert.equal(r.verified, false, cls);
    assert.ok(r.rows.some(x => x.class === cls && !x.ok), cls);
  }
});

test("data operations of unrecorded migrations must pass or be attested; recorded migrations are not re-checked", () => {
  const ledger = productionLedger();
  const failing = allPass.map(c => c.id === "0041_job_history_backfill" ? { ...c, status: "FAIL", evidence: "12 of 40 missing" } : c);
  const r1 = classifyLedger({ ledger, journal, known, attestations: attest(ledger), dataChecks: failing });
  assert.equal(r1.verified, false);
  assert.match(r1.reasons.join("\n"), /0041_job_history_backfill is FAIL/);
  const att = attest(ledger, { data_checks: [{ id: "0041_job_history_backfill", decision: "accept", reason: "reviewed" }] });
  assert.equal(classifyLedger({ ledger, journal, known, attestations: att, dataChecks: failing }).verified, true);
  // A ledger that records every migration up to 0051 needs no data checks at all.
  const full = journal.filter(e => e.idx <= 51).map((e, i) => ({ id: i + 1, hash: e.hash, created_at: e.when }));
  const r3 = classifyLedger({ ledger: full, journal, known, attestations: { production_ledger: { fingerprint: ledgerFingerprint(full) } }, dataChecks: [] });
  assert.equal(r3.checks.length, 0);
  assert.equal(r3.verified, true, r3.reasons.join("; "));
});

test("ledger fingerprint equals the SQL definition md5(string_agg(id:hash:created_at, ',' ORDER BY id))", () => {
  const rows = [{ id: 2, hash: "y", created_at: 20 }, { id: 1, hash: "x", created_at: 10 }];
  assert.equal(ledgerFingerprint(rows), createHash("md5").update("1:x:10,2:y:20").digest("hex"));
  assert.deepEqual(parseLedgerTsv("1\tx\t10\n2\ty\t20\n"), [{ id: 1, hash: "x", created_at: 10 }, { id: 2, hash: "y", created_at: 20 }]);
});

test("journal is strictly ordered and the generated package files match it", () => {
  assert.deepEqual(journalProblems(journal), []);
  assert.deepEqual(journalProblems([{ idx: 0, tag: "a", when: 2 }, { idx: 1, tag: "b", when: 1 }]).length, 1);
  const expected = read(`${PKG}/expected-ledger.sql`);
  for (const e of journal) assert.ok(expected.includes(`(${e.idx},''${e.tag}'',''${e.hash}'',${e.when}::bigint)`), e.tag);
  for (const e of journal) assert.ok(known.some(k => k.tag === e.tag && k.when === e.when && k.hash === e.hash), `known versions lack ${e.tag}`);
  for (const line of read(`${PKG}/files.sha256`).trim().split("\n")) {
    const [hash, path] = line.split(/\s+/);
    assert.equal(sha256(read(path)), hash, `${path} changed without regenerating the package`);
  }
});

test("rollback guards and validation cover every table and column 0052-0054 introduce", () => {
  const { tables, columns } = introducedObjects(PACKAGE_TAGS.map(t => read(`drizzle-postgres/${t}.sql`)));
  assert.equal(tables.length, 27);
  assert.equal(columns.length, 22);
  const baseline = read(`${PKG}/rollback-baseline.sql`), template = read(`${PKG}/rollback-template.sql`);
  const validate = read(`${PKG}/validate.sql`), guards = read(`${PKG}/guards.sql`), missing = read(`${PKG}/expected-missing.txt`);
  const dropList = /DROP TABLE ([\s\S]*?);/.exec(template)[1];
  for (const t of tables) {
    for (const [name, text] of [["rollback-baseline", baseline], ["validate", validate], ["guards", guards]]) assert.ok(text.includes(`'${t}'`), `${t} missing from ${name}`);
    assert.match(dropList, new RegExp(`\\b${t}\\b`), `${t} missing from the rollback DROP TABLE`);
    assert.ok(missing.includes(`MISSING_TABLE: ${t}\n`), `${t} missing from expected-missing.txt`);
  }
  for (const c of columns) {
    for (const [name, text] of [["rollback-template", template], ["validate", validate], ["guards", guards]]) assert.ok(text.includes(`'${c}'`), `${c} missing from ${name}`);
    assert.ok(missing.includes(`MISSING_COLUMN: ${c}\n`), `${c} missing from expected-missing.txt`);
  }
  for (const t of ["hr_managers", "portal_session_activity", "user_permissions"]) assert.ok(baseline.includes(`'${t}'`));
});

test("existing ledger rows are never updated or deleted, and only package rows can be removed by rollback", () => {
  const files = ["guards.sql", "ledger-record.sql", "validate.sql", "audit.sql", "rollback-baseline.sql", "fingerprint-begin.sql", "fingerprint-end.sql"];
  for (const f of files) assert.doesNotMatch(read(`${PKG}/${f}`), /(UPDATE|DELETE FROM)\s+drizzle\./i, f);
  const template = read(`${PKG}/rollback-template.sql`);
  const deletes = [...template.matchAll(/DELETE FROM drizzle\.__drizzle_migrations[\s\S]*?;/gi)].map(m => m[0]);
  assert.equal(deletes.length, 1);
  assert.match(deletes[0], /m\.id > :ledger_pre_max_id/);
  assert.match(deletes[0], /m\.hash = e\.hash AND m\.created_at = e\.created_at/);
  assert.match(read(`${PKG}/ledger-record.sql`), /WHERE e\.idx IN \(52, 53, 54\)/);
  assert.doesNotMatch(read(`${PKG}/hr-migrate-0052-0054.sh`), /keep-ledger/);
});

test("the in-transaction guard can never pass without a committed fingerprint attestation", () => {
  assert.ok(psqlVars(".").startsWith("\\set attested_ledger_fp 'not-attested'\n"));
  assert.match(read(`${PKG}/guards.sql`), /:'hr_ledger_fp' <> :'attested_ledger_fp'/);
});

test("the deployer is pinned to the reviewed hash and is not approved yet", () => {
  const review = JSON.parse(read(`${PKG}/deployer-review.json`));
  assert.equal(review.sha256, "2df500bdc1c75b927b8aeff733d1e204c49932aed8d9fcbf4b3686b58b3a5fc7");
  assert.notEqual(review.status, "approved");
});

test("journal discovery finds the source of a foreign ledger row and checks its file hash", () => {
  const root = mkdtempSync(join(tmpdir(), "hr-discover-"));
  const folder = join(root, "releases", "abc", "drizzle-postgres");
  mkdirSync(join(folder, "meta"), { recursive: true });
  const text = "CREATE TABLE x (id int);\n";
  writeFileSync(join(folder, "0031_generated.sql"), text);
  writeFileSync(join(folder, "0032_other.sql"), "SELECT 1;\n");
  writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify({ entries: [
    { idx: 31, tag: "0031_generated", when: UNKNOWN_32.created_at }, { idx: 32, tag: "0032_other", when: UNKNOWN_33.created_at }] }));
  const found = discoverJournals({ ledger: [{ id: 32, hash: sha256(text), created_at: UNKNOWN_32.created_at }, { id: 33, ...UNKNOWN_33 }], roots: [root] });
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].matches.map(m => [m.ledger_id, m.tag, m.hash_matches]), [[32, "0031_generated", true], [33, "0032_other", false]]);
});

// ---------- recovered evidence, reconciliation coverage, application-startup paths ----------
const evidenceFor = (hash32, hash33, present = true) => [
  { tag: "0031_vps_current_schema", when: UNKNOWN_32.created_at, file: "evidence/vps-lineage/0031_vps_current_schema.sql", present, hash: present ? hash32 : null },
  { tag: "0032_vps_attendance_device_country", when: UNKNOWN_33.created_at, file: "evidence/vps-lineage/0032_vps_attendance_device_country.sql", present, hash: present ? hash33 : null },
];
const evidenceAttestation = ledger => ({
  production_ledger: { fingerprint: ledgerFingerprint(ledger) },
  rows: [{ created_at: UNKNOWN_32.created_at, evidence_tag: "0031_vps_current_schema", decision: "accept" },
         { created_at: UNKNOWN_33.created_at, evidence_tag: "0032_vps_attendance_device_country", decision: "accept" }],
});

test("recovered VPS migrations explain rows 32/33 only when the committed files hash to the ledger values", () => {
  const ledger = productionLedger();
  const ok = classifyLedger({ ledger, journal, known, attestations: evidenceAttestation(ledger), dataChecks: allPass, evidence: evidenceFor(UNKNOWN_32.hash, UNKNOWN_33.hash) });
  assert.deepEqual(ok.rows.filter(r => r.id >= 32).map(r => [r.class, r.ok]), [["RECOVERED_SOURCE", true], ["RECOVERED_SOURCE", true]]);
  assert.equal(ok.verified, true, ok.reasons.join("; "));
  const mismatch = classifyLedger({ ledger, journal, known, attestations: evidenceAttestation(ledger), dataChecks: allPass, evidence: evidenceFor("9".repeat(64), UNKNOWN_33.hash) });
  assert.equal(mismatch.rows.find(r => r.id === 32).class, "RECOVERED_SOURCE_HASH_MISMATCH");
  assert.equal(mismatch.verified, false);
  const absent = classifyLedger({ ledger, journal, known, attestations: evidenceAttestation(ledger), dataChecks: allPass, evidence: evidenceFor(null, null, false) });
  assert.equal(absent.verified, false);
  assert.match(absent.rows.find(r => r.id === 32).detail, /not committed/);
});

test("the committed attestation references the recovered files and stays unverified until they and the fingerprint are committed", () => {
  const att = JSON.parse(read(`${PKG}/ledger-attestations.json`));
  assert.deepEqual(att.rows.map(r => [r.created_at, r.evidence_tag, r.decision]),
    [[UNKNOWN_32.created_at, "0031_vps_current_schema", "accept"], [UNKNOWN_33.created_at, "0032_vps_attendance_device_country", "accept"]]);
  assert.ok(att.rows.every(r => !r.hash), "hashes must come from the committed evidence files, never typed by hand");
  assert.equal(att.production_ledger, null);
  const r = classifyLedger({ ledger: productionLedger(), journal, known, attestations: att, dataChecks: allPass, evidence: [] });
  assert.equal(r.verified, false);
});

const reconSummary = (o = {}) => ({ jh: { proposed: 1, missing_source: 0, fp: "a".repeat(32), ...o.jh }, rbac: { insert: 4, grants: 4, preserved: 0, role_missing: 0, fp: "b".repeat(32), ...o.rbac } });
const failing3 = allPass.map(c => ["0041_job_history_backfill", "0041_admin_decisions_permissions", "0042_staffing_blueprint_permissions"].includes(c.id) ? { ...c, status: "FAIL" } : c);

test("failed data checks are covered only by an approved reconciliation whose fingerprint equals the current proposal", () => {
  const ledger = productionLedger();
  const approved = { job_history: { decision: "approved", proposal_fingerprint: "a".repeat(32) }, rbac: { decision: "approved", proposal_fingerprint: "b".repeat(32) } };
  const base = { ledger, journal, known, attestations: attest(ledger), dataChecks: failing3 };
  assert.equal(classifyLedger({ ...base, recon: reconSummary(), approval: approved }).verified, true);
  assert.equal(classifyLedger({ ...base, recon: reconSummary(), approval: {} }).verified, false, "no approval");
  const drift = classifyLedger({ ...base, recon: reconSummary({ rbac: { fp: "c".repeat(32) } }), approval: approved });
  assert.equal(drift.verified, false);
  assert.match(drift.reasons.join("\n"), /differs from the current proposal/);
  const missing = classifyLedger({ ...base, recon: reconSummary({ jh: { missing_source: 1 } }), approval: approved });
  assert.equal(missing.verified, false);
  assert.match(missing.reasons.join("\n"), /MISSING_SOURCE/);
  const attested = attest(ledger, { data_checks: [{ id: "0041_job_history_backfill", decision: "accept", reason: "reviewed exception" }] });
  assert.equal(classifyLedger({ ...base, attestations: attested, recon: reconSummary({ jh: { missing_source: 1 } }), approval: approved }).verified, true);
  assert.equal(reconciliationStatus(reconSummary({ rbac: { role_missing: 2 } }), approved).rbac.covers, null);
});

test("a deploy that would run the application's runtime reseed blocks verification", () => {
  const ledger = productionLedger();
  const base = { ledger, journal, known, attestations: attest(ledger), dataChecks: allPass };
  const r = classifyLedger({ ...base, runtime: { dbSeedVersion: "old", releaseSeedVersion: "new" } });
  assert.equal(r.verified, false);
  assert.match(r.reasons.join("\n"), /runtime reseed would run on deploy/);
  assert.equal(classifyLedger({ ...base, runtime: { dbSeedVersion: "same", releaseSeedVersion: "same" } }).verified, true);
});

test("with the committed approval file nothing is enabled: the transaction cannot reconcile anything unapproved", () => {
  const vars = psqlVars(".");
  for (const line of ["\\set recon_jh_enabled false", "\\set approved_jh_fp 'not-approved'", "\\set recon_rbac_enabled false", "\\set approved_rbac_fp 'not-approved'"]) assert.ok(vars.includes(line), line);
  const appr = JSON.parse(read(`${PKG}/reconciliation-approval.json`));
  assert.equal(appr.job_history.decision, "pending");
  assert.equal(appr.rbac.decision, "pending");
});

test("the RBAC seeds in recon-proposal.sql are exactly what 0041 and 0042 insert", () => {
  const m41 = read("drizzle-postgres/0041_employee_profile_and_decisions.sql"), m42 = read("drizzle-postgres/0042_staffing_blueprint.sql");
  assert.match(m41, /'administrative_decisions',a\.action,1 FROM roles r CROSS JOIN \(VALUES \('view'\),\('create'\)\) AS a\(action\)\nWHERE r\.name IN \('HR Manager','Department Manager'\)/);
  assert.match(m42, /CASE WHEN r\."name" = 'HR Manager' AND a\."action" IN \('view','create','edit','approve','delete'\) THEN 1 ELSE 0 END/);
  assert.match(m42, /\(VALUES \('view'\),\('create'\),\('edit'\),\('approve'\),\('delete'\),\('manage_settings'\)\)/);
  assert.match(m42, /WHERE r\."name" IN \('HR Manager','Department Manager','Employee'\)/);
  const proposal = read(`${PKG}/recon-proposal.sql`);
  assert.match(proposal, /unnest\(ARRAY\['HR Manager','Department Manager'\]\) AS r\(name\) CROSS JOIN unnest\(ARRAY\['view','create'\]\)/);
  assert.match(proposal, /unnest\(ARRAY\['HR Manager','Department Manager','Employee'\]\) AS r\(name\)\s+CROSS JOIN unnest\(ARRAY\['view','create','edit','approve','delete','manage_settings'\]\)/);
  assert.match(proposal, /CASE WHEN r\.name = 'HR Manager' AND a\.action IN \('view','create','edit','approve','delete'\) THEN 1 ELSE 0 END/);
  const checks = read(`${PKG}/data-checks.sql`);
  assert.match(checks, /staffing_roles AS \(SELECT id, name FROM roles WHERE name IN \('HR Manager','Department Manager','Employee'\)\)/);
});

test("reconciliation SQL only inserts (guarded), never updates or deletes existing employee or permission rows, and never invents dates", () => {
  const proposal = read(`${PKG}/recon-proposal.sql`), apply = read(`${PKG}/recon-apply.sql`);
  for (const m of proposal.matchAll(/\b(INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE)\s+(\w+)/g)) assert.match(m[2], /^hr_recon_/, `proposal writes ${m[2]}`);
  assert.doesNotMatch(apply, /\b(UPDATE|DELETE FROM)\s+(employee_job_history|permissions|employees)\b/);
  assert.match(apply, /INSERT INTO employee_job_history[\s\S]*?NOT EXISTS \(SELECT 1 FROM employee_job_history h WHERE h\.employee_id = j\.employee_id\)/);
  assert.match(apply, /INSERT INTO permissions[\s\S]*?ON CONFLICT \(role_id, module, action\) DO NOTHING/);
  const code = (proposal + apply).replace(/--[^\n]*/g, "");
  assert.doesNotMatch(code, /CURRENT_DATE|now\(\)::date|current_timestamp/i);
  assert.match(proposal, /THEN 'MISSING_SOURCE' ELSE 'PROPOSED' END/);
});

test("the reconciliation report lists exact employee IDs, roles, permission keys and counts", () => {
  const tsv = ["JH\t17\tAC-002\tactive\tPROPOSED\t1\t\t4\t\t9\t\t2025-12-01\tstart_date", "JH\t18\tAC-003\tactive\tMISSING_SOURCE\t1\t\t4\t\t9\t\t\t",
    "RBAC\t3\tHR Manager\tadministrative_decisions\tview\t1\tPROPOSED_INSERT\t\t0041_employee_profile_and_decisions",
    "RBAC\t4\tEmployee\tstaffing_blueprint\tview\t0\tPRESERVED_CUSTOM\t1\t0042_staffing_blueprint",
    "COUNT\temployees_without_job_history\t2", `SUMMARY\t1\t1\t${"a".repeat(32)}\t1\t1\t1\t0\t${"b".repeat(32)}`].join("\n");
  const before = parseReconTsv(tsv);
  const { md, jhCsv, rbacCsv } = renderReconciliation(before, null, {});
  assert.match(md, /\| 17 \| AC-002 \| PROPOSED \|/);
  assert.match(md, /\| 18 \| AC-003 \| \*\*MISSING_SOURCE\*\* \|/);
  assert.match(md, /\| 3 \| HR Manager \| administrative_decisions:view \| 1 \| \*\*PROPOSED_INSERT\*\* \|/);
  assert.match(md, /\| employees_without_job_history \| 2 \| \(after rehearsal\) \|/);
  assert.match(jhCsv, /^employee_id,employee_code,/);
  assert.match(rbacCsv, /^role_id,role_name,module,action,seed_allowed,status,existing_allowed,source\n3,HR Manager,administrative_decisions,view,1,PROPOSED_INSERT,,0041/);
});

test("no CI/CD, npm lifecycle or application-startup path runs Drizzle migrations", () => {
  const pkgJson = JSON.parse(read("package.json"));
  for (const [name, cmd] of Object.entries(pkgJson.scripts)) {
    if (/^(pre|post)|^(install|prepare|start)$/.test(name)) assert.doesNotMatch(cmd, /migrat|drizzle-kit/, `${name} runs ${cmd}`);
  }
  assert.equal(pkgJson.scripts["db:migrate"], "drizzle-kit migrate", "db:migrate stays a manual command");
  for (const wf of readdirSync(".github/workflows")) assert.doesNotMatch(read(`.github/workflows/${wf}`), /db:migrate|drizzle-kit\s+(migrate|push)|\/migrator|migrate\(/, wf);
  const sources = [];
  const walk = d => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = `${d}/${f.name}`; if (f.isDirectory()) walk(p); else if (/\.(ts|tsx|mjs|js)$/.test(f.name)) sources.push(p); } };
  for (const d of ["app", "db", "worker"]) walk(d);
  walk("scripts");
  for (const f of sources) {
    const text = read(f);
    if (f === "scripts/rehearse-organization-migration.mjs") continue;   // manual clone rehearsal, never part of startup or deploy
    assert.doesNotMatch(text, /drizzle-orm\/[\w-]+\/migrator|drizzle-kit migrate/, f);
  }
  for (const f of ["vite.config.ts", "next.config.ts", "drizzle.config.ts"]) assert.doesNotMatch(read(f), /migrate\(/, f);
});

test("runtime DDL at application startup is limited to the reviewed idempotent statements", () => {
  const found = [];
  for (const f of ["app/portal-auth.ts", "app/api/hr/route.ts"]) for (const m of read(f).matchAll(/"((?:ALTER TABLE|CREATE TABLE|CREATE (?:UNIQUE )?INDEX|DROP )[^"]*)"/g)) found.push(m[1].replace(/\s*\(.*$/, "").trim());
  assert.deepEqual(found.sort(), [
    "ALTER TABLE holidays ADD COLUMN IF NOT EXISTS attendance_types TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE holidays ADD COLUMN IF NOT EXISTS recurrence_type TEXT NOT NULL DEFAULT 'once'",
    "ALTER TABLE roles ADD COLUMN IF NOT EXISTS name_ar TEXT", "ALTER TABLE roles ADD COLUMN IF NOT EXISTS name_en TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS hr_data_scope TEXT NOT NULL DEFAULT 'all'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1",
    "CREATE TABLE IF NOT EXISTS system_settings",
  ].sort());
  const others = [];
  const walk = d => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = `${d}/${f.name}`; if (f.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f.name) && !["app/portal-auth.ts", "app/api/hr/route.ts"].includes(p)) others.push(p); } };
  walk("app"); walk("db"); walk("worker");
  for (const f of others) assert.doesNotMatch(read(f), /["'`]\s*(ALTER TABLE|CREATE TABLE|DROP TABLE|CREATE (UNIQUE )?INDEX)\b/i, f);
  // The runtime reseed is gated by SEED_VERSION; preflight compares it with production's system_settings.seed_version.
  assert.match(read("app/api/hr/route.ts"), /^const SEED_VERSION = "[^"]+";/m);
});

test("the packaged schema-audit script is pinned and strictly read-only", () => {
  const audit = read("ops/hr-schema-audit.sh");
  assert.ok(read(`${PKG}/files.sha256`).includes(`${sha256(audit)}  ops/hr-schema-audit.sh`));
  const sql = [...audit.matchAll(/-c "([\s\S]*?)"/g)].map(m => m[1]).join("\n");
  assert.match(sql, /^\s*SELECT table_name, column_name\s+FROM information_schema\.columns/m);
  assert.doesNotMatch(audit, /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT)\b/);
  assert.match(audit, /sys\.exit\(3\)/);
});

test("audit rows record every existing ledger row and unrecorded migration without touching the ledger", () => {
  const ledger = productionLedger();
  const lineage = classifyLedger({ ledger, journal, known, attestations: attest(ledger), dataChecks: allPass });
  const sql = auditSql({ lineage, runId: "apply-x", packageFingerprint: "p", deployerSha: "d" });
  assert.match(sql, /^INSERT INTO hr_ops\.migration_audit/);
  assert.equal((sql.match(/'existing_ledger_row'/g) || []).length, ledger.length);
  assert.equal((sql.match(/'journal_entry_out_of_band'/g) || []).length, lineage.outOfBand.length);
  assert.doesNotMatch(sql, /__drizzle_migrations/);
});
