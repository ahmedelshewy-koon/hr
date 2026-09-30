# Sanad HR — Final Production Readiness Audit

**Audit date:** 21 August 2026  
**Scope:** Production readiness verification and blocker-only fixes  
**Executive verdict:** **NOT READY FOR PRODUCTION**

No new HR feature was added. Payroll remained frozen.

---

## A. Executive Verdict

```text
NOT READY FOR PRODUCTION
```

The application compiles, builds, and passes all 54 automated tests. The Cloudflare development runtime serves the application shell successfully, and one verified Arabic/RTL defect on the login surface was fixed with a regression test.

Production readiness cannot be claimed because the configured PostgreSQL endpoint is unavailable, the migration chain has not been applied to an identified database, live authentication and domain workflows cannot run, and the real R2 binding has not been verified end to end. These conditions meet the audit's explicit launch-blocking rules.

---

## B. Blockers

1. **PostgreSQL runtime unavailable**
   - Configured endpoint: `127.0.0.1:5545`
   - Configured database: `koon_hr`
   - Configured user: `koon_hr_admin`
   - TCP result: connection refused.
   - The configured URL contains no password.
   - A local PostgreSQL 18 service was discovered on port `5544`, but it requires credentials and was not used because its ownership and intended database identity could not be authenticated safely.

2. **Migrations not applied or verified**
   - No database backup could be taken.
   - `npm run db:migrate` was not run against an unidentified or inaccessible database.
   - Required tables, columns, indexes, unique constraints, foreign keys, notices, and orphan counts remain unverified at runtime.

3. **Authentication and HR E2E blocked**
   - The application shell returned HTTP 200 in the Cloudflare development runtime.
   - `/api/auth`, `/api/hr`, `/api/dashboard`, `/api/notifications`, and `/api/reports` returned HTTP 500 because PostgreSQL could not be reached.
   - Login, lockout, session invalidation, password change, employee creation, leave, attendance, approvals, reports, and audit operations therefore have no valid live evidence.

4. **R2 live verification not performed**
   - Hosting configuration declares the `FILES` R2 binding.
   - Upload, download, authorization, replacement, archive, object cleanup, and no-public-exposure behavior were not executed against the real binding with database metadata.

5. **Security enforcement lacks live proof**
   - Source tests cover Origin checks, rate limiting, scoping, and stale-transition guards.
   - Runtime-critical authorization, cross-user isolation, CSRF rejection, and rate limiting were not exercised with real sessions and PostgreSQL.

---

## C. Must Fix Before Launch

1. Supply a verified, non-production `DATABASE_URL` for the intended Sanad HR database without exposing its password.
2. Confirm `current_database()`, `current_user`, PostgreSQL version, and timezone.
3. Record migration state and take a recoverable backup when meaningful data exists.
4. Run the official full migration command through `0013_hr_core_completion`.
5. Verify every required table, document column, index, unique constraint, and foreign key.
6. Report and remediate any orphan rows that cause an intended foreign key to be skipped.
7. Run the application with real test users and complete the required authentication, employee, leave, attendance, correction, approval, Profile 360, dashboard, notification, report, and audit E2E matrix.
8. Verify the actual `FILES` binding, server-side file validation, private access control, versioning, archive behavior, and response redaction.
9. Compare dashboard values and exports directly with database queries.
10. Re-run all launch gates after live verification.

---

## D. Can Defer After Launch

- Historical repository lint cleanup, provided launch-critical accessibility defects are separately fixed.
- Independent XLSX generation instead of UTF-8 CSV.
- Full MFA.
- A deep-link URL for every modal.
- Cosmetic UI polish.
- Advanced SLA, email, WhatsApp, analytics, and bulk approvals.

Lint was not hidden or disabled. It currently reports 130 errors and 3 warnings, concentrated in `app/hr-app.tsx` and `app/employee-drawer.tsx`. A broad cleanup was not attempted during this audit because it would require high-risk edits to large shared UI files.

---

## E. Verification Matrix

