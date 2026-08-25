import { createDatabase } from "../../../../db/postgres";
import { apiFailure, enforceRateLimit, requireActor, requirePermission } from "../../api-security";

const REQUIRED_TABLES = [
  "roles", "permissions", "users", "employees", "departments", "job_titles",
  "requests", "approvals", "attendance_logs", "daily_attendance", "holidays",
  "leave_types", "leave_policies", "leave_balances", "documents", "audit_logs",
  "performance_rating_scales", "performance_cycles", "performance_reviews",
  "performance_goals", "performance_comments", "job_openings", "job_requirements",
  "candidates", "candidate_applications", "candidate_documents", "candidate_match_results",
  "recruitment_stages", "interview_templates", "interview_plans", "interview_plan_stages",
  "interviews", "interview_participants", "interview_evaluations", "job_offers", "lifecycle_templates", "lifecycle_template_tasks",
  "employee_lifecycles", "lifecycle_tasks", "assets", "asset_assignments",
  "training_courses", "training_enrollments",
] as const;

const MIGRATION_0014_TIMESTAMP = 1787405400000;
const MIGRATION_0014_TAG = "0014_complete_hrms";

export async function GET(request: Request) {
  const db = createDatabase();
  try {
    const actor = await requireActor(request, db);
    if (actor.roleName !== "Super Admin") {
      throw new Response("Only Super Admin can run production readiness checks", { status: 403 });
    }
    await requirePermission(db, actor, "system_settings", "manage_settings");
    await enforceRateLimit(db, request, "production-readiness", 12, 60, actor.id);

    const identity = await db.prepare(`SELECT current_database() AS database_name,
      current_setting('server_version') AS postgres_version,
      current_setting('TimeZone') AS timezone`).first<{
        database_name: string;
        postgres_version: string;
        timezone: string;
      }>();

    const migrationTable = await db.prepare(
      "SELECT to_regclass('drizzle.__drizzle_migrations')::text AS relation_name"
    ).first<{ relation_name: string | null }>();
    let migrationCount = 0;
    let latestMigrationTimestamp: number | null = null;
    if (migrationTable?.relation_name) {
      const migrations = await db.prepare(
        "SELECT COUNT(*)::int AS migration_count, MAX(created_at)::bigint AS latest_created_at FROM drizzle.__drizzle_migrations"
      ).first<{ migration_count: number; latest_created_at: string | number | null }>();
      migrationCount = Number(migrations?.migration_count || 0);
      latestMigrationTimestamp = migrations?.latest_created_at == null ? null : Number(migrations.latest_created_at);
    }

    const tableRows = await db.prepare(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
    ).all<{ table_name: string }>();
    const present = new Set(tableRows.results.map(row => String(row.table_name)));
    const missingTables = REQUIRED_TABLES.filter(table => !present.has(table));

    const constraints = await db.prepare(`SELECT
      COUNT(*) FILTER (WHERE contype='f')::int AS foreign_key_count,
      COUNT(*) FILTER (WHERE contype='f' AND NOT convalidated)::int AS unvalidated_foreign_key_count,
      COUNT(*) FILTER (WHERE contype IN ('p','u','f','c'))::int AS integrity_constraint_count
      FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'`).first<{
        foreign_key_count: number;
        unvalidated_foreign_key_count: number;
        integrity_constraint_count: number;
      }>();

    const migration0014Applied = latestMigrationTimestamp !== null && latestMigrationTimestamp >= MIGRATION_0014_TIMESTAMP;
    return Response.json({
      databaseReachable: true,
      databaseName: identity?.database_name || null,
      postgresVersion: identity?.postgres_version || null,
      timezone: identity?.timezone || null,
      migrationCount,
      latestAppliedMigration: migration0014Applied ? MIGRATION_0014_TAG : latestMigrationTimestamp,
      migration0014Applied,
      requiredTables: {
        expected: REQUIRED_TABLES.length,
        present: REQUIRED_TABLES.length - missingTables.length,
        ready: missingTables.length === 0,
        missing: missingTables,
      },
      constraints: {
        foreignKeys: Number(constraints?.foreign_key_count || 0),
        unvalidatedForeignKeys: Number(constraints?.unvalidated_foreign_key_count || 0),
        integrityConstraints: Number(constraints?.integrity_constraint_count || 0),
        ready: Number(constraints?.unvalidated_foreign_key_count || 0) === 0,
      },
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error, "Unable to verify production readiness");
  } finally {
    await db.close();
  }
}
