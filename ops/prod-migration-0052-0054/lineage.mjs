// Drizzle migration-lineage verification for the 0052-0054 production package. Fail-closed:
// production may proceed only when every existing drizzle.__drizzle_migrations row is explained by
// the current journal, a committed historical version of it, or a reviewed attestation, the exact ledger
// fingerprint has been attested, and the data operations of migrations that the ledger does not record have
// been verified or attested. Nothing here writes to a database; the CLI only reads files it is given.
//
//   node lineage.mjs classify --repo DIR --ledger ledger.tsv --data-checks checks.tsv --out DIR
//       -> lineage.json, LINEAGE_REPORT.md, ADMIN_ACTION_REPORT.md (when unverified); exit 0 verified, 4 unverified
//   node lineage.mjs discover --ledger ledger.tsv --out DIR [--root PATH ...]
//       -> discovery.json / DISCOVERY.md: Drizzle journals found on this host whose entries match ledger rows
//   node lineage.mjs recon-render --recon recon.tsv [--after recon-after.tsv] --out DIR
//       -> RECONCILIATION_PROPOSAL.md + job-history-proposal.csv + rbac-proposal.csv (or RECONCILIATION_BEFORE_AFTER.md)
//   node lineage.mjs psql-vars --repo DIR      -> psql \set lines for the in-transaction guards and the approved reconciliation
//   node lineage.mjs audit-sql --lineage lineage.json --run-id ID --package FP --deployer SHA
//       -> INSERT statements for hr_ops.migration_audit (run inside the migration transaction)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_TAGS = ["0052_timesheet_management", "0053_payroll_rebuild", "0054_deleted_employee_email"];

/** Data and non-schema operations in 0031-0051 that a schema comparison cannot prove. Executed by data-checks.sql. */
export const DATA_CHECKS = [
  { id: "0032_ip_port_index_dropped", migrations: ["0032_biometric_agents"], what: "0032 drops idx_attendance_devices_ip_port" },
  { id: "0037_min_minutes_nullable", migrations: ["0037_deduction_rule_reference_fields"], what: "0037 makes deduction_rules.min_minutes nullable" },
  { id: "0038_company_request_type_key_dropped", migrations: ["0038_approval_workflow_department"], what: "0038 drops approval_workflows_company_id_request_type_key" },
  { id: "0039_0042_workforce_tables_absent", migrations: ["0039_workforce_planning", "0042_staffing_blueprint"], what: "0039 creates workforce_* tables, 0042 drops them" },
  { id: "0039_0042_workforce_permissions_removed", migrations: ["0039_workforce_planning", "0042_staffing_blueprint"], what: "0039 seeds workforce_planning permissions, 0042 deletes them" },
  { id: "0041_job_history_backfill", migrations: ["0041_employee_profile_and_decisions"], what: "0041 backfills employee_job_history for every non-deleted employee", reconciledBy: "job_history" },
  { id: "0041_admin_decisions_permissions", migrations: ["0041_employee_profile_and_decisions"], what: "0041 seeds administrative_decisions view/create for HR Manager and Department Manager", reconciledBy: "rbac" },
  { id: "0042_staffing_blueprint_permissions", migrations: ["0042_staffing_blueprint"], what: "0042 seeds staffing_blueprint permissions for HR Manager, Department Manager and Employee", reconciledBy: "rbac" },
  { id: "0046_debit_account_nullable", migrations: ["0046_cost_center_debit_optional"], what: "0046 makes cost_centers.debit_account nullable" },
];

export const sha256 = text => createHash("sha256").update(text).digest("hex");
const md5 = text => createHash("md5").update(text).digest("hex");

/** Same value as SQL: md5(string_agg(id||':'||hash||':'||created_at, ',' ORDER BY id)). */
export function ledgerFingerprint(rows) {
  return md5([...rows].sort((a, b) => a.id - b.id).map(r => `${r.id}:${r.hash}:${r.created_at}`).join(","));
}

export function parseLedgerTsv(text) {
  return text.split(/\r?\n/).filter(Boolean).map(line => {
    const [id, hash, created] = line.split("\t");
    if (!/^\d+$/.test(id) || !/^\d+$/.test(created)) throw new Error(`Bad ledger line: ${line}`);
    return { id: Number(id), hash: String(hash), created_at: Number(created) };
  });
}

export function parseDataChecksTsv(text) {
  return text.split(/\r?\n/).filter(Boolean).map(line => {
    const [id, status, evidence] = line.split("\t");
    return { id, status, evidence: evidence ?? "" };
  });
}

export function loadJournal(repo) {
  const entries = JSON.parse(readFileSync(join(repo, "drizzle-postgres/meta/_journal.json"), "utf8")).entries;
  return entries.map(e => ({ idx: e.idx, tag: e.tag, when: e.when,
    hash: sha256(readFileSync(join(repo, `drizzle-postgres/${e.tag}.sql`), "utf8").replace(/\r\n/g, "\n")) }));
}

