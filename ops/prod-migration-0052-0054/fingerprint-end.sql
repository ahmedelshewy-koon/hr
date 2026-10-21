-- Data-preservation proof, part 2 (inside the migration transaction, after the migrations, before COMMIT).
-- Any pre-existing row changed or removed in any pre-existing table aborts the whole transaction.
-- New rows are allowed only where 0052/0053 seed them (permissions, deduction_rules) and where the APPROVED
-- reconciliation inserts them (employee_job_history, permissions); recon-apply.sql verifies those counts exactly.
SELECT 'INSERT INTO hr_fp_after ' || stmt FROM hr_fp_sql ORDER BY tbl \gexec
SELECT format('INSERT INTO hr_fp_new_rows SELECT %L, count(*) FROM public.%I WHERE id > %s', tbl, tbl, max_id)
FROM hr_fp_sql WHERE max_id IS NOT NULL ORDER BY tbl \gexec
SELECT coalesce(string_agg(b.tbl, ', ' ORDER BY b.tbl), '') AS hr_fp_changed
FROM hr_fp_before b LEFT JOIN hr_fp_after a USING (tbl)
WHERE a.tbl IS NULL OR a.n <> b.n OR a.digest <> b.digest \gset
SELECT coalesce(string_agg(tbl || '+' || n, ', ' ORDER BY tbl), '') AS hr_fp_new FROM hr_fp_new_rows WHERE n > 0 \gset
SELECT coalesce(string_agg(tbl || '+' || n, ', ' ORDER BY tbl), '') AS hr_fp_unexpected_new
FROM hr_fp_new_rows WHERE n > 0 AND tbl NOT IN ('permissions', 'deduction_rules', 'employee_job_history') \gset
\echo HR_FINGERPRINT_CHANGED_EXISTING_ROWS=[:hr_fp_changed]
\echo HR_NEW_ROWS_IN_EXISTING_TABLES=[:hr_fp_new]
SELECT (:'hr_fp_changed' <> '' OR :'hr_fp_unexpected_new' <> '') AS hr_bad \gset
\if :hr_bad
  DO $$ BEGIN RAISE EXCEPTION 'DATA PRESERVATION CHECK FAILED: existing rows changed or unexpected rows added; transaction rolled back'; END $$;
\endif
\echo HR_DATA_PRESERVATION=PASS
