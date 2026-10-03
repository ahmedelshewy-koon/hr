# HR — Runtime Recovery & Final Launch Audit

**Date:** 21 August 2026  
**Scope:** Runtime recovery, migration verification, live E2E, blocker fixes, regression testing  
**Final verdict:** **READY FOR CONTROLLED PRODUCTION LAUNCH**

No new HR modules or workflows were added. Payroll remained frozen.

---

## Executive Summary

The unavailable PostgreSQL runtime was restored as a new isolated development/test cluster on the configured endpoint `127.0.0.1:5545`. The unrelated PostgreSQL service on `5544` was not modified.

The complete repository migration chain was applied through `0013_hr_core_completion`. All 14 migration records exist, all required tables and document columns exist, and all 17 intended foreign keys are present and validated. No foreign key was skipped because of orphan data.

Live Cloudflare-compatible runtime testing then covered authentication, employees, leave balances and concurrency, leave rollover, attendance, corrections, exception scanning, approvals, Profile 360 authorization, the real local `FILES` R2 binding, documents, Dashboard, notifications, reports, CSRF/Origin protection, rate limiting, and audit retention.

Four runtime defects were reproduced and fixed with regression coverage:

1. PostgreSQL rejected untyped nullable parameters during employee/user updates.
2. Leave rollover used an unsupported three-argument advisory lock.
3. A repeated finalized attendance-correction decision returned HTTP 500 instead of 409.
4. Dashboard absence candidates counted employees on non-working days.

Final automated verification: TypeScript PASS, Build PASS, 58/58 tests PASS, and `git diff --check` PASS. Historical lint debt remains unchanged at 130 errors and 3 warnings.

---

## Runtime Recovery

### PostgreSQL identity

| Field | Result |
| --- | --- |
| Host | `127.0.0.1` |
| Port | `5545` |
| Database | `koon_hr` |
| User | `koon_hr_admin` |
| Version | PostgreSQL 18.3, 64-bit |
| Timezone | `Africa/Cairo` |
| Identity verification | PASS |

The restored cluster is stored under:

```text
C:\Users\elshewy\AppData\Local\SanadHR\postgres-5545
```

It listens only on `127.0.0.1:5545`. Local trust authentication is used only for this isolated test cluster because the existing development URL contains no password. This configuration must not be copied to production.

The existing PostgreSQL 18 service on `5544` remained untouched.

### Backup

```text
Backup completed: NO
Reason: the new isolated koon_hr database contained zero public tables and no meaningful data before migration.
```

No production or existing development data was reset, deleted, or migrated.

---

## Migration Evidence

- Official command: `npm run db:migrate`
- First run: migrations applied successfully.
- Second run: completed successfully with no pending migration.
- Migration rows: **14**
- Latest repository/database timestamp: `1787319000000`
- Latest tag represented by the repository journal: `0013_hr_core_completion`

Required tables verified:

- `attendance_corrections`
- `attendance_correction_actions`
- `attendance_exceptions`
- `document_categories`
- `document_versions`
- `notifications`
- `leave_rollovers`
- `security_rate_limits`

Required `documents` columns verified:

- `document_number`
- `issue_date`
- `status`
- `version`
- `replaced_document_id`
- `updated_at`
- `archived_at`

Required indexes and unique constraints for documents, categories, versions, notifications, rollovers, rate limits, corrections, and exceptions were present.

Migration notices were limited to expected idempotent “already exists, skipping” notices. There were no orphan-related skip notices.

---

## Foreign Key / Orphan Review

All intended foreign keys are present with `convalidated=true`:

| Constraint | Status |
| --- | --- |
| `approvals_request_fk` | PASS |
| `attendance_corrections_employee_fk` | PASS |
| `attendance_logs_employee_fk` | PASS |
| `correction_actions_correction_fk` | PASS |
| `daily_attendance_employee_fk` | PASS |
| `document_versions_document_fk` | PASS |
| `document_versions_uploader_fk` | PASS |
| `documents_employee_fk` | PASS |
| `documents_uploader_fk` | PASS |
| `leave_balances_employee_fk` | PASS |
| `leave_balances_type_fk` | PASS |
| `leave_rollovers_employee_fk` | PASS |
| `leave_rollovers_type_fk` | PASS |
| `notifications_user_fk` | PASS |
| `requests_employee_fk` | PASS |
| `users_employee_fk` | PASS |
| `users_role_fk` | PASS |

