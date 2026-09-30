# Sanad HR — Migration Safety Report

**Date:** 2026-09-19
**Scope:** Repair the Drizzle migration baseline so `npm run db:generate` is safe again. No features, no unrelated refactoring, no database changes.

---

## Summary

`npm run db:generate` was emitting a 467-line migration that re-creates 27 tables that already exist. It is fixed:

- With no schema change, `db:generate` now prints **"No schema changes, nothing to migrate"** and writes nothing (verified in the real repo).
- A real schema change now generates only the SQL for that change, and that SQL applies cleanly to a clone of the real database.
- **No database was modified.** No migration file was rewritten, and `_journal.json` was not touched. The whole fix is one new snapshot file, 25 small corrections in `db/schema.ts`, and one guard test.

The fix has one thing worth knowing up front: the missing snapshots were the *visible* half of the problem. `db/schema.ts` also disagreed with the real database in 25 places, so simply serializing it into a snapshot would have produced a baseline that misdescribes the database. Those were corrected too. See [Root cause](#root-cause).

---

## Root cause

`drizzle-kit generate` never looks at the database. It diffs `db/schema.ts` against the **newest snapshot** in `drizzle-postgres/meta/` and emits SQL for the difference. So the snapshot is the source of truth for "what migrations have already done".

Three things went wrong, in order of discovery:

1. **Snapshots stopped at `0017`.** Migrations `0018`–`0023` (access roles, contract alerts, recruitment ATS, organization unit type, candidate stage compat, ZKTeco) were written by hand as raw SQL, and their tables and columns were added to `db/schema.ts`, but no snapshot was ever generated. The newest snapshot still described 50 tables while `schema.ts` and the database have 77, so drizzle-kit believed 27 tables and 33 columns were new.
2. **`db/schema.ts` had drifted from the database.** The hand-written SQL created objects that `schema.ts` describes differently. See the table below. A baseline serialized from an inaccurate `schema.ts` would have been wrong in exactly the newest and most actively edited module, recruitment.
3. **Nothing detected any of this.** The snapshot chain already had gaps (`0001`, `0009`, `0010`, `0013`–`0015`) and the `0017` snapshot itself already listed 8 indexes that do not exist in the database. The rot is recurring, not a one-off.

### What the bogus migration would have done

I reproduced it in a scratch copy: 106 statements (27 `CREATE TABLE`, 33 `ADD COLUMN`, 43 index statements, 2 `DROP INDEX`, 1 `DROP NOT NULL`).

| | Result |
|---|---|
| Statements whose target state **already exists** in the database | 91 |
| Index statements whose *name* is absent from the database | 15 (14 are the same unique constraint under another name; 1, `idx_candidates_email`, was never created) |
| Executed on a fresh clone | **Failed on statement 1:** `relation "attendance_device_punches" already exists`. The transaction rolled back and the clone still had 77 tables. |

So the old state was *blocking*, not *corrupting*: the migration could not succeed, and Postgres DDL is transactional. The real hazard was a developer "fixing" it by hand-editing a 467-line migration.

### How `schema.ts` differed from the database

Found by introspecting a clone with `drizzle-kit pull` and diffing it against the snapshot serialized from `schema.ts`, for everything drizzle-kit models:

| Difference | Count | Effect if left |
|---|---|---|
| Unique **constraint** in the DB, declared as `uniqueIndex("idx_…")` under another name in `schema.ts` | 20 | A future edit generates `DROP INDEX "idx_…"` for an object that does not exist, so the migration fails. Demonstrated below. |
| Partial-index `WHERE` predicate missing from `schema.ts` (`job_offers`, `notifications`) | 2 | A future edit would recreate the index as non-partial. |
| `job_openings.created_date` `DEFAULT CURRENT_DATE` missing | 1 | Cosmetic. |
| `idx_candidates_email` declared but **no migration ever created it** | 1 | A future `DROP INDEX` fails; the declaration is simply false. |

Tables, columns, types, nullability and primary keys matched everywhere apart from the one default above.

---

## Files changed

| File | Change |
|---|---|
| `drizzle-postgres/meta/0023_snapshot.json` | **New.** The baseline: the schema after `0023` (77 tables), chained after `0017` (`prevId` = `0017`'s id). It fills the missing snapshot for the existing `0023` journal entry. |
| `db/schema.ts` | 25 corrections to *existing* lines: 20 `uniqueIndex("idx_…")` → `unique("<real constraint name>")`, 2 `.where()` predicates, 1 column default, 1 stale index declaration removed, and the `unique` import. No table or column was added, removed or retyped. |
| `tests/migration-baseline.test.mjs` | **New** guard test (4 checks, ~3 s, needs no database). See [Guard test](#guard-test). |
| `MIGRATION_SAFETY_REPORT.md` | This file. |

**Not changed:** every `drizzle-postgres/*.sql` migration (including the two whose hashes no longer match the applied rows; see [risks](#remaining-migration-risks)), `_journal.json`, `package.json`, `drizzle.config.ts`, and the database.

> **Commit these together.** `_journal.json` (the `0023` entry) and `0023_zkteco_mb2000.sql` were already uncommitted from the ZKTeco work. The new snapshot describes the state *after* that migration, so it must not be committed without them.

---

## Snapshot / baseline strategy

**Chosen: backfill the one missing snapshot for the existing `0023` entry. Do not add a new migration.**

Why this is safe, from the drizzle sources in `node_modules`:

- `drizzle-kit migrate` calls drizzle-orm's `readMigrationFiles`, which reads only `_journal.json` and each `.sql` file, hashing the SQL text with SHA-256. **It never reads snapshot JSON.** Adding a snapshot cannot change what `db:migrate` does or what it believes is applied.
- `drizzle-kit generate` takes only the **newest** snapshot file as "previous state". The older gaps do not matter, so I did not fabricate intermediate snapshots for `0018`–`0022`, which I could not have reconstructed truthfully anyway.
- The snapshot content is a pure serialization of `schema.ts`. I produced it with drizzle-kit's own `generate` in a scratch copy, so the format is exactly what real runs write, then copied only the snapshot file.

**Rejected alternatives:**

| Option | Why not |
|---|---|
| New "baseline" migration `0024` with guarded SQL | Adds SQL that will run against production for no benefit; the objects already exist. |
| `drizzle-kit generate --custom` | Writes a snapshot that is a *copy of the previous one* (checked in the source), so it would have preserved the stale state. |
| Use the introspected (`pull`) snapshot as the baseline | It contains 91 foreign keys and 52 CHECK constraints that `schema.ts` does not declare, so the very next `generate` would emit ~143 `DROP CONSTRAINT` statements. |

**Why `schema.ts` was corrected first:** the snapshot must equal `serialize(schema.ts)`, otherwise `generate` reports a diff. The only way to also make it match the database was to make `schema.ts` truthful first. I limited that to correcting lines that were wrong. I did **not** add declarations for objects `schema.ts` has never modeled (foreign keys, CHECK constraints, five partial unique indexes); that is the project's existing convention and would be a large schema rewrite.

---

## Verification performed

All destructive and migration testing ran against a **clone** of the database (a `pg_dump` restored into a scratch database, since dropped) and a scratch copy of the repo. The real database was only dumped.

### Baseline accuracy (against introspection of the database)

| Check | Before | After |
|---|---|---|
| Tables / columns only on one side | 0 / 0 | 0 / 0 |
| Column attribute mismatches | 1 | **0** |
| Equivalent indexes with different names | 20 | **0** |
| Snapshot indexes absent from the DB by name | 8 (in the `0017` snapshot) | **0** of 86 |
| Snapshot unique constraints, name **and column order** matching the DB | not applicable | **20 of 20** |
| Partial-index predicates (3 that differ only in text formatting) | not applicable | normalized comparison: all 3 equivalent |

### The requested checks

| Task | Result |
|---|---|
| `npm run db:generate` with no schema change | **"No schema changes, nothing to migrate 😴"**. `drizzle-postgres/` was byte-identical (SHA-256 of every file) before and after, with `DATABASE_URL` unset and when pointed at a clone. |
| `drizzle-kit check` (snapshot chain) | "Everything's fine" |
| Harmless test change on a scratch copy, then revert | See below. |
| `npx tsc --noEmit` | pass |
| `node --test tests/*.test.mjs` | **125 tests: 122 pass, 3 skipped, 0 fail** (121 existing + 4 new; the 3 skipped are the same opt-in tests that were skipped before) |
| `npm run build` | pass, 19 API routes |
| `npm run lint` | 22 errors, 7 warnings: identical to the recorded baseline; none in the changed files |

---

## Generated SQL inspection

### 1. The harmless test change

Added one nullable `text` column to `holidays` in the scratch copy. Generated SQL, verbatim, and the whole of it:

```sql
ALTER TABLE "holidays" ADD COLUMN "migration_probe" text;
```

Applied to the clone with the real `drizzle-kit migrate`:

- Only that one migration ran (migration rows 24 → 25; the older migrations were not re-run).
- `holidays` went from 14 to 15 columns. The new column is nullable with no default; all 27 rows are NULL in it.
- The existing rows are **identical**: a hash of all `holidays` rows (new column excluded) equals the same hash taken on the real database.
- All 77 tables have unchanged row counts. A column-level diff of the whole clone shows exactly one difference: `holidays.migration_probe`.
- A second `generate` afterwards reported no changes, and `drizzle-kit check` passed on the extended chain.

Reverted by restoring the scratch copy from the real repo and re-cloning the database; `generate` was a no-op again. The real repo never contained the probe.

### 2. Why aligning the constraint names mattered

The same realistic edit (widen the unique key on `training_enrollments` from `(course_id, employee_id)` to include `status`), made under the old baseline and under the new one:

| | Old baseline | New baseline |
|---|---|---|
| Generated SQL | `DROP INDEX "idx_training_enrollments_course_employee";`<br>`CREATE UNIQUE INDEX "idx_training_enrollments_course_employee" … ("course_id","employee_id","status");` | `ALTER TABLE "training_enrollments" DROP CONSTRAINT "training_enrollments_unique";`<br>`ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_unique" UNIQUE("course_id","employee_id","status");` |
| Applied to a fresh clone | **Fails:** `ERROR: index "idx_training_enrollments_course_employee" does not exist`. Not recorded; the constraint is unchanged. | **Applies.** Migration recorded; constraint is now `UNIQUE (course_id, employee_id, status)`; the table's row is intact. |

### 3. Guard test negative controls

A guard that cannot fail proves nothing, so each failure mode was injected in the scratch copy:

| Injected fault | Result |
|---|---|
| Healthy state | 4 of 4 pass |
| **The original bug** (newest migration has no snapshot) | fails: "newest snapshot belongs to the newest migration" and "schema.ts matches the newest snapshot" |
| `schema.ts` edited but `db:generate` never run | fails, and the message prints the missing SQL (`ALTER TABLE "holidays" ADD COLUMN …`) |
| Hand-written journal entry and SQL, no snapshot | fails: "newest snapshot belongs to the newest migration" |
| Journal lists a missing `.sql` file | fails: "every journal entry has its SQL file" |
| Broken snapshot `prevId` chain | fails: "snapshots form a single unbroken chain" |

---

## Existing tables and data are safe

- **The real database was not modified.** Its schema-only dump has the same MD5 as the backup taken before the work started (`0c7480a0…`); `drizzle.__drizzle_migrations` still has 24 rows with the same newest `created_at`; there is no probe column. The only changes to the real database's data during the session are 10 new rows in `attendance_device_syncs` (the ZKTeco agent, one failed sync every ~5 minutes) and 2 in `audit_logs` (a Super Admin login and a page-availability toggle on your running dev server). None came from this work.
- No `.sql` migration file was edited, so the hashes recorded in `drizzle.__drizzle_migrations` are unaffected, and adding the snapshot cannot change them (the migrator does not read it).
- The `db/schema.ts` edits have no runtime effect: nothing in `app/`, `worker/` or `scripts/` imports it. Only drizzle-kit and one source-text test read it, and that test asserts on `employee_leave_types`, which was not touched. No code references the renamed index names, and the app does not use `ON CONSTRAINT`.
- A backup of the real database taken before the work is at `%TEMP%/claude/d--HR/b632c71b-…/scratchpad/migsafety/koon_hr_backup_20260919_110032.dump` (356 KB). Copy it somewhere permanent if you want to keep it.

---

## Guard test

`tests/migration-baseline.test.mjs` runs as part of `npm test`, with no database, in about 3 seconds. It fails when:

1. a journal entry has no `.sql` file, or the `idx` values are not contiguous;
2. the newest migration has no snapshot (the original bug);
3. the snapshots do not form a single chain;
4. `db/schema.ts` differs from the newest snapshot, i.e. `db:generate` would emit SQL. It uses drizzle-kit's own diff (`generateMigration`) and prints the SQL that is missing.

This is the one addition beyond the requested tasks. It is what stops the baseline from silently rotting a third time. Deleting the file is safe if you would rather not have it.

---

## Workflow for future schema changes

**Ordinary schema change (add or alter columns, tables, indexes):**

```bash
# 1. Edit db/schema.ts, then generate. No database connection is needed.
npm run db:generate -- --name=add_something

# 2. Read the generated drizzle-postgres/00NN_add_something.sql before doing anything else.
#    Look for DROP, ALTER … TYPE, and SET NOT NULL on populated tables. You may edit this SQL file by hand.
#    Never edit the snapshot JSON by hand.

# 3. Test on a clone, never on the real database.
pg_dump -Fc -d <real db url> -f backup.dump
createdb <clone name> && pg_restore --no-owner -d <clone url> backup.dump
DATABASE_URL=<clone url> npm run db:migrate

# 4. Check the guard and the rest of the suite.
node --test tests/migration-baseline.test.mjs
npm test

# 5. Commit schema.ts, the new .sql, the new snapshot and _journal.json together.

# 6. Back up, then migrate the real database (confirm the target URL first).
DATABASE_URL=<real db url> npm run db:migrate
```

**Data-only SQL** (backfills, seed rows; no schema change): `npx drizzle-kit generate --custom --name=backfill_x`, then put the SQL in the generated file. Do not create journal entries by hand; the guard test will fail if you do.

**Anything drizzle-kit does not model** (foreign keys, CHECK constraints, partial unique indexes): use `--custom` and leave `schema.ts` alone. It is invisible to drizzle, so there is nothing to keep in sync.

**Do not** use `--custom` for a change that alters the columns or tables `schema.ts` declares: the custom snapshot is a copy of the previous one, so the next `generate` would emit the same change again.

**If a generated migration fails,** `drizzle-kit migrate` exits 1 **without printing the database error**. To see it, run the SQL in a transaction: `psql -v ON_ERROR_STOP=1 -1 -f <file>` against the clone.

**To check `schema.ts` against a database at any time:** `drizzle-kit pull --dialect postgresql --url <clone url> --out <temp dir>` and diff that snapshot against `drizzle-postgres/meta/0023_snapshot.json`. The comparison scripts I used are not committed; ask if you want them added under `scripts/`.

---

## Remaining migration risks

Ordered by how likely they are to matter.

1. **Hand-written SQL can still bypass drizzle without being caught.** The guard test is database-free: it detects a missing snapshot or a `schema.ts` that disagrees with the snapshot, but not a hand-written migration that changes the database *and* leaves `schema.ts` untouched. Only introspection (`drizzle-kit pull`) detects that. A periodic check, or a CI job against a migrated scratch database, would close the gap.
2. **The migrator silently skips a migration that is "older" than the newest applied one.** It applies only migrations whose journal `when` is greater than the newest `created_at` in the database. Generated migrations use the current time, which is fine, but `0018`–`0023` have hand-picked `when` values, and the newest (`0023`, `1789560000000`, 2026-09-16) is close to "now". Never create a migration with a `when` lower than the newest applied one.
3. **Foreign keys and CHECK constraints are outside drizzle.** The database has 91 foreign keys and 52 CHECK constraints (from hand-written SQL in `0013`, `0014`, `0015`, `0020`, `0021`); `schema.ts` and every snapshot have none. Consequences: a *new* table generated by drizzle-kit will have no foreign keys or CHECKs, unlike the hand-written ones; and a generated `ALTER COLUMN … TYPE` or `DROP COLUMN` on a column those constraints reference is not warned about, so review those by hand.
4. **Five partial unique indexes exist only in the database** (`asset_assignments`, `assets` serial, `candidates` active email and converted employee, `employee_lifecycles` active). Drizzle never touches them, but re-declaring an equivalent index in `schema.ts` under another name would create a duplicate.
5. **Runtime DDL changes the schema outside migrations.** `app/portal-auth.ts` adds 7 auth columns at runtime, and `app/api/hr/route.ts` creates `system_settings` and adds 2 `holidays` columns. All are modeled in `schema.ts` and idempotent, but a migration that adds the same object without `IF NOT EXISTS` would collide on any database the app has already touched.
6. **`0017` and `0020` were edited after being applied.** Their SHA-256 in `drizzle.__drizzle_migrations` matches no committed version of the file. This is harmless today (the migrator compares only timestamps of applied rows) and the schema was previously confirmed identical to a fresh replay of all migrations, but if either file is ever run again it is the edited text that runs. I did not touch them, per instructions.
7. **`db:migrate` uses whatever `DATABASE_URL` is in the shell.** It does not read `.dev.vars`. A shell that still has the production URL exported will migrate production. Print the target before running it.
8. **Generated migrations are not idempotent** (no `IF NOT EXISTS`), so a half-applied environment cannot simply re-run them. Transactional DDL makes a failed run roll back cleanly, which is what protected the real database in the original failure.
9. **`idx_candidates_email` is now undeclared.** It was declared in `schema.ts` but never created, so I removed the declaration to match the database. If a plain index on `candidates.email` is actually wanted, add it back to `schema.ts` and let `db:generate` create it. Note the database already has a unique index on `lower(email)` for active candidates.
10. **`schema.ts` line endings.** `git` will convert the working copy's LF to CRLF on the next commit (`core.autocrlf`). This does not affect the guard test or `generate`.

---

## Environment notes

The local PostgreSQL 18 cluster for this project (`.postgres-data`, port 5545) was **not running** when I started, apparently since the crash logged on 2026-09-17. I restarted it with its recorded options (`-p 5545 -c listen_addresses=127.0.0.1`) so I could back it up, and left it running because `.dev.vars` and your dev server depend on it. A different PostgreSQL on port 5544 is unrelated and was not touched.
