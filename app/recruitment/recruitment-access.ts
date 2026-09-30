import { MANAGED_DEPARTMENTS_CTE } from "../organization/department-scope";
import type { ApiActor } from "../api/api-security";
import type { PostgresDatabase, TransactionDatabase } from "../../db/postgres";

type Db = PostgresDatabase | TransactionDatabase;
export const isRecruitmentAdmin = (actor: ApiActor) =>
  ["Super Admin", "HR Manager"].includes(actor.roleName);

async function jobScopeRow(db: Db, actor: ApiActor, jobId: number) {
  if (isRecruitmentAdmin(actor)) return { id: jobId, can_manage: 1 };
  if (!actor.employeeId) return null;
  return db
    .prepare(
      `${MANAGED_DEPARTMENTS_CTE} SELECT j.id,CASE WHEN j.recruiter_employee_id=? OR j.hiring_manager_employee_id=? OR j.department_id IN (SELECT id FROM managed) THEN 1 ELSE 0 END AS can_manage
    FROM job_openings j WHERE j.id=? AND (
      j.recruiter_employee_id=? OR j.hiring_manager_employee_id=? OR j.department_id IN (SELECT id FROM managed)
      OR EXISTS (SELECT 1 FROM interviews i JOIN interview_participants p ON p.interview_id=i.id JOIN candidate_applications a ON a.id=i.application_id WHERE a.job_id=j.id AND p.employee_id=?)
    )`,
    )
    .bind(
      actor.employeeId,
      actor.employeeId,
      actor.employeeId,
      jobId,
      actor.employeeId,
      actor.employeeId,
      actor.employeeId,
    )
    .first<{ id: number; can_manage: number }>();
}

export async function requireJobAccess(
  db: Db,
  actor: ApiActor,
  jobId: number,
  manage = false,
) {
  const row = await jobScopeRow(db, actor, jobId);
  if (!row || (manage && !Number(row.can_manage)))
    throw new Response(
      manage ? "You cannot manage this job" : "Job access denied",
      { status: 403 },
    );
  return row;
}

export async function requireApplicationAccess(
  db: Db,
  actor: ApiActor,
  applicationId: number,
  manage = false,
) {
  const application = await db
    .prepare(
      "SELECT id,job_id,candidate_id,current_stage_id,status FROM candidate_applications WHERE id=?",
    )
    .bind(applicationId)
    .first<{
      id: number;
      job_id: number;
      candidate_id: number;
      current_stage_id: number | null;
      status: string;
    }>();
  if (!application)
    throw new Response("Application not found", { status: 404 });
  if (isRecruitmentAdmin(actor)) return application;
  const scope = await jobScopeRow(db, actor, Number(application.job_id));
  if (scope?.can_manage) return application;
  if (
    !manage &&
    actor.employeeId &&
    (await db
      .prepare(
        "SELECT 1 AS allowed FROM interviews i JOIN interview_participants p ON p.interview_id=i.id WHERE i.application_id=? AND p.employee_id=? LIMIT 1",
      )
      .bind(applicationId, actor.employeeId)
      .first())
  )
    return application;
  throw new Response(
    manage ? "You cannot manage this application" : "Application access denied",
    { status: 403 },
  );
}

export async function requireInterviewAccess(
  db: Db,
  actor: ApiActor,
  interviewId: number,
  manage = false,
) {
  const row = await db
    .prepare(
      "SELECT i.id,i.application_id,a.job_id,p.id AS participant_id,p.employee_id FROM interviews i JOIN candidate_applications a ON a.id=i.application_id LEFT JOIN interview_participants p ON p.interview_id=i.id AND p.employee_id=? WHERE i.id=?",
    )
    .bind(actor.employeeId, interviewId)
    .first<{
      id: number;
      application_id: number;
      job_id: number;
      participant_id: number | null;
      employee_id: number | null;
    }>();
  if (!row) throw new Response("Interview not found", { status: 404 });
  if (isRecruitmentAdmin(actor)) return row;
  const scope = await jobScopeRow(db, actor, Number(row.job_id));
  if (manage && scope?.can_manage) return row;
  if (!manage && (scope?.can_manage || row.participant_id)) return row;
  throw new Response("Interview access denied", { status: 403 });
}

export async function canViewConsolidated(
  db: Db,
  actor: ApiActor,
  applicationId: number,
) {
  if (isRecruitmentAdmin(actor)) return true;
  try {
    await requireApplicationAccess(db, actor, applicationId, true);
    return true;
  } catch {
    return false;
  }
}

export function jobScopeSql(actor: ApiActor, alias = "j") {
  if (isRecruitmentAdmin(actor)) return { sql: "1=1", args: [] as unknown[] };
  if (!actor.employeeId) return { sql: "1=0", args: [] as unknown[] };
  return {
    sql: `(${alias}.recruiter_employee_id=? OR ${alias}.hiring_manager_employee_id=? OR ${alias}.department_id IN (${MANAGED_DEPARTMENTS_CTE} SELECT id FROM managed))`,
    args: [actor.employeeId, actor.employeeId, actor.employeeId],
  };
}
