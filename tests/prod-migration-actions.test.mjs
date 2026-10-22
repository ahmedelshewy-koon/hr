// The GitHub Actions path for the 0052-0054 package: the workflow can only run evidence, preflight and rehearsal (never
// apply, rollback or a deploy), and the proposed VPS wrapper accepts only allow-listed commits, delivered as a git bundle.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const read = path => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const slash = p => p.replace(/\\/g, "/");
const WF = ".github/workflows/hr-migration-0052-0054.yml";
const WRAPPER = "ops/prod-migration-0052-0054/vps/sana-hr-migration";
const wf = read(WF), wrapper = read(WRAPPER);

/** Lines of every `run: |` block (the shell the runner executes). */
function runBlocks(yaml) {
  const out = []; const lines = yaml.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:- )?run: \|\s*$/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    for (i++; i < lines.length && (lines[i].trim() === "" || lines[i].search(/\S/) > indent); i++) out.push(lines[i]);
    i--;
  }
  return out;
}

/* ---------- workflow ---------- */

test("the workflow is manual only and offers exactly the read-only and isolated stages", () => {
  const on = wf.slice(wf.indexOf("\non:"), wf.indexOf("\npermissions:"));
  assert.match(on, /^\s+workflow_dispatch:/m);
  assert.doesNotMatch(on, /^\s+(push|pull_request|pull_request_target|schedule|workflow_run|repository_dispatch):/m);
  assert.deepEqual(/options: \[([^\]]*)\]/.exec(wf)[1].split(",").map(s => s.trim()), ["capabilities", "evidence", "preflight", "rehearse"]);
  assert.match(wf, /\[\[ "\$STAGE" == rehearse && "\$CONFIRM" != "REHEARSE-0052-0054-NO-PRODUCTION-CHANGE" \]\]/);
});

