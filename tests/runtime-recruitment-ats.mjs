import assert from "node:assert/strict";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import postgres from "postgres";

const base = process.env.RUNTIME_BASE_URL || "http://localhost:3000";
const password = process.env.RUNTIME_PASSWORD;
if (!password) throw new Error("RUNTIME_PASSWORD is required");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = postgres(process.env.DATABASE_URL, { ssl: false, max: 1 });
const stamp = Date.now().toString();
const passwordHash = () => {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, 210000, 32, "sha256");
  return `pbkdf2-sha256$210000$${salt.toString("base64url")}$${hash.toString("base64url")}`;
};

const [superRole] = await sql`select id from roles where name='Super Admin'`;
const [employeeRole] = await sql`select id from roles where name='Employee'`;
assert.ok(superRole?.id && employeeRole?.id, "system roles");
const adminEmail = `ats.runtime.admin.${stamp}@hr.local`;
await sql`
  insert into users(email,role_id,password_hash,status,must_change_password,session_version,created_at,updated_at)
  values(${adminEmail},${superRole.id},${passwordHash()},'active',0,1,current_timestamp,current_timestamp)
  returning id,email`;

const interviewerRows = [];
for (const number of [1, 2]) {
  const code = `ATSI-${stamp.slice(-8)}-${number}`;
  const email = `ats.interviewer.${number}.${stamp}@hr.local`;
  const [employee] = await sql`
    insert into employees(employee_code,name_en,name_ar,work_email,start_date,employment_status,country,created_at,updated_at)
    values(${code},${`ATS Interviewer ${number}`},${`محاور اختبار ${number}`},${email},current_date::text,'active','Egypt',current_timestamp,current_timestamp)
    returning id,employee_code`;
  const [user] = await sql`
    insert into users(email,employee_id,role_id,password_hash,status,must_change_password,session_version,created_at,updated_at)
    values(${email},${employee.id},${employeeRole.id},${passwordHash()},'active',0,1,current_timestamp,current_timestamp)
    returning id,email`;
  interviewerRows.push({ ...employee, userId: user.id, email });
}

