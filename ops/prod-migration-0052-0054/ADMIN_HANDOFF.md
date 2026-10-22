# SANA HR production release 0052–0054 — administrator handoff

**For:** the VPS administrator (`209.42.23.12`). **Reviewers' background:** `RUNBOOK.md`.

**Purpose:** add the Timesheet and Payroll schema (0052–0054) to production. The same transaction fills two data gaps left by the VPS's own migrations: job history and role permissions.

**How it runs:** one read-only evidence run (Stage 1), one reviewed PR, then one maintenance window (Stage 2). Every production change waits behind a written approval checkpoint. Nothing is applied before Checkpoint B.

| Step | Who | Changes production? |
|---|---|---|
| Stage 1: `evidence` | Administrator | No (read-only) |
| **Checkpoint A**: commit evidence, attestation, approvals and deployer verdict | Developers and approvers (PR) | No |
| Stage 2.1–2.3: `preflight`, `rehearse` | Administrator | No (rehearsal uses a throwaway container) |
| **Checkpoint B**: written approval to apply | Release owner | — |
| Stage 2.4: `apply` | Administrator | **Yes**, one transaction, HR stopped |
| **Checkpoint C**: go/no-go for the release deploy | Release owner | — |
| Stage 2.5: deploy, then `postdeploy` | Administrator | Deploy only; `postdeploy` is read-only |
| **Checkpoint D**: sign-off, or recovery | Release owner | — |

Never run `drizzle-kit migrate`, `npm run db:migrate` or `drizzle-kit push` against production. Production's ledger head is newer than 0052/0053, so Drizzle would skip them and apply only 0054.

---

## 0. Prerequisites (once)

| Need | Check |
|---|---|
| Root shell on the VPS | `id -u` → `0` |
| docker, python3, node ≥ 18, sha256sum, curl, git | `node -v; docker ps --format '{{.Names}}' \| grep sanaa-hr-postgres` |
| ≥ 2 GiB free in `/root/sanaa-hr-cicd-backups` | `df -h /root` |
| Package checkout | `git clone https://github.com/ahmedelshewy-koon/hr.git /root/hr-migration` (once) |
| Recovered VPS migrations, in one directory, unmodified | `0031_vps_current_schema.sql`, `0032_vps_attendance_device_country.sql`, `meta/_journal.json`. Optional: an `ORIGIN.txt` saying where they were found |
| Candidate release checkout | The exact commit the deployer will run, e.g. `/root/hr-candidate` |

Never open, re-save or convert the recovered files: Drizzle hashes their exact bytes.

---

## Stage 1: evidence (read-only; no maintenance window)

```bash
cd /root/hr-migration && git fetch origin && git checkout <PR #7 commit named in the request>
sha256sum --quiet -c ops/prod-migration-0052-0054/files.sha256 && echo FILES-OK
bash ops/prod-migration-0052-0054/hr-migrate-0052-0054.sh evidence \
     --recovered /root/vps-recovered-migrations --candidate /root/hr-candidate; echo "exit=$?"
```

**Expected:**
- `FILES-OK`;
- `EVIDENCE=COMPLETE`, then `exit=4` (normal before review);
- a line `bundle to send: /root/sanaa-hr-migration-runs/evidence-<ts>.tar.gz (+ .sha256)`.

**What it does:**
- copies the recovered files byte for byte, with `SOURCE.txt` (sha256, mtime, owner);
- checks the candidate release (`candidate.txt`);
- scans the service unit, its start scripts, timers and crontabs for migration commands (`startup-paths.txt`);
- runs the full read-only preflight;
- writes `STAGE1_SUMMARY.md`, `APPROVAL_JOB_HISTORY.md` and `APPROVAL_RBAC.md`.

No database write, no service stop, no backup.

**Send:**
- the `.tar.gz` and its `.sha256`, over a private channel (the bundle lists user e-mails and employee IDs);
- `STAGE1_SUMMARY.md`, pasted into the PR #7 thread. Its *Blockers* section lists anything that needs a decision.

**Stop and report instead** if:
- the exit is `1`;
- the summary says `RECOVERED_SOURCE_HASH_MISMATCH`, `MIGRATION_COMMANDS_FOUND`, `CANDIDATE=FAIL` or `seed_version mismatch`.

**Change freeze, from Stage 1 until Stage 2 ends:**
- no new employees, no organisation/assignment edits;
- no Permissions-screen edits, no role changes.