/** Tables created and columns added to pre-existing tables by the given migration texts (comments stripped). */
export function introducedObjects(sqlTexts) {
  const sql = sqlTexts.join("\n").replace(/--[^\n]*/g, "");
  const tables = [...sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(?:"?public"?\.)?"?(\w+)"?/gi)].map(m => m[1]);
  const columns = [];
  for (const m of sql.matchAll(/ALTER TABLE(?: ONLY)?\s+(?:"?public"?\.)?"?(\w+)"?\s+ADD COLUMN(?: IF NOT EXISTS)?\s+"?(\w+)"?/gi)) {
    if (!tables.includes(m[1])) columns.push(`${m[1]}.${m[2]}`);
  }
  return { tables: [...new Set(tables)], columns: [...new Set(columns)] };
}

/** Journal sanity: strictly increasing, unique timestamps and contiguous idx. Returns a list of problems. */
export function journalProblems(journal) {
  const problems = [];
  journal.forEach((e, i) => {
    if (e.idx !== i) problems.push(`entry ${e.tag} has idx ${e.idx}, expected ${i}`);
    if (i && e.when <= journal[i - 1].when) problems.push(`entry ${e.tag} (${e.when}) is not newer than ${journal[i - 1].tag} (${journal[i - 1].when})`);
  });
  return problems;
}

const OK_CLASSES = new Set(["CURRENT_EXACT", "HISTORICAL_VERSION"]);
const BLOCKING = new Set(["PACKAGE_ALREADY_RECORDED", "NEWER_THAN_RELEASE", "DUPLICATE_TIMESTAMP", "RECOVERED_SOURCE_HASH_MISMATCH"]);

/**
 * Classifies every production ledger row and the migration ordering Drizzle would derive from it.
 * ledger: [{id, hash, created_at}], journal: loadJournal(), known: committed historical versions
 * [{tag, when, hash, commit, eol}], attestations: ledger-attestations.json, dataChecks: parseDataChecksTsv().
 */
