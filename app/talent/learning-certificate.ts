import type { ApiActor } from "../api/api-security";
import type { Db } from "./talent-service";
import { CERTIFICATE_ISSUER, CERTIFICATE_PREFIX, EVALUATION_CRITERIA, canApproveCertificate } from "./learning-evaluation";
import type { CertificateSnapshot, Evaluation } from "./learning-evaluation";

type Row = Record<string, unknown>;
type Person = { nameEn: string; nameAr: string };

const person = (row: Row | null | undefined): Person | null => (row?.name_en ? { nameEn: String(row.name_en), nameAr: String(row.name_ar || row.name_en) } : null);
const suffix = () => Array.from(crypto.getRandomValues(new Uint8Array(2)), byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase();

/** Employees who can still sign a certificate: not deleted or already gone. */
const SIGNER_STATUS_SQL = "('active','probation','notice_period')";

async function employeeName(db: Db, employeeId: unknown) {
  const id = Number(employeeId);
  if (!id) return null;
  return person(await db.prepare(`SELECT name_en,name_ar FROM employees WHERE id=? AND employment_status IN ${SIGNER_STATUS_SQL}`).bind(id).first<Row>());
}

/**
 * Freezes everything a certificate shows for a completed enrollment: the learner, the program, its instructor and the managers who
 * approve it. Runs on the caller's connection so it can join the completion transaction (this pool is one connection, so it must not
 * open another).
 */
export async function buildCertificate(
  db: Db,
  input: { enrollmentId: number; actor: ApiActor; today: string; completionDate: string; expiry: string | null; evaluation: Evaluation | null; score: number | null; certificateDetails?: unknown },
): Promise<CertificateSnapshot> {
  const row = await db
    .prepare(
      `SELECT x.employee_id,c.title,c.provider,c.course_type,c.start_date,c.end_date,c.validity_months,c.duration_hours,c.instructor_employee_id,c.instructor_name,
        e.employee_code,e.name_en,e.name_ar,e.manager_id,jt.name_en AS job_title_en,jt.name_ar AS job_title_ar,d.manager_employee_id AS department_manager_id
       FROM training_enrollments x JOIN training_courses c ON c.id=x.course_id JOIN employees e ON e.id=x.employee_id
       LEFT JOIN job_titles jt ON jt.id=e.job_title_id LEFT JOIN departments d ON d.id=e.department_id WHERE x.id=?`,
    )
    .bind(input.enrollmentId)
    .first<Row>();
  if (!row) throw new Response("Enrollment not found", { status: 404 });
  const learnerId = Number(row.employee_id);

  let instructor = row.instructor_employee_id ? await employeeName(db, row.instructor_employee_id) : row.instructor_name ? { nameEn: String(row.instructor_name), nameAr: String(row.instructor_name) } : null;
  let durationHours = row.duration_hours == null ? null : Number(row.duration_hours);
  if (input.certificateDetails !== undefined) {
    const details = (input.certificateDetails || {}) as Row;
    const name = String(details.instructorName ?? "").trim();
    const hours = Number(details.durationHours);
    if (typeof details.instructorName !== "string" || !name || name.length > 200 || !["number", "string"].includes(typeof details.durationHours) || !Number.isFinite(hours) || hours <= 0 || hours > 1000) throw new Response("Certificate instructor and duration are required", { status: 400 });
    // Preserve the internal instructor's bilingual name when the evaluator has not changed it.
    if (name !== instructor?.nameEn) instructor = { nameEn: name, nameAr: name };
    durationHours = hours;
  }

  // The learner's own department head approves; when the learner leads that department, the direct manager does.
  let departmentManager: Person | null = null;
  let departmentManagerId = 0;
  for (const candidate of [row.department_manager_id, row.manager_id]) {
    if (!Number(candidate) || Number(candidate) === learnerId) continue;
    departmentManager = await employeeName(db, candidate);
    if (departmentManager) { departmentManagerId = Number(candidate); break; }
  }

  // Names identify the requested approvers; only their explicit actions become signatures.
  const approvals: NonNullable<CertificateSnapshot["approvals"]> = [
    { role: "department_manager", employeeId: departmentManagerId || null, nameEn: departmentManager?.nameEn || "Department Manager", nameAr: departmentManager?.nameAr || "مدير الإدارة" },
    { role: "hr_manager", employeeId: null, nameEn: "HR Manager", nameAr: "مدير الموارد البشرية" },
  ];

  const overall = input.evaluation?.overall ?? input.score;
  return {
    version: 1,
    status: "pending",
    employeeId: learnerId,
    approvals,
    number: `${CERTIFICATE_PREFIX}-${input.completionDate.slice(0, 4)}-${String(input.enrollmentId).padStart(5, "0")}-${suffix()}`,
    issuedAt: input.today,
    issuer: CERTIFICATE_ISSUER,
    employee: {
      code: String(row.employee_code),
      nameEn: String(row.name_en),
      nameAr: String(row.name_ar || row.name_en),
      jobTitleEn: row.job_title_en ? String(row.job_title_en) : null,
      jobTitleAr: row.job_title_ar ? String(row.job_title_ar) : null,
    },
    program: {
      title: String(row.title),
      provider: row.provider ? String(row.provider) : null,
      courseType: String(row.course_type),
      durationHours,
      startDate: row.start_date ? String(row.start_date) : null,
      endDate: row.end_date ? String(row.end_date) : null,
      completionDate: input.completionDate,
      validityMonths: row.validity_months == null ? null : Number(row.validity_months),
    },
    instructor,
    signatories: [],
    result: {
      overall: overall == null ? null : Number(overall),
      grade: input.evaluation?.grade ?? null,
      criteria: input.evaluation ? EVALUATION_CRITERIA.map(criterion => ({ key: criterion.key, score: input.evaluation!.scores[criterion.key], weight: criterion.weight })) : null,
    },
    expiry: input.expiry,
  };
}

export async function saveCertificate(db: Db, enrollmentId: number, certificate: CertificateSnapshot) {
  await db
    .prepare("UPDATE training_enrollments SET certificate_number=?,certificate_json=?,certificate_issued_at=?::timestamptz,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(certificate.status === "pending" ? null : certificate.number, JSON.stringify(certificate), certificate.status === "pending" ? null : certificate.issuedAt, enrollmentId)
    .run();
}

export async function approveCertificate(db: Db, certificate: CertificateSnapshot, actor: ApiActor, role: string): Promise<CertificateSnapshot> {
  if (certificate.status !== "pending") return certificate;
  const approval = certificate.approvals?.find(item => item.role === role);
  if (!approval || !canApproveCertificate(approval, actor, certificate)) throw new Response("You cannot approve this certificate", { status: 403 });
  const signer = await employeeName(db, actor.employeeId);
  if (!signer) throw new Response("An active employee profile is required to approve certificates", { status: 409 });
  const approvedAt = new Date().toISOString();
  Object.assign(approval, signer, { approvedAt, userId: actor.id, employeeId: actor.employeeId });
  certificate.signatories.push({ role: approval.role, ...signer, approvedAt, userId: actor.id });
  if (certificate.approvals!.every(item => item.approvedAt)) {
    certificate.status = "issued";
    certificate.issuedAt = approvedAt.slice(0, 10);
  }
  return certificate;
}