The approvals are bound to fingerprints of the data as of Stage 1. Any such change makes Stage 2 stop safely at `preflight`, with nothing changed, and Stage 1 and the approvals must then be repeated.

---

## CHECKPOINT A: developers and approvers (no administrator action)

1. **Check and commit the recovered files.**
   ```bash
   node ops/prod-migration-0052-0054/lineage.mjs ingest --bundle <extracted evidence-run dir>            # dry run
   node ops/prod-migration-0052-0054/lineage.mjs ingest --bundle <extracted evidence-run dir> --write    # copy byte-exact
   ```
   `ingest` refuses files that differ from `SOURCE.txt` or from the ledger hashes. It prints, and never writes, the values for steps 2–4.
2. **Attest the ledger:** in `ledger-attestations.json`, set `production_ledger.fingerprint` to the value from `STAGE1_SUMMARY.md`.
3. **Approve separately:**
   - `APPROVAL_JOB_HISTORY.md`, by someone allowed to approve HR records;
   - `APPROVAL_RBAC.md`, by someone allowed to approve access changes.

   Copy each approved entry into `reconciliation-approval.json`. Choose option A or B for any MISSING_SOURCE employee (in `APPROVAL_JOB_HISTORY.md`). A rejection must instead be recorded as a `data_checks` attestation, as each request explains.
4. **Deployer verdict:** in `deployer-review.json`, set `status: "approved"` for the sha256 in the summary. Only do this once the startup paths are clean and the candidate check is PASS.
5. **Merge into the PR #7 branch** after review, and send the administrator the new commit SHA.

---

## Stage 2: maintenance window (one session)

Announce:
- HR will be unavailable for a few minutes during 2.4 and the deploy;
- every user must sign in again afterwards.

### 2.1 Checkout
```bash
cd /root/hr-migration && git fetch origin && git checkout <commit from Checkpoint A>
sha256sum --quiet -c ops/prod-migration-0052-0054/files.sha256 && echo FILES-OK
```

### 2.2 Preflight (read-only)
```bash
bash ops/prod-migration-0052-0054/hr-migrate-0052-0054.sh preflight; echo "exit=$?"
```
**Expected:** `HR_GUARDS=PASS`, `LINEAGE=VERIFIED`, `PREFLIGHT=PASS`, `exit=0`.

**If `exit=4`:** production changed since Stage 1 (the freeze was broken, or the ledger moved). Stop and send the run directory. Nothing was changed.

### 2.3 Rehearsal (production unchanged)
```bash
bash ops/prod-migration-0052-0054/hr-migrate-0052-0054.sh rehearse; echo "exit=$?"
```
**What it does:**
- takes a fresh backup and verifies it by restoring it into a throwaway, network-less container;
- applies 0052–0054 and the approved reconciliation there;
- validates the result and compares it with a from-scratch build;
- checks that a rerun is refused, that a clean rollback works, and that an unsafe rollback is refused.

**Expected:** `REHEARSAL=PASS`, `exit=0`, and a run directory `rehearse-<ts>`.

**If objects are reported missing against the from-scratch build:** stop, and send `catalog-missing-on-production.txt`. Use `--accept-catalog-drift` only after a written developer review.

### CHECKPOINT B: written approval to apply (release owner)
The approver reviews:
- `REHEARSAL_RESULT`;
- `RECONCILIATION_BEFORE_AFTER.md` (approved rows inserted, remaining 0);
- `validate-clone.txt`;
- `hr-manager-access.csv`.

The approver then decides `--hr-managers`. The default is nobody. Name user IDs only with a separate written approval; the same value must be passed to `rehearse` and `apply`.

The approval must be in writing and name the rehearsal run directory. Apply must start within 24 h of the rehearsal; after that, rehearse again.

### 2.4 Apply (changes production)
```bash
sha256sum /usr/local/sbin/sana-hr-deploy      # must equal deployer-review.json
bash ops/prod-migration-0052-0054/hr-migrate-0052-0054.sh apply \
     --rehearsal /root/sanaa-hr-migration-runs/rehearse-<ts> \
     --deployer-sha256 <sha256 above> \
     --confirm APPLY-0052-0054-ON-sanaa_hr; echo "exit=$?"
```
**What it does:**
1. re-checks every gate and fingerprint;
2. stops `sanaa-hr.service`;
3. takes a final backup, verified by a full restore;
4. applies everything in **one transaction**;
5. validates the result and saves an access snapshot;
6. restarts HR.