export function classifyLedger({ ledger, journal, known = [], attestations = {}, dataChecks = [], evidence = [], recon = null, approval = {}, runtime = null }) {
  const byWhen = new Map(journal.map(e => [e.when, e]));
  const packageEntries = journal.filter(e => PACKAGE_TAGS.includes(e.tag));
  const releaseHead = journal.at(-1).when;
  const seen = new Map();
  for (const r of ledger) seen.set(r.created_at, (seen.get(r.created_at) || 0) + 1);
  const attestedRows = (attestations.rows || []).filter(a => a.decision === "accept");

  const rows = [...ledger].sort((a, b) => a.id - b.id).map(r => {
    const j = byWhen.get(r.created_at);
    let cls, detail = "";
    if (seen.get(r.created_at) > 1) cls = "DUPLICATE_TIMESTAMP";
    else if (packageEntries.some(p => p.when === r.created_at || p.hash === r.hash)) cls = "PACKAGE_ALREADY_RECORDED";
    else if (r.created_at > releaseHead) cls = "NEWER_THAN_RELEASE";
    else if (j && j.hash === r.hash) { cls = "CURRENT_EXACT"; detail = j.tag; }
    else if (j) {
      const hist = known.find(k => k.tag === j.tag && k.hash === r.hash);
      cls = hist ? "HISTORICAL_VERSION" : "TIMESTAMP_KNOWN_HASH_UNKNOWN";
      detail = hist ? `${j.tag} as committed in ${hist.commit} (${hist.eol})` : `${j.tag}: hash matches no committed version`;
    } else {
      const ev = evidence.find(x => x.when === r.created_at);
      const entry = known.find(k => k.when === r.created_at && k.hash === r.hash);
      const anyHash = known.find(k => k.hash === r.hash);
      if (ev && ev.present && ev.hash === r.hash) { cls = "RECOVERED_SOURCE"; detail = `${ev.tag} (${ev.file}): journal timestamp and sha256 of the recovered file match`; }
      else if (ev && ev.present) { cls = "RECOVERED_SOURCE_HASH_MISMATCH"; detail = `${ev.tag}: recovered file sha256 ${ev.hash} differs from the ledger hash`; }
      else if (entry) { cls = "REMOVED_JOURNAL_ENTRY"; detail = `${entry.tag} at ${entry.when} existed in ${entry.commit} but is not in the current journal`; }
      else if (anyHash) { cls = "HASH_KNOWN_TIMESTAMP_UNKNOWN"; detail = `text equals ${anyHash.tag} (${anyHash.commit}) but no journal ever had timestamp ${r.created_at}`; }
      else { cls = "UNKNOWN_LINEAGE"; detail = ev ? `recovered journal lists ${ev.tag} but ${ev.file} is not committed` : "timestamp and hash match no journal entry or committed file in this repository"; }
    }
    // An attestation explains a row either by its literal hash, or by naming recovered evidence whose computed hash and
    // journal timestamp equal the row (so no hash is ever typed by hand).
    const attestation = attestedRows.find(a => Number(a.created_at) === r.created_at && (
      (a.hash && a.hash === r.hash) ||
      (a.evidence_tag && evidence.some(x => x.tag === a.evidence_tag && x.when === r.created_at && x.present && x.hash === r.hash))));
    const pendingEvidence = !attestation && attestedRows.find(a => Number(a.created_at) === r.created_at && a.evidence_tag);
    if (pendingEvidence) detail += ` (attestation names evidence ${pendingEvidence.evidence_tag}, which is not committed or does not match)`;
    const ok = OK_CLASSES.has(cls) || (!BLOCKING.has(cls) && Boolean(attestation));
    return { ...r, iso: new Date(r.created_at).toISOString(), class: cls, detail, attested: attestation ? attestation.identified_as || "accepted" : null, ok };
  });

  const head = ledger.length ? Math.max(...ledger.map(r => r.created_at)) : 0;
  const recordedWhens = new Set(ledger.map(r => r.created_at));
  const coveredUnrecorded = journal.filter(e => e.when <= head && !recordedWhens.has(e.when));
  const drizzleWouldApply = journal.filter(e => e.when > head);
  const projectedHead = Math.max(head, ...packageEntries.map(e => e.when));
  const projectedPending = journal.filter(e => e.when > projectedHead);
  const hazards = [];
  const skippedPackage = coveredUnrecorded.filter(e => PACKAGE_TAGS.includes(e.tag));
  if (skippedPackage.length) hazards.push(`Ledger head ${head} (${new Date(head).toISOString()}) is newer than ${skippedPackage.map(e => e.tag).join(", ")}: drizzle-kit migrate would treat them as applied and skip them. Never run drizzle-kit migrate / npm run db:migrate on production before this package.`);
  if (drizzleWouldApply.length && drizzleWouldApply.length < journal.length) hazards.push(`drizzle-kit migrate would apply only: ${drizzleWouldApply.map(e => e.tag).join(", ")}.`);
  if (projectedPending.length) hazards.push(`After the package, Drizzle would still consider pending: ${projectedPending.map(e => e.tag).join(", ")}.`);

  const outOfBand = coveredUnrecorded.filter(e => !PACKAGE_TAGS.includes(e.tag)).map(e => e.tag);
  const requiredChecks = DATA_CHECKS.filter(c => c.migrations.some(m => outOfBand.includes(m)));
  const attestedChecks = (attestations.data_checks || []).filter(a => a.decision === "accept");
  const reconciliation = reconciliationStatus(recon, approval);
  const checks = requiredChecks.map(c => {
    const result = dataChecks.find(d => d.id === c.id);
    const attestation = attestedChecks.find(a => a.id === c.id);
    const status = result ? result.status : "NOT_RUN";
    const covered = c.reconciledBy ? reconciliation[c.reconciledBy].covers : null;
    return { ...c, status, evidence: result?.evidence ?? "", attested: attestation ? attestation.reason || "accepted" : null, covered,
      ok: status === "PASS" || Boolean(attestation) || Boolean(covered) };
  });

  const fingerprint = ledgerFingerprint(ledger);
  const attestedFingerprint = attestations.production_ledger?.fingerprint ?? null;
  const reasons = [];
  for (const r of rows.filter(r => !r.ok)) reasons.push(`ledger row id ${r.id} (${r.created_at}, ${r.hash.slice(0, 12)}...) is ${r.class}${BLOCKING.has(r.class) ? " (blocking: no attestation can accept this state)" : " and has no accepted attestation"}`);
  if (projectedPending.length || head > releaseHead) reasons.push("migration ordering cannot be made safe with this release");
  for (const c of checks.filter(c => !c.ok)) reasons.push(`data check ${c.id} is ${c.status} for unrecorded migration(s) ${c.migrations.join(", ")}${c.reconciledBy ? ` and is not covered by an approved reconciliation (${reconciliation[c.reconciledBy].state})` : ""}`);
  if (runtime && runtime.dbSeedVersion !== runtime.releaseSeedVersion) reasons.push(`runtime reseed would run on deploy: system_settings.seed_version is ${runtime.dbSeedVersion ?? "absent"}, the release expects ${runtime.releaseSeedVersion}; the reseed upserts role permissions (overwriting custom values for ROLE_DEFAULTS modules) without review`);
  if (attestedFingerprint !== fingerprint) reasons.push(attestedFingerprint ? `ledger fingerprint ${fingerprint} differs from the attested ${attestedFingerprint} (the ledger changed since review)` : `ledger fingerprint ${fingerprint} has not been attested`);
  const problems = journalProblems(journal);
  for (const p of problems) reasons.push(`journal: ${p}`);

  return {
    verified: reasons.length === 0, reasons, fingerprint, attestedFingerprint, head, headIso: new Date(head).toISOString(),
    releaseHead, projectedHead, rows, coveredUnrecorded: coveredUnrecorded.map(e => e.tag), outOfBand, drizzleWouldApply: drizzleWouldApply.map(e => e.tag),
    projectedPending: projectedPending.map(e => e.tag), hazards, checks, evidence, reconciliation, runtime,
  };
}

