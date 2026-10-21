-- Records 0033-0054 in drizzle.__drizzle_migrations, inside the migration transaction (LEDGER_MODE=reconcile).
-- Requires expected-ledger.sql. Drizzle applies every journal entry with `when` > MAX(created_at); leaving the
-- ledger at 0032 would make the next `drizzle-kit migrate` replay 0033-0054 (non-idempotent DDL and data rewrites).
-- Rehearsal proves 0033-0054 are fully present (catalog vs a from-scratch build) before this may run on production.
WITH e(idx,tag,hash,created_at) AS :expected_ledger
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT e.hash, e.created_at FROM e
WHERE e.idx BETWEEN 33 AND 54
  AND NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = e.created_at)
ORDER BY e.idx;
WITH e(idx,tag,hash,created_at) AS :expected_ledger
SELECT (SELECT count(*) FROM drizzle.__drizzle_migrations) AS hr_ledger_rows,
       (SELECT max(created_at) FROM drizzle.__drizzle_migrations) AS hr_ledger_head,
       (SELECT count(*) FROM e WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = e.created_at)) AS hr_ledger_missing,
       (SELECT count(*) FROM e WHERE e.created_at > (SELECT max(created_at) FROM drizzle.__drizzle_migrations)) AS hr_drizzle_pending \gset
\echo HR_LEDGER_ROWS=:hr_ledger_rows HEAD=:hr_ledger_head MISSING=:hr_ledger_missing DRIZZLE_WOULD_APPLY=:hr_drizzle_pending
SELECT (:hr_ledger_rows <> 55 OR :hr_ledger_head <> :head_when OR :hr_ledger_missing > 0 OR :hr_drizzle_pending > 0) AS hr_bad \gset
\if :hr_bad
  DO $$ BEGIN RAISE EXCEPTION 'LEDGER RECONCILIATION FAILED'; END $$;
\endif
\echo HR_LEDGER=RECONCILED