**Expected:** `HR_DATA_PRESERVATION=PASS`, `HR_VALIDATION=PASS`, `APPLY=COMPLETE`, `exit=0`.

Write down the `apply-<ts>` run directory and the backup path (it is also in `<run>/BACKUP`).

**If it fails before COMMIT:** the transaction rolls back and production is unchanged. HR is restarted automatically. Send the run directory.

### CHECKPOINT C: go/no-go for the release deploy (release owner)
Deploy only the candidate checked in Stage 1, with the usual deployer and nothing else:
- no permission edits;
- no HR-manager assignment;
- no migrations.

### 2.5 Deploy, then post-deployment validation (read-only)
```bash
# deploy the approved release with the usual deployer, then:
bash ops/prod-migration-0052-0054/hr-migrate-0052-0054.sh postdeploy --run-dir /root/sanaa-hr-migration-runs/apply-<ts>; echo "exit=$?"
```
**Expected:** `POSTDEPLOY=PASS`, `exit=0`.

**What it checks:**
- the schema contract and the official audit;
- `HR_VALIDATION=PASS`;
- `seed_version` equals the release;
- HR answers on `:4050`;
- permissions, roles, users and the seed marker are **identical** to the snapshot taken at apply.

**If `exit=5`:** read `access.diff` (`<` = at apply, `>` = now) and go to Checkpoint D.

### CHECKPOINT D: sign-off or recovery (release owner)
- **PASS:** announce that HR is available again.
- **Next steps, each separately approved:**
  - assign HR managers (Timesheet, Payroll, Saved Attendance and Vacation Setup stay hidden from HR Managers until then);
  - lift the freeze.

---

## Optional: run Stage 1, preflight and rehearsal through GitHub Actions

Workflow: `.github/workflows/hr-migration-0052-0054.yml` (manual only). Stages: `capabilities`, `evidence`, `preflight` and `rehearse`.

**Apply, rollback, postdeploy and the deploy are not in it.** Those stay manual, as root, behind Checkpoints B–D.

**Why setup is needed:**
- As configured, `sana-deploy` can upload to its inbox and run only `sudo -n /usr/local/sbin/sana-hr-deploy`.
- The package needs root: `docker exec` into the database, `/root/...` run and backup directories, `crontab -l -u root`.
- So the workflow cannot run anything until the administrator approves and installs the setup below. Run the `capabilities` stage first: it reports read-only what `sana-deploy` may do.