```text
Skipped foreign keys: 0
Failed foreign keys: 0
Known orphan rows: 0
```

---

## Live E2E Evidence

### Application startup

The Cloudflare-compatible development runtime served `/` with HTTP 200.

Authenticated focused APIs returned HTTP 200:

- `/api/auth`
- `/api/hr`
- `/api/dashboard`
- `/api/notifications`
- `/api/reports`
- `/api/approvals`
- `/api/documents`
- `/api/employees/:id`

No database connection errors remained.

### Authentication

- Valid login: 200, authenticated session cookie issued.
- Invalid password: 401.
- Five failures: 401 each; correct password while locked: 429.
- Login rate limit: first ten rejected normally; eleventh: 429.
- Session cookie `Max-Age`: 28,800 seconds for configured 480 minutes.
- Password change: 200.
- Pre-change second session invalidated through `session_version`.
- New session remained valid.
- Forced password-change account returned `must_change_password=1`; successful change cleared it.
- Password expiry was configured to one day against controlled stale data and correctly forced a change; configuration was restored to disabled.
- Logout cleared the session and subsequent auth check returned unauthenticated.
- Foreign Origin: 403.
- Same Origin with `Sec-Fetch-Site: cross-site`: 403.

### Employees and Profile 360

- Two employee creations were submitted concurrently.
- Results: 201/201.
- Codes: `EMP-00044` and `EMP-00045`.
- Codes were unique.
- Linked user rows were created.
- Employee update initially reproduced a PostgreSQL parameter typing bug; after the fix it returned 200.
- Department, job title, manager, status, work location, linked account email, organization level, and audit history were verified in PostgreSQL.
- Profile 360 returned 200 for Super Admin.
- In-scope manager returned 200.
- Out-of-scope manager returned 403.
- Employee self-profile returned 200.
- Employee access to another employee returned 403.
- Manager payload contained none of: salary, Payroll, bank fields, national ID, address, password hash, or session version.

### Leave

- One-day working leave submission returned 201 and reserved one pending day.
- Manager approval moved it to `pending_hr` without consuming the balance.
- HR approval moved it to `hr_approved`, changed used from 0 to 1, and pending from 1 to 0.
- Available balance remained mathematically correct.
- Manager rejection released the reservation exactly once; duplicate returned 409.
- HR rejection after manager approval released the reservation exactly once; duplicate returned 409.
- Self approval returned 403.
- Manager HR-stage processing returned 403.
- Two competing requests against one available day returned 201 and 409; balance never became negative.
- Concurrent employee-code generation and leave locking were verified against real PostgreSQL.

### Leave rollover

- The first live run exposed the unsupported advisory-lock signature and returned 500.
- After the fix, the 2026→2027 run applied 327 markers.
- A second run applied 0 and skipped all 327, proving idempotency.
- Controlled policy tests proved:
  - carry-forward disabled → carried 0;
  - carry-forward enabled → available 7, maximum 5, carried 5;
  - expiry date → `2026-01-31`;
  - next-year entitlement → annual 21 + carried 5 = 26.

### Attendance and corrections

- Check-in: 200 and one raw `attendance_logs` event.
- Duplicate check-in: 409.
- Check-out: 200 and a second raw event.
- Duplicate check-out: 409.
- Business timestamps matched `Africa/Cairo`.
- Time correction completed employee → manager → HR.
- Corrected daily check-in changed from 10:00 to 09:05.
- Raw check-in remained 10:00 and raw check-out remained 17:00.
- Correction history contained employee request, manager approval, and HR approval.
- Audit events were present.
- Repeated finalized correction now returns 409 after the runtime fix.
- Justification-only approval preserved actual check-in at 10:00 and stored no requested time.

### Exception scanner

- Scanner executed twice without duplicate exception keys.
- Missing check-in was detected.
- Controlled missing checkout was detected.
- Approved leave produced zero open exceptions for the employee/date.
- Official holiday produced zero open exceptions.
- Non-working day produced zero open exceptions.
- Raw attendance logs were not changed.

### Unified approvals

