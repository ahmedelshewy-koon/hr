# Payroll and Time Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox syntax for tracking.

**Goal:** Complete the attached Payroll and Timesheet specifications in the existing Sanaa application while preserving history and concurrent Timesheet work.

**Architecture:** Reuse the Timesheet facts, calculation, deduction, schedule, and access services. Extend the existing PostgreSQL schema additively. Keep authenticated server APIs as the sole write boundary. Store immutable payroll and ERP posting evidence and require reconciliation for any retry or reversal.

**Tech Stack:** Next.js compatible vinext, TypeScript, Drizzle ORM, PostgreSQL, React, existing Sanaa CSS and permission grid.

**Spec:** `C:\Users\elshewy\Desktop\Payroll_Module_Rebuild_Prompt.md` and `C:\Users\elshewy\Desktop\Timesheet_Management_Rebuild_Prompt.md`. The user's Next.js, PostgreSQL, separate Business Unit mapping and no production action instructions override spec references to Lovable and Supabase.

## Global Constraints

- Never infer a Working Business Unit from `company_id`.
- Preserve historical salary, payroll, attendance, requests, and accounting data.
- Keep migrations unapplied in production and use only fake ERP transport in tests.
- Preserve Claude's Timesheet files and reuse their calculations.
- Gate all payroll routes and API actions by the existing role and permission system as well as active HR manager membership.

## Review Focus

- A user without basic salary privilege must not infer basic from preview or run payloads.
- A confirmed, locked, or sent run must not be recalculated or reposted.
- Partial ERP acceptance must remain traceable and block retries until verified reconciliation.
- Timesheet posting must not overwrite a confirmed run or another country's variable entries.
- Missing Business Unit or cost center must block posting without silently dropping employees.

## Tasks

### Task 1: Baseline and isolated verification

**Files:** `tests/rendered-html.test.mjs`, `docs/PAYROLL_REBUILD_STATUS.md`.

- [x] Diagnose the Cloudflare binding failure in the Node HTML smoke test.
- [x] Supply a test-only binding and verify the HTML test passes.
- [ ] Run the complete suite and address remaining regressions.
- [ ] Create a fresh isolated PostgreSQL clone, migrate through 0053, and record the database test connection without touching production.

### Task 2: Permission and salary boundaries

**Files:** `app/payroll/access.ts`, `app/api/payroll/route.ts`, `app/payroll/service.ts`, `app/hr-settings/catalog.ts`, `db/schema.ts`, migration, access tests.

- [ ] Write failing tests for each route/action permission and non-privileged salary leakage.
- [ ] Add route permission keys and seed grants using existing roles and permissions.
- [ ] Enforce every API view/action and field level scope on the server.
- [ ] Verify permission and salary tests and TypeScript.

### Task 3: Attendance and employee setup gaps

**Files:** New focused WFH, saved attendance, biometric, vacation, request services and pages; existing Timesheet facts read adapters; additive migration; integration tests.

- [ ] Test and implement WFH sessions with employee checkout and administrative force checkout.
- [ ] Test and implement confirmed saved attendance snapshots and notifications.
- [ ] Add raw biometric log filtering and existing device ingest integration.
- [ ] Add vacation balance integration and region ordered request approval/escalation.
- [ ] Complete employee payroll fields and visibility.

### Task 4: Payroll core and UI completion

**Files:** Payroll services, UI pages and CSS, route registry, migration, tests.

- [ ] Complete setup CRUD/import/export, eligibility, recurring, matrix and variable actions.
- [ ] Add search, filters, multi sort, Excel import/export and print to each required screen.
- [ ] Verify bilingual Arabic/English copy, RTL and mobile tables.
- [ ] Verify preview totals equal run totals by currency.

### Task 5: Posting, locking, and ERP reconciliation

**Files:** Timesheet payroll bridge, Payroll run service, ERP adapter, append only posting evidence migration, tests.

- [ ] Test and make Deduction Summary post/rollback atomic and safe against confirmed runs.
- [ ] Test and make run recalculation, confirmation, lock and unlock transactional.
- [ ] Record invoice attempts per Business Unit, batch, request fingerprint and response.
- [ ] Prevent retry after ambiguous/partial failure; require recorded verified reconciliation for reversal.
- [ ] Run end-to-end Timesheet to Payroll to fake ERP scenarios in isolated PostgreSQL.

### Task 6: Dependency audit and final gate

**Files:** Legacy Payroll UI/service only after dependency search, test suite, completion audit.

- [ ] Remove verified unused legacy Payroll code without removing historical tables.
- [ ] Run full TypeScript, lint, build, tests and database integration suite.
- [ ] Produce a requirement by requirement audit and production readiness assessment.
