import { MANAGED_DEPARTMENTS_CTE } from "../../../organization/department-scope";
import type { PostgresDatabase } from "../../../../db/postgres";
import type { ApiActor } from "../../api-security";
import { requireModule } from "../../../talent/talent-service";
import { LEARNING_ADMIN_ROLES } from "../../../talent/learning-rules";

type Row = Record<string, unknown>;

export const isLearningAdmin = (actor: ApiActor) => LEARNING_ADMIN_ROLES.includes(actor.roleName);

/**
 * Who may open a program's materials. It mirrors what GET /api/learning lists, so nobody can fetch a material
 * for a program they cannot see: HR sees every program, a manager sees the programs they created or that their
 * team is assigned to, and an employee sees the programs assigned to them (a cancelled assignment grants nothing).
 */
export async function canViewCourseMaterials(db: PostgresDatabase, actor: ApiActor, course: Row) {
  if (isLearningAdmin(actor)) return true;
  if (Number(course.created_by_user_id) === actor.id) return true;
  const courseId = Number(course.id);
  if (actor.roleName === "Employee") {
    if (!actor.employeeId) return false;
    return Boolean(await db.prepare("SELECT 1 AS ok FROM training_enrollments WHERE course_id=? AND employee_id=? AND status!='cancelled'").bind(courseId, actor.employeeId).first());
  }
  if (actor.roleName === "Department Manager" && actor.employeeId) {
    return Boolean(await db.prepare(`${MANAGED_DEPARTMENTS_CTE} SELECT 1 AS ok FROM training_enrollments x JOIN employees emp ON emp.id=x.employee_id WHERE x.course_id=? AND x.status!='cancelled' AND (emp.department_id IN (SELECT id FROM managed) OR emp.id=?) LIMIT 1`).bind(actor.employeeId, courseId, actor.employeeId).first());
  }
  return true;
}

/** Adding or removing a material needs the create permission, and outside HR only the program's creator may do it. */
export async function requireMaterialManager(db: PostgresDatabase, actor: ApiActor, courseId: number) {
  await requireModule(db, actor, "learning", "create");
  const course = await db.prepare("SELECT id,status,created_by_user_id FROM training_courses WHERE id=?").bind(courseId).first<Row>();
  if (!course) throw new Response("Course not found", { status: 404 });
  if (!isLearningAdmin(actor) && Number(course.created_by_user_id) !== actor.id) throw new Response("Only HR or the program creator can manage materials", { status: 403 });
  return course;
}