| Area | Result | Evidence | Action |
| --- | --- | --- | --- |
| Database migrations | BLOCKER | Configured port 5545 refused connections; no migration was applied | Verify DB, back up, migrate through 0013, inspect schema/FKs |
| Authentication | BLOCKER | `/api/auth` returned 500 because DB was unreachable | Execute login, failure, lockout, session, logout, password tests live |
| Employees | NOT TESTED | Source tests pass; no real DB employee creation/edit | Run creation, concurrent codes, edit, account/profile verification |
| Leave | NOT TESTED | Unit/source tests cover calculations, locks, and transitions | Execute balance reservation, approvals, rejection, and concurrency live |
| Attendance | NOT TESTED | Engine tests pass; no real attendance rows were created | Execute check-in/out and verify timezone and calculated values |
| Attendance Corrections | NOT TESTED | Tests cover guarded transactions and immutable raw events | Run correction and justification-only workflows live |
| Unified Approvals | NOT TESTED | Tests cover scope, self-approval, and stale guards in source | Verify manager/HR roles and two-session stale decision live |
| Employee Profile 360 | NOT TESTED | Automated scope/redaction tests pass | Verify HR, recursive manager, and employee payloads with real users |
| Documents/R2 | BLOCKER | `FILES` declared; no live R2/database workflow | Perform all valid/invalid upload, ACL, replace, archive, expiry tests |
| Dashboard | NOT TESTED | API could not query DB | Compare every metric with authoritative SQL |
| Notifications | NOT TESTED | API could not query DB; source tests pass | Verify recipients, unread/read, dedupe, navigation, cross-user denial |
| Reports | NOT TESTED | API could not query DB; source tests pass | Generate five exports and verify filters, BOM, limits, and redaction |
| Security | BLOCKER | Source tests only; runtime write checks unavailable | Exercise Origin, Sec-Fetch-Site, and rate limits with real sessions |
| Permissions/Scope | NOT TESTED | Static tests pass; no real role accounts | Verify manager recursion, self scope, and direct-ID denial live |
| Audit | NOT TESTED | No controlled DB data or retention run | Run retention twice and inspect protected events and cleanup audit |
| Mobile | NOT TESTED | Login tested at 375×812 with no horizontal overflow; authenticated areas unavailable | Complete required authenticated mobile matrix |
| RTL/Arabic | NOT TESTED | Login surface verified as Arabic/RTL after fix; authenticated areas unavailable | Complete Arabic checks across all modules |
| TypeScript | PASS | `npx tsc --noEmit` exited 0 | None |
| Build | PASS | `npm run build` completed all five build phases and emitted API routes | None |
| Tests | PASS | 54 tests, 54 passed, 0 failed, 0 skipped | Add live integration/E2E evidence before launch |
| Lint | CAN DEFER AFTER LAUNCH | 133 findings: 130 errors and 3 warnings | Clean incrementally without blanket disables or unsafe refactor |

---

## F. Database Evidence

### Configured identity

| Field | Evidence |
| --- | --- |
| Host | `127.0.0.1` |
| Port | `5545` |
| Database | `koon_hr` |
| User | `koon_hr_admin` |
| TCP availability | Failed — connection refused |
| Password in configured URL | Absent |
| `current_database()` | NOT TESTED |
| `current_user` | NOT TESTED |
| PostgreSQL version | NOT TESTED against intended DB |
| Timezone | NOT TESTED |

The machine has a running PostgreSQL 18 Windows service listening on `5544`. The documented sample for that endpoint uses another user and a placeholder password. No password was guessed, no database was changed, and no migration was applied to that service.

### Migration evidence

- Journal latest entry: index `13`, tag `0013_hr_core_completion`.
- This is repository metadata only, not proof that the target database is migrated.
- Migration `0013` declares:
  - `document_categories`
  - `document_versions`
  - `notifications`
  - `leave_rollovers`
  - `security_rate_limits`
  - new document metadata/version/archive columns
  - required indexes and unique constraints
  - guarded `add_fk_if_clean` foreign-key creation with a PostgreSQL notice when orphans exist.

### FK/orphan result