/**
 * Whether the approved reconciliation covers a failed data check: the part must be approved, its approved fingerprint must
 * equal the proposal computed from production now, and nothing may remain that it cannot fix (MISSING_SOURCE employees,
 * missing roles) - those need a separate decision.
 */
export function reconciliationStatus(recon, approval = {}) {
  const part = (key, summary, blockers) => {
    const a = approval[key] || {};
    if (!summary) return { state: "no proposal computed", covers: null };
    if (a.decision !== "approved") return { state: `proposal ${summary.fp} not approved (decision: ${a.decision ?? "none"})`, covers: null };
    if (a.proposal_fingerprint !== summary.fp) return { state: `approved fingerprint ${a.proposal_fingerprint} differs from the current proposal ${summary.fp} (re-approve)`, covers: null };
    if (blockers) return { state: blockers, covers: null };
    return { state: "approved and current", covers: `approved ${key} reconciliation (fingerprint ${summary.fp})` };
  };
  return {
    job_history: part("job_history", recon?.jh, recon?.jh?.missing_source ? `${recon.jh.missing_source} employee(s) have no stored assignment_effective_date/start_date (MISSING_SOURCE)` : null),
    rbac: part("rbac", recon?.rbac, recon?.rbac?.role_missing ? `${recon.rbac.role_missing} seeded row(s) reference a role that does not exist` : null),
  };
}

/** Recovered VPS migrations (evidence/vps-lineage): journal entries with the sha256 of the exact file bytes. */
export function loadEvidence(pkgDir) {
  const dir = join(pkgDir, "evidence", "vps-lineage");
  const journalPath = join(dir, "meta", "_journal.json");
  if (!existsSync(journalPath)) return [];
  return (JSON.parse(readFileSync(journalPath, "utf8")).entries || []).map(e => {
    const file = join(dir, `${e.tag}.sql`);
    const present = existsSync(file);
    return { tag: e.tag, when: e.when, file: `evidence/vps-lineage/${e.tag}.sql`, present, hash: present ? sha256(readFileSync(file)) : null };
  });
}

/** Schema the recovered VPS migrations introduce vs. what repo migrations 0031-0047 introduce (net of the 0042 drops). */
export function evidenceEquivalence(repo, pkgDir, evidence) {
  const vps = introducedObjects(evidence.filter(e => e.present).map(e => readFileSync(join(pkgDir, e.file), "utf8")));
  const repoTags = loadJournal(repo).filter(e => e.idx >= 31 && e.idx <= 47).map(e => e.tag);
  const own = introducedObjects(repoTags.map(t => readFileSync(join(repo, `drizzle-postgres/${t}.sql`), "utf8")));
  const dropped = ["workforce_plans", "workforce_plan_lines", "workforce_plan_events"];
  const repoTables = own.tables.filter(t => !dropped.includes(t));
  const diff = (a, b) => a.filter(x => !b.includes(x));
  return { vpsTables: vps.tables.length, repoTables: repoTables.length,
    tablesOnlyInRepo: diff(repoTables, vps.tables), tablesOnlyInVps: diff(vps.tables, repoTables),
    columnsOnlyInRepo: diff(own.columns.filter(c => !dropped.includes(c.split(".")[0])), vps.columns), columnsOnlyInVps: diff(vps.columns, own.columns) };
}

export function parseReconTsv(text) {
  const out = { jh: [], rbac: [], counts: {}, summary: null };
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const f = line.split("\t");
    if (f[0] === "JH") out.jh.push({ employee_id: +f[1], employee_code: f[2], employment_status: f[3], status: f[4], company_id: f[5], branch_id: f[6], department_id: f[7], section_id: f[8], job_title_id: f[9], position_id: f[10], start_date: f[11], date_source: f[12] });
    else if (f[0] === "RBAC") out.rbac.push({ role_id: f[1], role_name: f[2], module: f[3], action: f[4], seed_allowed: +f[5], status: f[6], existing_allowed: f[7], source: f[8] });
    else if (f[0] === "COUNT") out.counts[f[1]] = +f[2];
    else if (f[0] === "SUMMARY") out.summary = { jh: { proposed: +f[1], missing_source: +f[2], fp: f[3] }, rbac: { insert: +f[4], grants: +f[5], preserved: +f[6], role_missing: +f[7], fp: f[8] } };
  }
  return out;
}

