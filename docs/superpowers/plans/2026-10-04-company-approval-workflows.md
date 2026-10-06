# Company approval workflows implementation plan

> **For agentic workers:** Use superpowers:executing-plans; check each task against the approved specification.

**Goal:** Configurable sequential approvers for each company and request type, used by real requests.
**Architecture:** Versioned settings and immutable per-request snapshots. A shared workflow service resolves and advances named approvers; existing leave and attendance services retain ownership of their transactional side effects. Existing pending/final statuses remain compatible; custom stages use workflow:<index>.
**Tech Stack:** React, TypeScript, PostgreSQL, existing database adapter and Node tests.
**Spec:** ../specs/2026-10-04-company-approval-workflows-design.md

## Global constraints
- Preserve existing dirty working files and legacy request behavior.
- Arabic/English responsive UI; company/type isolation; no self approval.
- Settings edits affect new submissions only; final effects happen once.

## Review focus
- Concurrent duplicate decisions cannot advance two stages.
- Approver access must not expose other employee data.
- Leave submitted on behalf must follow its configured path.
- Inactive approvers and missing manager assignments fail closed.
- Historical snapshots remain readable after settings change.

## Tasks
- [x] 1. Add workflow validation tests (invalid types, empty stages, duplicate approvers), observe RED, implement pure policy and versioned persistence. Add additive SQL migration and schema definitions. Verify policy tests.
- [x] 2. Implement resolveWorkflow(db, employeeId, requestType), attachWorkflow(db, sourceType, sourceId, snapshot), decideWorkflow(db, sourceType, sourceId, actorId, expectedStage, decision, reason). Snapshot names and IDs, use transaction locks and stage token. Test ordered transitions and rejection, self approval, stale decisions, immutable snapshots.
- [x] 3. Integrate submission and decisions in app/api/hr/route.ts, app/leave/leave-service.ts, app/attendance/attendance-service.ts; preserve balances and final attendance updates. Cancel snapshots with cancelled leave. Test complete request lifecycles and concurrent decisions in PostgreSQL.
- [x] 4. Add management API and React page under Settings with company/type selectors and ordered searchable approvers, up/down/add/remove and version-aware save. Wire existing settings navigation. Validate authorization and validation errors.
- [x] 5. Integrate assigned approvals in aggregation, authentication/page access, approval chain, employee request lists and document authorization; route workflow decisions through a dedicated authorized endpoint. Update notifications and counts using assignments. Verify scoped access and UI metadata.
- [x] 6. Apply additive migration to local development database, run targeted tests, TypeScript, lint and build; obtain independent review and resolve important findings. Record verification below.

## Execution ledger
- User authorized implementation with «نفذ». Proceed inline without another approval round.
- Ruling: work in the existing checkout on a feature branch, preserving unrelated dirty changes. The running application and new HR settings depend on uncommitted files; a clean worktree would omit these. No broad commits/staging of existing work.
- Shared interface: custom pending sources retain pending_hr for existing reporting and balance queries; current_stage=workflow:N identifies the actual authority. UI resolves stage labels from the snapshot, never calls these HR approvals.


## Verification and review
- Pure and regression suite: 45/45 passed (workflow policy, approval chain, unified approvals, leave engine, attendance corrections, dashboard role scope).
- Real PostgreSQL service tests: 28 assertions passed, including company/type selection, immutable snapshots, inactive/self approvers, final leave consumption, rejection/cancellation, on-behalf submission, final attendance application and monthly metrics. All fixture mutations rolled back.
- Independent connections: simultaneous decisions produced exactly one success and one stale-stage rejection; the next step remained pending. Dedicated test schema removed.
- HTTP integration: 20 checks passed against localhost for settings permissions, validation, optimistic saves, assigned-page access, request creation and two sequential decisions. Dedicated fixture records removed.
- Browser: actual React component with clearly marked synthetic fixture data tested in Arabic and English, adding/reordering/saving stages, desktop and 390px mobile viewport; no horizontal overflow. Main app browser session was unauthenticated; API behavior was verified separately with dedicated fixture accounts.
- TypeScript: passed. Targeted ESLint: zero errors; four existing next/no-img-element warnings in hr-app.tsx. Production build: passed.
- Independent review: three P2 presentation findings fixed (on-behalf confirmation based on server result, workflow-aware statuses and attendance chains, unavailable approver indication). Added RED→GREEN coverage for status presentation and unavailable approvers. No deferred review findings.
- Ruling: dashboard approval metrics reuse the assignment-aware approval aggregation so they match the approval center, including attendance corrections. Corrected Date serialization in monthly decision metrics and verified with PostgreSQL.
- Ruling: snapshots store ordered steps as JSON in versioned/run tables instead of a separate row per step. Whole-run locking and stage tokens make decisions atomic; tests cover replay and concurrent attempts.
- Local migration 0036 applied successfully. Unrelated existing changes and later migration 0037 remain untouched. No merge, push, or deployment performed.
- Temporary public preview files removed before the final build; only reproducible preview script remains.
