-- Data-preservation proof, part 1 (inside the migration transaction, before any DDL).
-- For every existing public table, records a row count and an md5 over all rows, using ONLY the columns that exist
-- now (columns added later are ignored) and, for tables with an integer id, only rows with id <= the current max.
-- fingerprint-end.sql recomputes the same statements after the migrations and aborts the transaction on any change.
CREATE TEMP TABLE hr_fp_sql (tbl text PRIMARY KEY, max_id bigint, stmt text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE hr_fp_before (tbl text PRIMARY KEY, n bigint NOT NULL, digest text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE hr_fp_after (LIKE hr_fp_before) ON COMMIT DROP;
CREATE TEMP TABLE hr_fp_new_rows (tbl text PRIMARY KEY, n bigint NOT NULL) ON COMMIT DROP;
INSERT INTO hr_fp_sql (tbl, max_id, stmt)
SELECT c.table_name,
       CASE WHEN bool_or(c.column_name = 'id' AND c.data_type IN ('integer','bigint')) THEN 0 END,
       format('SELECT %L, count(*), md5(coalesce(string_agg(r, chr(10) ORDER BY r), %L)) FROM (SELECT ROW(%s)::text AS r FROM public.%I%s) s',
              c.table_name, '', string_agg(quote_ident(c.column_name), ',' ORDER BY c.ordinal_position), c.table_name,
              CASE WHEN bool_or(c.column_name = 'id' AND c.data_type IN ('integer','bigint'))
                   THEN format(' WHERE id <= (SELECT max_id FROM hr_fp_sql WHERE tbl = %L)', c.table_name) ELSE '' END)
FROM information_schema.columns c
JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
WHERE c.table_schema = 'public'
GROUP BY c.table_name;
SELECT format('UPDATE hr_fp_sql SET max_id = (SELECT coalesce(max(id), 0) FROM public.%I) WHERE tbl = %L', tbl, tbl)
FROM hr_fp_sql WHERE max_id IS NOT NULL ORDER BY tbl \gexec
SELECT 'INSERT INTO hr_fp_before ' || stmt FROM hr_fp_sql ORDER BY tbl \gexec
SELECT count(*) AS hr_fp_tables, sum(n) AS hr_fp_rows FROM hr_fp_before \gset
\echo HR_FINGERPRINT_BEFORE tables=:hr_fp_tables rows=:hr_fp_rows
