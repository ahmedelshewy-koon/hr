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
//   node lineage.mjs psql-vars --repo DIR      -> psql \set lines for the in-transaction guards
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
  { id: "0041_job_history_backfill", migrations: ["0041_employee_profile_and_decisions"], what: "0041 backfills employee_job_history for every non-deleted employee" },
  { id: "0041_admin_decisions_permissions", migrations: ["0041_employee_profile_and_decisions"], what: "0041 seeds administrative_decisions view/create for HR Manager and Department Manager" },
  { id: "0042_staffing_blueprint_permissions", migrations: ["0042_staffing_blueprint"], what: "0042 seeds staffing_blueprint permissions for HR Manager and Department Manager" },
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
const BLOCKING = new Set(["PACKAGE_ALREADY_RECORDED", "NEWER_THAN_RELEASE", "DUPLICATE_TIMESTAMP"]);

/**
 * Classifies every production ledger row and the migration ordering Drizzle would derive from it.
 * ledger: [{id, hash, created_at}], journal: loadJournal(), known: committed historical versions
 * [{tag, when, hash, commit, eol}], attestations: ledger-attestations.json, dataChecks: parseDataChecksTsv().
 */
export function classifyLedger({ ledger, journal, known = [], attestations = {}, dataChecks = [] }) {
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
      const entry = known.find(k => k.when === r.created_at && k.hash === r.hash);
      const anyHash = known.find(k => k.hash === r.hash);
      if (entry) { cls = "REMOVED_JOURNAL_ENTRY"; detail = `${entry.tag} at ${entry.when} existed in ${entry.commit} but is not in the current journal`; }
      else if (anyHash) { cls = "HASH_KNOWN_TIMESTAMP_UNKNOWN"; detail = `text equals ${anyHash.tag} (${anyHash.commit}) but no journal ever had timestamp ${r.created_at}`; }
      else { cls = "UNKNOWN_LINEAGE"; detail = "timestamp and hash match no journal entry or committed file in this repository"; }
    }
    const attestation = attestedRows.find(a => Number(a.created_at) === r.created_at && a.hash === r.hash);
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
  const checks = requiredChecks.map(c => {
    const result = dataChecks.find(d => d.id === c.id);
    const attestation = attestedChecks.find(a => a.id === c.id);
    const status = result ? result.status : "NOT_RUN";
    return { ...c, status, evidence: result?.evidence ?? "", attested: attestation ? attestation.reason || "accepted" : null, ok: status === "PASS" || Boolean(attestation) };
  });

  const fingerprint = ledgerFingerprint(ledger);
  const attestedFingerprint = attestations.production_ledger?.fingerprint ?? null;
  const reasons = [];
  for (const r of rows.filter(r => !r.ok)) reasons.push(`ledger row id ${r.id} (${r.created_at}, ${r.hash.slice(0, 12)}...) is ${r.class}${BLOCKING.has(r.class) ? " (blocking: no attestation can accept this state)" : " and has no accepted attestation"}`);
  if (projectedPending.length || head > releaseHead) reasons.push("migration ordering cannot be made safe with this release");
  for (const c of checks.filter(c => !c.ok)) reasons.push(`data check ${c.id} is ${c.status} for unrecorded migration(s) ${c.migrations.join(", ")}`);
  if (attestedFingerprint !== fingerprint) reasons.push(attestedFingerprint ? `ledger fingerprint ${fingerprint} differs from the attested ${attestedFingerprint} (the ledger changed since review)` : `ledger fingerprint ${fingerprint} has not been attested`);
  const problems = journalProblems(journal);
  for (const p of problems) reasons.push(`journal: ${p}`);

  return {
    verified: reasons.length === 0, reasons, fingerprint, attestedFingerprint, head, headIso: new Date(head).toISOString(),
    releaseHead, projectedHead, rows, coveredUnrecorded: coveredUnrecorded.map(e => e.tag), outOfBand, drizzleWouldApply: drizzleWouldApply.map(e => e.tag),
    projectedPending: projectedPending.map(e => e.tag), hazards, checks,
  };
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
    ...result.checks.map(c => `| ${c.id} | ${c.migrations.join(", ")} | ${c.ok ? "" : "**"}${c.status}${c.ok ? "" : "**"} | ${c.evidence} | ${c.attested ?? ""} |`),
    ``, `## Why it is ${result.verified ? "verified" : "not verified"}`, ...(result.reasons.length ? result.reasons.map(r => `- ${r}`) : ["- every row explained, fingerprint attested, data operations verified"]), ``];
  return lines.join("\n");
}

