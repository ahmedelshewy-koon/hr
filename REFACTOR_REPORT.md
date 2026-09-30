# Sanad HR — Refactor & Cleanup Report

**Date:** 2026-09-19
**Scope:** Repository-wide audit and safe, incremental refactor. No feature work, no framework changes, no database migrations.

---

## Executive summary

Sanad HR is a ~20,700-line Next-style application (vinext + React 19 RSC) running on Cloudflare Workers against PostgreSQL through a hand-rolled D1-compatible shim. The architecture is sound; the problems were concentrated in **repetition** and in **per-request work that nobody had measured**.

The three findings that mattered:

1. **Every authenticated API request executed 8 DDL/backfill statements** before doing any real work (`ensureAuthSchema`), including `ALTER TABLE` on the two hottest auth tables and an `UPDATE` that rewrote role rows on every call.
2. **Permission checks were one database round trip each.** The `/api/hr` bootstrap endpoint asked ~22 of them per request, and the employee-profile endpoint up to 14. The dashboard polls `/api/hr` every 15 seconds.
3. **The department-scoping authorization rule was copy-pasted into 8 modules.** Two of those copies had already diverged. Any future divergence silently widens or narrows an access boundary.

Alongside those, the same `createDatabase / try / catch / finally close` shell was hand-written in 20 route handlers, four near-identical error responders existed (one of which leaked raw PostgreSQL error text to clients), and 14 component files each declared their own `Row` type — which accounted for 149 of the 184 pre-existing lint errors.

**Result:** lint errors went from **184 → 22**, all four checks pass, and the API surface, UI behavior, and database schema are unchanged.

---

## Validation

All commands run from the repository root on Windows.

| Check | Baseline (before) | After |
|---|---|---|
| `npx tsc --noEmit` | **pass** (exit 0) | **pass** (exit 0) |
| `npm run lint` | **fail** — 184 errors, 7 warnings | **fail** — 22 errors, 7 warnings |
| `node --test tests/*.test.mjs` | **pass** — 121 tests: 118 pass, 3 skipped, 0 fail | **pass** — 121 tests: 118 pass, 3 skipped, 0 fail |
| `npm run build` | **pass** (exit 0) | **pass** (exit 0) |
| `npm test` (build + tests) | pass | **pass** (exit 0) |

Notes:

- **Lint was already failing before any change was made.** The remaining 22 errors are pre-existing accessibility and React-effect issues that cannot be fixed without changing rendered DOM or effect timing — see *Remaining technical debt*. No new lint error was introduced.
- The build output still registers **all 19 API routes**, verified identical to baseline. This specifically confirms the `withDatabase` rewrite did not break vinext's static route detection.
- **Not run:** the `tests/runtime-*.mjs` files and `evaluation-access-doctor.mjs`. These are not matched by the test glob (`tests/*.test.mjs`) and require a live `DATABASE_URL` against a real PostgreSQL instance, which is not available in this environment. They are unmodified apart from one unused-variable fix.

---

## Main problems found

| # | Problem | Severity | Status |
|---|---|---|---|
| 1 | `ensureAuthSchema` ran 8 DDL/backfill statements on **every** authenticated request | High (perf) | Fixed |
| 2 | Permission checks cost one query each: ~22 per `/api/hr` GET, up to 14 per employee profile | High (perf) | Fixed |
| 3 | Recursive department-scope CTE duplicated across 8 modules, already divergent | High (security-adjacent) | Deduplicated |
| 4 | `hr/route.ts` returned raw error messages (incl. PostgreSQL text) in 500 responses | Medium (security) | Fixed |
| 5 | `createDatabase / try / catch / finally close` hand-written in 20 handlers | Medium (maintainability) | Fixed |
| 6 | Four near-identical error responders (`apiFailure`, `apiError`, `failure`, one inline) | Medium | Consolidated to one |
| 7 | Four parallel permission-check implementations | Medium | Reduced to one shared helper |
| 8 | 14 component files each declared `type Row = Record<string, any>` | Medium (typing) | Consolidated to one |
| 9 | Five unreachable top-level symbols in `hr-app.tsx`; one dead file (`db/index.ts`) | Low | Removed |
| 10 | `canAccessEmployee` implemented twice with **different** semantics | Medium | **Documented, not changed** — see *Risks* |
| 11 | `/api/hr` GET is a ~27-query bootstrap polled every 15s | Medium (perf) | **Documented, not changed** |

---

## Files and modules refactored

### New shared modules (3 files, 66 lines)

