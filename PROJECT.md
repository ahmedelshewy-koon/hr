# Sanad HR

**Sanad HR — People, simply managed.** A bilingual (Arabic/English, RTL-aware) employee experience and HR operations platform covering the full employee lifecycle: org structure, leave, attendance, approvals, documents, and role-based administration for a multi-country company (Egypt / Saudi Arabia).

## Overview

Sanad HR is a single-tenant HR system built as a Cloudflare-hosted site. It combines:

- An **employee/HR self-service portal** — requests, approvals, personal records.
- An **HR admin console** — employees, departments, job titles, org chart, leave, attendance, users & permissions, system settings.
- A **Postgres-backed data layer** accessed through a single JSON API, with full audit logging.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [vinext](https://github.com/cloudflare/vinext) (Next.js-shaped app runtime) on Cloudflare |
| UI | React 19, custom CSS (no component library), `lucide-react` icons |
| Fonts | IBM Plex Sans Arabic (bilingual EN/AR, RTL layout) |
| Database | PostgreSQL via `drizzle-orm` / `postgres` driver |
| File storage | Cloudflare R2 (bucket binding `FILES`, declared in `.openai/hosting.json`) |
| Auth | Dual model — see [Authentication](#authentication) |
| Tooling | TypeScript, ESLint, Vite (`vite.config.ts` simulates bindings locally), Drizzle Kit for migrations |

## Core Modules

- **Dashboard** — headcount, attendance, and leave snapshot with quick actions.
- **Employees** — employee records, job titles, departments (CRUD), organizational hierarchy.
- **Leave** — leave types, per-country leave policies, entitlements/balances, official holiday calendar (Egypt/Saudi Arabia, recurring or one-off).
- **Attendance** — daily attendance records, punch events, lateness/overtime tracking, scheduling (fixed hours, grace period, required daily minutes).
- **Requests & Approvals** — unified request pipeline (leave, late arrival, early departure, WFH, expense reimbursement, certificates) with multi-stage approval (`pending_manager` → HR, etc.).
- **Org Chart** — visual structure across company divisions → departments → teams → employees.
- **Users & Permissions** — four-category role-based access control (Super Admin, HR Manager, Department Manager, Employee) with per-module/action permission grants and department-scoped data access.
- **Documents** — per-employee document storage (R2-backed) with categories and expiry tracking.
- **System Settings & Audit Log** — configurable leave/attendance settings, full audit trail of writes (previous/new value, actor, IP).

## Data Model

Defined in [`db/schema.ts`](db/schema.ts) via Drizzle, backed by PostgreSQL:

`departments`, `job_titles`, `employees`, `roles`, `users`, `permissions`, `requests`, `approvals`, `attendance_logs`, `daily_attendance`, `leave_types`, `leave_policies`, `leave_balances`, `holidays`, `documents`, `audit_logs`, `system_settings`.

Employees carry bilingual names (`name_en`/`name_ar`), department/job title/manager references, work schedule (days, check-in/out, grace minutes), and employment metadata (country, salary, type). Leave and attendance are normalized per employee/day/type for reporting and balance tracking.

## Authentication

Two complementary layers:

1. **Portal login** (`app/portal-auth.ts`) — each system user signs in with an individual email and PBKDF2-hashed password. HMAC-signed, versioned `HttpOnly` sessions are invalidated when an account is disabled or its password/access changes. The configured `KOON_LOGIN_EMAIL` / `KOON_LOGIN_PASSWORD_HASH` pair remains a one-time-compatible bootstrap path for the first system administrator.
2. **Optional ChatGPT sign-in (SIWC)** (`app/chatgpt-auth.ts`) — when present, identifies the individual user (via `oai-authenticated-user-*` headers) for per-user attribution; otherwise requests fall back to a synthetic `portal:<email>` identity.

Accounts are created with employees and receive the **Employee** category by default. System administrators and HR can set a temporary password; the user must replace it at first sign-in. Read and write access is enforced server-side per module and data scope: HR sees company data, department managers see their managed department tree, and employees see only their own records. All mutating actions are recorded to `audit_logs`.

## Project Structure

```
app/
  hr-app.tsx          # main SPA shell: nav, pages (dashboard, employees, leave, attendance, org, users, settings)
  employee-drawer.tsx # employee detail/edit side panel
  portal-auth.ts       # shared portal login/session (HMAC cookie)
  chatgpt-auth.ts      # optional Sign-in-with-ChatGPT (SIWC) helpers
  api/
    auth/route.ts       # portal login/logout endpoint
    hr/route.ts          # single JSON API: GET (bootstrap data) + POST (all actions)
  layout.tsx, page.tsx, *.css
db/
  schema.ts            # Drizzle table definitions
  postgres.ts, index.ts # DB connection helpers
drizzle/, drizzle-postgres/  # generated migrations
docs/postgresql.md      # Postgres setup notes
tests/                   # build/render smoke tests
```

## Getting Started

```bash
npm install
npm run dev      # local development
npm run build    # verify the vinext build output
npm test         # build + smoke test rendered HTML
```

Requires Node.js `>=22.13.0` and a PostgreSQL connection (see [`docs/postgresql.md`](docs/postgresql.md) and `drizzle.config.ts`). Schema changes: `npm run db:generate` then `npm run db:migrate`.

## Deployment

Hosted as a Cloudflare Site (`.openai/hosting.json`), with an R2 bucket (`FILES`) for document storage and no D1 binding — all relational data lives in PostgreSQL.