export function renderAdminActionReport(result) {
  const unverified = result.rows.filter(r => !r.ok);
  return [`# ADMINISTRATOR ACTION REPORT - production migration lineage NOT verified`, ``,
    `Nothing was changed. \`rehearse\` and \`apply\` stay blocked until developers review this evidence and commit an`,
    `attestation (ops/prod-migration-0052-0054/ledger-attestations.json) through a reviewed pull request.`, ``,
    `## Why`, ...result.reasons.map(r => `- ${r}`), ``,
    `## Ledger rows that need an explanation`, ...(unverified.length ? unverified.map(r => `- id ${r.id}: created_at ${r.created_at} (${r.iso}), hash \`${r.hash}\` - ${r.class}: ${r.detail}`) : ["- none"]), ``,
    `## Evidence to collect (read-only) and send with this run directory`,
    `1. \`DISCOVERY.md\` / \`discovery.json\` in this directory: Drizzle journals found on the VPS whose entries match the rows above. If a match is listed, also send that journal and its SQL file(s) (paths are in the report).`,
    `2. The release history: \`ls -la --time-style=full-iso /opt/sanaa-hr/releases/\` and, for each release, \`git -C <release> log -1 2>/dev/null\` or the release tarball name (the GitHub SHA).`,
    `3. Who generated or ran migrations against production: search shell histories (root, sana-deploy) for \`drizzle-kit\`, \`db:migrate\`, \`db:generate\`, \`migrate(\` and send the matching lines with dates (redact secrets).`,
    `4. The full content of \`/usr/local/sbin/sana-hr-deploy\` (deployer.copy here; redact secrets). Reviewers must know whether it runs drizzle-kit migrate or any SQL, and in what order relative to the schema audit.`,
    `5. Any deployment or migration logs from 2026-10-06/07 (\`journalctl -u sanaa-hr.service --since 2026-10-05 --until 2026-10-09\`, deploy logs under /home/sana-deploy or /var/log).`,
    `6. Confirm nobody runs \`drizzle-kit migrate\` / \`npm run db:migrate\` against production until this is resolved (see the ordering hazards in LINEAGE_REPORT.md).`,
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
  const att = JSON.parse(readFileSync(join(repo, "ops/prod-migration-0052-0054/ledger-attestations.json"), "utf8"));
  const fp = att.production_ledger?.fingerprint;
  return `\\set attested_ledger_fp '${/^[0-9a-f]{32}$/.test(fp ?? "") ? fp : "not-attested"}'\n`;
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
    });
    writeFileSync(join(a.out, "lineage.json"), JSON.stringify(result, null, 2));
    writeFileSync(join(a.out, "LINEAGE_REPORT.md"), renderLineageReport(result));
    if (!result.verified) writeFileSync(join(a.out, "ADMIN_ACTION_REPORT.md"), renderAdminActionReport(result));
    console.log(`LINEAGE=${result.verified ? "VERIFIED" : "UNVERIFIED"} fingerprint=${result.fingerprint} head=${result.head}`);
    process.exit(result.verified ? 0 : 4);
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
    console.error("usage: lineage.mjs classify|discover|psql-vars|audit-sql ..."); process.exit(2);
  }
}