| File | Purpose |
|---|---|
| `app/organization/department-scope.ts` | Single definition of the recursive department-hierarchy CTE (`MANAGED_DEPARTMENTS_CTE`) plus `isCompanyWideRole`. Replaces 10 inlined copies across 8 files. |
| `app/api/route-helpers.ts` | `withDatabase(failureMessage, handler)` — owns connection open/close and error translation for route handlers. |
| `app/ui-types.ts` | One documented `Row` type for API rows rendered by the UI, replacing 14 per-file declarations. |

### Modified

**API layer**
- `app/api/api-security.ts` — reformatted from single-line dense style to readable; added `loadPermissions()` (batch permission grid); hardened `apiFailure`; now uses the shared CTE.
- `app/api/hr/route.ts` — N+1 permission fix; removed the duplicate `apiError`; uses the shared CTE.
- `app/api/employees/[id]/route.ts` — removed its private `permission()` and `failure()` helpers; 14 permission queries collapsed to 1.
- `app/api/approvals/route.ts` — inline error handler replaced with `apiFailure`.
- `app/api/auth/route.ts` — role display labels now set inline at bootstrap (see *Behavior changed*).
- Converted to `withDatabase` (20 handlers): `assets`, `dashboard`, `documents`, `documents/[id]`, `learning`, `lifecycle`, `notifications`, `operations/audit-retention`, `operations/leave-rollover`, `operations/production-readiness`, `performance`, `recruitment/documents/[id]`, `reports`, `talent/options`.

**Domain / auth**
- `app/portal-auth.ts` — `ensureAuthSchema` memoized per isolate.
- `app/approvals/approval-aggregation.ts`, `app/recruitment/recruitment-access.ts` — use the shared CTE.
- `app/recruitment/recruitment-api.ts`, `app/recruitment/recruitment-service.ts` — regex lint fixes.

**UI**
- `app/hr-app.tsx` — five dead symbols removed (1219 → 1183 lines); `Row` import; lazy `useState` initializers.
- 14 component files — local `Row` alias replaced with the shared import.

**Deleted**
- `db/index.ts` — `getDb()` had zero references repository-wide.

**Tests** — six assertion updates, all following the refactor rather than weakening coverage (see *Tests*).

---

## Important changes made

### 1. Auth schema bootstrap runs once per isolate, not once per request

`ensureAuthSchema` issues 7 `ALTER TABLE … ADD COLUMN IF NOT EXISTS` statements plus a role-label `UPDATE`. It is reached by **every** authenticated request through `requireActor`, and directly from five more places.

Because each request builds its own `postgres(url, { max: 1 })` client, there was no pooling to amortize this: 8 serialized round trips before the session lookup. `ALTER TABLE … IF NOT EXISTS` still takes an `ACCESS EXCLUSIVE` lock even when the column exists, and PostgreSQL does not elide no-op updates, so the `UPDATE` rewrote up to four `roles` rows per request forever.

The statements describe database-wide state, not per-connection state, so they now run at most once per isolate:

```ts
let authSchemaReady: Promise<void> | null = null;

export function ensureAuthSchema(d1: PostgresDatabase) {
  if (!authSchemaReady) {
    authSchemaReady = applyAuthSchema(d1).catch(error => {
      authSchemaReady = null;   // a failed attempt is not cached
      throw error;
    });
  }
  return authSchemaReady;
}
```

The signature is unchanged, so all six call sites were untouched. A failed attempt resets the cache so a transient error is retried rather than disabling the bootstrap for the isolate's lifetime.

### 2. Permission checks batched

`hasPermission` costs one round trip per question. Added `loadPermissions()`, which fetches the role's whole grid once:

```ts
const rows = await db.prepare("SELECT module,action FROM permissions WHERE role_id=? AND allowed=1")…
const granted = new Set(rows.map(r => `${r.module}:${r.action}`));
return { allows: (module, action) => granted.has(`${module}:${action}`) };
```

Equivalent by construction: `allowed` is a 0/1 column, so the `allowed=1` rows are exactly the pairs `hasPermission` approves, and the Super Admin short-circuit is preserved.

- `/api/hr` GET: **22 queries → 1** (5 capability flags + 17 page-module checks).
- `/api/employees/[id]`: **up to 14 queries → 1**.

`hasPermission` / `requirePermission` remain for routes that ask a single question.

### 3. One definition of the department-scope rule

`MANAGED_DEPARTMENTS_CTE` replaces 10 inlined copies. The nine single-line copies were byte-identical, so the generated SQL is unchanged; the one multi-line copy in `recruitment-access.ts` differed only in whitespace. The literal now appears in exactly one file.

