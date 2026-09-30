import { env } from "cloudflare:workers";
import {
  createDatabase,
  type PostgresDatabase,
  type TransactionDatabase,
} from "../../db/postgres";
import { createEmployeeRecord } from "../employees/employee-service";
import {
  apiFailure,
  enforceRateLimit,
  enforceWriteOrigin,
  requireActor,
} from "../api/api-security";
import {
  audit,
  body,
  notifyEmployee,
  number,
  required,
  requireModule,
  text,
  transition,
} from "../talent/talent-service";
import {
  canViewConsolidated,
  isRecruitmentAdmin,
  jobScopeSql,
  requireApplicationAccess,
  requireInterviewAccess,
  requireJobAccess,
} from "./recruitment-access";
import {
  candidateEvidence,
  consolidateEvaluations,
  matchCandidate,
  parseCvText,
  parseJson,
  safeCandidateObjectKey,
  stringList,
  validateCvFile,
  validateFairRequirements,
  validateRequirementWeights,
  validateScorecardWeights,
  type JsonRecord,
  type JobRequirement,
  type MatchingThresholds,
} from "./recruitment-service";

type Db = PostgresDatabase | TransactionDatabase;
type Row = Record<string, unknown>;
type R2ObjectLike = {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
  size?: number;
};
type R2BucketLike = {
  get(key: string): Promise<R2ObjectLike | null>;
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
};
const bucket = () => (env as unknown as { FILES?: R2BucketLike }).FILES,
  noStore = { "cache-control": "private, no-store" };
const offerMoves: Record<string, string[]> = {
  draft: ["sent"],
  sent: ["accepted", "rejected", "expired"],
  accepted: [],
  rejected: [],
  expired: [],
};
const allowedJobStatuses = ["draft", "open", "on_hold", "closed", "cancelled"],
  asRows = (value: unknown) =>
    Array.isArray(value) ? (value as JsonRecord[]) : [],
  clampPage = (value: string | null) => Math.max(1, Number(value) || 1),
  clampLimit = (value: string | null, max = 100) =>
    Math.min(max, Math.max(1, Number(value) || 25)),
  ids = (value: unknown) =>
    Array.isArray(value)
      ? [
          ...new Set(
            value.map(Number).filter((id) => Number.isInteger(id) && id > 0),
          ),
        ]
      : [];

function recruitmentSettings(row?: { value_json: string } | null) {
  const value = parseJson<JsonRecord>(row?.value_json, {}),
    thresholds = (value.thresholds as JsonRecord) || {};
  return {
    thresholds: {
      strong: Number(thresholds.strong) || 85,
      good: Number(thresholds.good) || 70,
      review: Number(thresholds.review) || 50,
    } as MatchingThresholds,
    cvWeight: Number(value.cvWeight) || 40,
    interviewWeight: Number(value.interviewWeight) || 60,
  };
}
async function options(
  db: Db,
  actor: Awaited<ReturnType<typeof requireActor>>,
) {
  const employees = (
      await db
        .prepare(
          "SELECT e.id,e.employee_code,e.name_en,e.name_ar,e.department_id,e.manager_id,r.name AS role_name FROM employees e LEFT JOIN users u ON u.employee_id=e.id AND u.status='active' LEFT JOIN roles r ON r.id=u.role_id WHERE e.employment_status IN ('active','probation','notice_period') ORDER BY e.name_en LIMIT 2000",
        )
        .all()
    ).results,
    departments = (
      await db
        .prepare(
          "SELECT id,name_en,name_ar,manager_employee_id,parent_id FROM departments WHERE status='active' ORDER BY name_en",
        )
        .all()
    ).results,
    templates = isRecruitmentAdmin(actor)
      ? (
          await db
            .prepare(
              "SELECT id,name,scope_type,department_id,job_family,job_id,status FROM interview_templates WHERE status='active' ORDER BY scope_type,name",
            )
            .all()
        ).results
      : [];
  return {
    employees,
    departments,
    templates,
    currentActor: {
      id: actor.id,
      employeeId: actor.employeeId,
      roleName: actor.roleName,
    },
    permissions: {
      canAdmin: isRecruitmentAdmin(actor),
      canCreate:
        isRecruitmentAdmin(actor) || actor.roleName === "Department Manager",
      canSetup: isRecruitmentAdmin(actor),
    },
  };
}

async function loadOverview(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
) {
  const scope = jobScopeSql(actor),
    today = new Date().toISOString().slice(0, 10),
    [
      jobCounts,
      applicationCounts,
      interviewCounts,
      offerCounts,
      jobs,
      myInterviews,
      opts,
    ] = await Promise.all([
      db
        .prepare(
          `SELECT COUNT(*) FILTER(WHERE j.status='open')::int AS open_jobs,COUNT(*)::int AS total_jobs FROM job_openings j WHERE ${scope.sql}`,
        )
        .bind(...scope.args)
        .first<Row>(),
      db
        .prepare(
          `SELECT COUNT(*) FILTER(WHERE a.status IN ('active','on_hold','offer'))::int AS active_candidates,COUNT(*) FILTER(WHERE a.applied_at>=CURRENT_TIMESTAMP-INTERVAL '7 days')::int AS new_candidates,COUNT(*) FILTER(WHERE s.stage_type='shortlist' AND a.status='active')::int AS shortlisted,COUNT(*) FILTER(WHERE s.stage_type='review' AND a.status='active')::int AS decisions_required,COUNT(*) FILTER(WHERE s.stage_type='screening' AND a.status='active')::int AS screening_queue FROM candidate_applications a JOIN job_openings j ON j.id=a.job_id LEFT JOIN recruitment_stages s ON s.id=a.current_stage_id WHERE ${scope.sql}`,
        )
        .bind(...scope.args)
        .first<Row>(),
      db
        .prepare(
          `SELECT COUNT(DISTINCT i.id) FILTER(WHERE i.scheduled_at::date=CURRENT_DATE AND i.status='scheduled')::int AS today,COUNT(DISTINCT p.id) FILTER(WHERE i.status IN ('scheduled','completed') AND e.id IS NULL)::int AS pending_evaluations FROM interviews i JOIN candidate_applications a ON a.id=i.application_id JOIN job_openings j ON j.id=a.job_id JOIN interview_participants p ON p.interview_id=i.id AND p.required=1 LEFT JOIN interview_evaluations e ON e.interview_id=i.id AND e.interviewer_employee_id=p.employee_id AND e.status='submitted' WHERE ${scope.sql}`,
        )
        .bind(...scope.args)
        .first<Row>(),
      db
        .prepare(
          `SELECT COUNT(*) FILTER(WHERE o.status IN ('draft','sent') OR o.approval_status='pending')::int AS pending_offers FROM job_offers o JOIN job_openings j ON j.id=o.job_id WHERE ${scope.sql}`,
        )
        .bind(...scope.args)
        .first<Row>(),
      db
        .prepare(
          `SELECT j.id,j.title,j.location,j.employment_type,j.openings_count,j.status,j.created_date,j.closing_date,d.name_en AS department_name,d.name_ar AS department_name_ar,hm.name_en AS hiring_manager_name,hm.name_ar AS hiring_manager_name_ar,r.name_en AS recruiter_name,r.name_ar AS recruiter_name_ar,COUNT(a.id)::int AS applicants,COUNT(a.id) FILTER(WHERE s.stage_type='shortlist')::int AS shortlisted,COUNT(a.id) FILTER(WHERE s.stage_type='interview')::int AS in_interview,COUNT(a.id) FILTER(WHERE s.stage_type='offer')::int AS offers FROM job_openings j LEFT JOIN departments d ON d.id=j.department_id LEFT JOIN employees hm ON hm.id=j.hiring_manager_employee_id LEFT JOIN employees r ON r.id=j.recruiter_employee_id LEFT JOIN candidate_applications a ON a.job_id=j.id LEFT JOIN recruitment_stages s ON s.id=a.current_stage_id WHERE ${scope.sql} GROUP BY j.id,d.name_en,d.name_ar,hm.name_en,hm.name_ar,r.name_en,r.name_ar ORDER BY CASE j.status WHEN 'open' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,j.created_at DESC LIMIT 50`,
        )
        .bind(...scope.args)
        .all(),
      actor.employeeId
        ? db
            .prepare(
              "SELECT i.id,i.scheduled_at,i.duration_minutes,i.status,c.name AS candidate_name,j.title AS job_title,ps.name_en AS stage_name,ps.name_ar AS stage_name_ar,COALESCE(e.status,'pending') AS evaluation_status FROM interview_participants p JOIN interviews i ON i.id=p.interview_id JOIN candidate_applications a ON a.id=i.application_id JOIN candidates c ON c.id=a.candidate_id JOIN job_openings j ON j.id=a.job_id LEFT JOIN interview_plan_stages ps ON ps.id=i.plan_stage_id LEFT JOIN interview_evaluations e ON e.interview_id=i.id AND e.interviewer_employee_id=p.employee_id WHERE p.employee_id=? AND (i.scheduled_at::date>=CURRENT_DATE OR e.status IS NULL OR e.status='draft') ORDER BY i.scheduled_at LIMIT 30",
            )
            .bind(actor.employeeId)
            .all()
        : Promise.resolve({ results: [] }),
      options(db, actor),
    ]);
  const kpis = {
      ...jobCounts,
      ...applicationCounts,
      ...interviewCounts,
      ...offerCounts,
    },
    actionRequired = [
      {
        kind: "screening",
        count: Number(applicationCounts?.screening_queue || 0),
        target: "candidates",
      },
      {
        kind: "interviews_today",
        count: Number(interviewCounts?.today || 0),
        target: "interviews",
      },
      {
        kind: "feedback",
        count: Number(interviewCounts?.pending_evaluations || 0),
        target: "interviews",
      },
      {
        kind: "offers",
        count: Number(offerCounts?.pending_offers || 0),
        target: "candidates",
      },
      {
        kind: "decisions",
        count: Number(applicationCounts?.decisions_required || 0),
        target: "candidates",
      },
    ].filter((item) => item.count > 0);
  return {
    view: "overview",
    today,
    kpis,
    jobs: jobs.results,
    actionRequired,
    myInterviews: myInterviews.results,
    ...opts,
  };
}