test("the workflow cannot apply, roll back, deploy or run migrations, and touches no secret beyond reading the deploy key", () => {
  const shell = runBlocks(wf).join("\n");
  // The runner only syntax-checks the package; it never runs one of its stages itself.
  for (const line of shell.split("\n").filter(l => /hr-migrate-0052-0054\.sh/.test(l))) assert.match(line, /^\s*(test -s|bash -n) /, line);
  for (const re of [/\b(apply|rollback|postdeploy)\b/, /APPLY-0052-0054|ROLLBACK-0052-0054/, /sana-hr-deploy/, /drizzle-kit|db:migrate|migrate\(/,
    /systemctl (stop|start|restart)/, /\bpsql\b|docker exec/, /gh secret|authorized_keys|StrictHostKeyChecking=no/]) assert.doesNotMatch(shell, re, String(re));
  assert.deepEqual([...new Set([...wf.matchAll(/secrets\.([A-Z_]+)/g)].map(m => m[1]))].sort(), ["SANA_DEPLOY_KEY", "SANA_DEPLOY_KNOWN_HOSTS"]);
  for (const line of shell.split("\n").filter(l => /\b(ssh|scp)\s+-o/.test(l))) assert.match(line, /StrictHostKeyChecking=yes/, line);
  for (const line of shell.split("\n").filter(l => /sudo -n /.test(l) && !/sudo -n -l/.test(l))) assert.match(line, /sudo -n \$WRAPPER /, `only the reviewed wrapper is run with sudo: ${line}`);
  assert.match(wf, /^\s+if: inputs\.stage != 'capabilities'\n\s+env:/m);
});

test("no workflow input is interpolated into shell code (inputs reach scripts only through validated env)", () => {
  for (const line of runBlocks(wf)) assert.doesNotMatch(line, /\$\{\{\s*(inputs|github\.event)\./, line);
  assert.match(wf, /\[\[ "\$PKG" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
});

test("guard job: least privilege, required-reviewer environment checked before the VPS job can start", () => {
  assert.match(wf, /^permissions:\n {2}contents: read\n\n/m);
  const guard = wf.slice(wf.indexOf("\n  guard:"), wf.indexOf("\n  run:\n"));
  assert.match(guard, /permissions:\n\s+actions: read/);
  assert.match(guard, /environments\/production-migration/);
  assert.match(guard, /select\(\.type == "required_reviewers"\)/);
  const run = wf.slice(wf.indexOf("\n  run:\n"));
  assert.match(run, /needs: guard\n/);
  assert.match(run, /environment: production-migration\n/);
  assert.match(run, /persist-credentials: false/);
});

test("stages never overlap a production deployment (same concurrency group, never cancelled)", () => {
  const group = w => /concurrency:\n\s+group: (\S+)\n\s+cancel-in-progress: (\w+)/.exec(w).slice(1);
  assert.deepEqual(group(wf), group(read(".github/workflows/deploy-production.yml")));
  assert.deepEqual(group(wf), ["sanaa-hr-production", "false"]);
});

test("the review archive is the only thing downloaded, and it is kept 7 days", () => {
  assert.match(wf, /sudo -n \$WRAPPER fetch \$name/);
  assert.match(wf, /\[\[ "\$name" =~ \^\(evidence\|preflight\|rehearse\)-\[0-9\]\{8\}T\[0-9\]\{6\}Z\$ \]\]/);
  assert.match(wf, /retention-days: 7/);
  assert.match(wf, /"\$STAGE" == evidence && "\$rc" == 4/, "evidence's expected exit 4 is not a failure");
  for (const f of [...wf.matchAll(/tests\/[\w-]+\.test\.mjs/g)].map(m => m[0])) assert.ok(read(f), f);
});

/* ---------- VPS wrapper ---------- */

function sh(body, { input } = {}) {
  // The wrapper pins PATH to the system directories; keep the test machine's (Git for Windows keeps git elsewhere).
  const script = `set -Eeuo pipefail\n__path="$PATH"\nsource "${slash(process.cwd())}/${WRAPPER}"\nPATH="$__path"\n${body}`;
  return spawnSync("bash", ["-c", script], { encoding: "utf8", input });
}
const SHA = "a".repeat(40);

test("the wrapper refuses every stage except evidence, preflight and rehearse, before reading anything", () => {
  assert.match(wrapper, /^STAGES="evidence preflight rehearse"$/m);
  for (const stage of ["apply", "rollback", "postdeploy", "deploy", "", "preflight;id", "rehearse "]) {
    const r = sh(`ALLOWLIST=/nonexistent; run_stage '${stage}' ${SHA}`);
    assert.equal(r.status, 64, `${stage}: ${r.stderr}`);
    assert.match(r.stderr, /REFUSED: stage/);
  }
  for (const [args, msg] of [[`preflight ${SHA.slice(1)}`, /40 lowercase hex/], [`preflight ${SHA.toUpperCase()}`, /40 lowercase hex/],
    [`preflight ${SHA} ${"b".repeat(40)}`, /only checked by 'evidence'/], [`evidence ${SHA} xyz`, /candidate sha/]]) {
    const r = sh(`ALLOWLIST=/nonexistent; run_stage ${args}`);
    assert.equal(r.status, 64); assert.match(r.stderr, msg);
  }
  const direct = sh("main preflight " + SHA);
  if (process.getuid?.() !== 0) { assert.equal(direct.status, 64); assert.match(direct.stderr, /run through sudo/); }
});

test("the allow-list must be root-owned, not writable by others, and name the exact commit and stage", () => {
  const dir = slash(mkdtempSync(join(tmpdir(), "hr-allow-")));
  writeFileSync(`${dir}/list`, `${SHA} evidence\n${SHA} preflight\n`);
  const run = (stage, statOut = "root 644") => sh(`stat() { echo "${statOut}"; }; ALLOWLIST="${dir}/list"; approved ${SHA} ${stage}; echo OK`);
  assert.match(run("preflight").stdout, /OK/);
  assert.equal(run("rehearse").status, 64, "not allow-listed for rehearse");
  assert.equal(run("pre").status, 64, "no prefix matches");
  assert.equal(run("preflight", "sana-deploy 644").status, 64, "owned by someone else");
  assert.equal(run("preflight", "root 666").status, 64, "world-writable");
  assert.equal(sh(`ALLOWLIST="${dir}/missing"; approved ${SHA} preflight`).status, 64);
});

test("intake checks out exactly the requested commit from a git bundle on stdin, and refuses anything else", () => {
  const dir = slash(mkdtempSync(join(tmpdir(), "hr-bundle-")));
  const git = (...a) => { const r = spawnSync("git", ["-C", `${dir}/src`, ...a], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  mkdirSync(`${dir}/src`); git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  mkdirSync(`${dir}/src/ops/prod-migration-0052-0054`, { recursive: true }); mkdirSync(`${dir}/src/app/api/hr`, { recursive: true });
  writeFileSync(`${dir}/src/ops/prod-migration-0052-0054/hr-migrate-0052-0054.sh`, "echo package\n");
  for (const f of ["ops/hr-schema-audit.sh", "ops/hr-schema-contract.json", "app/api/hr/route.ts"]) writeFileSync(`${dir}/src/${f}`, f);
  git("add", "."); git("commit", "-qm", "pkg"); const pkg = git("rev-parse", "HEAD");
  writeFileSync(`${dir}/src/other.txt`, "x"); git("rm", "-q", "ops/hr-schema-audit.sh"); git("add", "."); git("commit", "-qm", "later"); const later = git("rev-parse", "HEAD");
  git("bundle", "create", `${dir}/hr.bundle`, "HEAD", "--all");
  const bundle = readFileSync(`${dir}/hr.bundle`);
  const ok = sh(`WORK="${dir}/work"; d="$(intake ${pkg})"; git -C "$d" rev-parse HEAD; test ! -e "$d/other.txt" && echo CLEAN`, { input: bundle });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, new RegExp(`^${pkg}$`, "m"));
  assert.match(ok.stdout, /CLEAN/);
  const missing = sh(`WORK="${dir}/work"; intake ${"c".repeat(40)}`, { input: bundle });
  assert.equal(missing.status, 64); assert.match(missing.stderr, /not in the bundle/);
  const garbage = sh(`WORK="${dir}/work"; intake ${pkg}`, { input: "not a bundle" });
  assert.equal(garbage.status, 64); assert.match(garbage.stderr, /stdin is not a git bundle/);
  const forged = sh(`WORK="${dir}/work"; intake ${pkg}`, { input: "# v2 git bundle\nnot really\n" });
  assert.equal(forged.status, 64); assert.match(forged.stderr, /not a valid git bundle/);
  const cand = sh(`WORK="${dir}/work"; intake ${later} ${pkg} >/dev/null; cat "${dir}/work/candidate-${pkg}/.release-sha"; ls "${dir}/work/candidate-${pkg}/ops"`, { input: bundle });
  assert.equal(cand.status, 0, cand.stderr);
  assert.match(cand.stdout, new RegExp(`^${pkg}\\nhr-schema-audit\\.sh\\nhr-schema-contract\\.json$`, "m"));
  const bare = sh(`WORK="${dir}/work"; intake ${pkg} ${later}`, { input: bundle });
  assert.equal(bare.status, 64, "a candidate without the files the evidence check reads is refused");
  assert.match(bare.stderr, /lacks ops\/hr-schema-audit\.sh/);
});

test("fetch serves only a run's review archive, by a strictly formatted name", () => {
  for (const name of ["../../etc/shadow", "evidence-20261021T140000Z/../x", "apply-20261021T140000Z", "evidence-1", ""]) {
    const r = sh(`RUN_ROOT=/nonexistent; fetch '${name}'`);
    assert.equal(r.status, 64, name); assert.match(r.stderr, /bad run name/);
  }
  assert.match(sh(`RUN_ROOT=/nonexistent; fetch evidence-20261021T140000Z`).stderr, /no review archive/);
});

test("the review archive leaves out e-mails (HR manager access) and the deployer copy, and redacts preflight.txt", () => {
  const root = slash(mkdtempSync(join(tmpdir(), "hr-review-")));
  const run = `${root}/evidence-20261021T140000Z`;
  mkdirSync(run);
  for (const [f, text] of [["STAGE1_SUMMARY.md", "summary"], ["hr-manager-access.csv", "a@b.c"], ["deployer.copy", "script"], ["ledger.tsv", "1\th\t2"],
    ["preflight.txt", "HR_GUARDS=PASS\n===== HR MANAGER ACCESS (report only) =====\nemail | a@b.c\n"]]) writeFileSync(`${run}/${f}`, text);
  const r = sh(`RUN_ROOT="${root}"; review_archive "${run}"; cd "${root}" && tar -tzf evidence-20261021T140000Z.review.tar.gz`);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /REVIEW_ARCHIVE=evidence-20261021T140000Z/);
  assert.match(r.stdout, /STAGE1_SUMMARY\.md/); assert.match(r.stdout, /ledger\.tsv/); assert.match(r.stdout, /preflight-redacted\.txt/);
  assert.doesNotMatch(r.stdout, /hr-manager-access\.csv|deployer\.copy|\/preflight\.txt/);
  assert.equal(read(`${run}/preflight-redacted.txt`), "HR_GUARDS=PASS\n");
});

test("the wrapper never reads sana-deploy's home, closes stdin for the package, and the sudoers entry names only the wrapper", () => {
  assert.doesNotMatch(wrapper.replace(/^#.*$/gm, ""), /\/home\/sana-deploy|incoming|outgoing/);
  assert.match(wrapper, /hr-migrate-0052-0054\.sh" "\$stage" "\$\{args\[@\]\}" < \/dev\/null > "\$WORK\/\$stage-stdout\.txt"/, "the package's stdout (preflight report with e-mails) never reaches the Actions log");
  assert.match(wrapper, /core\.hooksPath=\/dev\/null/);
  const sudoers = read("ops/prod-migration-0052-0054/vps/sudoers.sana-hr-migration").split("\n").filter(l => l && !l.startsWith("#"));
  assert.deepEqual(sudoers, ["Defaults!/usr/local/sbin/sana-hr-migration env_reset, !setenv", "sana-deploy ALL=(root) NOPASSWD: /usr/local/sbin/sana-hr-migration"]);
});