### 4. Route handler shell centralized

```ts
export async function GET(request: Request) {
  return withDatabase("Unable to load notifications", async db => { … });
}
```

`export async function` declarations were deliberately kept (rather than `export const GET = withDatabase(…)`) so vinext's static route analysis is unaffected — confirmed by the build output listing all 19 routes.

Four handlers intentionally keep their own `try/catch`: `documents` POST and `documents/[id]` PUT need to delete orphaned R2 objects on failure, and the three `auth` handlers return distinct Arabic messages with `no-store` headers.

---

## Performance improvements

| Change | Effect |
|---|---|
| `ensureAuthSchema` memoized | Removes **8 serialized statements per authenticated request**, including two `ACCESS EXCLUSIVE` table locks and a row-rewriting `UPDATE` |
| `/api/hr` GET permission batching | **22 queries → 1** |
| `/api/employees/[id]` permission batching | **up to 14 queries → 1** |
| `grantedPages` computation | Was `Promise.all` over 17 per-module DB lookups; now an in-memory `Set` filter |
| `useState` lazy initializers | `ReportsPage` and the recruitment offer form no longer recompute default dates on every render |

Worked example — one `/api/hr` GET by an HR Manager previously issued roughly **30 auth/permission round trips** before the 27 data queries. It now issues **2**.

These are round-trip counts derived from reading the code, not wall-clock measurements; no load testing was possible without a live database.

---

## Security and reliability improvements

**Raw error text no longer reaches clients.** `hr/route.ts` had its own `apiError` whose 500 branch returned `error.message` — on this stack usually a PostgreSQL error exposing table and column names. It now returns a generic message while still `console.error`-ing the full error server-side. Intentional validation messages (thrown as `Response`) are unaffected.

**Error handling unified.** `apiFailure` absorbed the one genuinely better behavior from the duplicate handlers — falling back to `statusText` when a thrown `Response` has an empty body — so no route lost message fidelity. It also forwards `error.headers`, which preserves `retry-after` on 429 responses where the previous inline handlers dropped it.

**Authorization scope has one source of truth.** The department CTE and the permission lookup were each implemented several times; divergence between copies is how access-control bugs appear. Both are now single definitions.

**Connection cleanup is structural.** 20 handlers can no longer forget `await db.close()` — the helper owns it.

### Checked and found sound (no change needed)

