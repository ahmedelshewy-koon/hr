-- Records 0052, 0053 and 0054 in drizzle.__drizzle_migrations, inside the migration transaction, after the three
-- files have actually run in it. Requires expected-ledger.sql and the guard variables (hr_ledger_max_id,
-- attested_ledger_fp). Every existing row is preserved untouched; 0033-0051 are NOT recorded, because Drizzle did
-- not run them on production (their state is documented in hr_ops.migration_audit instead).
-- Ordering: Drizzle applies journal entries newer than MAX(created_at). Production's head (2026-10-07) is newer
-- than 0052/0053, so Drizzle would skip them; recording 0054 makes the head 0054, so nothing in this release is
-- pending afterwards and the next migration (newer than 0054) is the first Drizzle will apply.
WITH e(idx,tag,hash,created_at) AS :expected_ledger
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT e.hash, e.created_at FROM e WHERE e.idx IN (52, 53, 54) ORDER BY e.idx;
WITH e(idx,tag,hash,created_at) AS :expected_ledger
SELECT (SELECT md5(coalesce(string_agg(id || ':' || hash || ':' || created_at, ',' ORDER BY id), '')) FROM drizzle.__drizzle_migrations WHERE id <= :hr_ledger_max_id) AS hr_ledger_old_fp,
       (SELECT count(*) FROM drizzle.__drizzle_migrations m JOIN e ON e.idx IN (52, 53, 54) AND m.hash = e.hash AND m.created_at = e.created_at WHERE m.id > :hr_ledger_max_id) AS hr_ledger_new_rows,
       (SELECT count(*) FROM drizzle.__drizzle_migrations WHERE id > :hr_ledger_max_id) AS hr_ledger_all_new,
       (SELECT max(created_at) FROM drizzle.__drizzle_migrations) AS hr_ledger_new_head,
       (SELECT count(*) FROM e WHERE e.created_at > (SELECT max(created_at) FROM drizzle.__drizzle_migrations)) AS hr_drizzle_pending,
       (SELECT string_agg(id::text, ',' ORDER BY id) FROM drizzle.__drizzle_migrations WHERE id > :hr_ledger_max_id) AS hr_ledger_new_ids \gset
\echo HR_LEDGER existing_rows_unchanged=:hr_ledger_old_fp new_rows=:hr_ledger_new_rows/3 ids=:hr_ledger_new_ids head=:hr_ledger_new_head drizzle_pending=:hr_drizzle_pending
SELECT (:'hr_ledger_old_fp' <> :'attested_ledger_fp' OR :hr_ledger_new_rows <> 3 OR :hr_ledger_all_new <> 3
        OR :hr_ledger_new_head <> :head_when OR :hr_drizzle_pending > 0) AS hr_bad \gset
\if :hr_bad
  DO $$ BEGIN RAISE EXCEPTION 'LEDGER RECORDING FAILED: existing rows changed, wrong rows added, or ordering unsafe'; END $$;
\endif
\echo HR_LEDGER=RECORDED_0052_0054
