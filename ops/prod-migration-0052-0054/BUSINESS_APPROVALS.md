# Business approvals: 0052–0054 release

**Approved by:** the release owner (ahmadelshewy@asuscards.com), in writing, on 2026-10-22.

These are **policy approvals**. The technical gates still apply unchanged:
- `reconciliation-approval.json` stays `pending` until Stage 1 delivers the exact proposal fingerprints;
- reviewers then commit each approved entry with its fingerprint;
- if production changes after that, the fingerprint changes and the apply refuses.

| # | Decision | Approved | Still needed before it takes effect |
|---|---|---|---|
| 1 | **Job-history reconciliation (0041 backfill):** insert one `current_assignment` row for each employee without history, using only stored values | Yes | Stage 1 fingerprint and employee IDs in `APPROVAL_JOB_HISTORY.md`, committed to `reconciliation-approval.json` |
| 2 | **Employees without a stored assignment date (MISSING_SOURCE): option A.** Leave them without history now; HR enters the date in the application after the release. No date is invented | Yes, option A | The employee IDs from Stage 1, recorded as a `data_checks` attestation for `0041_job_history_backfill` in `ledger-attestations.json` |
| 3 | **RBAC reconciliation:** HR Manager and Department Manager get view and create on `administrative_decisions`. The other rows are explicit denials (parity with 0042) that change no access. Existing permissions are never changed | Yes | Stage 1 fingerprint and rows in `APPROVAL_RBAC.md`, committed to `reconciliation-approval.json`. **If Stage 1 proposes any other grant (allowed=1), it needs a new approval** |
| 4 | **Release version:** deploy `main` after a separate, reviewed PR adds the insert-only runtime reseed (`app/api/hr/role-permission-seed.ts`) | Yes | The PR merged (with the automatically triggered deploy held and rejected); that `main` commit given as the candidate in Stage 1 |
| 5 | **HR managers at apply: none** (default). Assigning HR managers is a separate, later approval | Yes | — |
| 6 | **Apply on production, conditional:** approved once the rehearsal passes | Conditional | Checkpoint B: confirm in writing, naming the passing rehearsal run directory, within 24 h of it |

Not approved here: the deployer verdict (`deployer-review.json`), which is the reviewers' decision after Stage 1, and the deploy go/no-go and sign-off (Checkpoints C and D).