```text
Actual FK status: NOT TESTED
Skipped constraints: NOT TESTED
Orphan counts: NOT TESTED
Sample orphan IDs: NOT TESTED
```

No orphan rows were deleted or modified.

---

## G. Live E2E Results

| Workflow | Result | Runtime evidence |
| --- | --- | --- |
| Application shell | PASS | Cloudflare dev runtime served `/` with HTTP 200 |
| Focused APIs startup | BLOCKER | Data APIs returned HTTP 500 due unavailable PostgreSQL |
| Valid/wrong login and lockout | NOT TESTED | No accessible real users/database |
| Session expiry/logout/version | NOT TESTED | No valid session could be created |
| Forced password change/expiry | NOT TESTED | Database unavailable |
| Employee create/edit/concurrency | NOT TESTED | Database unavailable |
| Leave submit/approve/reject/concurrency | NOT TESTED | Database unavailable |
| Leave rollover twice | NOT TESTED | Database unavailable |
| Attendance check-in/out | NOT TESTED | Database unavailable |
| Attendance correction | NOT TESTED | Database unavailable |
| Justification-only immutability | NOT TESTED | Database unavailable |
| Attendance exception scan | NOT TESTED | Database unavailable |
| Unified approvals roles/stale action | NOT TESTED | Database unavailable |
| Profile 360 scope/redaction | NOT TESTED | Database unavailable |
| Documents/R2 valid and invalid files | NOT TESTED | Database/R2 live workflow unavailable |
| Document ACL/replacement/archive/expiry | NOT TESTED | Database/R2 live workflow unavailable |
| Dashboard SQL comparison/navigation | NOT TESTED | Database unavailable |
| Notifications lifecycle/isolation | NOT TESTED | Database unavailable |
| Five report exports/security | NOT TESTED | Database unavailable |
| Origin/CSRF/rate limiting | NOT TESTED | No authenticated runtime writes |
| Audit retention twice | NOT TESTED | Database unavailable |
| Pagination/load-more | NOT TESTED | No real history data |
| Login mobile/RTL | PASS | 375×812, no horizontal overflow, Arabic language and RTL computed direction |
| Authenticated mobile/RTL/accessibility | NOT TESTED | Authentication blocked |

The Node-oriented `npm run start` command served the shell but API imports failed on the Cloudflare-specific `cloudflare:` module scheme. The official Cloudflare-backed `npm run dev` runtime loaded bindings correctly; its API failures were then attributable to PostgreSQL connectivity. No cross-runtime environment rewrite was made without deployment evidence.

---

## H. Automated Verification

| Command | Result | Exact evidence |
| --- | --- | --- |
| `npx tsc --noEmit` | PASS | Exit code 0 |
| `npm run build` | PASS | Five phases completed; 11 focused API routes emitted |
| `npm test` | PASS | 54 tests; 54 passed; 0 failed; 0 skipped |
| `npm run lint` | CAN DEFER AFTER LAUNCH | 130 errors and 3 warnings |
| `git diff --check` | PASS | Exit code 0; line-ending warnings only |

Automated tests are unit, smoke, and source-contract tests. They are not a substitute for the blocked PostgreSQL/R2 E2E evidence.

---

## I. Files Changed During Audit

Only the following audit/fix-related changes were made:

1. `app/hr-app.tsx`
   - Added `lang="ar"` to the already RTL Arabic login surface.
2. `tests/production-readiness.test.mjs`
   - Added a regression assertion for Arabic language and RTL semantics.
3. `SANAD_HR_PRODUCTION_READINESS_AUDIT_2026-08-21.md`
   - Added this audit report.

All other existing modified/untracked files predated this audit turn and were preserved.

---

## J. Payroll Confirmation

```text
Payroll was not modified.
Payroll calculations were not modified.
Payroll schema was not modified.
Payroll APIs were not modified.
Payroll UI was not modified.
```

No audit fix changed Payroll behavior. The sole application edit was the language metadata attribute on the Arabic login surface.

---

## Launch Gate

Keep HR Core frozen. Do not launch until a verified database and R2 test environment are available, migrations and foreign keys are proven, and the runtime-critical E2E matrix is completed successfully.
