-- Append-only audit trail of this reconciliation, created inside the migration transaction. It lives in its own
-- schema (hr_ops) so it is outside the public schema contract and outside Drizzle's ledger. Rows are only ever
-- inserted (apply writes the reviewed lineage classification; rollback appends an event); never updated or deleted.
CREATE SCHEMA IF NOT EXISTS hr_ops;
CREATE TABLE IF NOT EXISTS hr_ops.migration_audit (
  id serial PRIMARY KEY,
  run_id text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by text NOT NULL DEFAULT current_user,
  event text NOT NULL,
  tag text,
  created_at bigint,
  hash text,
  classification text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
