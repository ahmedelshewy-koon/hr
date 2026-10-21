import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyLedger, ledgerFingerprint, loadJournal, journalProblems, introducedObjects, psqlVars, auditSql, discoverJournals,
  parseLedgerTsv, PACKAGE_TAGS, DATA_CHECKS, sha256,
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
  assert.equal(psqlVars("."), "\\set attested_ledger_fp 'not-attested'\n");
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

test("audit rows record every existing ledger row and unrecorded migration without touching the ledger", () => {
  const ledger = productionLedger();
  const lineage = classifyLedger({ ledger, journal, known, attestations: attest(ledger), dataChecks: allPass });
  const sql = auditSql({ lineage, runId: "apply-x", packageFingerprint: "p", deployerSha: "d" });
  assert.match(sql, /^INSERT INTO hr_ops\.migration_audit/);
  assert.equal((sql.match(/'existing_ledger_row'/g) || []).length, ledger.length);
  assert.equal((sql.match(/'journal_entry_out_of_band'/g) || []).length, lineage.outOfBand.length);
  assert.doesNotMatch(sql, /__drizzle_migrations/);
});