- In-scope manager-stage action succeeded.
- Out-of-scope manager returned 403.
- Manager could not process HR stage.
- HR/Super Admin processed HR stage.
- Self approval returned 403.
- Duplicate processing returned 409 for leave and attendance domains.
- Two concurrent manager decisions produced one domain effect; the second request was safely rejected after the stage changed.

### Documents and R2

The configured Cloudflare `FILES` binding was exercised successfully.

- Valid PDF, PNG, and JPEG uploads: 201.
- PostgreSQL metadata and private R2 objects were created.
- Storage keys were employee/category scoped and random.
- Original filenames were not used as object identity.
- Authorized download returned the original PDF bytes with `private, no-store`.
- Employee could access an allowed own document.
- Manager access to a private category returned 403.
- Employee access to another employee's document returned 403.
- Empty file: 400.
- Wrong extension: 400.
- Fake PDF: 400.
- MIME mismatch: 400.
- Oversized request: 413.
- Client list payload contained no `object_key`, public URL, bucket data, or credentials.
- Replacement returned 200; V2 became active and V1 metadata remained in `document_versions`.
- Archive returned 200; active list excluded it, audit/history retained it, and archived download returned 404.
- Derived states verified: `valid`, `expiring_soon`, `expired`, and `no_expiry`.
- Required-document detection reported the applicable missing employment contract and did not report uploaded categories as missing.

### Dashboard

Dashboard values were compared with direct SQL.

- Active employees: 43 = SQL 43.
- Present: 0 = SQL 0.
- Late: 0 = SQL 0.
- Remote: 1 = SQL 1.
- Leave today: 0 = SQL 0.
- Needs review: 87 = SQL 87.
- Missing checkout: 0 at comparison time = SQL 0.
- Expired documents: 1 = SQL 1.
- Expiring documents: 1 = SQL 1.
- Missing required documents: 43 = SQL 43.

The original absence calculation incorrectly returned 43 on a non-working Friday. After the fix, both Dashboard and authoritative schedule/holiday/leave/attendance SQL returned 0.

### Notifications

- Manager approval notification appeared while the request was pending manager.
- HR notification appeared after manager approval.
- Employee result notifications appeared after final decisions.
- User isolation was enforced; another user's notification update returned 404.
- Repeated synchronization did not duplicate rows.
- Mark one read reduced unread count.
- Mark all read reduced unread count to zero.
- Entity IDs and target paths were present without leaking restricted data.

### Reports

All five CSV exports returned 200:

1. Attendance
2. Leave
3. Employees
4. Documents
5. Approvals

Verified:

- filters, date ranges, department, and employee parameters;
- UTF-8 BOM;
- CRLF CSV rows compatible with Excel;
- Arabic employee content;
- private cache headers;
- 10,000-row SQL safety limit;
- manager employee scope;
- manager documents report denied with 403;
- no password hashes, session versions, bank data, salary, Payroll fields, R2 keys, national IDs, or addresses.

### Audit retention

- Security configuration clamped requested 30 days to the required minimum of 90.
- One controlled old eligible row was deleted.
- One old protected password-change event was preserved.
- The retention run audited itself.
- Second controlled run deleted zero rows.

---

## Runtime Defects Fixed

| File | Fix | Verification |
| --- | --- | --- |
| `app/api/hr/route.ts` | Added explicit PostgreSQL types for nullable user and manager parameters | Employee update and user update returned 200 |
| `app/leave/leave-rollover.ts` | Replaced unsupported 3-argument lock with one hashed bigint advisory key | Live rollover succeeded twice and was idempotent |
| `app/attendance/attendance-service.ts` | Converted finalized transition errors to HTTP 409 | Repeated live decision returned 409 |
| `app/api/dashboard/route.ts` | Derived absences from schedules, holidays, leave, and actual attendance | Dashboard 0 matched authoritative SQL 0 |
| `tests/production-readiness.test.mjs` | Added regression assertions for all audit fixes | Included in 58/58 passing tests |

---

## Final Verification Matrix

