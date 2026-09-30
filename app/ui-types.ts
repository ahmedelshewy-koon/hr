/**
 * A record returned by the HR API and rendered by the workspace components.
 *
 * The API layer ships rows straight from PostgreSQL, so the column set is decided
 * by the query rather than by a type. The UI reads those columns by name
 * (`row.employee_name_ar`, `row.late_minutes`, ...), which needs an index
 * signature permissive enough to dot-access.
 *
 * This alias used to be redeclared in fourteen component files, each one its own
 * `no-explicit-any` violation. Declaring it once keeps a single, documented escape
 * hatch and gives a single place to tighten later: replacing `any` with `unknown`
 * here, then fixing the call sites, is the migration path to real row types.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see the note above
export type Row = Record<string, any>;
