# Forward migration reconciliation after applied 0030

Read-only verification on 2026-09-26 confirmed the connected server is
`127.0.0.1:5545 / koon_hr`.

## Frozen history

The latest live journal entry is id `31`, timestamp `1790422744917`, with
SHA-256 `3aa2e4ffdc337c085aa45dac244ae0568b0448515efb02fac90f50364f11446a`.
This matches the current bytes of `0030_organizational_assignments.sql` and
the recorded approved execution hash. No historical SQL, snapshot, journal
entry or live schema was changed during this reconciliation.

## Observed delta

The two schema amendments listed in `ORGANIZATION_STAGE1_REVIEW.md` are
already present in both the frozen SQL and the live database:

| Object | Live definition |
| --- | --- |
| `public.job_grades.sort_order` | integer, NOT NULL, default 0 |
| `public.companies.companies_code_unique` | UNIQUE (code) |

The Stage 1 review's description of 0030 as pending does not describe this
live target. Its instruction to use a forward migration for any additional
delta still applies. Existing migration history must remain frozen.

All four tests in `tests/migration-baseline.test.mjs` passed, including an
empty generated difference between the latest snapshot and `db/schema.ts`.

## Final reconciliation

Final live inspection completed at `2026-09-26T13:14:19.281Z` in a repeatable-read,
read-only transaction. The server reported `transaction_read_only=on`.

- **0030 historical artifact verified:** the file's exact SHA-256 matches live
  journal id 31. The journal timestamp matches the local 0030 entry.
- **0030 metadata is consistent:** the local journal has 31 entries ending at
  0030, the snapshot descends from 0029, and all four migration-baseline tests
  pass. Generating the 0029-to-0030 snapshot difference produces the same 44
  statements as the frozen SQL except for the position of `sort_order` within
  the `CREATE TABLE job_grades` column list. Its definition is identical; this
  ordering difference is not a required schema alteration.
- **No 0031 required for the documented Stage 1 amendments.** Both amendments
  already exist. The user confirmed there are no further Stage 1 schema
  amendments; remaining Stage 1 changes are application-level only.
- **Whole-database `desired schema = live schema` cannot be confirmed.** The
  TypeScript schema matches its snapshot, but direct live introspection reveals
  older database objects not represented in that desired schema.

### Broader schema differences outside Stage 1

The installed Drizzle comparison produced 182 raw difference operations:
56 check-constraint removals, 93 foreign-key removals, 8 unique-constraint
removals, 7 unique-constraint additions, 8 index removals, 3 index additions,
and 7 default changes. These are diagnostic output, **not approved migration
statements**, and were never executed.

Some raw differences are representation noise. For example, introspection
reported `company_branches_pair` columns in the opposite order, while a direct
`pg_get_constraintdef` query confirmed the exact historical definition
`UNIQUE (company_id, branch_id)`. Other differences reflect actual omissions
from the TypeScript schema and snapshots:

| Live object omitted from desired schema | Direct catalog verification |
| --- | --- |
| `departments_unit_type_check` | Restricts `unit_type` to company/department; defined in migration 0021 |
| `performance_cycles_dates` | Requires `end_date >= start_date`; defined in migration 0014 |
| `leave_balances_employee_fk` | References employees(id), ON DELETE RESTRICT |
| `leave_balances_type_fk` | References leave_types(id), ON DELETE RESTRICT |

Consequently, an empty snapshot-to-TypeScript diff does not establish equality
with the live database. The broader differences are not an additive Stage 1
delta and must not be converted into a destructive 0031 under this task.

Evidence is saved in
`outputs/organization-implementation/final-forward-reconciliation.json` and
`outputs/organization-implementation/live-schema-introspection.json`.
The raw historical-statement string comparison is false solely because of
the column ordering difference explained above.

The comparison API's normal suggestion stage attempted an interactive question
and exited without executing changes. A temporary copy of that API was then
used to return introspected snapshots and raw differences before suggestions
or application. Installed dependency files were not edited. All database
inspection was enforced read-only, and no apply callback was called.

No 0031 was generated. No historical SQL, snapshot or journal was rewritten.
No live DDL, data writes, backfill, migration replay or migration-runner
invocation occurred. Reconciliation stops here.