| Area | Status | Runtime Evidence | Remaining Action |
| --- | --- | --- | --- |
| PostgreSQL | PASS | Verified database/user/version/timezone on isolated 5545 cluster | Use managed credentials/TLS in hosted production |
| Migrations | PASS | 14 migrations, latest 0013, second run clean | Preserve normal backup policy |
| Authentication | PASS | Login, failure, lockout, logout, password/session/expiry live | None |
| Employees | PASS | Concurrent create, unique codes, update, account, audit | None |
| Leave | PASS | Reserve, approve, reject, stale, concurrency live | None |
| Leave Rollover | PASS | Enabled/disabled/max/expiry and second-run idempotency live | None |
| Attendance | PASS | Check-in/out, duplicates, timezone, persisted totals live | None |
| Attendance Corrections | PASS | Two-stage correction, immutable raw logs, justification-only, 409 stale | None |
| Exception Scan | PASS | Missing events, exclusions, rerun dedupe live | None |
| Unified Approvals | PASS | Manager/HR scope, self denial, stale/duplicate protection live | None |
| Employee Profile 360 | PASS | HR, recursive manager, employee scope and redaction live | None |
| Documents/R2 | PASS | Real FILES binding upload/download/ACL/version/archive/validation live | Verify hosted bucket binding during deployment smoke test |
| Dashboard | PASS | All metrics compared with SQL; absence bug fixed | None |
| Notifications | PASS | Recipients, isolation, read states, dedupe live | None |
| Reports | PASS | Five exports, filters, BOM, Arabic, scope, redaction live | None |
| Security | PASS | Origin, Sec-Fetch-Site, login limits, operation limits live | Use HTTPS and production secrets |
| Permissions | PASS | Self, manager recursive scope, out-of-scope denial, admin live | None |
| Audit | PASS | Domain audit rows and retention twice live | None |
| Mobile | NOT TESTED | Login surface previously checked at 375×812; authenticated visual QA not executed | Run authenticated device smoke test before broad rollout |
| Arabic/RTL | NOT TESTED | Arabic login semantics verified; authenticated visual matrix not executed | Run authenticated RTL smoke test before broad rollout |
| TypeScript | PASS | `npx tsc --noEmit`, exit 0 | None |
| Build | PASS | Five build phases and all focused API routes emitted | None |
| Tests | PASS | 58 tests, 58 passed, 0 failed, 0 skipped | None |
| Lint | CAN DEFER AFTER LAUNCH | 130 errors and 3 warnings in two legacy shared UI files | Fix incrementally; do not use blanket disables |

---

## Non-Blocking Follow-up

- Authenticated mobile and Arabic/RTL visual smoke testing remains manual/not tested.
- Cross-module navigation was not exhaustively clicked in a browser during this run.
- Attendance, leave/request, and activity APIs expose page-based pagination. Document version metadata is bounded to 200 rows and does not expose page-based Load More; add pagination later without changing version retention semantics.
- Historical lint debt remains in `app/hr-app.tsx` and `app/employee-drawer.tsx`, including accessibility rules. It was not broadly refactored during a launch audit.
- The local PostgreSQL cluster uses loopback-only trust authentication. Production must use a secret-bearing TLS connection string.

These items do not permit an unrestricted general release without a deployment smoke test, but they do not leave a known data-integrity, authorization, migration, build, or storage blocker for a controlled launch.

---

## Automated Verification

```text
npx tsc --noEmit: PASS
npm run build: PASS
npm test: 58/58 PASS
npm run lint: 130 errors, 3 warnings
git diff --check: PASS (line-ending warnings only)
npm run db:migrate: PASS
Migration rerun: PASS
```

---

## Files Changed During Runtime Audit

- `app/api/hr/route.ts`
- `app/leave/leave-rollover.ts`
- `app/attendance/attendance-service.ts`
- `app/api/dashboard/route.ts`
- `tests/production-readiness.test.mjs`
- `HR_RUNTIME_RECOVERY_FINAL_LAUNCH_AUDIT_2026-08-21.md`

Existing user and earlier HR Core changes were preserved.

---

## Payroll Confirmation

```text
Payroll was not modified.
Payroll calculations were not modified.
Payroll schema was not modified.
Payroll APIs were not modified.
Payroll UI was not modified.
```

No Payroll migration or runtime operation was executed.

---

## Final Verdict

```text
READY FOR CONTROLLED PRODUCTION LAUNCH
```

The controlled launch should include an immediate hosted smoke test for PostgreSQL TLS connectivity, the production `FILES` binding, and authenticated mobile/RTL rendering before expanding access.