**One-time setup (administrator's decision; remove it after the release):**

| Step | Command (as root, from a checkout of the reviewed commit) |
|---|---|
| Wrapper | `install -o root -g root -m 0755 ops/prod-migration-0052-0054/vps/sana-hr-migration /usr/local/sbin/sana-hr-migration` |
| sudo rule (only that wrapper) | `install -o root -g root -m 0440 ops/prod-migration-0052-0054/vps/sudoers.sana-hr-migration /etc/sudoers.d/sana-hr-migration && visudo -cf /etc/sudoers.d/sana-hr-migration` |
| Allow-list (exact commit and stage) | `install -d -m 0755 /etc/sanaa-hr && printf '%s evidence\n%s preflight\n' <sha> <sha> > /etc/sanaa-hr/migration-approved-commits && chmod 0644 /etc/sanaa-hr/migration-approved-commits` |
| Recovered files | Place them, unmodified, in `/root/vps-recovered-migrations/`, with `meta/` |
| GitHub environment | A repository admin creates `production-migration` with required reviewers. The workflow refuses to start without it |

**What the wrapper guarantees:**
- It runs only `evidence`, `preflight` and `rehearse`, and only for a commit and stage listed in the root-owned allow-list.
- It receives the package as a git bundle on stdin and checks out exactly that commit. It never reads `sana-deploy`'s home directory.
- It keeps the package's stdout (the HR-manager e-mail report) on the VPS.
- It returns a review archive without e-mails or the deployer copy. The archive is kept in GitHub for 7 days.
- No secret, SSH key or existing permission is changed: the workflow reads `SANA_DEPLOY_KEY` / `SANA_DEPLOY_KNOWN_HOSTS` like the existing workflows.

**Runs:** Actions → *HR migration 0052-0054* → Run workflow.

| When | Inputs | Expected |
|---|---|---|
| Before setup, any time | stage `capabilities`, any package commit | Summary *Ready* or *Not ready* |
| Stage 1 | stage `evidence`, package = PR #7 commit, candidate = release commit | Green (exit 4 is accepted); artifact with the review archive and STAGE1 summary in the job summary |
| Checkpoint A | Developers: `lineage.mjs ingest` on the extracted review archive (it contains everything ingest needs) | Same as the manual path |
| Window 2.2 | Administrator allow-lists the Checkpoint A commit for `preflight` and `rehearse`; stage `preflight` | Green, `PREFLIGHT=PASS` in the log |
| Window 2.3 | stage `rehearse`, confirm `REHEARSE-0052-0054-NO-PRODUCTION-CHANGE`, environment approval | Green, REHEARSAL_RESULT in the job summary; the run directory stays in `/root/sanaa-hr-migration-runs/` for `apply` |
| 2.4 onwards | Manual as above: `apply` from `/root/hr-migration` at the **same commit** (apply checks the package fingerprint against the rehearsal) | — |

**Two cautions:**
- **Default branch.** GitHub can only start a manual workflow whose file is on the default branch. Getting this file onto `main` needs its own approved PR.
- **Deploys on merge.** Any merge to `main` also triggers `deploy-production.yml` (push to `main`). Before such a merge, make sure that deploy run is held by the `production` environment's reviewers and rejected. Otherwise it could deploy before 0052–0054 are applied; the deployer's schema audit should refuse that.

Stages share the deploy's concurrency group, so they never overlap a deployment. Start one run at a time: GitHub keeps only one pending run per group.

## Recovery

| Situation | Action |
|---|---|
| `evidence`, `preflight` or `rehearse` fails | Nothing changed. Send the run directory |
| `apply` fails before COMMIT | Nothing changed. HR is restarted automatically. Send the run directory |
| Applied; the deploy fails or `postdeploy` = 5 because of the release | Keep the schema (additive). Redeploy the previous release, then investigate |
| Applied; must be undone; nothing written to the new objects yet | `bash ops/prod-migration-0052-0054/hr-migrate-0052-0054.sh rollback --run-dir <apply run> --confirm ROLLBACK-0052-0054-ON-sanaa_hr`, then deploy the pre-0052 release |
| Rollback refused, or data already written | Restore the verified final backup into a **new** database and swap the names (RUNBOOK §9). **Never `pg_restore --clean`** |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Passed |
| 1 | A gate or check failed; read the last `ERROR:` line |
| 2 | Usage |
| 4 | Lineage or reconciliation not verified (expected only in Stage 1) |
| 5 | `postdeploy` found a difference |

## Outstanding approvals (state of this commit)

| # | Decision | Owner | Status |
|---|---|---|---|
| 1 | Stage 1 evidence bundle delivered (recovered files, startup paths, candidate SHA) | VPS administrator | **open** |
| 2 | Recovered files committed (`ingest --write`), reviewed | Developers | open (needs 1) |
| 3 | `production_ledger.fingerprint` attested | Developers | open (needs 1) |
| 4 | Job-history reconciliation, including the MISSING_SOURCE decision (option A or B) | HR data owner | **policy approved 2026-10-22, option A** (`BUSINESS_APPROVALS.md`); fingerprint binding needs 1 |
| 5 | RBAC reconciliation: `administrative_decisions` view/create grants for HR Manager and Department Manager, plus parity denials | Access owner | **policy approved 2026-10-22** (`BUSINESS_APPROVALS.md`); fingerprint binding needs 1 |
| 6 | Deployer verdict `approved` for sha256 `2df500bd…5fc7` (now `conditional_pass`) | Reviewers | open (needs 1) |
| 7 | Candidate release named, and containing the insert-only reseed (`app/api/hr/role-permission-seed.ts`) | Release owner | **decided 2026-10-22:** `main` after the separate reseed PR is merged (its auto-deploy held); commit SHA open |
| 8 | Written approval to apply (Checkpoint B), with the `--hr-managers` decision (default: none) | Release owner | **conditionally approved 2026-10-22**, HR managers none; confirm naming the passing rehearsal |
| 9 | Go/no-go for the deploy (Checkpoint C) and sign-off (Checkpoint D) | Release owner | open |
| 10 | GitHub Actions path only: approve and install the wrapper, sudoers entry and allow-list; create the `production-migration` environment with required reviewers; get the workflow file onto `main` with the triggered deploy held | VPS administrator; repository admin; release owner | open (optional) |