const login = async (email) => {
  const response = await fetch(`${base}/api/auth`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, `${email}: ${await response.text()}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, `${email} session`);
  return cookie;
};
const adminCookie = await login(adminEmail);
const interviewerCookies = await Promise.all(interviewerRows.map((row) => login(row.email)));
const request = async (cookie, path, payload, multipart = false) => {
  const response = await fetch(`${base}${path}`, {
    method: payload == null ? "GET" : "POST",
    headers: {
      cookie,
      origin: base,
      "sec-fetch-site": "same-origin",
      ...(!multipart && payload != null ? { "content-type": "application/json" } : {}),
    },
    body: payload == null ? undefined : multipart ? payload : JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
};
const call = async (cookie, path, payload, multipart = false) => {
  const result = await request(cookie, path, payload, multipart);
  assert.ok(result.response.ok, `${path} ${result.response.status}: ${JSON.stringify(result.body)}`);
  return result.body;
};
const expectStatus = async (cookie, path, payload, status) => {
  const result = await request(cookie, path, payload);
  assert.equal(result.response.status, status, `${path}: ${JSON.stringify(result.body)}`);
  return result.body;
};

const overview = await call(adminCookie, "/api/recruitment?view=overview");
const department = overview.departments[0];
const owner = overview.employees.find((row) => Number(row.department_id) === Number(department?.id)) || overview.employees[0];
const template = overview.templates[0];
assert.ok(department?.id && owner?.id && template?.id, "recruitment setup data");
const requirements = [
  { category: "work_experience", name: "3+ years of data analysis experience", priority: "required", weight: 30, minimumValue: "3" },
  { category: "technical_skills", name: "SQL Python", description: "Practical SQL and Python delivery", priority: "required", weight: 40 },
  { category: "education", name: "Computer Science", description: "Bachelor degree or equivalent", priority: "preferred", weight: 20 },
  { category: "language", name: "English", priority: "preferred", weight: 10 },
];
const createJob = (title) => call(adminCookie, "/api/recruitment", {
  action: "create_job",
  title,
  departmentId: department.id,
  hiringManagerEmployeeId: owner.id,
  recruiterEmployeeId: owner.id,
  location: "Cairo / Hybrid",
  employmentType: "full_time",
  openingsCount: 1,
  status: "open",
  summary: "Build reliable workforce analytics products.",
  responsibilities: "Analyze business data and communicate evidence-based recommendations.",
  description: "Production data analyst role.",
  templateId: template.id,
  requirements,
  screeningQuestions: [{
    question: "Are you available to start within 45 days?",
    answerType: "yes_no",
    importance: "knockout",
    knockoutRule: { operator: "equals", value: "Yes" },
  }],
});
const job = await createJob(`Senior Data Analyst — ATS verification ${stamp}`);
const secondJob = await createJob(`Data Quality Analyst — ATS verification ${stamp}`);

const candidateEmail = `mohamed.ats.${stamp}@example.com`;
const candidate = await call(adminCookie, "/api/recruitment", {
  action: "add_candidate",
  jobId: job.id,
  name: "Mohamed Ahmed Hassan",
  email: candidateEmail,
  phone: "+20 100 555 0101",
  location: "Cairo",
  currentJobTitle: "Data Analyst",
  currentCompany: "Nile Insights",
  totalExperience: 4.5,
  education: ["BSc Computer Science"],
  skills: ["SQL", "Python", "Power BI"],
  languages: ["Arabic", "English"],
  source: "employee_referral",
  screeningAnswers: {},
});
assert.equal(candidate.flags.length, 1, "knockout answer is flagged, not rejected");
const secondApplication = await call(adminCookie, "/api/recruitment", {
  action: "add_candidate",
  jobId: secondJob.id,
  name: "Mohamed Ahmed Hassan",
  email: candidateEmail,
  source: "talent_pool",
});
assert.equal(secondApplication.candidateId, candidate.candidateId, "candidate profile deduplicated across jobs");

let profile = await call(adminCookie, `/api/recruitment?view=candidate&id=${candidate.candidateId}&applicationId=${candidate.applicationId}`);
const technicalStage = profile.stages.find((row) => row.stage_key === "technical_interview");
await expectStatus(adminCookie, "/api/recruitment", {
  action: "move_application", applicationId: candidate.applicationId, stageId: technicalStage.id,
}, 409);

const form = new FormData();
form.set("applicationId", String(candidate.applicationId));
form.set("candidateId", String(candidate.candidateId));
form.set("file", new File([`Mohamed Ahmed Hassan\n${candidateEmail}\n+20 100 555 0101\nData Analyst at Nile Insights\n2019 - 2024\nSkills: SQL, Python, Power BI\nLanguages: Arabic, English\nBSc Computer Science`], "mohamed-ahmed-cv.txt", { type: "text/plain" }));
const upload = await call(adminCookie, "/api/recruitment", form, true);
assert.equal(upload.parsingStatus, "complete");
let match = await call(adminCookie, "/api/recruitment", { action: "run_match", applicationId: candidate.applicationId });
assert.ok(match.overallScore >= 70 && match.requirements.length === 4, "explainable weighted match");
profile = await call(adminCookie, `/api/recruitment?view=candidate&id=${candidate.candidateId}&applicationId=${candidate.applicationId}`);
assert.equal(profile.requirementScores.length, 4);
assert.ok(profile.requirementScores.every((row) => row.rationale && row.evidence_status));
await call(adminCookie, "/api/recruitment", {
  action: "update_candidate",
  applicationId: candidate.applicationId,
  candidateId: candidate.candidateId,
  documentId: upload.documentId,
  name: "Mohamed Ahmed Hassan",
  email: candidateEmail,
  phone: "+20 100 555 0101",
  location: "Cairo",
  currentJobTitle: "Senior Data Analyst",
  currentCompany: "Nile Insights",
  totalExperience: 5,
  education: ["BSc Computer Science"],
  skills: ["SQL", "Python", "Power BI"],
  languages: ["Arabic", "English"],
  certifications: [],
  projects: ["Enterprise analytics warehouse"],
  correctedCv: { totalExperience: 5, currentJobTitle: "Senior Data Analyst" },
});
profile = await call(adminCookie, `/api/recruitment?view=candidate&id=${candidate.candidateId}&applicationId=${candidate.applicationId}`);
assert.equal(Number(profile.match.is_stale), 1, "human correction marks old match stale");
match = await call(adminCookie, "/api/recruitment", { action: "run_match", applicationId: candidate.applicationId });
assert.equal(match.overallScore >= 70, true);

for (const key of ["screening", "shortlisted", "hr_interview", "technical_interview"]) {
  profile = await call(adminCookie, `/api/recruitment?view=candidate&id=${candidate.candidateId}&applicationId=${candidate.applicationId}`);
  const stage = profile.stages.find((row) => row.stage_key === key);
  await call(adminCookie, "/api/recruitment", { action: "move_application", applicationId: candidate.applicationId, stageId: stage.id });
}
profile = await call(adminCookie, `/api/recruitment?view=candidate&id=${candidate.candidateId}&applicationId=${candidate.applicationId}`);
const planStage = profile.planStages.find((row) => row.stage_key === "technical_interview") || profile.planStages[0];
const scheduledAt = new Date(Date.now() + 14 * 86400000 + Number(stamp.slice(-5)) * 60000).toISOString();
const interview = await call(adminCookie, "/api/recruitment", {
  action: "schedule_interview",
  applicationId: candidate.applicationId,
  planStageId: planStage.id,
  interviewerEmployeeIds: interviewerRows.map((row) => row.id),
  scheduledAt,
  durationMinutes: 60,
  meetingMethod: "video",
  location: "https://meet.hr.local/ats-verification",
});
await expectStatus(adminCookie, "/api/recruitment", {
  action: "schedule_interview",
  applicationId: candidate.applicationId,
  planStageId: planStage.id,
  interviewerEmployeeIds: [interviewerRows[0].id],
  scheduledAt,
  durationMinutes: 60,
}, 409);
const rescheduledAt = new Date(new Date(scheduledAt).getTime() + 3 * 3600000).toISOString();
await call(adminCookie, "/api/recruitment", {
  action: "reschedule_interview", interviewId: interview.id, scheduledAt: rescheduledAt, durationMinutes: 75, meetingMethod: "video", location: "HR Meet",
});

const interviewData = await call(interviewerCookies[0], `/api/recruitment?view=interview&id=${interview.id}`);
assert.equal(interviewData.permissions.canEvaluate, true);
assert.equal(interviewData.otherEvaluations.length, 0, "other scores hidden before completion");
const scores = interviewData.criteria.map((criterion, index) => ({ criterionId: criterion.id, score: index % 2 ? 4 : 5, comment: "Evidence verified during structured interview." }));
await call(interviewerCookies[0], "/api/recruitment", {
  action: "save_evaluation", interviewId: interview.id, scores, recommendation: "strong_hire", notes: "Draft evidence notes retained before submission.",
});
await call(interviewerCookies[0], "/api/recruitment", {
  action: "submit_evaluation", interviewId: interview.id, scores, recommendation: "strong_hire", notes: "Strong evidence across technical depth, communication, and problem solving.",
});
const privateView = await call(interviewerCookies[1], `/api/recruitment?view=interview&id=${interview.id}`);
assert.equal(privateView.otherEvaluations.length, 0, "first recommendation remains private from second interviewer");
await call(interviewerCookies[1], "/api/recruitment", {
  action: "submit_evaluation", interviewId: interview.id, scores, recommendation: "hire", notes: "Candidate demonstrated sound practical judgment and relevant production experience.",
});
await expectStatus(interviewerCookies[1], "/api/recruitment", {
  action: "submit_evaluation", interviewId: interview.id, scores, recommendation: "hire", notes: "Duplicate submission must remain blocked.",
}, 409);
profile = await call(adminCookie, `/api/recruitment?view=candidate&id=${candidate.candidateId}&applicationId=${candidate.applicationId}`);
assert.equal(
  profile.evaluationSummary.stageResults.find((row) => Number(row.id) === Number(planStage.id)).complete,
  true,
  "all required evaluations for the scheduled stage are complete",
);
assert.equal(profile.evaluationSummary.allRequiredComplete, false, "future configured stages remain visibly incomplete");
assert.equal(profile.evaluations.length, 2);
assert.ok(profile.evaluationSummary.formula.stageAggregation);

for (const key of ["management_interview", "final_review", "offer"]) {
  profile = await call(adminCookie, `/api/recruitment?view=candidate&id=${candidate.candidateId}&applicationId=${candidate.applicationId}`);
  const stage = profile.stages.find((row) => row.stage_key === key);
  await call(adminCookie, "/api/recruitment", { action: "move_application", applicationId: candidate.applicationId, stageId: stage.id });
}
const today = new Date().toISOString().slice(0, 10);
const joiningDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const offer = await call(adminCookie, "/api/recruitment", {
  action: "create_offer", applicationId: candidate.applicationId, offerDate: today, joiningDate, position: "Senior Data Analyst", departmentId: department.id, managerEmployeeId: owner.id,
});
await call(adminCookie, "/api/recruitment", { action: "approve_offer", offerId: offer.id, approved: true });
await call(adminCookie, "/api/recruitment", { action: "decide_offer", offerId: offer.id, status: "sent" });
await call(adminCookie, "/api/recruitment", { action: "decide_offer", offerId: offer.id, status: "accepted" });
const hire = await call(adminCookie, "/api/recruitment", { action: "convert_hire", offerId: offer.id, nameAr: "محمد أحمد حسن", country: "Egypt" });
assert.ok(hire.employeeId && hire.lifecycleId, "hire creates employee and starts existing onboarding");
await expectStatus(adminCookie, "/api/recruitment", { action: "convert_hire", offerId: offer.id, nameAr: "محمد أحمد حسن", country: "Egypt" }, 409);
const onboarding = await call(adminCookie, `/api/lifecycle?employeeId=${hire.employeeId}`);
assert.ok(onboarding.lifecycles.some((row) => row.lifecycle_type === "onboarding"));

const [evidence] = await sql`
  select
    (select count(*)::int from audit_logs where module='recruitment' and created_at>current_timestamp-interval '30 minutes') as audits,
    (select count(*)::int from candidate_stage_history where application_id=${candidate.applicationId}) as stage_events,
    (select count(*)::int from interview_evaluations where interview_id=${interview.id} and status='submitted') as submitted_evaluations`;
assert.ok(evidence.audits >= 15);
assert.ok(evidence.stage_events >= 8);
assert.equal(evidence.submitted_evaluations, 2);

console.log(JSON.stringify({
  jobId: job.id,
  candidateId: candidate.candidateId,
  applications: [candidate.applicationId, secondApplication.applicationId],
  cvDocumentId: upload.documentId,
  matchScore: match.overallScore,
  interviewId: interview.id,
  independentEvaluations: evidence.submitted_evaluations,
  consolidatedScore: profile.evaluationSummary.decisionSupportScore,
  offerId: offer.id,
  employeeId: hire.employeeId,
  onboardingId: hire.lifecycleId,
  auditEvents: evidence.audits,
  stageHistoryEvents: evidence.stage_events,
}, null, 2));
await sql.end();