- **SQL injection:** every interpolation into `db.prepare()` is either a whitelisted constant (e.g. `approvalStatus` in `dashboard/route.ts`) or generated placeholders (`ids.map(() => "?")`). User-controlled values go through `.bind()`. No injectable path found.
- **Secrets:** no credentials in source. `KOON_LOGIN_EMAIL`, `KOON_LOGIN_PASSWORD_HASH`, `KOON_AUTH_SECRET` and `DATABASE_URL` are read from the Worker env / `process.env` and throw when unset. No `.env` file was read or modified.
- **Session handling:** HMAC-signed cookie, `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS, constant-time comparison, PBKDF2-SHA256 at 210,000 iterations, server-side `session_version` invalidation. Sound.
- **`DEFAULT_USER_PASSWORD = "123456"`** in `hr/route.ts` is a deliberate product decision (accounts are created with `must_change_password`), and an existing test asserts it. Left alone — flagged below as a policy question, not a code defect.
- **Dependencies:** all eight runtime dependencies are genuinely used. `mammoth` and `unpdf` are reached only through dynamic `import()` in the CV parser, and `drizzle-orm` only through `db/schema.ts` for drizzle-kit migration generation — none is safe to remove. **No dependency was added, removed, or upgraded.**

---

## Removed dead and duplicate code

**Dead code**
- `db/index.ts` (whole file) — `getDb()` had zero references. Deleting it does not free `drizzle-orm` (still needed by `db/schema.ts` for migrations) or `postgres` (used by `db/postgres.ts`).
- `app/hr-app.tsx` — five unreachable top-level symbols: `OperationalDashboard`, `Approvals`, `AttendancePage`, `EmployeeTable`, `permissionModuleLabel`, plus the now-orphaned `DashboardData` type. Each had exactly one repository-wide reference: its own definition. They had been superseded by `ApprovalsCenter`, `AttendanceWorkspace` and the current `Dashboard`.
- Symbols that became dead as a result: the `AlertTriangle` import and `attendanceNeedsAction`.
- Unused `CalendarDays` import (`employee-drawer.tsx`), unused `notify` prop on `Dashboard` (removed at both declaration and call site), unused `admin` binding in `tests/runtime-recruitment-ats.mjs` (the INSERT still runs).

**Duplication removed**
- 10 inlined copies of the recursive department CTE → 1.
- 20 hand-written database-lifecycle blocks → 1 helper.
- 4 error responders → 1.
- 4 permission-check implementations → 1 shared pair (`hasPermission` / `loadPermissions`).
- 14 `Row` type declarations → 1. Four of those used `ReturnType<typeof JSON.parse>` — a trick that produces `any` while evading the linter.

**Deliberately left alone:** the `Empty` and `Status` components appear in several files but render **different markup and CSS classes**. Merging them would change the DOM. Not duplication in any actionable sense.

---

## Behavior intentionally changed

Three changes, all narrow:

1. **Unexpected 500 responses from `/api/hr` now return a generic message** instead of the raw exception text. This is the security fix above. Validation errors and all intentional user-facing messages are byte-identical. Client code that displayed raw server exception text for debugging will now see `"Unexpected server error"`; the detail is in the server log.

2. **`bootstrapAdmin` sets the Super Admin role's `name_en` / `name_ar` inline.** Previously those labels were backfilled by the *next* request's `ensureAuthSchema` pass. Memoizing that pass would have skipped the backfill within the same isolate, so the two literal values (copied verbatim from `portal-auth.ts`) are now written at insert time. The resulting row is identical.

3. **`/api/dashboard` no longer has a browser consumer.** Removing the unreachable `OperationalDashboard` component removed the only `fetch("/api/dashboard")` call in the UI. **The endpoint itself is untouched** and remains covered by `tests/runtime-complete-hrms.mjs`. This is a pre-existing gap the cleanup exposed, not a new one — the component was already unreachable. **This needs a product decision** (wire up the focused dashboard, or retire the endpoint); it should not be resolved by a refactor.

Everything else preserves behavior exactly: the same SQL strings, the same status codes, the same response shapes, the same rendered DOM.

---

## Tests

Six assertions were updated. All of them assert on **source text**, so they broke on the refactor while the guarantee they protect still held:

| Test | Change |
|---|---|
| `rendered-html.test.mjs` | `hr/route.ts` matched `/WITH RECURSIVE managed/`. Now asserts the route references `MANAGED_DEPARTMENTS_CTE` **and** that `department-scope.ts` still defines a recursive CTE — strictly stronger. |
| `dashboard-role-scope`, `employee-profile-360`, `unified-approvals`, `hr-core-completion` | Same substitution for four more modules. |
| `hr-core-completion` | `/origin!==expected/` → `/origin\s*!==\s*expected/`, tolerating the reformatting. |
| `hr-core-completion` | Dropped the `fetch("/api/dashboard")` UI assertion, which was asserting on the string contents of dead code. Replaced with a comment pointing here. |

This last one is the only place coverage was genuinely reduced, and it is called out deliberately rather than quietly adjusted.

**Note on the test suite as a whole:** it leans heavily on regex matching against source files rather than on behavior. That makes it brittle under any refactor — five of six breakages above were false alarms. Flagged below.

---

## Remaining technical debt

Ordered by value.

1. **`/api/hr` is a ~27-query bootstrap polled every 15 seconds.** `Dashboard` calls `reload()` on a 15s interval *and* on every window focus and visibility change; the endpoint returns employees, departments, jobs, requests, attendance (LIMIT 2000), payroll, audit and settings in one payload. Splitting it per workspace, or moving the dashboard to the existing focused `/api/dashboard`, is the single biggest remaining win. Not attempted here: it changes the client data flow substantially.

2. **`canAccessEmployee` exists twice with different semantics.** `api-security.ts` returns true for *any* self-match and excludes `employment_status='deleted'`; `hr/route.ts` restricts the self-match to the Employee role and does **not** exclude deleted employees. Unifying them **would change who can see what**, so it needs a deliberate decision about which rule is correct — it is not a refactor.

3. **Two `audit()` implementations.** `hr/route.ts` records `previous_value` and `ip_address`; `talent-service.ts` records neither. Unifying changes what lands in the audit log.

4. **`postgresSql()` rewrites every `?` to `$n` with a blind regex.** It would corrupt any SQL containing a literal `?` inside a string, or a PostgreSQL JSON operator (`?`, `?|`, `?&`). I verified **no current query contains one**, so this is latent, not live. A cheap guard: assert in `postgresSql` that the placeholder count matches the bound-values count.

5. **22 remaining lint errors**, all requiring DOM or effect-timing changes:
   - *9 × `label-has-associated-control`* — labels needing `htmlFor`/nesting.
   - *7 × `no-static-element-interactions`* — modal backdrop `<div onMouseDown>` scrims. Note `approvals-center.tsx` already uses the correct pattern (`<button className="modal-scrim" aria-label=…>`); adopting it elsewhere means CSS changes, and forcing `role`/`tabIndex` onto a scrim would make screen-reader behavior *worse*.
   - *6 × `set-state-in-effect`* — effects that need restructuring; real cascading-render cost but real behavior risk.
   - *7 warnings* — `<img>` vs `next/image`, and two `exhaustive-deps`.

6. **Per-request connection churn.** `createDatabase()` builds and tears down a `postgres` client per request with `max: 1`. Standard for Workers, but worth revisiting if a pooler (PgBouncer / Hyperdrive) is available.

7. **Server-side `type Row = Record<string, unknown>` is still declared in ~10 API files.** Harmless (not a lint error, and `unknown` is the safe choice) but still duplication.

8. **Brittle source-text tests** — see above. Migrating the highest-value ones to behavioral assertions would make future refactors far cheaper.

9. **`DEFAULT_USER_PASSWORD = "123456"`** — mitigated by `must_change_password`, but worth a policy review (a random per-user initial password delivered out of band). A test currently asserts the literal, so changing it is a product decision.

10. **Large modules remain large:** `recruitment-api.ts` (2,945 lines), `recruitment-workspace.tsx` (3,051), `hr-app.tsx` (1,183), and `hr/route.ts` whose POST is a 46-branch `if (action === …)` chain. Converting that chain to a handler map is mechanical and safe, but it is a very large diff; I judged it out of scope for a behavior-preserving pass and better done per-module with review.

---

## Risks and areas needing manual verification

| Area | Why | How to verify |
|---|---|---|
| **`ensureAuthSchema` memoization** | Highest-value change and the one with real semantics. Correct because the statements are idempotent and database-wide, and every per-request client points at the same `DATABASE_URL`. | Deploy to staging, confirm login works against a database **missing** the auth columns, and confirm the columns are created exactly once. |
| **Bootstrap admin path** | `bootstrapAdmin` / `recoverConfiguredAdmin` run only on first-ever login or admin recovery. No automated test covers them. | Exercise first-login on a fresh database and the configured-admin recovery path. |
| **`withDatabase` rollout (20 handlers)** | Mechanical but broad. Typecheck, tests and build all pass and all 19 routes register. | Smoke-test each endpoint against a live database, especially `documents` download/replace (R2 streaming) and `reports` (CSV). |
| **`/api/dashboard` orphaning** | Needs a product decision, not a code fix. | Decide: wire up the focused dashboard, or retire the endpoint. |
| **Permission batching** | Equivalent by construction, but it is authorization code. | Log in as HR Manager, Department Manager and Employee; confirm the visible page set and profile tabs are unchanged. |
| **Runtime test suites** | `tests/runtime-*.mjs` could not be executed (no live database). | Run them against staging: `node tests/runtime-complete-hrms.mjs`, `runtime-rbac-hrms.mjs`, `runtime-recruitment-ats.mjs`, `runtime-biometric-api.mjs`. |

---

## Commands

```bash
# Install
npm install                  # requires Node >= 22.13.0

# Develop
npm run dev                  # vinext dev server

# Validate (all four should be run before merging)
npx tsc --noEmit             # typecheck        -> passes
npm run lint                 # eslint           -> 22 errors, 7 warnings (all pre-existing)
node --test tests/*.test.mjs # unit tests       -> 118 pass, 3 skipped, 0 fail
npm run build                # production build -> passes

npm test                     # build + unit tests in one step

# Production
npm start                    # vinext start

# Database (requires DATABASE_URL)
npm run db:generate          # generate a migration from db/schema.ts
npm run db:migrate           # apply migrations

# Biometric attendance agent (requires DATABASE_URL and device access)
npm run attendance:sync      # one-shot ZKTeco sync
npm run attendance:agent     # watch mode

# Runtime suites — NOT run here; need a live DATABASE_URL
node tests/runtime-complete-hrms.mjs
node tests/runtime-rbac-hrms.mjs
node tests/runtime-recruitment-ats.mjs
node tests/runtime-biometric-api.mjs
```

`npm run lint` exits non-zero both before and after this work. Treat **22 errors / 7 warnings** as the current known-good baseline; any increase is a regression.
