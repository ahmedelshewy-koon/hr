# HR — Final Validation Report

**Date:** 2026-09-19
**Scope:** Validate the final merged working tree against the real PostgreSQL database, fix regressions only. The tree is `main` @ `cceafff` plus uncommitted work: the refactor described in `REFACTOR_REPORT.md`, the biometric / page-availability features, and a parallel learning-module session.
**Companion document:** `REFACTOR_REPORT.md` (what the refactor changed). This report records what was verified, how, and what was found.

---

## Verdict

**The merged tree is sound, with one regression, which is now fixed.**

- The merge introduced **one regression**, and it has been fixed. On three routes (`/api/hr`, `/api/employees/[id]`, `/api/approvals`), every error response's `Content-Type` changed from `application/json` to `text/plain;charset=UTF-8`, although the body was still JSON. The cause and the fix are in [Regression found and fixed](#regression-found-and-fixed).
- **No other behavior changed.** 2,242 read requests were replayed against a pre-refactor build and the final build on identical data. Every status code and every response body matched, including the `/api/hr` bootstrap for all 43 real users.
- **All four runtime suites pass** on a clone of the real database. Two of them first needed their test fixtures updated, and they fail identically on the pre-refactor build, so they are stale tests, not regressions. See [Runtime suites](#runtime-suites).
- The refactor's performance claims were **measured, not just derived**. The auth bootstrap runs once per isolate. `/api/hr` issues 29 fewer SQL statements per request, and it is faster on medians (267 → 221 ms).
- **Several problems predate the merge** and were left alone, as instructed. The most important is that `npm run db:generate` is currently unsafe. See [Pre-existing issues](#pre-existing-issues-found-not-fixed).

Nothing was committed. The only change to the repository is 6 lines in `app/api/api-security.ts`, plus this file.

---

## The database, and how it was protected

"The real DB" is the local PostgreSQL 18.3 cluster at `127.0.0.1:5545`, database `koon_hr`, configured in `.dev.vars`. It holds real HR data: 48 employees, 43 active users, 23 departments, 238 biometric punches and 383 audit rows, across 77 tables. All 24 migrations (`0000`–`0023`) are applied.

The runtime suites are write-heavy. `runtime-rbac-hrms.mjs` **overwrites the password hashes of users 1 and 2**, and the others create Super Admin accounts with known passwords, jobs, candidates, employees, assets and review cycles. None of that can run on real HR data, so the work was split as follows:

| Where | What ran |
|---|---|
| **Backup** | `pg_dump` of `koon_hr` taken before anything else ran. It restores to an identical schema and identical row counts in all 77 tables. |
| **Clones of `koon_hr`** (restored from that dump, dropped afterwards) | Everything that writes: runtime suites, the differential test, the auth-bootstrap scenarios, the query counts, the browser smoke. |
| **Real `koon_hr` itself** | Only rollback-only tests and read-only requests. Row counts of all 77 tables were snapshotted before and after. |

**Net change to the real database from this session:** `security_rate_limits` +2 rows, from the two POSTs in `runtime-biometric-api.mjs` that are expected to be denied. No other table changed. `attendance_device_syncs` also grew by 15 rows over the same period, but those come from the ZKTeco agent already running on this machine (`trigger=scheduled`), not from validation.

Your dev server on `:3000` and the ZKTeco agent were left running and untouched. Validation used separate servers on other ports.

---

## Validation summary

### Static checks (on `D:\HR`, after the fix)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **pass** |
| `npm run lint` | 22 errors, 7 warnings. Same as the refactor's recorded baseline; nothing new, and nothing in the changed file. |
| `node --test tests/*.test.mjs` | **121 tests: 118 pass, 3 skipped, 0 fail** |
| The 3 skipped tests, run with their opt-in flags | **all pass.** Two DB tests (`RUN_BIOMETRIC_DB_TESTS=1`) pass on the clone and on real `koon_hr`; both roll back. The Playwright dashboard test (`RUN_DASHBOARD_UI_TESTS=1`) passes 8/8 against the final build. |
| `npm run build` | **pass**; all 19 API routes registered |

### Runtime suites

Each suite ran against the production build served by `wrangler dev` (the same workerd runtime as Cloudflare), on the clone. For comparison, each also ran against a **pre-refactor baseline build** (see [How the baseline was built](#how-the-baseline-was-built)).

| Suite | Final build | Pre-refactor build | Notes |
|---|---|---|---|
| `runtime-recruitment-ats.mjs` (unmodified) | **pass** | pass | CV upload and parse, match score 100, two independent evaluations, offer approval, hire, 409 on a duplicate hire, onboarding |
| `runtime-biometric-api.mjs` (unmodified) | **pass**, on the clone **and on real `koon_hr`** | pass | Role authorization, pagination, wildcard escaping, daily view |
| `runtime-complete-hrms.mjs` (unmodified) | fail at `create_job` → 400 | **same failure** | Stale test (see below) |
| ↳ variant with the recruitment prologue replaced | **pass** | pass | Lifecycle, assets, learning and performance (with their 409 guards), offboarding with account deactivation, 4 profile tabs, dashboard, notifications, 6 CSV reports |
| `runtime-rbac-hrms.mjs` (unmodified) | fail at "performance in-scope" → 403 | **same failure** | Stale fixture IDs (see below) |
| ↳ variant with actors chosen from the data | **pass** | pass | Manager in-scope 4/4, manager ID-tampering blocked 4/4, employee own 4/4, employee tampering blocked 3/3, recursive-scope manager review, finalization |

Why the two unmodified suites fail on both builds:

- **`runtime-complete-hrms.mjs`** drives the recruitment API that existed before the ATS rewrite (`add_candidate` by `jobId`, `move_candidate` by `candidateId`). Commit `cceafff` (2026-08-25) replaced that API; the test was last touched on 2026-08-23. The new flow is covered by `runtime-recruitment-ats.mjs`. The variant keeps every later step unchanged and swaps only the recruitment prologue for a seeded hire plus an onboarding started through the real `/api/lifecycle` endpoint.
- **`runtime-rbac-hrms.mjs`** hardcodes user 1 as a Department Manager and employee 4 as out of scope. After the real-employee import, users 1 and 2 are both Employees. The variant picks a manager, an in-scope employee account and an out-of-scope employee using the app's own recursive department rule, then runs the original assertions. One assertion was made grant-aware: an administrator revoked Employee `assets:view` through the Roles screen on 2026-08-24 (audit rows 117–118), so the correct answer on this data is 403, not 200.

The variants live outside the repository. The unmodified suites were not edited, because a stale test is not a regression.

### Differential test: pre-refactor vs final

This is the main regression check. Two servers ran side by side against the same fresh clone: the **pre-refactor baseline** and the **final build**. Each request was sent three times, in the order baseline, final, baseline. That order separates real differences from data changing between calls.

Coverage:

- `/api/hr` bootstrap for **all 43 active users**, which covers page sets, capability flags and data scope
- every read endpoint, for 11 representative users across all 4 roles
- all 11 employee-profile tabs × 10 target employees (self, in scope, out of scope)
- all 11 report types in JSON and CSV
- anonymous requests, cross-origin writes, and 11 error paths (404, 400, unknown actions, missing IDs)

| | Before fix | After fix |
|---|---|---|
| Request triples | 2,242 | 2,242 |
| Identical (status, body and headers) | 1,454 | 1,783 |
| Differences in **status or body** | **0** | **0** |
| Header-only differences | 788 (the regression) | 459 (an older error-label bug, now corrected; see below) |
| Timeouts / baseline-vs-baseline drift | 0 / 0 | 0 / 0 |

Every successful response, for every user and every endpoint, is byte-identical between the pre-refactor and final builds. This is the direct evidence that the permission batching, the shared department-scope query and the `withDatabase` conversion preserved behavior on real data.

### Browser smoke on real data

Headless Chromium visited every sidebar page for 2 users per role on both builds: 15 pages for Super Admin and HR Manager, 11 for Department Managers, 4 for Employees.

- Both builds showed identical page sets.
- There were **0 page errors, 0 console errors and 0 failed API calls**.
- Page headings were identical between the builds.

Most real accounts have `must_change_password=1`, which correctly forces the password-change modal. The harness cleared only that flag in the session payload so the pages could be reached; everything else was live.

### Read-only checks against the real `koon_hr`

| Check | Result |
|---|---|
| DB-gated biometric tests (`RUN_BIOMETRIC_DB_TESTS=1`), which roll back | 9/9 pass; row counts unchanged |
| `runtime-biometric-api.mjs` against the final build | pass |
| Read-only sweep with the final build (all 43 users' `/api/hr`, plus 7 users × every read endpoint, profile tab and CSV report) | **762 requests: 0 server errors (5xx), 0 timeouts.** 483 × 200, 274 × 403 (scope and permission denials, the same as the differential test), 4 × 401, 1 × 404. Page sets consistent per role. Error responses are `application/json`. Median 144 ms, p95 251 ms. **0 rows changed.** |

`/api/notifications` was left out of the real-DB sweep because its GET handler creates operational notifications (`syncOperationalNotifications`). It was covered on the clone.

---

## Regression found and fixed

**Symptom.** On `/api/hr`, `/api/employees/[id]` and `/api/approvals`, every 4xx error response changed its `Content-Type` from `application/json` to `text/plain;charset=UTF-8`. The body was still the same JSON `{"error": "…"}`. The differential test found this on 788 responses; status codes and bodies were unaffected.

**Cause.** The refactor moved these three routes from their private error handlers onto the shared `apiFailure`. `apiFailure` forwards the headers of the thrown `Response`, which is deliberate: it keeps `retry-after` on 429 responses. But a validation error thrown as `new Response("message", { status })` carries `content-type: text/plain`. `Response.json()` only adds `application/json` when no content type is already present (per the Fetch spec), so the plain-text label leaked through.

**Fix** (`app/api/api-security.ts`, `apiFailure`). Keep forwarding the thrower's headers, but drop the thrown body's own content headers:

```ts
const headers = new Headers(error.headers);
headers.delete("content-type");
headers.delete("content-length");
return Response.json({ error: body || error.statusText || "Request failed" }, { status: error.status, headers });
```

**Verification.**

- The full differential test was rerun, and the three routes now match the pre-refactor build exactly (0 differences).
- A 429 still returns `retry-after: 60`, now with `application/json`. It fired on the 181st request against the 180-per-minute limit.
- Typecheck, lint, the unit tests and the build were all rerun with unchanged results.

**Side effect.** The same leak already existed before the refactor on every route that used `apiFailure` in HEAD: dashboard, notifications, performance, lifecycle, assets, learning, documents, reports, operations, and recruitment documents. Those routes' error responses are now also `application/json`; these are the 459 remaining header-only differences. Status codes and bodies are unchanged. No UI code reads this header (checked), so the change is invisible in the app. It matters only to external API consumers, for whom it is a correction.

---

## The refactor's claims, checked empirically

`REFACTOR_REPORT.md` derived its performance numbers by reading code and listed items that needed manual checking. Those were measured against the database:

### Auth bootstrap memoized per isolate (the report's "highest-value change")

Each scenario ran on a fresh isolate, against a clone with **all 7 auth columns dropped**. A DDL event trigger counted every `ALTER TABLE` actually executed.

| Scenario | Final build | Pre-refactor build |
|---|---|---|
| A: 6 sequential requests on a database missing the columns | all succeed; columns recreated, roles labelled; **7 ALTERs in total** | all succeed; 42 ALTERs |
| B: 6 concurrent first requests, held behind a lock on `users` so they all wait on the same pending bootstrap | all 6 return 200 when the lock is released; **7 ALTERs** | all succeed; 49 ALTERs |
| C: the first request is aborted by its client mid-bootstrap, then new requests arrive | follow-up requests return 200 at normal latency; **7 ALTERs**; no workerd cross-request warnings | all succeed; 28 ALTERs |

Scenario C was the specific risk: in Workers, a promise shared across requests can stall if the request that created it is cancelled. It does not stall here.

### SQL statements per request

Measured as `xact_commit` deltas on a dedicated database; the queries run in autocommit, so one statement is one transaction.

| Request | Pre-refactor | Final | Saved |
|---|---|---|---|
| `/api/hr` bootstrap, HR Manager | 66 | 37 | 29 |
| `/api/hr` bootstrap, Department Manager | 61.5 | 32.5 | 29 |
| `/api/hr` bootstrap, Employee | 60 | 31 | 29 |
| Employee profile (overview), HR Manager | 32 | 16 | 16 |
| `/api/approvals` | 17 | 9 | 8 |
| `/api/notifications` | 29 | 21 | 8 |

The 8 saved on every endpoint is the auth bootstrap (7 `ALTER` + 1 `UPDATE`). The remaining 21 on `/api/hr` are the batched permission checks, which matches the report's "22 → 1".

**Latency** (medians, same machine, requests interleaved): `/api/hr` bootstrap 267 → 221 ms; all other reads 149 → 112 ms. A repeat run gave 286 → 230 and 142 → 108.

### Other checks

- **Merge of the two parallel sessions.** `app/api/learning/route.ts` was rewritten by both the refactor session and the learning session. The final file contains both sets of changes: `withDatabase` and the shared department-scope query, plus the `learning-rules` logic and its later fix that moved permission checks out of the transaction. The learning flows pass in the runtime suites.
- **Deadlock scan.** Each request has a single-connection pool, so calling `db` inside `db.transaction` would hang. All 40 transaction blocks in `app/` were scanned, and none does this.
- **`/api/dashboard` has no browser consumer**, as the refactor report states. No UI page calls it. The endpoint still works (it is covered by the runtime suite and the sweep). Whether to keep it remains a product decision.

### How the baseline was built

The pre-refactor state was never committed, so it was reconstructed from the final tree:

- `app/api/hr/route.ts` and `app/api/auth/route.ts` were restored from Claude Code's pre-edit backups of the refactor session. These files had uncommitted feature work, so HEAD would not have been the right baseline.
- Every other refactor-touched server file was restored from HEAD. This was done only where the backups proved the file was identical to HEAD before the refactor, or where its diff contained nothing but refactor patterns.
- Files carrying unrelated feature work (dashboard, learning, attendance, notifications, UI) were kept as they are in the final tree. For those files, the comparison therefore isolates the refactor rather than the features.

---

## Pre-existing issues found (not fixed)

These predate the merge or come from data and environment rather than code. Following the "regressions only" instruction, they were documented and not changed.

1. **`npm run db:generate` is unsafe.** The newest drizzle snapshot is `0017` (2026-08-23), while migrations `0018`–`0023` were hand-written without snapshots. Running `db:generate` in a scratch copy produced a 467-line migration that **re-creates 27 tables that already exist**; applying it would fail. Regenerate a baseline snapshot before the next schema change.
2. **Migrations `0017` and `0020` were edited after being applied.** Their SHA-256 hashes in `drizzle.__drizzle_migrations` match no committed version of those files; line endings were ruled out. Applying the repo's migrations to an empty database produces the same schema as the real DB: 897 columns, 189 indexes and 869 constraints, with identical functions, triggers, views and sequences. So there is **no schema drift**. Seed data inserted by those migrations on a fresh environment was not compared.
3. **`system_settings` differs cosmetically** between the real DB and a fresh install. The real table was created by the runtime `CREATE TABLE IF NOT EXISTS` in `hr/route.ts` before migration `0004`, so it has a redundant inline `UNIQUE` and `CURRENT_TIMESTAMP` defaults instead of the equivalent `now()`.
4. **Two runtime suites are stale** (described under [Runtime suites](#runtime-suites)). Adopting the data-driven variants would bring them back into service; they can be provided.
5. **Every biometric sync is failing.** Every scheduled sync since 2026-09-18 18:59 has failed with `Device connection failed (1)`; the last success was 2026-09-17 13:09. The device at `192.168.1.147:4370` does not answer TCP or ping from this machine, which is on `192.168.105.x`. This is a network problem, not a code problem.
6. **A local tooling quirk (`wrangler dev` only).** After a POST whose body the worker never reads (for example, one rejected early as cross-site), the next request through the local proxy can hang until another request arrives. The pre-refactor build shows the same behavior. It does not affect deployed Workers, but it can make local test harnesses appear to hang.

---

## Not validated

- **Hosted environment.** This covers the Cloudflare deployment, a networked production database, Hyperdrive or pooling, and the real R2 bucket. The CV upload used wrangler's local R2 simulator.
- **Writes on the real DB.** By design, every write path ran only on clones.
- **Write responses.** POST responses were not compared one by one between builds; write behavior was compared through the runtime suites, which give the same results on both builds.
- **The generic 500 path.** `/api/hr`'s "Unexpected server error" response requires a database fault and was not triggered.
- **In-page interactions.** The browser smoke checks that each page renders; it does not exercise controls within pages. It covered 7 users.
- **Lint debt.** The 22 lint errors remain, as recorded in the refactor report.

---

## Reproducing

```bash
# Static checks
npx tsc --noEmit
npm run lint                  # expect 22 errors, 7 warnings
node --test tests/*.test.mjs  # expect 118 pass, 3 skipped
npm run build                 # expect 19 API routes

# Opt-in tests (the DB tests roll back and are safe on real data)
RUN_BIOMETRIC_DB_TESTS=1 node --test tests/biometric-attendance.test.mjs tests/biometric-ordering.test.mjs
RUN_DASHBOARD_UI_TESTS=1 PLAYWRIGHT_MODULE=<playwright-core index.mjs> DASHBOARD_TEST_BASE=<app url> \
  node --test tests/dashboard-attendance-runtime.test.mjs

# Runtime suites: run against a CLONE, never the real DB (they overwrite passwords and create admins)
createdb koon_hr_validation && pg_restore -d <clone url> --no-owner <dump>
npm run build
# Serve the built worker with a .dev.vars that points at the clone, then:
DATABASE_URL=<clone url> RUNTIME_BASE_URL=<app url> RUNTIME_PASSWORD=<any> node tests/runtime-recruitment-ats.mjs
DATABASE_URL=<clone url> BIOMETRIC_TEST_BASE=<app url> node tests/runtime-biometric-api.mjs
```

The harnesses used here were kept out of the repository: the differential probe, the auth-bootstrap scenarios, the query counter, the browser smoke, the real-DB sweep and the two suite variants.

Clean-up: every scratch database (`koon_hr_validation`, `koon_hr_diff`, `koon_hr_authcheck`, `koon_hr_fresh`) and every validation server was removed. The pre-validation backup `koon_hr_pre_validation_20260919_013918.dump` was left in the session's temporary directory; copy it elsewhere if you want to keep it.