const csv = (rows, cols) => [cols.join(","), ...rows.map(r => cols.map(c => /[",\n]/.test(String(r[c] ?? "")) ? `"${String(r[c]).replace(/"/g, '""')}"` : String(r[c] ?? "")).join(","))].join("\n") + "\n";

/** RECONCILIATION_PROPOSAL.md (+ CSVs); with `after`, adds the after-state from a rehearsal clone. */
export function renderReconciliation(before, after, approval = {}) {
  const s = before.summary;
  const jhCols = ["employee_id", "employee_code", "employment_status", "status", "company_id", "branch_id", "department_id", "section_id", "job_title_id", "position_id", "start_date", "date_source"];
  const rbacCols = ["role_id", "role_name", "module", "action", "seed_allowed", "status", "existing_allowed", "source"];
  const st = reconciliationStatus(s, approval);
  const countRows = Object.keys(before.counts).map(k => `| ${k} | ${before.counts[k]} | ${after ? after.counts[k] ?? "" : "(after rehearsal)"} |`);
  const md = [`# Historical data reconciliation proposal`, ``,
    `Computed read-only from the database; nothing has been applied. Each part needs explicit approval in`,
    `reconciliation-approval.json with exactly the fingerprint below (approval state: job history - ${st.job_history.state}; RBAC - ${st.rbac.state}).`, ``,
    `## Job history (0041 backfill)`, ``,
    `- Proposed inserts: **${s.jh.proposed}** (fingerprint \`${s.jh.fp}\`); MISSING_SOURCE (never inserted): **${s.jh.missing_source}**`,
    `- Each row is a 'current_assignment' entry built only from the employee's stored assignment; start_date is the stored assignment_effective_date, else start_date. No date is invented.`, ``,
    `| employee_id | code | status | company | branch | department | section | job title | position | start_date | date source |`, `|---|---|---|---|---|---|---|---|---|---|---|`,
    ...before.jh.map(r => `| ${r.employee_id} | ${r.employee_code} | ${r.status === "PROPOSED" ? "PROPOSED" : "**MISSING_SOURCE**"} | ${r.company_id} | ${r.branch_id} | ${r.department_id} | ${r.section_id} | ${r.job_title_id} | ${r.position_id} | ${r.start_date} | ${r.date_source} |`),
    ...(before.jh.length ? [] : ["| (none) |||||||||||"]), ``,
    `## RBAC (0041 administrative_decisions, 0042 staffing_blueprint)`, ``,
    `- Proposed inserts: **${s.rbac.insert}** (of which access grants allowed=1: **${s.rbac.grants}**; the rest are explicit denials that change no access) - fingerprint \`${s.rbac.fp}\``,
    `- Existing rows are never modified: PRESERVED_CUSTOM **${s.rbac.preserved}**; roles missing: **${s.rbac.role_missing}**`, ``,
    `| role_id | role | permission key | seed allowed | status | existing allowed | source |`, `|---|---|---|---|---|---|---|`,
    ...before.rbac.map(r => `| ${r.role_id} | ${r.role_name} | ${r.module}:${r.action} | ${r.seed_allowed} | ${r.status === "PROPOSED_INSERT" ? "**PROPOSED_INSERT**" : r.status} | ${r.existing_allowed} | ${r.source} |`), ``,
    `## Record counts (before / after)`, ``, `| count | before | after |`, `|---|---|---|`, ...countRows, ``];
  if (after) md.push(`After-state source: rehearsal clone after the approved reconciliation. Proposed inserts remaining: job history ${after.summary.jh.proposed}, RBAC ${after.summary.rbac.insert} (both must be 0).`, ``);
  return { md: md.join("\n"), jhCsv: csv(before.jh, jhCols), rbacCsv: csv(before.rbac, rbacCols) };
}

export function renderLineageReport(result) {
  const lines = [`# Migration lineage report`, ``, `LINEAGE=${result.verified ? "VERIFIED" : "UNVERIFIED"}`, ``,
    `- Ledger rows: ${result.rows.length}; fingerprint \`${result.fingerprint}\` (attested: ${result.attestedFingerprint ?? "none"})`,
    `- Ledger head: ${result.head} (${result.headIso}); release head (0054): ${result.releaseHead}; head after package: ${result.projectedHead}`,
    `- Journal entries Drizzle treats as applied but the ledger does not record: ${result.coveredUnrecorded.join(", ") || "none"}`,
    `- drizzle-kit migrate would apply now: ${result.drizzleWouldApply.join(", ") || "nothing"}; after the package: ${result.projectedPending.join(", ") || "nothing"}`,
    ``, `## Ordering hazards`, ...(result.hazards.length ? result.hazards.map(h => `- ${h}`) : ["- none"]),
    ``, `## Ledger rows`, ``, `| id | created_at | time (UTC) | hash | class | detail | attestation |`, `|---|---|---|---|---|---|---|`,
    ...result.rows.map(r => `| ${r.id} | ${r.created_at} | ${r.iso} | \`${r.hash}\` | ${r.ok ? "" : "**"}${r.class}${r.ok ? "" : "**"} | ${r.detail} | ${r.attested ?? ""} |`),
    ``, `## Data operations of unrecorded migrations`, ``, `| check | migrations | status | evidence | attestation |`, `|---|---|---|---|---|`,
    ...result.checks.map(c => `| ${c.id} | ${c.migrations.join(", ")} | ${c.ok ? "" : "**"}${c.status}${c.ok ? "" : "**"} | ${c.evidence} | ${c.attested ?? c.covered ?? ""} |`),
    ``, `## Recovered VPS migrations (evidence/vps-lineage)`,
    ...(result.evidence?.length ? result.evidence.map(e => `- ${e.tag} (when ${e.when}): ${e.present ? `file committed, sha256 \`${e.hash}\`` : "**file not committed**"}`) : ["- none committed (recovered files and journal still required)"]),
    ...(result.equivalence ? [`- Schema introduced: VPS ${result.equivalence.vpsTables} tables vs repo 0031-0047 ${result.equivalence.repoTables} tables (net of the 0042 drops). Only in repo: ${result.equivalence.tablesOnlyInRepo.join(", ") || "none"}; only in VPS: ${result.equivalence.tablesOnlyInVps.join(", ") || "none"}; columns only in repo: ${result.equivalence.columnsOnlyInRepo.join(", ") || "none"}; columns only in VPS: ${result.equivalence.columnsOnlyInVps.join(", ") || "none"}`] : []),
    ``, `## Historical data reconciliation`,
    `- Job history: ${result.reconciliation?.job_history.state}`, `- RBAC: ${result.reconciliation?.rbac.state}`, `- Details: RECONCILIATION_PROPOSAL.md`,
    ``, `## Application startup`,
    `- system_settings.seed_version: ${result.runtime ? `${result.runtime.dbSeedVersion ?? "absent"} (release expects ${result.runtime.releaseSeedVersion}) - ${result.runtime.dbSeedVersion === result.runtime.releaseSeedVersion ? "no runtime reseed on deploy" : "**a deploy would run the runtime reseed**"}` : "not checked"}`,
    ``, `## Why it is ${result.verified ? "verified" : "not verified"}`, ...(result.reasons.length ? result.reasons.map(r => `- ${r}`) : ["- every row explained, fingerprint attested, data operations verified"]), ``];
  return lines.join("\n");
}

export function renderAdminActionReport(result) {
  const unverified = result.rows.filter(r => !r.ok);
  return [`# ADMINISTRATOR ACTION REPORT - production migration lineage or data reconciliation NOT verified`, ``,
    `Nothing was changed. \`rehearse\` and \`apply\` stay blocked until developers review this evidence and commit an`,
    `attestation (ops/prod-migration-0052-0054/ledger-attestations.json) through a reviewed pull request.`, ``,
    `## Why`, ...result.reasons.map(r => `- ${r}`), ``,
    `## Ledger rows that need an explanation`, ...(unverified.length ? unverified.map(r => `- id ${r.id}: created_at ${r.created_at} (${r.iso}), hash \`${r.hash}\` - ${r.class}: ${r.detail}`) : ["- none"]), ``,
    `## Evidence still required (read-only) - send with this run directory`,
    `1. The recovered VPS migrations, byte for byte: \`0031_vps_current_schema.sql\`, \`0032_vps_attendance_device_country.sql\`, the original VPS \`meta/_journal.json\`, and SOURCE.txt (where each was found, mtime, owner, sha256sum computed on the VPS). Developers commit them under ops/prod-migration-0052-0054/evidence/vps-lineage/.`,
    `2. The ledger fingerprint and rows from this run (LINEAGE_REPORT.md, ledger.tsv), for the attestation's production_ledger entry.`,
    `3. RECONCILIATION_PROPOSAL.md, job-history-proposal.csv and rbac-proposal.csv from this run, for explicit approval of the job-history backfill and the RBAC rows.`,
    `4. For every MISSING_SOURCE employee: HR's confirmation of the correct assignment effective date (corrected in the application through the normal, separately approved process) - or a reviewed decision to leave the employee without history.`,
    `5. Service-startup paths: \`systemctl cat sanaa-hr.service\` (ExecStart, ExecStartPre, EnvironmentFile), \`systemctl list-timers --all\`, and \`crontab -l\` for root and sana-deploy - showing no migration commands.`,
    `6. The candidate release the deployer will run: its GitHub SHA and \`sha256sum ops/hr-schema-audit.sh ops/hr-schema-contract.json\` inside it (must equal files.sha256 in this package).`,
    `7. Confirmation that nobody will run drizzle-kit migrate / npm run db:migrate against production until the package is applied (see LINEAGE_REPORT.md, ordering hazards).`,
    ``, `Note: drizzle stores the journal's generation time ("when") as created_at, not the time a migration ran.`,
    `The unknown rows were therefore generated at the times shown, in a journal that is not in this repository.`, ``].join("\n");
}

/** Read-only search for Drizzle journals on this host that explain ledger rows. */
export function discoverJournals({ ledger, roots, maxDepth = 7 }) {
  const wanted = new Map(ledger.map(r => [r.created_at, r]));
  const found = [];
  const skip = new Set(["node_modules", ".git", "proc", "sys", "dev", ".cache", "dist"]);
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let names; try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (skip.has(name)) continue;
      const path = join(dir, name);
      let st; try { st = statSync(path); } catch { continue; }
      if (st.isDirectory()) walk(path, depth + 1);
      else if (name === "_journal.json" && basename(dir) === "meta") {
        let entries = []; try { entries = JSON.parse(readFileSync(path, "utf8")).entries || []; } catch { continue; }
        const folder = dirname(dir);
        const matches = entries.filter(e => wanted.has(e.when)).map(e => {
          const sqlPath = join(folder, `${e.tag}.sql`);
          const fileHash = existsSync(sqlPath) ? sha256(readFileSync(sqlPath, "utf8")) : null;
          const row = wanted.get(e.when);
          return { tag: e.tag, when: e.when, ledger_id: row.id, ledger_hash: row.hash, file: sqlPath, file_hash: fileHash, hash_matches: fileHash === row.hash };
        });
        found.push({ journal: path, modified: st.mtime.toISOString(), entries: entries.length, last_tag: entries.at(-1)?.tag ?? null, last_when: entries.at(-1)?.when ?? null, matches });
      }
    }
  };
  for (const root of roots) if (existsSync(root)) walk(root, 0);
  return found;
}

function renderDiscovery(found, roots) {
  const withMatches = found.filter(f => f.matches.length);
  return [`# Drizzle journals found on this host`, ``, `Searched (read-only): ${roots.join(", ")}`, `Journals found: ${found.length}; with entries matching ledger rows: ${withMatches.length}`, ``,
    ...found.map(f => [`## ${f.journal}`, `modified ${f.modified}; ${f.entries} entries; last ${f.last_tag} (${f.last_when})`,
      ...(f.matches.length ? f.matches.map(m => `- ledger id ${m.ledger_id} <- ${m.tag} (${m.when}); file hash ${m.hash_matches ? "MATCHES" : "DIFFERS"} (${m.file})`) : ["- no entry matches a ledger timestamp"]), ``].join("\n"))].join("\n");
}

/** psql \set lines: attested fingerprint for the in-transaction guard (or a value that can never match). */
export function psqlVars(repo) {
  const pkg = join(repo, "ops/prod-migration-0052-0054");
  const att = JSON.parse(readFileSync(join(pkg, "ledger-attestations.json"), "utf8"));
  const appr = JSON.parse(readFileSync(join(pkg, "reconciliation-approval.json"), "utf8"));
  const fp = att.production_ledger?.fingerprint;
  const md5ish = v => /^[0-9a-f]{32}$/.test(v ?? "");
  const part = key => { const p = appr[key] || {}; const on = p.decision === "approved" && md5ish(p.proposal_fingerprint); return [on, on ? p.proposal_fingerprint : "not-approved"]; };
  const [jhOn, jhFp] = part("job_history"), [rbacOn, rbacFp] = part("rbac");
  return [`\\set attested_ledger_fp '${md5ish(fp) ? fp : "not-attested"}'`,
    `\\set recon_jh_enabled ${jhOn}`, `\\set approved_jh_fp '${jhFp}'`,
    `\\set recon_rbac_enabled ${rbacOn}`, `\\set approved_rbac_fp '${rbacFp}'`, ""].join("\n");
}

const lit = v => v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
export function auditSql({ lineage, runId, packageFingerprint, deployerSha }) {
  const values = [
    ["apply_started", null, null, null, "", JSON.stringify({ package: packageFingerprint, deployer_sha256: deployerSha, ledger_fingerprint: lineage.fingerprint, ledger_head: lineage.head })],
    ...lineage.rows.map(r => ["existing_ledger_row", null, r.created_at, r.hash, r.class, JSON.stringify({ id: r.id, detail: r.detail, attestation: r.attested })]),
    ...lineage.outOfBand.map(tag => ["journal_entry_out_of_band", tag, null, null, "present_not_recorded", JSON.stringify({ note: "covered by ledger head; schema verified by rehearsal catalog comparison; not recorded in drizzle ledger" })]),
    ...lineage.checks.map(c => ["data_check", c.migrations.join(","), null, null, c.status, JSON.stringify({ id: c.id, evidence: c.evidence, attestation: c.attested })]),
  ];
  return `INSERT INTO hr_ops.migration_audit (run_id, event, tag, created_at, hash, classification, detail) VALUES\n` +
    values.map(v => `(${lit(runId)}, ${lit(v[0])}, ${lit(v[1])}, ${v[2] ?? "NULL"}, ${lit(v[3])}, ${lit(v[4])}, ${lit(v[5])}::jsonb)`).join(",\n") + ";\n";
}

function args(argv) {
  const out = { root: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, "");
    if (k === "root") out.root.push(argv[++i]); else out[k] = argv[++i];
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = args(rest);
  if (cmd === "classify") {
    const pkg = join(a.repo, "ops/prod-migration-0052-0054");
    const result = classifyLedger({
      ledger: parseLedgerTsv(readFileSync(a.ledger, "utf8")),
      journal: loadJournal(a.repo),
      known: JSON.parse(readFileSync(join(pkg, "known-migration-versions.json"), "utf8")).versions,
      attestations: JSON.parse(readFileSync(join(pkg, "ledger-attestations.json"), "utf8")),
      dataChecks: a["data-checks"] ? parseDataChecksTsv(readFileSync(a["data-checks"], "utf8")) : [],
      evidence: loadEvidence(pkg),
      recon: a.recon ? parseReconTsv(readFileSync(a.recon, "utf8")).summary : null,
      approval: JSON.parse(readFileSync(join(pkg, "reconciliation-approval.json"), "utf8")),
      runtime: a.runtime ? JSON.parse(readFileSync(a.runtime, "utf8")) : null,
    });
    if (result.evidence.some(e => e.present)) result.equivalence = evidenceEquivalence(a.repo, pkg, result.evidence);
    writeFileSync(join(a.out, "lineage.json"), JSON.stringify(result, null, 2));
    writeFileSync(join(a.out, "LINEAGE_REPORT.md"), renderLineageReport(result));
    if (!result.verified) writeFileSync(join(a.out, "ADMIN_ACTION_REPORT.md"), renderAdminActionReport(result));
    console.log(`LINEAGE=${result.verified ? "VERIFIED" : "UNVERIFIED"} fingerprint=${result.fingerprint} head=${result.head}`);
    process.exit(result.verified ? 0 : 4);
  } else if (cmd === "recon-render") {
    const pkg = join(fileURLToPath(new URL(".", import.meta.url)));
    const before = parseReconTsv(readFileSync(a.recon, "utf8"));
    const after = a.after ? parseReconTsv(readFileSync(a.after, "utf8")) : null;
    const r = renderReconciliation(before, after, JSON.parse(readFileSync(join(pkg, "reconciliation-approval.json"), "utf8")));
    writeFileSync(join(a.out, after ? "RECONCILIATION_BEFORE_AFTER.md" : "RECONCILIATION_PROPOSAL.md"), r.md);
    if (!after) { writeFileSync(join(a.out, "job-history-proposal.csv"), r.jhCsv); writeFileSync(join(a.out, "rbac-proposal.csv"), r.rbacCsv); }
    console.log(`RECON job_history_proposed=${before.summary.jh.proposed} missing_source=${before.summary.jh.missing_source} fp=${before.summary.jh.fp} rbac_insert=${before.summary.rbac.insert} grants=${before.summary.rbac.grants} preserved=${before.summary.rbac.preserved} fp=${before.summary.rbac.fp}`);
  } else if (cmd === "discover") {
    const roots = a.root.length ? a.root : ["/opt/sanaa-hr", "/home/sana-deploy", "/root", "/srv", "/var/www"];
    const found = discoverJournals({ ledger: parseLedgerTsv(readFileSync(a.ledger, "utf8")), roots });
    writeFileSync(join(a.out, "discovery.json"), JSON.stringify(found, null, 2));
    writeFileSync(join(a.out, "DISCOVERY.md"), renderDiscovery(found, roots));
    console.log(`DISCOVERY journals=${found.length} matching=${found.filter(f => f.matches.length).length}`);
  } else if (cmd === "psql-vars") {
    process.stdout.write(psqlVars(a.repo));
  } else if (cmd === "audit-sql") {
    process.stdout.write(auditSql({ lineage: JSON.parse(readFileSync(a.lineage, "utf8")), runId: a["run-id"], packageFingerprint: a.package, deployerSha: a.deployer }));
  } else {
    console.error("usage: lineage.mjs classify|discover|recon-render|psql-vars|audit-sql ..."); process.exit(2);
  }
}