async function loadJobs(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  url: URL,
) {
  const scope = jobScopeSql(actor),
    where = [scope.sql],
    args = [...scope.args],
    search = text(url.searchParams.get("search"), 120),
    status = text(url.searchParams.get("status"), 40),
    department = Number(url.searchParams.get("department")),
    manager = Number(url.searchParams.get("manager")),
    recruiter = Number(url.searchParams.get("recruiter")),
    location = text(url.searchParams.get("location"), 120);
  if (search) {
    where.push(
      "(j.title ILIKE ? OR j.location ILIKE ? OR d.name_en ILIKE ? OR d.name_ar ILIKE ?)",
    );
    args.push(...Array(4).fill(`%${search}%`));
  }
  if (status) {
    where.push("j.status=?");
    args.push(status);
  }
  if (department) {
    where.push("j.department_id=?");
    args.push(department);
  }
  if (manager) {
    where.push("j.hiring_manager_employee_id=?");
    args.push(manager);
  }
  if (recruiter) {
    where.push("j.recruiter_employee_id=?");
    args.push(recruiter);
  }
  if (location) {
    where.push("j.location ILIKE ?");
    args.push(`%${location}%`);
  }
  const page = clampPage(url.searchParams.get("page")),
    limit = clampLimit(url.searchParams.get("limit")),
    offset = (page - 1) * limit,
    rows = await db
      .prepare(
        `SELECT j.*,d.name_en AS department_name,d.name_ar AS department_name_ar,hm.name_en AS hiring_manager_name,hm.name_ar AS hiring_manager_name_ar,r.name_en AS recruiter_name,r.name_ar AS recruiter_name_ar,COUNT(a.id)::int AS applicants,COUNT(a.id) FILTER(WHERE s.stage_type='shortlist')::int AS shortlisted,COUNT(a.id) FILTER(WHERE s.stage_type='interview')::int AS in_interview,COUNT(a.id) FILTER(WHERE s.stage_type='offer')::int AS offers,COUNT(*) OVER()::int AS total_count FROM job_openings j LEFT JOIN departments d ON d.id=j.department_id LEFT JOIN employees hm ON hm.id=j.hiring_manager_employee_id LEFT JOIN employees r ON r.id=j.recruiter_employee_id LEFT JOIN candidate_applications a ON a.job_id=j.id LEFT JOIN recruitment_stages s ON s.id=a.current_stage_id WHERE ${where.join(" AND ")} GROUP BY j.id,d.name_en,d.name_ar,hm.name_en,hm.name_ar,r.name_en,r.name_ar ORDER BY j.created_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(...args, limit, offset)
      .all();
  return {
    view: "jobs",
    jobs: rows.results,
    page,
    limit,
    total: Number(rows.results[0]?.total_count || 0),
    ...(await options(db, actor)),
  };
}

async function loadCandidates(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  url: URL,
) {
  const scope = jobScopeSql(actor),
    where = [scope.sql, "c.merged_into_candidate_id IS NULL"],
    args = [...scope.args],
    search = text(url.searchParams.get("search"), 120),
    job = Number(url.searchParams.get("job")),
    department = Number(url.searchParams.get("department")),
    stage = text(url.searchParams.get("stage"), 80),
    recruiter = Number(url.searchParams.get("recruiter")),
    minMatch = Number(url.searchParams.get("minMatch")),
    maxMatch = Number(url.searchParams.get("maxMatch"));
  if (search) {
    where.push(
      "(c.name ILIKE ? OR c.email ILIKE ? OR c.current_job_title ILIKE ?)",
    );
    args.push(...Array(3).fill(`%${search}%`));
  }
  if (job) {
    where.push("a.job_id=?");
    args.push(job);
  }
  if (department) {
    where.push("j.department_id=?");
    args.push(department);
  }
  if (stage) {
    where.push("(s.stage_key=? OR a.status=?)");
    args.push(stage, stage);
  }
  if (recruiter) {
    where.push("a.recruiter_employee_id=?");
    args.push(recruiter);
  }
  if (minMatch) {
    where.push("COALESCE(m.overall_score,0)>=?");
    args.push(minMatch);
  }
  if (maxMatch) {
    where.push("COALESCE(m.overall_score,0)<=?");
    args.push(maxMatch);
  }
  const page = clampPage(url.searchParams.get("page")),
    limit = clampLimit(url.searchParams.get("limit")),
    offset = (page - 1) * limit,
    rows = await db
      .prepare(
        `SELECT a.id AS application_id,a.status AS application_status,a.applied_at,a.stage_entered_at,a.recruiter_employee_id,c.id AS candidate_id,c.name,c.email,c.phone,c.location,c.current_job_title,c.current_company,c.total_experience,j.id AS job_id,j.title AS job_title,j.department_id,d.name_en AS department_name,d.name_ar AS department_name_ar,s.id AS stage_id,s.stage_key,s.name_en AS stage_name,s.name_ar AS stage_name_ar,s.sort_order AS stage_order,m.overall_score,m.classification,m.created_at AS match_created_at,CASE WHEN m.id IS NULL THEN 0 WHEN m.job_requirements_version<>j.requirements_version OR m.candidate_profile_version<>c.profile_version OR m.cv_document_version<>COALESCE(cv.version,0) THEN 1 ELSE 0 END AS match_stale,ni.scheduled_at AS next_interview,EXTRACT(day FROM CURRENT_TIMESTAMP-a.stage_entered_at)::int AS days_in_stage,COUNT(*) OVER()::int AS total_count FROM candidate_applications a JOIN candidates c ON c.id=a.candidate_id JOIN job_openings j ON j.id=a.job_id LEFT JOIN departments d ON d.id=j.department_id LEFT JOIN recruitment_stages s ON s.id=a.current_stage_id LEFT JOIN LATERAL (SELECT * FROM candidate_match_results x WHERE x.application_id=a.id ORDER BY x.created_at DESC LIMIT 1) m ON true LEFT JOIN LATERAL (SELECT version FROM candidate_documents x WHERE x.candidate_id=c.id AND x.document_type='cv' ORDER BY version DESC LIMIT 1) cv ON true LEFT JOIN LATERAL (SELECT scheduled_at FROM interviews x WHERE x.application_id=a.id AND x.status='scheduled' AND x.scheduled_at>=CURRENT_TIMESTAMP ORDER BY x.scheduled_at LIMIT 1) ni ON true WHERE ${where.join(" AND ")} ORDER BY a.updated_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(...args, limit, offset)
      .all();
  return {
    view: "candidates",
    candidates: rows.results,
    page,
    limit,
    total: Number(rows.results[0]?.total_count || 0),
    ...(await options(db, actor)),
  };
}

async function loadInterviews(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  url: URL,
) {
  const scope = jobScopeSql(actor),
    args: unknown[] = [actor.employeeId || 0],
    where = [
      isRecruitmentAdmin(actor)
        ? "1=1"
        : `(${scope.sql} OR mine.id IS NOT NULL)`,
    ];
  if (!isRecruitmentAdmin(actor)) args.push(...scope.args);
  const status = text(url.searchParams.get("status"), 40),
    date = text(url.searchParams.get("date"), 10),
    job = Number(url.searchParams.get("job")),
    stage = Number(url.searchParams.get("stage")),
    interviewer = Number(url.searchParams.get("interviewer"));
  if (status) {
    if (status === "awaiting_feedback")
      where.push(
        "i.status IN ('scheduled','completed') AND mine.id IS NOT NULL AND COALESCE(me.status,'pending')<>'submitted'",
      );
    else {
      where.push("i.status=?");
      args.push(status);
    }
  }
  if (date) {
    where.push("i.scheduled_at::date=?::date");
    args.push(date);
  }
  if (job) {
    where.push("j.id=?");
    args.push(job);
  }
  if (stage) {
    where.push("i.plan_stage_id=?");
    args.push(stage);
  }
  if (interviewer) {
    where.push(
      "EXISTS (SELECT 1 FROM interview_participants px WHERE px.interview_id=i.id AND px.employee_id=?)",
    );
    args.push(interviewer);
  }
  const rows = await db
    .prepare(
      `SELECT i.id,i.application_id,i.scheduled_at,i.end_at,i.duration_minutes,i.meeting_method,i.location,i.status,c.id AS candidate_id,c.name AS candidate_name,j.id AS job_id,j.title AS job_title,d.name_en AS department_name,d.name_ar AS department_name_ar,ps.id AS plan_stage_id,ps.name_en AS stage_name,ps.name_ar AS stage_name_ar,mine.id AS my_participant_id,COALESCE(me.status,'pending') AS my_evaluation_status,(SELECT COUNT(*)::int FROM interview_participants p WHERE p.interview_id=i.id) AS interviewer_count,(SELECT COUNT(*)::int FROM interview_evaluations e WHERE e.interview_id=i.id AND e.status='submitted') AS submitted_count FROM interviews i JOIN candidate_applications a ON a.id=i.application_id JOIN candidates c ON c.id=a.candidate_id JOIN job_openings j ON j.id=a.job_id LEFT JOIN departments d ON d.id=j.department_id LEFT JOIN interview_plan_stages ps ON ps.id=i.plan_stage_id LEFT JOIN interview_participants mine ON mine.interview_id=i.id AND mine.employee_id=? LEFT JOIN interview_evaluations me ON me.interview_id=i.id AND me.interviewer_employee_id=mine.employee_id WHERE ${where.join(" AND ")} ORDER BY CASE WHEN i.scheduled_at>=CURRENT_TIMESTAMP THEN 0 ELSE 1 END,i.scheduled_at LIMIT 300`,
    )
    .bind(...args)
    .all();
  return {
    view: "interviews",
    interviews: rows.results,
    ...(await options(db, actor)),
  };
}

async function loadJob(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  jobId: number,
) {
  await requireJobAccess(db, actor, jobId);
  const [
    job,
    requirements,
    screening,
    stages,
    applications,
    planStages,
    planInterviewers,
    planQuestions,
    criteria,
    activity,
    opts,
  ] = await Promise.all([
    db
      .prepare(
        "SELECT j.*,d.name_en AS department_name,d.name_ar AS department_name_ar,hm.name_en AS hiring_manager_name,hm.name_ar AS hiring_manager_name_ar,r.name_en AS recruiter_name,r.name_ar AS recruiter_name_ar FROM job_openings j LEFT JOIN departments d ON d.id=j.department_id LEFT JOIN employees hm ON hm.id=j.hiring_manager_employee_id LEFT JOIN employees r ON r.id=j.recruiter_employee_id WHERE j.id=?",
      )
      .bind(jobId)
      .first<Row>(),
    db
      .prepare(
        "SELECT * FROM job_requirements WHERE job_id=? AND active=1 AND version=(SELECT requirements_version FROM job_openings WHERE id=?) ORDER BY sort_order,id",
      )
      .bind(jobId, jobId)
      .all(),
    db
      .prepare(
        "SELECT * FROM job_screening_questions WHERE job_id=? ORDER BY sort_order,id",
      )
      .bind(jobId)
      .all(),
    db
      .prepare(
        "SELECT * FROM recruitment_stages WHERE job_id=? AND active=1 ORDER BY sort_order",
      )
      .bind(jobId)
      .all(),
    db
      .prepare(
        "SELECT a.id AS application_id,a.status,c.id AS candidate_id,c.name,c.email,s.stage_key,s.name_en AS stage_name,s.name_ar AS stage_name_ar,m.overall_score,m.classification,a.updated_at FROM candidate_applications a JOIN candidates c ON c.id=a.candidate_id LEFT JOIN recruitment_stages s ON s.id=a.current_stage_id LEFT JOIN LATERAL (SELECT * FROM candidate_match_results x WHERE x.application_id=a.id ORDER BY x.created_at DESC LIMIT 1) m ON true WHERE a.job_id=? ORDER BY a.updated_at DESC LIMIT 200",
      )
      .bind(jobId)
      .all(),
    db
      .prepare(
        "SELECT ps.*,p.source_template_id,p.name AS plan_name,p.version AS plan_version FROM interview_plans p JOIN interview_plan_stages ps ON ps.plan_id=p.id WHERE p.job_id=? AND p.status='active' ORDER BY ps.sort_order",
      )
      .bind(jobId)
      .all(),
    db
      .prepare(
        "SELECT x.*,e.name_en AS employee_name,e.name_ar AS employee_name_ar FROM interview_stage_interviewers x JOIN interview_plan_stages ps ON ps.id=x.plan_stage_id JOIN interview_plans p ON p.id=ps.plan_id LEFT JOIN employees e ON e.id=x.employee_id WHERE p.job_id=? AND p.status='active' ORDER BY ps.sort_order,x.id",
      )
      .bind(jobId)
      .all(),
    db
      .prepare(
        "SELECT x.plan_stage_id,x.question_id,x.sort_order,x.required,q.question,q.what_good_looks_like,q.evaluation_guidance,q.question_type FROM interview_stage_questions x JOIN interview_questions q ON q.id=x.question_id JOIN interview_plan_stages ps ON ps.id=x.plan_stage_id JOIN interview_plans p ON p.id=ps.plan_id WHERE p.job_id=? AND p.status='active' ORDER BY ps.sort_order,x.sort_order",
      )
      .bind(jobId)
      .all(),
    db
      .prepare(
        "SELECT c.* FROM interview_scorecard_criteria c JOIN interview_plan_stages ps ON ps.id=c.plan_stage_id JOIN interview_plans p ON p.id=ps.plan_id WHERE p.job_id=? AND p.status='active' ORDER BY ps.sort_order,c.sort_order",
      )
      .bind(jobId)
      .all(),
    db
      .prepare(
        "SELECT a.*,u.email AS actor_email FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.module='recruitment' AND ((a.record_type='job_opening' AND a.record_id=?) OR a.new_value LIKE ?) ORDER BY a.created_at DESC LIMIT 100",
      )
      .bind(String(jobId), `%"jobId":${jobId}%`)
      .all(),
    options(db, actor),
  ]);
  if (!job) throw new Response("Job not found", { status: 404 });
  return {
    view: "job",
    job,
    requirements: requirements.results,
    screeningQuestions: screening.results,
    stages: stages.results,
    applications: applications.results,
    planStages: planStages.results,
    planInterviewers: planInterviewers.results,
    planQuestions: planQuestions.results,
    scorecardCriteria: criteria.results,
    activity: activity.results,
    ...opts,
  };
}

async function loadCandidate(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  candidateId: number,
  applicationId: number,
) {
  const application = await requireApplicationAccess(db, actor, applicationId);
  if (Number(application.candidate_id) !== candidateId)
    throw new Response("Candidate does not belong to this application", {
      status: 400,
    });
  const consolidatedAllowed = await canViewConsolidated(
      db,
      actor,
      applicationId,
    ),
    [
      candidate,
      applications,
      selected,
      documents,
      parsed,
      match,
      scores,
      interviews,
      evaluations,
      stages,
      planStages,
      offers,
      matchingSetting,
      history,
      activity,
      opts,
    ] = await Promise.all([
      db
        .prepare(
          "SELECT * FROM candidates WHERE id=? AND merged_into_candidate_id IS NULL",
        )
        .bind(candidateId)
        .first<Row>(),
      db
        .prepare(
          "SELECT a.*,j.title AS job_title,s.stage_key,s.name_en AS stage_name,s.name_ar AS stage_name_ar,m.overall_score,m.classification FROM candidate_applications a JOIN job_openings j ON j.id=a.job_id LEFT JOIN recruitment_stages s ON s.id=a.current_stage_id LEFT JOIN LATERAL (SELECT * FROM candidate_match_results x WHERE x.application_id=a.id ORDER BY x.created_at DESC LIMIT 1) m ON true WHERE a.candidate_id=? ORDER BY a.applied_at DESC",
        )
        .bind(candidateId)
        .all(),
      db
        .prepare(
          "SELECT a.*,j.title AS job_title,j.requirements_version,j.department_id,j.hiring_manager_employee_id,s.stage_key,s.name_en AS stage_name,s.name_ar AS stage_name_ar FROM candidate_applications a JOIN job_openings j ON j.id=a.job_id LEFT JOIN recruitment_stages s ON s.id=a.current_stage_id WHERE a.id=?",
        )
        .bind(applicationId)
        .first<Row>(),
      db
        .prepare(
          "SELECT id,name,content_type,size_bytes,version,parsing_status,parsing_confidence,parsing_error,created_at FROM candidate_documents WHERE candidate_id=? ORDER BY version DESC,id DESC",
        )
        .bind(candidateId)
        .all(),
      db
        .prepare(
          "SELECT p.*,d.version AS document_version,d.name AS document_name FROM candidate_cv_parsed_data p JOIN candidate_documents d ON d.id=p.document_id WHERE d.candidate_id=? ORDER BY d.version DESC LIMIT 1",
        )
        .bind(candidateId)
        .first<Row>(),
      db
        .prepare(
          "SELECT m.*,CASE WHEN m.job_requirements_version<>j.requirements_version OR m.candidate_profile_version<>c.profile_version OR m.cv_document_version<>COALESCE(d.version,0) THEN 1 ELSE 0 END AS is_stale FROM candidate_match_results m JOIN candidate_applications a ON a.id=m.application_id JOIN job_openings j ON j.id=a.job_id JOIN candidates c ON c.id=a.candidate_id LEFT JOIN LATERAL (SELECT version FROM candidate_documents x WHERE x.candidate_id=c.id AND x.document_type='cv' ORDER BY version DESC LIMIT 1) d ON true WHERE m.application_id=? ORDER BY m.created_at DESC LIMIT 1",
        )
        .bind(applicationId)
        .first<Row>(),
      db
        .prepare(
          "SELECT s.*,r.name AS requirement_name,r.category,r.weight,r.priority FROM candidate_requirement_scores s JOIN job_requirements r ON r.id=s.requirement_id WHERE s.match_result_id=(SELECT id FROM candidate_match_results WHERE application_id=? ORDER BY created_at DESC LIMIT 1) ORDER BY r.sort_order",
        )
        .bind(applicationId)
        .all(),
      db
        .prepare(
          "SELECT i.*,ps.name_en AS stage_name,ps.name_ar AS stage_name_ar,(SELECT COUNT(*)::int FROM interview_participants p WHERE p.interview_id=i.id) AS interviewer_count,(SELECT COUNT(*)::int FROM interview_evaluations e WHERE e.interview_id=i.id AND e.status='submitted') AS submitted_count FROM interviews i LEFT JOIN interview_plan_stages ps ON ps.id=i.plan_stage_id WHERE i.application_id=? ORDER BY i.scheduled_at DESC",
        )
        .bind(applicationId)
        .all(),
      consolidatedAllowed
        ? db
            .prepare(
              "SELECT e.id,e.interview_id,e.interviewer_employee_id,e.notes,e.recommendation,e.overall_score,e.status,e.submitted_at,emp.name_en AS interviewer_name,emp.name_ar AS interviewer_name_ar,ps.id AS plan_stage_id,ps.name_en AS stage_name,ps.name_ar AS stage_name_ar FROM interview_evaluations e JOIN interviews i ON i.id=e.interview_id JOIN employees emp ON emp.id=e.interviewer_employee_id LEFT JOIN interview_plan_stages ps ON ps.id=i.plan_stage_id WHERE i.application_id=? AND e.status='submitted' ORDER BY i.scheduled_at,e.id",
            )
            .bind(applicationId)
            .all()
        : Promise.resolve({ results: [] }),
      db
        .prepare(
          "SELECT * FROM recruitment_stages WHERE job_id=? AND active=1 ORDER BY sort_order",
        )
        .bind(application.job_id)
        .all(),
      db
        .prepare(
          "SELECT ps.* FROM interview_plan_stages ps JOIN interview_plans p ON p.id=ps.plan_id WHERE p.job_id=? AND p.status='active' ORDER BY ps.sort_order",
        )
        .bind(application.job_id)
        .all(),
      db
        .prepare(
          "SELECT * FROM job_offers WHERE application_id=? ORDER BY created_at DESC",
        )
        .bind(applicationId)
        .all(),
      db
        .prepare(
          "SELECT value_json FROM system_settings WHERE setting_key='recruitment_matching'",
        )
        .first<{ value_json: string }>(),
      db
        .prepare(
          "SELECT h.*,fs.name_en AS from_stage_name,fs.name_ar AS from_stage_name_ar,ts.name_en AS to_stage_name,ts.name_ar AS to_stage_name_ar,u.email AS actor_email FROM candidate_stage_history h LEFT JOIN recruitment_stages fs ON fs.id=h.from_stage_id JOIN recruitment_stages ts ON ts.id=h.to_stage_id LEFT JOIN users u ON u.id=h.actor_user_id WHERE h.application_id=? ORDER BY h.created_at DESC",
        )
        .bind(applicationId)
        .all(),
      db
        .prepare(
          "SELECT a.*,u.email AS actor_email FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.module='recruitment' AND ((a.record_type='candidate' AND a.record_id=?) OR (a.record_type='candidate_application' AND a.record_id=?)) ORDER BY a.created_at DESC LIMIT 150",
        )
        .bind(String(candidateId), String(applicationId))
        .all(),
      options(db, actor),
    ]);
  if (!candidate || !selected)
    throw new Response("Candidate not found", { status: 404 });
  const evaluationSettings = recruitmentSettings(matchingSetting);
  const evaluationSummary = consolidateEvaluations(
    planStages.results.map((stage) => {
      const stageInterviews = interviews.results.filter(
        (item) => Number(item.plan_stage_id) === Number(stage.id),
      );
      const submitted = evaluations.results.filter(
        (item) => Number(item.plan_stage_id) === Number(stage.id),
      );
      const requiredCount = stageInterviews.reduce(
        (sum, item) => sum + Number(item.interviewer_count || 0),
        0,
      );
      return {
        id: Number(stage.id),
        name: String(stage.name_en),
        aggregationWeight: Number(stage.aggregation_weight),
        evaluations: [
          ...submitted.map((item) => ({
            overallScore: Number(item.overall_score),
            submitted: true,
            required: true,
          })),
          ...Array(Math.max(0, requiredCount - submitted.length))
            .fill(null)
            .map(() => ({ overallScore: 0, submitted: false, required: true })),
        ],
      };
    }),
    Number(match?.overall_score || 0),
    {
      cvWeight: evaluationSettings.cvWeight,
      interviewWeight: evaluationSettings.interviewWeight,
    },
  );
  return {
    ...opts,
    view: "candidate",
    candidate,
    applications: applications.results,
    application: selected,
    documents: documents.results,
    parsedCv: parsed
      ? {
          ...parsed,
          extracted: parseJson(parsed.extracted_json, {}),
          corrected: parseJson(parsed.corrected_json, {}),
        }
      : null,
    match: match
      ? {
          ...match,
          strong_matches: parseJson(match.strong_matches_json, []),
          partial_matches: parseJson(match.partial_matches_json, []),
          missing_requirements: parseJson(match.missing_requirements_json, []),
          concerns: parseJson(match.concerns_json, []),
          suggested_questions: parseJson(match.suggested_questions_json, []),
        }
      : null,
    requirementScores: scores.results,
    interviews: interviews.results,
    evaluations: evaluations.results,
    stages: stages.results,
    planStages: planStages.results,
    offers: offers.results,
    evaluationSummary,
    stageHistory: history.results,
    activity: activity.results,
    permissions: {
      ...opts.permissions,
      canViewConsolidated: consolidatedAllowed,
    },
  };
}

async function loadInterview(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  interviewId: number,
) {
  await requireInterviewAccess(db, actor, interviewId);
  const context = await db
    .prepare(
      "SELECT i.*,a.job_id,a.candidate_id,a.current_stage_id,a.status AS application_status,c.name AS candidate_name,c.email,c.phone,c.location AS candidate_location,c.current_job_title,c.current_company,c.total_experience,c.skills_json,c.languages_json,j.title AS job_title,j.summary AS job_summary,j.hiring_manager_employee_id,j.recruiter_employee_id,ps.name_en AS stage_name,ps.name_ar AS stage_name_ar,ps.passing_guidance,ps.required_feedback,ps.independent_evaluations,m.overall_score AS match_score,m.classification,m.concerns_json,m.suggested_questions_json FROM interviews i JOIN candidate_applications a ON a.id=i.application_id JOIN candidates c ON c.id=a.candidate_id JOIN job_openings j ON j.id=a.job_id LEFT JOIN interview_plan_stages ps ON ps.id=i.plan_stage_id LEFT JOIN LATERAL (SELECT * FROM candidate_match_results x WHERE x.application_id=a.id ORDER BY x.created_at DESC LIMIT 1) m ON true WHERE i.id=?",
    )
    .bind(interviewId)
    .first<Row>();
  if (!context) throw new Response("Interview not found", { status: 404 });
  const participant = actor.employeeId
      ? await db
          .prepare(
            "SELECT * FROM interview_participants WHERE interview_id=? AND employee_id=?",
          )
          .bind(interviewId, actor.employeeId)
          .first<Row>()
      : null,
    [questions, criteria, requirements, myEvaluation, myScores, participants] =
      await Promise.all([
        db
          .prepare(
            "SELECT q.*,x.required,x.sort_order FROM interview_stage_questions x JOIN interview_questions q ON q.id=x.question_id WHERE x.plan_stage_id=? ORDER BY x.sort_order",
          )
          .bind(context.plan_stage_id)
          .all(),
        db
          .prepare(
            "SELECT * FROM interview_scorecard_criteria WHERE plan_stage_id=? ORDER BY sort_order",
          )
          .bind(context.plan_stage_id)
          .all(),
        db
          .prepare(
            "SELECT r.*,s.score,s.evidence_status,s.evidence,s.rationale FROM job_requirements r LEFT JOIN LATERAL (SELECT rs.* FROM candidate_requirement_scores rs JOIN candidate_match_results m ON m.id=rs.match_result_id WHERE rs.requirement_id=r.id AND m.application_id=? ORDER BY m.created_at DESC LIMIT 1) s ON true WHERE r.job_id=? AND r.active=1 AND r.version=(SELECT requirements_version FROM job_openings WHERE id=?) ORDER BY r.sort_order",
          )
          .bind(context.application_id, context.job_id, context.job_id)
          .all(),
        participant
          ? db
              .prepare(
                "SELECT * FROM interview_evaluations WHERE interview_id=? AND interviewer_employee_id=?",
              )
              .bind(interviewId, actor.employeeId)
              .first<Row>()
          : Promise.resolve(null),
        participant
          ? db
              .prepare(
                "SELECT s.* FROM interview_evaluation_scores s JOIN interview_evaluations e ON e.id=s.evaluation_id WHERE e.interview_id=? AND e.interviewer_employee_id=?",
              )
              .bind(interviewId, actor.employeeId)
              .all()
          : Promise.resolve({ results: [] }),
        db
          .prepare(
            "SELECT p.id,p.employee_id,p.required,p.status,e.name_en,e.name_ar,COALESCE(v.status,'pending') AS evaluation_status FROM interview_participants p JOIN employees e ON e.id=p.employee_id LEFT JOIN interview_evaluations v ON v.interview_id=p.interview_id AND v.interviewer_employee_id=p.employee_id WHERE p.interview_id=? ORDER BY p.id",
          )
          .bind(interviewId)
          .all(),
      ]),
    canConsolidate = await canViewConsolidated(
      db,
      actor,
      Number(context.application_id),
    ),
    allSubmitted = participants.results
      .filter((item) => Number(item.required))
      .every((item) => item.evaluation_status === "submitted"),
    others =
      canConsolidate && allSubmitted
        ? (
            await db
              .prepare(
                "SELECT e.*,p.name_en AS interviewer_name,p.name_ar AS interviewer_name_ar FROM interview_evaluations e JOIN employees p ON p.id=e.interviewer_employee_id WHERE e.interview_id=? AND e.status='submitted' ORDER BY e.id",
              )
              .bind(interviewId)
              .all()
          ).results
        : [];
  return {
    ...(await options(db, actor)),
    view: "interview",
    interview: {
      ...context,
      skills: stringList(context.skills_json),
      languages: stringList(context.languages_json),
      concerns: parseJson(context.concerns_json, []),
      suggestedQuestions: parseJson(context.suggested_questions_json, []),
    },
    questions: questions.results,
    criteria: criteria.results,
    requirements: requirements.results,
    participant,
    myEvaluation: myEvaluation
      ? { ...myEvaluation, scores: myScores.results }
      : null,
    participants: participants.results,
    otherEvaluations: others,
    permissions: {
      canEvaluate: Boolean(participant),
      canViewConsolidated: canConsolidate && allSubmitted,
    },
  };
}

async function loadSetup(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
) {
  if (!isRecruitmentAdmin(actor))
    throw new Response("Interview setup is restricted to HR administrators", {
      status: 403,
    });
  const [
    templates,
    templateStages,
    templateInterviewers,
    templateQuestions,
    templateCriteria,
    questions,
    opts,
  ] = await Promise.all([
    db
      .prepare(
        "SELECT t.*,d.name_en AS department_name,d.name_ar AS department_name_ar FROM interview_templates t LEFT JOIN departments d ON d.id=t.department_id ORDER BY t.status,t.name",
      )
      .all(),
    db
      .prepare(
        "SELECT * FROM interview_template_stages ORDER BY template_id,sort_order",
      )
      .all(),
    db
      .prepare(
        "SELECT x.*,e.name_en AS employee_name,e.name_ar AS employee_name_ar FROM interview_template_stage_interviewers x LEFT JOIN employees e ON e.id=x.employee_id ORDER BY x.template_stage_id,x.id",
      )
      .all(),
    db
      .prepare(
        "SELECT x.*,q.question,q.question_type FROM interview_template_stage_questions x JOIN interview_questions q ON q.id=x.question_id ORDER BY x.template_stage_id,x.sort_order",
      )
      .all(),
    db
      .prepare(
        "SELECT * FROM interview_template_scorecard_criteria ORDER BY template_stage_id,sort_order",
      )
      .all(),
    db
      .prepare(
        "SELECT q.*,d.name_en AS department_name,d.name_ar AS department_name_ar,j.title AS job_title FROM interview_questions q LEFT JOIN departments d ON d.id=q.department_id LEFT JOIN job_openings j ON j.id=q.job_id WHERE q.status<>'superseded' ORDER BY q.created_at DESC LIMIT 500",
      )
      .all(),
    options(db, actor),
  ]);
  return {
    ...opts,
    view: "setup",
    templates: templates.results,
    templateStages: templateStages.results,
    templateInterviewers: templateInterviewers.results,
    templateQuestions: templateQuestions.results,
    templateCriteria: templateCriteria.results,
    questions: questions.results,
  };
}

export async function handleRecruitmentGet(request: Request) {
  const db = createDatabase();
  try {
    const actor = await requireActor(request, db);
    await requireModule(db, actor, "recruitment", "view");
    const url = new URL(request.url),
      view = url.searchParams.get("view") || "overview",
      result =
        view === "overview"
          ? await loadOverview(db, actor)
          : view === "jobs"
            ? await loadJobs(db, actor, url)
            : view === "job"
              ? await loadJob(db, actor, Number(url.searchParams.get("id")))
              : view === "candidates"
                ? await loadCandidates(db, actor, url)
                : view === "candidate"
                  ? await loadCandidate(
                      db,
                      actor,
                      Number(url.searchParams.get("id")),
                      Number(url.searchParams.get("applicationId")),
                    )
                  : view === "interviews"
                    ? await loadInterviews(db, actor, url)
                    : view === "interview"
                      ? await loadInterview(
                          db,
                          actor,
                          Number(url.searchParams.get("id")),
                        )
                      : view === "setup"
                        ? await loadSetup(db, actor)
                        : null;
    if (!result)
      throw new Response("Unsupported recruitment view", { status: 400 });
    return Response.json(result, { headers: noStore });
  } catch (error) {
    return apiFailure(error, "Unable to load recruitment");
  } finally {
    await db.close();
  }
}

// Mutation handlers are kept below the read models so every frontend view and write
// shares the same scoped, server-authoritative domain boundary.
async function insertJobStages(tx: Db, jobId: number) {
  for (const stage of [
    {
      key: "applied",
      en: "Applied",
      ar: "تم التقديم",
      type: "applied",
      order: 10,
    },
    {
      key: "screening",
      en: "Screening",
      ar: "الفرز",
      type: "screening",
      order: 20,
    },
    {
      key: "shortlisted",
      en: "Shortlisted",
      ar: "القائمة المختصرة",
      type: "shortlist",
      order: 30,
    },
    {
      key: "hr_interview",
      en: "HR Interview",
      ar: "مقابلة الموارد البشرية",
      type: "interview",
      order: 40,
    },
    {
      key: "technical_interview",
      en: "Technical Interview",
      ar: "المقابلة الفنية",
      type: "interview",
      order: 50,
    },
    {
      key: "management_interview",
      en: "Management Interview",
      ar: "مقابلة الإدارة",
      type: "interview",
      order: 60,
    },
    {
      key: "final_review",
      en: "Final Review",
      ar: "المراجعة النهائية",
      type: "review",
      order: 70,
    },
    {
      key: "offer",
      en: "Offer",
      ar: "العرض الوظيفي",
      type: "offer",
      order: 80,
    },
    { key: "hired", en: "Hired", ar: "تم التعيين", type: "hired", order: 90 },
  ])
    await tx
      .prepare(
        "INSERT INTO recruitment_stages(job_id,stage_key,name_en,name_ar,stage_type,sort_order,terminal,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
      )
      .bind(
        jobId,
        stage.key,
        stage.en,
        stage.ar,
        stage.type,
        stage.order,
        stage.key === "hired" ? 1 : 0,
      )
      .run();
}

async function cloneInterviewPlan(
  tx: Db,
  jobId: number,
  templateId: number | undefined,
  actorId: number,
) {
  let template = templateId
    ? await tx
        .prepare(
          "SELECT id,name FROM interview_templates WHERE id=? AND status='active'",
        )
        .bind(templateId)
        .first<{ id: number; name: string }>()
    : null;
  if (!template)
    template = await tx
      .prepare(
        "SELECT t.id,t.name FROM job_openings j JOIN interview_templates t ON t.status='active' AND ((t.scope_type='department' AND t.department_id=j.department_id) OR t.scope_type='company') WHERE j.id=? ORDER BY CASE t.scope_type WHEN 'department' THEN 0 ELSE 1 END,t.id LIMIT 1",
      )
      .bind(jobId)
      .first<{ id: number; name: string }>();
  if (!template)
    throw new Response("An active interview template is required", {
      status: 400,
    });
  const plan = await tx
      .prepare(
        "INSERT INTO interview_plans(job_id,source_template_id,name,version,status,created_by_user_id,created_at,updated_at) VALUES (?,?,?,1,'active',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id",
      )
      .bind(jobId, template.id, `${template.name} — Job ${jobId}`, actorId)
      .first<{ id: number }>(),
    stages = (
      await tx
        .prepare(
          "SELECT * FROM interview_template_stages WHERE template_id=? ORDER BY sort_order",
        )
        .bind(template.id)
        .all()
    ).results;
  for (const source of stages) {
    const stage = await tx
      .prepare(
        "INSERT INTO interview_plan_stages(plan_id,source_template_stage_id,stage_key,name_en,name_ar,sort_order,duration_minutes,passing_guidance,required_feedback,independent_evaluations,aggregation_weight,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id",
      )
      .bind(
        plan!.id,
        source.id,
        source.stage_key,
        source.name_en,
        source.name_ar,
        source.sort_order,
        source.duration_minutes,
        source.passing_guidance,
        source.required_feedback,
        source.independent_evaluations,
        source.aggregation_weight,
      )
      .first<{ id: number }>();
    await tx
      .prepare(
        "INSERT INTO interview_stage_interviewers(plan_stage_id,role_key,employee_id,required,created_at,updated_at) SELECT ?,role_key,employee_id,required,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM interview_template_stage_interviewers WHERE template_stage_id=?",
      )
      .bind(stage!.id, source.id)
      .run();
    await tx
      .prepare(
        "INSERT INTO interview_stage_questions(plan_stage_id,question_id,sort_order,required,created_at,updated_at) SELECT ?,question_id,sort_order,required,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM interview_template_stage_questions WHERE template_stage_id=?",
      )
      .bind(stage!.id, source.id)
      .run();
    await tx
      .prepare(
        "INSERT INTO interview_scorecard_criteria(plan_stage_id,name_en,name_ar,description,weight,required,sort_order,created_at,updated_at) SELECT ?,name_en,name_ar,description,weight,required,sort_order,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM interview_template_scorecard_criteria WHERE template_stage_id=?",
      )
      .bind(stage!.id, source.id)
      .run();
  }
  return plan!.id;
}

function requirementInput(value: unknown) {
  return asRows(value).map((item, index) => ({
    category: required(item.category, "requirement category"),
    name: required(item.name, "requirement name"),
    description: text(item.description),
    priority: text(item.priority) === "preferred" ? "preferred" : "required",
    weight: Number(item.weight),
    minimumValue: text(item.minimumValue),
    notes: text(item.notes),
    sortOrder: (index + 1) * 10,
  }));
}
function screeningInput(value: unknown) {
  return asRows(value).map((item, index) => ({
    question: required(item.question, "screening question"),
    answerType: required(item.answerType, "answer type"),
    importance: ["important", "knockout"].includes(text(item.importance))
      ? text(item.importance)
      : "informational",
    options: Array.isArray(item.options) ? item.options : [],
    knockoutRule: item.knockoutRule || null,
    sortOrder: (index + 1) * 10,
  }));
}

async function createJob(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  input: JsonRecord,
) {
  await requireModule(db, actor, "recruitment", "create");
  const requirements = requirementInput(input.requirements);
  if (requirements.length) validateRequirementWeights(requirements);
  validateFairRequirements(requirements);
  const questions = screeningInput(input.screeningQuestions),
    requestedStatus = text(input.status) || "draft";
  if (!allowedJobStatuses.includes(requestedStatus))
    throw new Response("Invalid job status", { status: 400 });
  const jobId = await db.transaction(async (tx) => {
    const job = await tx
      .prepare(
        "INSERT INTO job_openings(title,department_id,job_title_id,hiring_manager_employee_id,recruiter_employee_id,location,employment_type,openings_count,summary,responsibilities,description,requirements,status,created_date,closing_date,requirements_version,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,1,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id",
      )
      .bind(
        required(input.title, "title"),
        number(input.departmentId) || null,
        number(input.jobTitleId) || null,
        number(input.hiringManagerEmployeeId) || null,
        number(input.recruiterEmployeeId) || actor.employeeId || null,
        text(input.location) || null,
        text(input.employmentType) || "full_time",
        Math.max(1, number(input.openingsCount)),
        text(input.summary) || null,
        text(input.responsibilities) || null,
        text(input.description) || null,
        text(input.description) || null,
        text(input.createdDate) || new Date().toISOString().slice(0, 10),
        text(input.closingDate) || null,
        actor.id,
      )
      .first<{ id: number }>();
    await requireJobAccess(tx, actor, job!.id, true);
    for (const item of requirements)
      await tx
        .prepare(
          "INSERT INTO job_requirements(job_id,category,name,description,priority,weight,minimum_value,notes,sort_order,version,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
        )
        .bind(
          job!.id,
          item.category,
          item.name,
          item.description || null,
          item.priority,
          item.weight,
          item.minimumValue || null,
          item.notes || null,
          item.sortOrder,
        )
        .run();
    for (const item of questions)
      await tx
        .prepare(
          "INSERT INTO job_screening_questions(job_id,question,answer_type,importance,options_json,knockout_rule_json,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
        )
        .bind(
          job!.id,
          item.question,
          item.answerType,
          item.importance,
          JSON.stringify(item.options),
          item.knockoutRule ? JSON.stringify(item.knockoutRule) : null,
          item.sortOrder,
        )
        .run();
    await insertJobStages(tx, job!.id);
    await cloneInterviewPlan(
      tx,
      job!.id,
      number(input.templateId) || undefined,
      actor.id,
    );
    await tx
      .prepare(
        "UPDATE job_openings SET status=?,published_at=CASE WHEN ?='open' THEN CURRENT_TIMESTAMP ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .bind(requestedStatus, requestedStatus, job!.id)
      .run();
    return job!.id;
  });
  await audit(db, actor, "job_created", "recruitment", "job_opening", jobId, {
    jobId,
    status: requestedStatus,
    requirementCount: requirements.length,
  });
  return Response.json({ ok: true, id: jobId }, { status: 201 });
}

async function updateJobRequirements(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  input: JsonRecord,
) {
  const jobId = number(input.jobId);
  await requireJobAccess(db, actor, jobId, true);
  const requirements = requirementInput(input.requirements);
  if (requirements.length) validateRequirementWeights(requirements);
  validateFairRequirements(requirements);
  const result = await db.transaction(async (tx) => {
    const job = await tx
      .prepare(
        "SELECT status,requirements_version FROM job_openings WHERE id=? FOR UPDATE",
      )
      .bind(jobId)
      .first<{ status: string; requirements_version: number }>();
    if (!job) throw new Response("Job not found", { status: 404 });
    const version = Number(job.requirements_version) + 1;
    await tx
      .prepare(
        "UPDATE job_openings SET status='draft',updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .bind(jobId)
      .run();
    for (const item of requirements)
      await tx
        .prepare(
          "INSERT INTO job_requirements(job_id,category,name,description,priority,weight,minimum_value,notes,sort_order,version,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
        )
        .bind(
          jobId,
          item.category,
          item.name,
          item.description || null,
          item.priority,
          item.weight,
          item.minimumValue || null,
          item.notes || null,
          item.sortOrder,
          version,
        )
        .run();
    await tx
      .prepare(
        "UPDATE job_openings SET requirements_version=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .bind(version, job.status, jobId)
      .run();
    return { version, previousVersion: job.requirements_version };
  });
  await audit(
    db,
    actor,
    "job_requirements_changed",
    "recruitment",
    "job_opening",
    jobId,
    result,
  );
  return Response.json({ ok: true, ...result });
}

function screeningFlags(questions: Row[], answers: JsonRecord) {
  const flags: JsonRecord[] = [];
  for (const question of questions) {
    if (question.importance !== "knockout") continue;
    const rule = parseJson<JsonRecord>(question.knockout_rule_json, {}),
      answer = answers[String(question.id)],
      operator = String(rule.operator || "equals"),
      expected = rule.value,
      flagged =
        operator === "equals"
          ? answer !== expected
          : operator === "not_equals"
            ? answer === expected
            : operator === "minimum"
              ? Number(answer) < Number(expected)
              : false;
    if (flagged)
      flags.push({
        questionId: question.id,
        question: question.question,
        answer,
        rule,
        disposition: "hr_review_required",
      });
  }
  return flags;
}

async function addCandidate(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  input: JsonRecord,
) {
  await requireModule(db, actor, "recruitment", "create");
  const jobId = number(input.jobId);
  await requireJobAccess(db, actor, jobId, true);
  const email = required(input.email, "email").toLocaleLowerCase(),
    answers =
      input.screeningAnswers && typeof input.screeningAnswers === "object"
        ? (input.screeningAnswers as JsonRecord)
        : {},
    questions = (
      await db
        .prepare(
          "SELECT * FROM job_screening_questions WHERE job_id=? ORDER BY sort_order",
        )
        .bind(jobId)
        .all()
    ).results,
    flags = screeningFlags(questions, answers),
    result = await db.transaction(async (tx) => {
      let candidate = await tx
        .prepare(
          "SELECT id FROM candidates WHERE lower(email)=? AND merged_into_candidate_id IS NULL FOR UPDATE",
        )
        .bind(email)
        .first<{ id: number }>();
      if (!candidate)
        candidate = await tx
          .prepare(
            "INSERT INTO candidates(job_id,name,email,phone,location,current_job_title,current_company,total_experience,education_json,skills_json,languages_json,certifications_json,source,notes,stage,profile_version,human_corrected_at,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'applied',1,CURRENT_TIMESTAMP,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id",
          )
          .bind(
            jobId,
            required(input.name, "name"),
            email,
            text(input.phone) || null,
            text(input.location) || null,
            text(input.currentJobTitle) || null,
            text(input.currentCompany) || null,
            Number(input.totalExperience) || null,
            JSON.stringify(input.education || []),
            JSON.stringify(input.skills || []),
            JSON.stringify(input.languages || []),
            JSON.stringify(input.certifications || []),
            text(input.source) || "manual",
            text(input.notes) || null,
            actor.id,
          )
          .first<{ id: number }>();
      else
        await tx
          .prepare(
            "UPDATE candidates SET phone=COALESCE(phone,?),location=COALESCE(location,?),current_job_title=COALESCE(current_job_title,?),current_company=COALESCE(current_company,?),updated_at=CURRENT_TIMESTAMP WHERE id=?",
          )
          .bind(
            text(input.phone) || null,
            text(input.location) || null,
            text(input.currentJobTitle) || null,
            text(input.currentCompany) || null,
            candidate.id,
          )
          .run();
      if (
        await tx
          .prepare(
            "SELECT id FROM candidate_applications WHERE candidate_id=? AND job_id=?",
          )
          .bind(candidate!.id, jobId)
          .first()
      )
        throw new Response(
          "This candidate already has an application for the selected job",
          { status: 409 },
        );
      const stage = await tx
          .prepare(
            "SELECT id FROM recruitment_stages WHERE job_id=? AND stage_key='applied'",
          )
          .bind(jobId)
          .first<{ id: number }>(),
        job = await tx
          .prepare("SELECT recruiter_employee_id FROM job_openings WHERE id=?")
          .bind(jobId)
          .first<{ recruiter_employee_id: number | null }>(),
        application = await tx
          .prepare(
            "INSERT INTO candidate_applications(candidate_id,job_id,current_stage_id,status,source,screening_answers_json,screening_flags_json,recruiter_employee_id,stage_entered_at,applied_at,created_at,updated_at) VALUES (?,?,?,'active',?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id",
          )
          .bind(
            candidate!.id,
            jobId,
            stage!.id,
            text(input.source) || "manual",
            JSON.stringify(answers),
            JSON.stringify(flags),
            number(input.recruiterEmployeeId) ||
              job?.recruiter_employee_id ||
              null,
          )
          .first<{ id: number }>();
      await tx
        .prepare(
          "INSERT INTO candidate_stage_history(application_id,to_stage_id,action,actor_user_id,created_at) VALUES (?,?,'applied',?,CURRENT_TIMESTAMP)",
        )
        .bind(application!.id, stage!.id, actor.id)
        .run();
      return {
        candidateId: candidate!.id,
        applicationId: application!.id,
        flags,
      };
    });
  await audit(
    db,
    actor,
    "candidate_added",
    "recruitment",
    "candidate",
    result.candidateId,
    {
      jobId,
      applicationId: result.applicationId,
      screeningFlags: result.flags.length,
    },
  );
  return Response.json({ ok: true, ...result }, { status: 201 });
}

async function uploadCv(
  request: Request,
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
) {
  const storage = bucket();
  if (!storage)
    throw new Response("Candidate document storage is not configured", {
      status: 503,
    });
  const form = await request.formData(),
    applicationId = Number(form.get("applicationId")),
    candidateId = Number(form.get("candidateId")),
    file = form.get("file");
  if (!(file instanceof File) || !applicationId || !candidateId)
    throw new Response("Candidate, application, and CV file are required", {
      status: 400,
    });
  const application = await requireApplicationAccess(
    db,
    actor,
    applicationId,
    true,
  );
  if (Number(application.candidate_id) !== candidateId)
    throw new Response("Candidate does not match application", { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer()),
    mime = validateCvFile(bytes, file.name, file.type),
    objectKey = safeCandidateObjectKey(candidateId, mime),
    next = await db
      .prepare(
        "SELECT COALESCE(MAX(version),0)+1 AS version FROM candidate_documents WHERE candidate_id=? AND document_type='cv'",
      )
      .bind(candidateId)
      .first<{ version: number }>();
  await storage.put(objectKey, bytes, {
    httpMetadata: { contentType: mime },
    customMetadata: {
      candidateId: String(candidateId),
      applicationId: String(applicationId),
      documentType: "cv",
    },
  });
  let documentId = 0;
  try {
    const row = await db
      .prepare(
        "INSERT INTO candidate_documents(candidate_id,application_id,document_type,name,object_key,content_type,size_bytes,version,parsing_status,uploaded_by_user_id,created_at,updated_at) VALUES (?,?,'cv',?,?,?,?,?,'parsing',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id",
      )
      .bind(
        candidateId,
        applicationId,
        file.name.slice(0, 180),
        objectKey,
        mime,
        bytes.length,
        Number(next?.version) || 1,
        actor.id,
      )
      .first<{ id: number }>();
    documentId = Number(row!.id);
    try {
      const { extractCvText } = await import("./recruitment-service"),
        raw = await Promise.race([
          extractCvText(bytes, mime),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error("CV parsing timed out")), 25000),
          ),
        ]),
        extracted = parseCvText(raw),
        status = raw.length > 50 ? "complete" : "partial";
      await db.transaction(async (tx) => {
        await tx
          .prepare(
            "INSERT INTO candidate_cv_parsed_data(document_id,parser_version,raw_text,extracted_json,status,confidence,parsed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
          )
          .bind(
            documentId,
            "sanad-parser-1",
            raw.slice(0, 200000),
            JSON.stringify({ ...extracted, rawText: raw.slice(0, 200000) }),
            status,
            extracted.confidence,
          )
          .run();
        await tx
          .prepare(
            "UPDATE candidate_documents SET parsing_status='complete',parsing_confidence=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
          )
          .bind(extracted.confidence, documentId)
          .run();
        await tx
          .prepare(
            "UPDATE candidates SET phone=COALESCE(phone,NULLIF(?,'')),current_job_title=COALESCE(current_job_title,NULLIF(?,'')),total_experience=COALESCE(total_experience,?),education_json=CASE WHEN education_json='[]' THEN ? ELSE education_json END,skills_json=CASE WHEN skills_json='[]' THEN ? ELSE skills_json END,languages_json=CASE WHEN languages_json='[]' THEN ? ELSE languages_json END,certifications_json=CASE WHEN certifications_json='[]' THEN ? ELSE certifications_json END,projects_json=CASE WHEN projects_json='[]' THEN ? ELSE projects_json END,profile_version=profile_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",
          )
          .bind(
            extracted.phone,
            extracted.currentJobTitle,
            extracted.totalExperience,
            JSON.stringify(extracted.education),
            JSON.stringify(extracted.skills),
            JSON.stringify(extracted.languages),
            JSON.stringify(extracted.certifications),
            JSON.stringify(extracted.projects),
            candidateId,
          )
          .run();
      });
      await audit(
        db,
        actor,
        "cv_parsed",
        "recruitment",
        "candidate",
        candidateId,
        { applicationId, documentId, status, confidence: extracted.confidence },
      );
      return Response.json(
        { ok: true, documentId, parsingStatus: status, extracted },
        { status: 201 },
      );
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "CV parsing failed";
      await db
        .prepare(
          "UPDATE candidate_documents SET parsing_status='failed',parsing_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(message.slice(0, 1000), documentId)
        .run();
      await db
        .prepare(
          "INSERT INTO candidate_cv_parsed_data(document_id,parser_version,status,extracted_json,created_at,updated_at) VALUES (?,'sanad-parser-1','failed','{}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
        )
        .bind(documentId)
        .run();
      await audit(
        db,
        actor,
        "cv_parse_failed",
        "recruitment",
        "candidate",
        candidateId,
        { applicationId, documentId, error: message },
      );
      return Response.json(
        { ok: true, documentId, parsingStatus: "failed", error: message },
        { status: 202 },
      );
    }
  } catch (error) {
    await storage.delete(objectKey).catch(() => {});
    throw error;
  }
}

async function updateCandidate(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  input: JsonRecord,
) {
  const applicationId = number(input.applicationId),
    candidateId = number(input.candidateId),
    application = await requireApplicationAccess(
      db,
      actor,
      applicationId,
      true,
    );
  if (Number(application.candidate_id) !== candidateId)
    throw new Response("Candidate does not match application", { status: 400 });
  await db
    .prepare(
      "UPDATE candidates SET name=?,email=?,phone=?,location=?,current_job_title=?,current_company=?,total_experience=?,education_json=?,skills_json=?,languages_json=?,certifications_json=?,projects_json=?,notes=?,profile_version=profile_version+1,human_corrected_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
    .bind(
      required(input.name, "name"),
      required(input.email, "email").toLocaleLowerCase(),
      text(input.phone) || null,
      text(input.location) || null,
      text(input.currentJobTitle) || null,
      text(input.currentCompany) || null,
      Number(input.totalExperience) || null,
      JSON.stringify(input.education || []),
      JSON.stringify(input.skills || []),
      JSON.stringify(input.languages || []),
      JSON.stringify(input.certifications || []),
      JSON.stringify(input.projects || []),
      text(input.notes) || null,
      candidateId,
    )
    .run();
  const documentId = number(input.documentId);
  if (documentId)
    await db
      .prepare(
        "UPDATE candidate_cv_parsed_data SET corrected_json=?,status='corrected',corrected_by_user_id=?,corrected_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE document_id=?",
      )
      .bind(JSON.stringify(input.correctedCv || {}), actor.id, documentId)
      .run();
  await audit(
    db,
    actor,
    "candidate_profile_corrected",
    "recruitment",
    "candidate",
    candidateId,
    { applicationId, documentId: documentId || null },
  );
  return Response.json({ ok: true });
}

async function runMatch(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  input: JsonRecord,
) {
  const applicationId = number(input.applicationId),
    application = await requireApplicationAccess(
      db,
      actor,
      applicationId,
      true,
    ),
    [job, candidate, requirements, parsed, document, setting] =
      await Promise.all([
        db
          .prepare("SELECT requirements_version FROM job_openings WHERE id=?")
          .bind(application.job_id)
          .first<{ requirements_version: number }>(),
        db
          .prepare("SELECT * FROM candidates WHERE id=?")
          .bind(application.candidate_id)
          .first<Row>(),
        db
          .prepare(
            "SELECT * FROM job_requirements WHERE job_id=? AND active=1 AND version=(SELECT requirements_version FROM job_openings WHERE id=?) ORDER BY sort_order",
          )
          .bind(application.job_id, application.job_id)
          .all(),
        db
          .prepare(
            "SELECT p.raw_text,p.extracted_json,p.corrected_json FROM candidate_cv_parsed_data p JOIN candidate_documents d ON d.id=p.document_id WHERE d.candidate_id=? AND p.status IN ('complete','partial','corrected') ORDER BY d.version DESC LIMIT 1",
          )
          .bind(application.candidate_id)
          .first<Row>(),
        db
          .prepare(
            "SELECT version FROM candidate_documents WHERE candidate_id=? AND document_type='cv' ORDER BY version DESC LIMIT 1",
          )
          .bind(application.candidate_id)
          .first<{ version: number }>(),
        db
          .prepare(
            "SELECT value_json FROM system_settings WHERE setting_key='recruitment_matching'",
          )
          .first<{ value_json: string }>(),
      ]);
  if (!job || !candidate)
    throw new Response("Application context is incomplete", { status: 409 });
  const parsedData = {
      ...parseJson<JsonRecord>(parsed?.extracted_json, {}),
      ...parseJson<JsonRecord>(parsed?.corrected_json, {}),
      rawText: String(parsed?.raw_text || ""),
    },
    settings = recruitmentSettings(setting),
    analysis = matchCandidate(
      requirements.results as unknown as JobRequirement[],
      candidateEvidence(candidate, parsedData),
      settings.thresholds,
    ),
    resultId = await db.transaction(async (tx) => {
      const row = await tx
        .prepare(
          "INSERT INTO candidate_match_results(application_id,overall_score,classification,job_requirements_version,candidate_profile_version,cv_document_version,status,strong_matches_json,partial_matches_json,missing_requirements_json,concerns_json,suggested_questions_json,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,'complete',?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id",
        )
        .bind(
          applicationId,
          analysis.overallScore,
          analysis.classification,
          job.requirements_version,
          Number(candidate.profile_version),
          Number(document?.version) || 0,
          JSON.stringify(analysis.strongMatches),
          JSON.stringify(analysis.partialMatches),
          JSON.stringify(analysis.missingRequirements),
          JSON.stringify(analysis.concerns),
          JSON.stringify(analysis.suggestedQuestions),
          actor.id,
        )
        .first<{ id: number }>();
      for (const score of analysis.requirements)
        await tx
          .prepare(
            "INSERT INTO candidate_requirement_scores(match_result_id,requirement_id,score,evidence_status,evidence,rationale,created_at,updated_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
          )
          .bind(
            row!.id,
            score.requirementId,
            score.score,
            score.evidenceStatus,
            score.evidence || null,
            score.rationale,
          )
          .run();
      return row!.id;
    });
  await audit(
    db,
    actor,
    "candidate_match_run",
    "recruitment",
    "candidate_application",
    applicationId,
    {
      matchResultId: resultId,
      overallScore: analysis.overallScore,
      classification: analysis.classification,
    },
  );
  return Response.json(
    { ok: true, id: resultId, ...analysis },
    { status: 201 },
  );
}

async function moveApplication(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  input: JsonRecord,
) {
  const applicationId = number(input.applicationId);
  await requireApplicationAccess(db, actor, applicationId, true);
  const targetStageId = number(input.stageId),
    result = await db.transaction(async (tx) => {
      const current = await tx
          .prepare(
            "SELECT a.*,s.sort_order AS current_order,s.stage_type AS current_type FROM candidate_applications a JOIN recruitment_stages s ON s.id=a.current_stage_id WHERE a.id=? FOR UPDATE OF a",
          )
          .bind(applicationId)
          .first<Row>(),
        target = await tx
          .prepare(
            "SELECT * FROM recruitment_stages WHERE id=? AND job_id=? AND active=1",
          )
          .bind(targetStageId, current?.job_id)
          .first<Row>();
      if (!current || !target)
        throw new Response("Application stage was not found", { status: 404 });
      if (!["active", "on_hold", "offer"].includes(String(current.status)))
        throw new Response("Inactive applications cannot move stages", {
          status: 409,
        });
      if (target.stage_type === "hired")
        throw new Response(
          "Use accepted offer conversion to hire a candidate",
          { status: 409 },
        );
      if (
        Math.abs(Number(target.sort_order) - Number(current.current_order)) > 20
      )
        throw new Response(
          "Only the next or previous configured stage may be selected",
          { status: 409 },
        );
      const nextStatus = target.stage_type === "offer" ? "offer" : "active";
      await tx
        .prepare(
          "UPDATE candidate_applications SET current_stage_id=?,status=?,stage_entered_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(targetStageId, nextStatus, applicationId)
        .run();
      await tx
        .prepare(
          "INSERT INTO candidate_stage_history(application_id,from_stage_id,to_stage_id,action,reason,actor_user_id,created_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)",
        )
        .bind(
          applicationId,
          current.current_stage_id,
          targetStageId,
          Number(target.sort_order) > Number(current.current_order)
            ? "moved_forward"
            : "moved_back",
          text(input.reason) || null,
          actor.id,
        )
        .run();
      await tx
        .prepare(
          "UPDATE candidates SET stage=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(
          target.stage_type === "interview" ? "interview" : target.stage_key,
          current.candidate_id,
        )
        .run();
      return {
        fromStageId: current.current_stage_id,
        toStageId: targetStageId,
        stageKey: target.stage_key,
      };
    });
  await audit(
    db,
    actor,
    "candidate_stage_changed",
    "recruitment",
    "candidate_application",
    applicationId,
    result,
  );
  return Response.json({ ok: true, ...result });
}

async function setApplicationStatus(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  input: JsonRecord,
) {
  const applicationId = number(input.applicationId),
    application = await requireApplicationAccess(
      db,
      actor,
      applicationId,
      true,
    ),
    status = required(input.status, "status");
  if (!["on_hold", "withdrawn"].includes(status))
    throw new Response("Invalid application status action", { status: 400 });
  await db
    .prepare(
      "UPDATE candidate_applications SET status=?,decision_at=CASE WHEN ?='withdrawn' THEN CURRENT_TIMESTAMP ELSE decision_at END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status NOT IN ('rejected','hired')",
    )
    .bind(status, status, applicationId)
    .run();
  await audit(
    db,
    actor,
    "candidate_status_changed",
    "recruitment",
    "candidate_application",
    applicationId,
    { from: application.status, to: status, reason: text(input.reason) },
  );
  return Response.json({ ok: true });
}

async function rejectApplication(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  input: JsonRecord,
) {
  const applicationId = number(input.applicationId),
    application = await requireApplicationAccess(
      db,
      actor,
      applicationId,
      true,
    ),
    reason = required(input.reason, "rejection reason"),
    communication = text(input.communicationStatus) || "not_sent";
  await db.transaction(async (tx) => {
    await tx
      .prepare(
        "UPDATE candidate_applications SET status='rejected',rejection_stage_id=current_stage_id,rejection_reason=?,rejection_notes=?,communication_status=?,decision_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status NOT IN ('hired','rejected')",
      )
      .bind(
        reason,
        text(input.internalNotes) || null,
        communication,
        applicationId,
      )
      .run();
    await tx
      .prepare(
        "UPDATE candidates SET stage='rejected',updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .bind(application.candidate_id)
      .run();
  });
  await audit(
    db,
    actor,
    "candidate_rejected",
    "recruitment",
    "candidate_application",
    applicationId,
    {
      stageId: application.current_stage_id,
      reason,
      communicationStatus: communication,
    },
  );
  return Response.json({ ok: true });
}

async function resolveInterviewers(
  db: Db,
  jobId: number,
  planStageId: number,
  provided: number[],
) {
  if (provided.length) return provided;
  const rows = (
      await db
        .prepare(
          "SELECT x.role_key,x.employee_id,j.hiring_manager_employee_id,j.recruiter_employee_id,d.manager_employee_id AS department_manager_id FROM interview_stage_interviewers x JOIN interview_plan_stages ps ON ps.id=x.plan_stage_id JOIN interview_plans p ON p.id=ps.plan_id JOIN job_openings j ON j.id=p.job_id LEFT JOIN departments d ON d.id=j.department_id WHERE x.plan_stage_id=? AND j.id=?",
        )
        .bind(planStageId, jobId)
        .all()
    ).results,
    resolved: number[] = [];
  for (const row of rows) {
    const value =
      Number(row.employee_id) ||
      Number(
        row.role_key === "recruiter"
          ? row.recruiter_employee_id
          : row.role_key === "department_manager"
            ? row.department_manager_id
            : row.hiring_manager_employee_id,
      );
    if (value) resolved.push(value);
  }
  return [...new Set(resolved)];
}

async function scheduleInterview(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  input: JsonRecord,
) {
  const applicationId = number(input.applicationId),
    application = await requireApplicationAccess(
      db,
      actor,
      applicationId,
      true,
    ),
    planStageId = number(input.planStageId),
    stage = await db
      .prepare(
        "SELECT ps.*,p.job_id FROM interview_plan_stages ps JOIN interview_plans p ON p.id=ps.plan_id WHERE ps.id=? AND p.status='active'",
      )
      .bind(planStageId)
      .first<Row>();
  if (!stage || Number(stage.job_id) !== Number(application.job_id))
    throw new Response(
      "Interview stage does not belong to the application job",
      { status: 400 },
    );
  const scheduledAt = new Date(required(input.scheduledAt, "scheduled time"));
  if (
    !Number.isFinite(scheduledAt.getTime()) ||
    scheduledAt.getTime() < Date.now() - 300000
  )
    throw new Response("Interview time is invalid", { status: 400 });
  const duration = Math.min(
      480,
      Math.max(
        15,
        number(input.durationMinutes) || Number(stage.duration_minutes) || 60,
      ),
    ),
    endAt = new Date(scheduledAt.getTime() + duration * 60000),
    interviewers = await resolveInterviewers(
      db,
      Number(application.job_id),
      planStageId,
      ids(input.interviewerEmployeeIds),
    );
  if (!interviewers.length)
    throw new Response("At least one valid interviewer is required", {
      status: 400,
    });
  const valid = (
    await db
      .prepare(
        `SELECT id FROM employees WHERE id IN (${interviewers.map(() => "?").join(",")}) AND employment_status IN ('active','probation','notice_period')`,
      )
      .bind(...interviewers)
      .all()
  ).results;
  if (valid.length !== interviewers.length)
    throw new Response(
      "One or more interviewers are not active system employees",
      { status: 400 },
    );
  const conflict = await db
    .prepare(
      `SELECT e.name_en,i.scheduled_at FROM interview_participants p JOIN employees e ON e.id=p.employee_id JOIN interviews i ON i.id=p.interview_id WHERE p.employee_id IN (${interviewers.map(() => "?").join(",")}) AND i.status='scheduled' AND i.scheduled_at<?::timestamptz AND COALESCE(i.end_at,i.scheduled_at+(i.duration_minutes*INTERVAL '1 minute'))>?::timestamptz LIMIT 1`,
    )
    .bind(...interviewers, endAt.toISOString(), scheduledAt.toISOString())
    .first<Row>();
  if (conflict)
    throw new Response(
      `Scheduling conflict for ${conflict.name_en} at ${conflict.scheduled_at}`,
      { status: 409 },
    );
  const interviewId = await db.transaction(async (tx) => {
    const row = await tx
      .prepare(
        "INSERT INTO interviews(candidate_id,application_id,plan_stage_id,interviewer_employee_id,scheduled_at,end_at,duration_minutes,interview_type,meeting_method,location,notes,status,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?::timestamptz,?::timestamptz,?,?,?,?,?,'scheduled',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id",
      )
      .bind(
        application.candidate_id,
        applicationId,
        planStageId,
        interviewers[0],
        scheduledAt.toISOString(),
        endAt.toISOString(),
        duration,
        text(input.interviewType) || "structured",
        text(input.meetingMethod) || "in_person",
        text(input.location) || null,
        text(input.notes) || null,
        actor.id,
      )
      .first<{ id: number }>();
    for (const employeeId of interviewers)
      await tx
        .prepare(
          "INSERT INTO interview_participants(interview_id,employee_id,required,status,created_at,updated_at) VALUES (?,?,1,'assigned',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
        )
        .bind(row!.id, employeeId)
        .run();
    return row!.id;
  });
  for (const employeeId of interviewers)
    await notifyEmployee(db, employeeId, {
      type: "recruitment",
      title: "interview_assigned",
      message: scheduledAt.toISOString(),
      entityType: "interview",
      entityId: interviewId,
      path: "recruitment",
      key: `interview:${interviewId}:assigned:${employeeId}`,
    });
  await audit(
    db,
    actor,
    "interview_scheduled",
    "recruitment",
    "interview",
    interviewId,
    {
      applicationId,
      planStageId,
      interviewers,
      scheduledAt: scheduledAt.toISOString(),
      duration,
    },
  );
  return Response.json({ ok: true, id: interviewId }, { status: 201 });
}

async function rescheduleInterview(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  input: JsonRecord,
) {
  const interviewId = number(input.interviewId),
    interview = await db
      .prepare(
        "SELECT i.*,a.job_id FROM interviews i JOIN candidate_applications a ON a.id=i.application_id WHERE i.id=?",
      )
      .bind(interviewId)
      .first<Row>();
  if (!interview) throw new Response("Interview not found", { status: 404 });
  await requireApplicationAccess(
    db,
    actor,
    Number(interview.application_id),
    true,
  );
  if (interview.status !== "scheduled")
    throw new Response("Only scheduled interviews can be rescheduled", {
      status: 409,
    });
  const scheduledAt = new Date(required(input.scheduledAt, "scheduled time"));
  if (
    !Number.isFinite(scheduledAt.getTime()) ||
    scheduledAt.getTime() < Date.now() - 300000
  )
    throw new Response("Interview time is invalid", { status: 400 });
  const duration = Math.min(
      480,
      Math.max(
        15,
        number(input.durationMinutes) ||
          Number(interview.duration_minutes) ||
          60,
      ),
    ),
    endAt = new Date(scheduledAt.getTime() + duration * 60000),
    participants = (
      await db
        .prepare(
          "SELECT employee_id FROM interview_participants WHERE interview_id=?",
        )
        .bind(interviewId)
        .all()
    ).results.map((row) => Number(row.employee_id));
  if (participants.length) {
    const conflict = await db
      .prepare(
        `SELECT e.name_en,i.scheduled_at FROM interview_participants p JOIN employees e ON e.id=p.employee_id JOIN interviews i ON i.id=p.interview_id WHERE p.employee_id IN (${participants.map(() => "?").join(",")}) AND i.id<>? AND i.status='scheduled' AND i.scheduled_at<?::timestamptz AND COALESCE(i.end_at,i.scheduled_at+(i.duration_minutes*INTERVAL '1 minute'))>?::timestamptz LIMIT 1`,
      )
      .bind(
        ...participants,
        interviewId,
        endAt.toISOString(),
        scheduledAt.toISOString(),
      )
      .first<Row>();
    if (conflict)
      throw new Response(
        `Scheduling conflict for ${conflict.name_en} at ${conflict.scheduled_at}`,
        { status: 409 },
      );
  }
  await db
    .prepare(
      "UPDATE interviews SET scheduled_at=?::timestamptz,end_at=?::timestamptz,duration_minutes=?,meeting_method=?,location=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='scheduled'",
    )
    .bind(
      scheduledAt.toISOString(),
      endAt.toISOString(),
      duration,
      text(input.meetingMethod) || interview.meeting_method,
      text(input.location) || null,
      text(input.notes) || null,
      interviewId,
    )
    .run();
  for (const employeeId of participants)
    await notifyEmployee(db, employeeId, {
      type: "recruitment",
      title: "interview_rescheduled",
      message: scheduledAt.toISOString(),
      entityType: "interview",
      entityId: interviewId,
      path: "recruitment",
      key: `interview:${interviewId}:rescheduled:${scheduledAt.toISOString()}:${employeeId}`,
    });
  await audit(
    db,
    actor,
    "interview_rescheduled",
    "recruitment",
    "interview",
    interviewId,
    {
      previousScheduledAt: interview.scheduled_at,
      scheduledAt: scheduledAt.toISOString(),
      duration,
    },
  );
  return Response.json({ ok: true });
}

async function cancelInterview(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  input: JsonRecord,
) {
  const interviewId = number(input.interviewId),
    interview = await db
      .prepare("SELECT * FROM interviews WHERE id=?")
      .bind(interviewId)
      .first<Row>();
  if (!interview) throw new Response("Interview not found", { status: 404 });
  await requireApplicationAccess(
    db,
    actor,
    Number(interview.application_id),
    true,
  );
  if (interview.status !== "scheduled")
    throw new Response("Only scheduled interviews can be cancelled", {
      status: 409,
    });
  const reason = required(input.reason, "cancellation reason"),
    participants = (
      await db
        .prepare(
          "SELECT employee_id FROM interview_participants WHERE interview_id=?",
        )
        .bind(interviewId)
        .all()
    ).results.map((row) => Number(row.employee_id));
  await db
    .prepare(
      "UPDATE interviews SET status='cancelled',cancellation_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='scheduled'",
    )
    .bind(reason, interviewId)
    .run();
  for (const employeeId of participants)
    await notifyEmployee(db, employeeId, {
      type: "recruitment",
      title: "interview_cancelled",
      message: reason,
      entityType: "interview",
      entityId: interviewId,
      path: "recruitment",
      key: `interview:${interviewId}:cancelled:${employeeId}`,
    });
  await audit(
    db,
    actor,
    "interview_cancelled",
    "recruitment",
    "interview",
    interviewId,
    { reason, previousScheduledAt: interview.scheduled_at },
  );
  return Response.json({ ok: true });
}

async function saveEvaluation(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  input: JsonRecord,
  submit: boolean,
) {
  const interviewId = number(input.interviewId),
    access = await requireInterviewAccess(db, actor, interviewId);
  if (!actor.employeeId || Number(access.employee_id) !== actor.employeeId)
    throw new Response(
      "Only an assigned interviewer can evaluate this interview",
      { status: 403 },
    );
  const existing = await db
    .prepare(
      "SELECT status FROM interview_evaluations WHERE interview_id=? AND interviewer_employee_id=?",
    )
    .bind(interviewId, actor.employeeId)
    .first<{ status: string }>();
  if (existing?.status === "submitted")
    throw new Response("Submitted evaluations are immutable", { status: 409 });
  const criteria = (
      await db
        .prepare(
          "SELECT c.* FROM interview_scorecard_criteria c JOIN interviews i ON i.plan_stage_id=c.plan_stage_id WHERE i.id=? ORDER BY c.sort_order",
        )
        .bind(interviewId)
        .all()
    ).results,
    submittedScores = asRows(input.scores),
    scoreMap = new Map(
      submittedScores.map((item) => [Number(item.criterionId), item]),
    );
  validateScorecardWeights(
    criteria.map((item) => ({ weight: Number(item.weight) })),
  );
  if (
    submit &&
    criteria.some(
      (item) => Number(item.required) && !scoreMap.has(Number(item.id)),
    )
  )
    throw new Response(
      "Complete every required scorecard criterion before submitting",
      { status: 400 },
    );
  for (const entry of submittedScores) {
    const score = Number(entry.score);
    if (
      score < 1 ||
      score > 5 ||
      !criteria.some((item) => Number(item.id) === Number(entry.criterionId))
    )
      throw new Response(
        "Evaluation scores must be between 1 and 5 and belong to this scorecard",
        { status: 400 },
      );
  }
  const recommendation = text(input.recommendation),
    notes = text(input.notes, 12000);
  if (
    submit &&
    !["strong_hire", "hire", "mixed", "no_hire"].includes(recommendation)
  )
    throw new Response("A valid overall recommendation is required", {
      status: 400,
    });
  if (
    submit &&
    ["strong_hire", "no_hire", "mixed"].includes(recommendation) &&
    notes.length < 20
  )
    throw new Response(
      "A written rationale is required for critical or mixed recommendations",
      { status: 400 },
    );
  const scored = criteria.filter((item) => scoreMap.has(Number(item.id))),
    totalWeight = scored.reduce((sum, item) => sum + Number(item.weight), 0),
    overall = totalWeight
      ? scored.reduce(
          (sum, item) =>
            sum +
            Number(scoreMap.get(Number(item.id))?.score) *
              20 *
              Number(item.weight),
          0,
        ) / totalWeight
      : 0,
    evaluationId = await db.transaction(async (tx) => {
      const participant = await tx
          .prepare(
            "SELECT id FROM interview_participants WHERE interview_id=? AND employee_id=?",
          )
          .bind(interviewId, actor.employeeId)
          .first<{ id: number }>(),
        evaluation = await tx
          .prepare(
            "INSERT INTO interview_evaluations(interview_id,participant_id,interviewer_employee_id,notes,recommendation,overall_score,status,submitted_at,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,CASE WHEN ?='submitted' THEN CURRENT_TIMESTAMP ELSE NULL END,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(interview_id,interviewer_employee_id) DO UPDATE SET notes=EXCLUDED.notes,recommendation=EXCLUDED.recommendation,overall_score=EXCLUDED.overall_score,status=EXCLUDED.status,submitted_at=EXCLUDED.submitted_at,updated_at=CURRENT_TIMESTAMP RETURNING id",
          )
          .bind(
            interviewId,
            participant!.id,
            actor.employeeId,
            notes || null,
            recommendation || null,
            overall,
            submit ? "submitted" : "draft",
            submit ? "submitted" : "draft",
            actor.id,
          )
          .first<{ id: number }>();
      await tx
        .prepare(
          "DELETE FROM interview_evaluation_scores WHERE evaluation_id=?",
        )
        .bind(evaluation!.id)
        .run();
      for (const item of submittedScores)
        await tx
          .prepare(
            "INSERT INTO interview_evaluation_scores(evaluation_id,criterion_id,score,comments,created_at,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
          )
          .bind(
            evaluation!.id,
            Number(item.criterionId),
            Number(item.score),
            text(item.comments) || null,
          )
          .run();
      if (submit)
        await tx
          .prepare(
            "UPDATE interview_participants SET status='completed',updated_at=CURRENT_TIMESTAMP WHERE interview_id=? AND employee_id=?",
          )
          .bind(interviewId, actor.employeeId)
          .run();
      return evaluation!.id;
    });
  if (submit) {
    const pending = await db
      .prepare(
        "SELECT 1 FROM interview_participants p LEFT JOIN interview_evaluations e ON e.interview_id=p.interview_id AND e.interviewer_employee_id=p.employee_id AND e.status='submitted' WHERE p.interview_id=? AND p.required=1 AND e.id IS NULL LIMIT 1",
      )
      .bind(interviewId)
      .first();
    if (!pending) {
      await db
        .prepare(
          "UPDATE interviews SET status='completed',updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(interviewId)
        .run();
      const owners = await db
        .prepare(
          "SELECT DISTINCT x.employee_id FROM (SELECT j.recruiter_employee_id AS employee_id FROM interviews i JOIN candidate_applications a ON a.id=i.application_id JOIN job_openings j ON j.id=a.job_id WHERE i.id=? UNION SELECT j.hiring_manager_employee_id FROM interviews i JOIN candidate_applications a ON a.id=i.application_id JOIN job_openings j ON j.id=a.job_id WHERE i.id=?) x WHERE x.employee_id IS NOT NULL",
        )
        .bind(interviewId, interviewId)
        .all();
      for (const owner of owners.results)
        await notifyEmployee(db, Number(owner.employee_id), {
          type: "recruitment",
          title: "all_evaluations_completed",
          entityType: "interview",
          entityId: interviewId,
          path: "recruitment",
          key: `interview:${interviewId}:evaluations-complete:${owner.employee_id}`,
        });
    }
  }
  await audit(
    db,
    actor,
    submit ? "evaluation_submitted" : "evaluation_draft_saved",
    "recruitment",
    "interview_evaluation",
    evaluationId,
    {
      interviewId,
      overallScore: overall,
      recommendation: submit ? recommendation : undefined,
    },
  );
  return Response.json({
    ok: true,
    id: evaluationId,
    overallScore: overall,
    status: submit ? "submitted" : "draft",
  });
}

async function createQuestion(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  input: JsonRecord,
) {
  if (!isRecruitmentAdmin(actor))
    throw new Response(
      "Question bank management is restricted to HR administrators",
      { status: 403 },
    );
  const row = await db
    .prepare(
      "INSERT INTO interview_questions(question,what_good_looks_like,evaluation_guidance,question_type,department_id,job_id,job_family,skill,competency,seniority,interview_stage,interviewer_role,score_min,score_max,status,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,5,'active',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id",
    )
    .bind(
      required(input.question, "question"),
      text(input.whatGoodLooksLike) || null,
      text(input.evaluationGuidance) || null,
      required(input.questionType, "question type"),
      number(input.departmentId) || null,
      number(input.jobId) || null,
      text(input.jobFamily) || null,
      text(input.skill) || null,
      text(input.competency) || null,
      text(input.seniority) || null,
      text(input.interviewStage) || null,
      text(input.interviewerRole) || null,
      actor.id,
    )
    .first<{ id: number }>();
  await audit(
    db,
    actor,
    "interview_question_created",
    "recruitment",
    "interview_question",
    row!.id,
    { questionType: input.questionType },
  );
  return Response.json({ ok: true, id: row!.id }, { status: 201 });
}

async function updateQuestion(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  input: JsonRecord,
) {
  if (!isRecruitmentAdmin(actor)) throw new Response("Question bank management is restricted to HR administrators", { status: 403 });
  const status = text(input.status) || "active";
  if (!["active", "inactive"].includes(status)) throw new Response("Invalid question status", { status: 400 });
  if (!["technical", "behavioral", "situational", "leadership", "communication", "culture_fit", "role_specific", "verification"].includes(text(input.questionType)))
    throw new Response("Invalid question type", { status: 400 });
  const questionId = await db.transaction(async tx => {
    const old = await tx.prepare("SELECT * FROM interview_questions WHERE id=? FOR UPDATE").bind(number(input.questionId)).first();
    if (!old) throw new Response("Interview question not found", { status: 404 });
    // Keep questions referenced by existing job plans and evaluations unchanged.
    const row = await tx.prepare("INSERT INTO interview_questions(question,what_good_looks_like,evaluation_guidance,question_type,department_id,job_id,job_family,skill,competency,seniority,interview_stage,interviewer_role,score_min,score_max,status,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id")
      .bind(required(input.question, "question"), text(input.whatGoodLooksLike) || null, text(input.evaluationGuidance) || null, required(input.questionType, "question type"), old.department_id, old.job_id, old.job_family, old.skill, old.competency, old.seniority, old.interview_stage, old.interviewer_role, old.score_min, old.score_max, status, actor.id).first<{id: number}>();
    await tx.prepare("UPDATE interview_template_stage_questions SET question_id=?,updated_at=CURRENT_TIMESTAMP WHERE question_id=?").bind(row!.id, old.id).run();
    await tx.prepare("UPDATE interview_questions SET status='superseded',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(old.id).run();
    return row!.id;
  });
  await audit(db, actor, "interview_question_updated", "recruitment", "interview_question", questionId, { previousId: input.questionId });
  return Response.json({ ok: true, id: questionId });
}

async function deleteQuestion(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  input: JsonRecord,
) {
  if (!isRecruitmentAdmin(actor))
    throw new Response("Question bank management is restricted to HR administrators", { status: 403 });
  const questionId = number(input.questionId);
  const question = await db.prepare("SELECT question FROM interview_questions WHERE id=?").bind(questionId).first<{ question: string }>();
  if (!question) throw new Response("Interview question not found", { status: 404 });
  const inUse = await db.prepare("SELECT 1 FROM interview_stage_questions WHERE question_id=? LIMIT 1").bind(questionId).first();
  if (inUse) throw new Response("This question is assigned to an active interview plan and cannot be deleted. Mark it inactive instead.", { status: 409 });
  await db.prepare("DELETE FROM interview_questions WHERE id=?").bind(questionId).run();
  await audit(db, actor, "interview_question_deleted", "recruitment", "interview_question", questionId, { question: question.question });
  return Response.json({ ok: true });
}

async function createTemplate(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  input: JsonRecord,
) {
  if (!isRecruitmentAdmin(actor))
    throw new Response(
      "Interview template management is restricted to HR administrators",
      { status: 403 },
    );
  const editing = input.action === "update_template";
  const status = text(input.status) || "active";
  const scope = text(input.scopeType) || "company";
  if (!["active", "inactive"].includes(status) || !["company", "department", "job_family", "job"].includes(scope))
    throw new Response("Invalid template settings", { status: 400 });
  if ((scope === "department" && !number(input.departmentId)) || (scope === "job" && !number(input.jobId)) || (scope === "job_family" && !text(input.jobFamily)))
    throw new Response("Complete the template scope", { status: 400 });
  const stages = asRows(input.stages);
  for (const stage of stages) {
    if (![Number(stage.aggregationWeight), ...asRows(stage.criteria).map(item => Number(item.weight))].every(weight => Number.isFinite(weight) && weight > 0 && weight <= 100))
      throw new Response("Weights must be greater than zero and at most 100", { status: 400 });
    if (!Number.isInteger(Number(stage.durationMinutes)) || Number(stage.durationMinutes) < 15)
      throw new Response("Interview duration must be at least 15 minutes", { status: 400 });
    for (const interviewer of asRows(stage.interviewers)) {
      if (!number(interviewer.employeeId) && !["recruiter", "hiring_manager", "department_manager"].includes(text(interviewer.roleKey)))
        throw new Response("Select an interviewer or a valid role", { status: 400 });
    }
  }
  if (!stages.length)
    throw new Response("At least one interview stage is required", {
      status: 400,
    });
  validateScorecardWeights(
    stages.map((stage) => ({ weight: Number(stage.aggregationWeight) })),
  );
  for (const stage of stages)
    validateScorecardWeights(
      asRows(stage.criteria).map((item) => ({ weight: Number(item.weight) })),
    );
  const templateId = await db.transaction(async (tx) => {
    const template = editing ? await tx.prepare("SELECT id FROM interview_templates WHERE id=? FOR UPDATE").bind(number(input.templateId)).first<{id: number}>() : await tx
      .prepare(
        "INSERT INTO interview_templates(name,scope_type,department_id,job_family,job_id,description,status,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,'active',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id",
      )
      .bind(
        required(input.name, "template name"),
        text(input.scopeType) || "company",
        number(input.departmentId) || null,
        text(input.jobFamily) || null,
        number(input.jobId) || null,
        text(input.description) || null,
        actor.id,
      )
      .first<{ id: number }>();
    if (!template) throw new Response("Interview template not found", { status: 404 });
    await tx.prepare("UPDATE interview_templates SET name=?,scope_type=?,department_id=?,job_family=?,job_id=?,description=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(required(input.name, "template name"), scope, scope === "department" ? number(input.departmentId) : null, scope === "job_family" ? text(input.jobFamily) : null, scope === "job" ? number(input.jobId) : null, text(input.description) || null, status, template.id).run();
    if (editing) await tx.prepare("DELETE FROM interview_template_stages WHERE template_id=?").bind(template.id).run();
    for (let index = 0; index < stages.length; index++) {
      const source = stages[index],
        stage = await tx
          .prepare(
            "INSERT INTO interview_template_stages(template_id,stage_key,name_en,name_ar,sort_order,duration_minutes,passing_guidance,required_feedback,independent_evaluations,aggregation_weight,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id",
          )
          .bind(
            template!.id,
            text(source.stageKey) || `stage_${index + 1}`,
            required(source.nameEn, "stage English name"),
            required(source.nameAr, "stage Arabic name"),
            (index + 1) * 10,
            Math.max(15, number(source.durationMinutes) || 60),
            text(source.passingGuidance) || null,
            source.requiredFeedback === false ? 0 : 1,
            source.independentEvaluations === false ? 0 : 1,
            Number(source.aggregationWeight),
          )
          .first<{ id: number }>();
      for (const interviewer of asRows(source.interviewers))
        await tx
          .prepare(
            "INSERT INTO interview_template_stage_interviewers(template_stage_id,role_key,employee_id,required,created_at,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
          )
          .bind(
            stage!.id,
            text(interviewer.roleKey) || null,
            number(interviewer.employeeId) || null,
            interviewer.required === false ? 0 : 1,
          )
          .run();
      for (const [questionIndex, questionId] of ids(
        source.questionIds,
      ).entries())
        await tx
          .prepare(
            "INSERT INTO interview_template_stage_questions(template_stage_id,question_id,sort_order,required,created_at,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
          )
          .bind(stage!.id, questionId, (questionIndex + 1) * 10, 1)
          .run();
      for (const [criterionIndex, criterion] of asRows(
        source.criteria,
      ).entries())
        await tx
          .prepare(
            "INSERT INTO interview_template_scorecard_criteria(template_stage_id,name_en,name_ar,description,weight,required,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
          )
          .bind(
            stage!.id,
            required(criterion.nameEn, "criterion English name"),
            required(criterion.nameAr, "criterion Arabic name"),
            text(criterion.description) || null,
            Number(criterion.weight),
            criterion.required === false ? 0 : 1,
            (criterionIndex + 1) * 10,
          )
          .run();
    }
    return template!.id;
  });
  await audit(
    db,
    actor,
    editing ? "interview_template_updated" : "interview_template_created",
    "recruitment",
    "interview_template",
    templateId,
    { name: input.name, stages: stages.length },
  );
  return Response.json({ ok: true, id: templateId }, { status: editing ? 200 : 201 });
}

async function deleteTemplate(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  input: JsonRecord,
) {
  if (!isRecruitmentAdmin(actor))
    throw new Response("Interview template management is restricted to HR administrators", { status: 403 });
  const templateId = number(input.templateId);
  const template = await db.prepare("SELECT name FROM interview_templates WHERE id=?").bind(templateId).first<{ name: string }>();
  if (!template) throw new Response("Interview template not found", { status: 404 });
  await db.prepare("DELETE FROM interview_templates WHERE id=?").bind(templateId).run();
  await audit(db, actor, "interview_template_deleted", "recruitment", "interview_template", templateId, { name: template.name });
  return Response.json({ ok: true });
}

async function deleteTemplateStage(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  input: JsonRecord,
) {
  if (!isRecruitmentAdmin(actor))
    throw new Response("Interview template management is restricted to HR administrators", { status: 403 });
  const stageId = number(input.templateStageId);
  const stage = await db.prepare("SELECT template_id, name_en FROM interview_template_stages WHERE id=?").bind(stageId).first<{ template_id: number; name_en: string }>();
  if (!stage) throw new Response("Interview stage not found", { status: 404 });
  const remaining = await db.prepare("SELECT COUNT(*)::int AS count FROM interview_template_stages WHERE template_id=?").bind(stage.template_id).first<{ count: number }>();
  if ((remaining?.count ?? 0) <= 1)
    throw new Response("A template must keep at least one stage. Delete the whole template instead.", { status: 409 });
  await db.prepare("DELETE FROM interview_template_stages WHERE id=?").bind(stageId).run();
  await audit(db, actor, "interview_template_stage_deleted", "recruitment", "interview_template_stage", stageId, { name: stage.name_en, templateId: stage.template_id });
  return Response.json({ ok: true });
}

async function createOffer(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  input: JsonRecord,
) {
  const applicationId = number(input.applicationId);
  await requireApplicationAccess(db, actor, applicationId, true);
  const context = await db
    .prepare(
      "SELECT a.candidate_id,a.job_id,s.stage_type,j.title,j.department_id,j.hiring_manager_employee_id FROM candidate_applications a JOIN recruitment_stages s ON s.id=a.current_stage_id JOIN job_openings j ON j.id=a.job_id WHERE a.id=?",
    )
    .bind(applicationId)
    .first<Row>();
  if (!context || context.stage_type !== "offer")
    throw new Response("Candidate must be in the configured offer stage", {
      status: 409,
    });
  const row = await db
    .prepare(
      "INSERT INTO job_offers(job_id,candidate_id,application_id,offer_date,joining_date,position,department_id,manager_employee_id,approval_status,status,notes,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'pending','draft',?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id",
    )
    .bind(
      context.job_id,
      context.candidate_id,
      applicationId,
      required(input.offerDate, "offer date"),
      required(input.joiningDate, "proposed start date"),
      text(input.position) || context.title,
      number(input.departmentId) || context.department_id,
      number(input.managerEmployeeId) || context.hiring_manager_employee_id,
      text(input.notes) || null,
      actor.id,
    )
    .first<{ id: number }>();
  await audit(db, actor, "offer_created", "recruitment", "job_offer", row!.id, {
    applicationId,
    joiningDate: input.joiningDate,
  });
  return Response.json({ ok: true, id: row!.id }, { status: 201 });
}

async function approveOffer(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  input: JsonRecord,
) {
  if (!isRecruitmentAdmin(actor))
    throw new Response("Offer approval is restricted to HR administrators", {
      status: 403,
    });
  const offerId = number(input.offerId),
    row = await db
      .prepare(
        "UPDATE job_offers SET approval_status=?,decided_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='draft' RETURNING application_id",
      )
      .bind(
        input.approved === false ? "rejected" : "approved",
        actor.id,
        offerId,
      )
      .first<Row>();
  if (!row) throw new Response("Draft offer not found", { status: 404 });
  await audit(
    db,
    actor,
    "offer_approval_updated",
    "recruitment",
    "job_offer",
    offerId,
    { approvalStatus: input.approved === false ? "rejected" : "approved" },
  );
  return Response.json({ ok: true });
}

async function decideOffer(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  input: JsonRecord,
) {
  const offerId = number(input.offerId),
    next = required(input.status, "status"),
    row = await db
      .prepare(
        "SELECT o.*,a.job_id FROM job_offers o JOIN candidate_applications a ON a.id=o.application_id WHERE o.id=? FOR UPDATE OF o",
      )
      .bind(offerId)
      .first<Row>();
  if (!row) throw new Response("Offer not found", { status: 404 });
  await requireApplicationAccess(db, actor, Number(row.application_id), true);
  transition(String(row.status), next, offerMoves, "offer transition");
  if (next === "sent" && row.approval_status !== "approved")
    throw new Response("Offer must be approved before it is sent", {
      status: 409,
    });
  await db.transaction(async (tx) => {
    await tx
      .prepare(
        "UPDATE job_offers SET status=?,decided_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .bind(next, actor.id, offerId)
      .run();
    if (next === "accepted")
      await tx
        .prepare(
          "UPDATE candidate_applications SET status='offer',updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(row.application_id)
        .run();
  });
  await audit(
    db,
    actor,
    "offer_status_updated",
    "recruitment",
    "job_offer",
    offerId,
    { from: row.status, to: next },
  );
  return Response.json({ ok: true });
}

async function convertHire(
  db: PostgresDatabase,
  actor: Awaited<ReturnType<typeof requireActor>>,
  input: JsonRecord,
) {
  await requireModule(db, actor, "recruitment", "approve");
  const offerId = number(input.offerId),
    converted = await db.transaction(async (tx) => {
      const offer = await tx
        .prepare(
          "SELECT o.*,a.id AS application_id,a.current_stage_id,a.status AS application_status,c.id AS candidate_id,c.name,c.email,c.converted_employee_id,j.department_id AS job_department_id,j.job_title_id,j.hiring_manager_employee_id,j.location AS job_location,j.employment_type,s.stage_type FROM job_offers o JOIN candidate_applications a ON a.id=o.application_id JOIN candidates c ON c.id=a.candidate_id JOIN job_openings j ON j.id=a.job_id JOIN recruitment_stages s ON s.id=a.current_stage_id WHERE o.id=? FOR UPDATE OF o,a,c",
        )
        .bind(offerId)
        .first<Row>();
      if (!offer) throw new Response("Offer not found", { status: 404 });
      await requireApplicationAccess(
        tx,
        actor,
        Number(offer.application_id),
        true,
      );
      if (offer.status !== "accepted")
        throw new Response("Offer must be accepted", { status: 409 });
      if (offer.stage_type !== "offer")
        throw new Response("Application is not in the offer stage", {
          status: 409,
        });
      if (offer.converted_employee_id)
        throw new Response("Candidate already converted", { status: 409 });
      const employee = await createEmployeeRecord(tx, {
          companyId:input.companyId,branchId:input.branchId,positionId:input.positionId,sectionId:input.sectionId,teamId:input.teamId,gradeId:input.gradeId,workLocationId:input.workLocationId,hrUserId:input.hrUserId,
          nameEn: String(offer.name),
          nameAr: text(input.nameAr) || String(offer.name),
          workEmail: String(offer.email),
          startDate: String(offer.joining_date),
          country: required(input.country, "country"),
          departmentId:
            number(offer.department_id) ||
            number(offer.job_department_id) ||
            null,
          jobTitleId: number(offer.job_title_id) || null,
          managerId:
            number(offer.manager_employee_id) ||
            number(offer.hiring_manager_employee_id) ||
            null,
          workLocation: text(offer.job_location) || null,
          employmentType: text(offer.employment_type) || "full_time",
        }),
        hiredStage = await tx
          .prepare(
            "SELECT id FROM recruitment_stages WHERE job_id=? AND stage_type='hired' ORDER BY sort_order LIMIT 1",
          )
          .bind(offer.job_id)
          .first<{ id: number }>();
      await tx
        .prepare(
          "UPDATE candidates SET stage='hired',converted_employee_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND converted_employee_id IS NULL",
        )
        .bind(employee.id, offer.candidate_id)
        .run();
      await tx
        .prepare(
          "UPDATE candidate_applications SET status='hired',current_stage_id=?,stage_entered_at=CURRENT_TIMESTAMP,decision_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(hiredStage!.id, offer.application_id)
        .run();
      await tx
        .prepare(
          "INSERT INTO candidate_stage_history(application_id,from_stage_id,to_stage_id,action,actor_user_id,created_at) VALUES (?,?,?,'hired',?,CURRENT_TIMESTAMP)",
        )
        .bind(
          offer.application_id,
          offer.current_stage_id,
          hiredStage!.id,
          actor.id,
        )
        .run();
      const template = await tx
        .prepare(
          "SELECT id FROM lifecycle_templates WHERE lifecycle_type='onboarding' AND status='active' ORDER BY id LIMIT 1",
        )
        .first<{ id: number }>();
      let lifecycleId: number | null = null;
      if (template) {
        const lifecycle = await tx
          .prepare(
            "INSERT INTO employee_lifecycles(employee_id,lifecycle_type,template_id,status,started_by_user_id,created_at,updated_at) VALUES (?,'onboarding',?,'in_progress',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id",
          )
          .bind(employee.id, template.id, actor.id)
          .first<{ id: number }>();
        lifecycleId = lifecycle!.id;
        const tasks = (
          await tx
            .prepare(
              "SELECT * FROM lifecycle_template_tasks WHERE template_id=? ORDER BY sort_order",
            )
            .bind(template.id)
            .all()
        ).results;
        for (const task of tasks) {
          const selectedOwnerId = Number(task.owner_user_id) || 0,
            ownerType = String(task.owner_type),
            owner = selectedOwnerId
              ? await tx
                  .prepare(
                    "SELECT id FROM users WHERE id=? AND status='active'",
                  )
                  .bind(selectedOwnerId)
                  .first<{ id: number }>()
              : ownerType === "employee"
                ? await tx
                    .prepare("SELECT id FROM users WHERE employee_id=?")
                    .bind(employee.id)
                    .first<{ id: number }>()
                : ownerType === "manager"
                  ? await tx
                      .prepare("SELECT u.id FROM users u WHERE u.employee_id=?")
                      .bind(
                        number(offer.manager_employee_id) ||
                          number(offer.hiring_manager_employee_id),
                      )
                      .first<{ id: number }>()
                  : await tx
                      .prepare(
                        "SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name IN ('HR Manager','Super Admin') AND u.status='active' ORDER BY CASE r.name WHEN 'HR Manager' THEN 0 ELSE 1 END,u.id LIMIT 1",
                      )
                      .first<{ id: number }>();
          await tx
            .prepare(
              "INSERT INTO lifecycle_tasks(lifecycle_id,title,owner_user_id,employee_id,due_date,status,required,created_at,updated_at) VALUES (?,?,?,?,(?::date + (? * INTERVAL '1 day'))::date::text,'pending',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
            )
            .bind(
              lifecycleId,
              task.title,
              owner?.id || null,
              employee.id,
              offer.joining_date,
              task.due_offset_days,
              task.required,
            )
            .run();
        }
      }
      return {
        ...employee,
        lifecycleId,
        candidateId: Number(offer.candidate_id),
        applicationId: Number(offer.application_id),
      };
    });
  await audit(
    db,
    actor,
    "candidate_hired",
    "recruitment",
    "candidate",
    converted.candidateId,
    {
      applicationId: converted.applicationId,
      employeeId: converted.id,
      lifecycleId: converted.lifecycleId,
    },
  );
  return Response.json(
    {
      ok: true,
      employeeId: converted.id,
      employeeCode: converted.code,
      lifecycleId: converted.lifecycleId,
    },
    { status: 201 },
  );
}

export async function handleRecruitmentPost(request: Request) {
  const db = createDatabase();
  try {
    enforceWriteOrigin(request);
    const actor = await requireActor(request, db);
    await enforceRateLimit(db, request, "recruitment-write", 180, 60, actor.id);
    if (request.headers.get("content-type")?.includes("multipart/form-data"))
      return await uploadCv(request, db, actor);
    const input = await body(request),
      action = required(input.action, "action");
    if (action === "create_job") return await createJob(db, actor, input);
    if (action === "update_job_requirements")
      return await updateJobRequirements(db, actor, input);
    if (action === "add_candidate") return await addCandidate(db, actor, input);
    if (action === "update_candidate")
      return await updateCandidate(db, actor, input);
    if (action === "run_match") return await runMatch(db, actor, input);
    if (action === "move_application")
      return await moveApplication(db, actor, input);
    if (action === "set_application_status")
      return await setApplicationStatus(db, actor, input);
    if (action === "reject_application")
      return await rejectApplication(db, actor, input);
    if (action === "schedule_interview")
      return await scheduleInterview(db, actor, input);
    if (action === "reschedule_interview")
      return await rescheduleInterview(db, actor, input);
    if (action === "cancel_interview")
      return await cancelInterview(db, actor, input);
    if (action === "save_evaluation")
      return await saveEvaluation(db, actor, input, false);
    if (action === "submit_evaluation")
      return await saveEvaluation(db, actor, input, true);
    if (action === "update_question") return await updateQuestion(db, actor, input);
    if (action === "create_question")
      return await createQuestion(db, actor, input);
    if (action === "delete_question") return await deleteQuestion(db, actor, input);
    if (action === "create_template" || action === "update_template")
      return await createTemplate(db, actor, input);
    if (action === "delete_template") return await deleteTemplate(db, actor, input);
    if (action === "delete_template_stage")
      return await deleteTemplateStage(db, actor, input);
    if (action === "create_offer") return await createOffer(db, actor, input);
    if (action === "approve_offer") return await approveOffer(db, actor, input);
    if (action === "decide_offer") return await decideOffer(db, actor, input);
    if (action === "convert_hire") return await convertHire(db, actor, input);
    throw new Response("Unsupported recruitment action", { status: 400 });
  } catch (error) {
    return apiFailure(error, "Recruitment action failed");
  } finally {
    await db.close();
  }
}
