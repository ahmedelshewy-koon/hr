# Sanad HR Core Operations

## Production initialization

New reference data and schema changes are migration-owned. Set a verified `DATABASE_URL`, confirm `current_database()` and `current_user`, take a backup or use an isolated test database, then run `npm run db:migrate`. Migration `0013_hr_core_completion` adds document categories and versioning, notifications, leave rollover records, distributed rate-limit buckets, indexes, and non-destructive foreign keys. Existing-table foreign keys are added only when the migration detects no orphan rows; skipped constraints emit a PostgreSQL notice and require data repair before rerunning the integrity step.

The legacy `ensureSeed()` remains idempotent and guarded by `seed_version`. No document categories or other new large seed workloads were added to normal GET requests.

## R2 documents

The Cloudflare binding must be named `FILES`. R2 has no public application URL. Upload, view, download, replacement, and archive operations go through authenticated `/api/documents` routes. The backend validates employee scope and category policy, checks file signatures and extensions, generates opaque keys, returns private/no-store responses, retains replacement objects as versions, and uses soft archive for active metadata.

## Scheduled attendance scan

The Worker exports a Cloudflare `scheduled` handler. Configure a daily cron after the local business day closes. The handler resolves the last completed date in `Africa/Cairo` and calls the existing attendance recalculation service. That service remains authoritative for working days, holidays, approved leave, calculations, and exception idempotency.

## Explicit administrative services

- `POST /api/operations/leave-rollover` with `{ "fromYear": 2026 }` is HR-only, rate-limited, audited, and idempotent per employee/type/year.
- `POST /api/operations/audit-retention` is Super Admin-only, rate-limited, enforces at least 90 days, preserves critical audit actions, and records its own result.

Neither operation runs on page load.

## Security settings

`sessionMinutes` is enforced between 15 minutes and 24 hours. `passwordExpiryDays` marks expired accounts for forced password change. `auditRetentionDays` is enforced by the explicit retention service. MFA is intentionally marked unsupported and is not presented as an operational setting.

## Runtime verification

The local `.dev.vars` currently targets PostgreSQL at `127.0.0.1:5545`. At the time of this implementation that endpoint refused connections, so migrations and live PostgreSQL/R2 workflows were not executed. Do not substitute credentials or apply migrations to the instance on another port without verifying database ownership and identity first.
