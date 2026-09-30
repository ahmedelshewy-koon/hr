/**
 * evaluation-access-doctor.mjs  (READ-ONLY — never writes)
 *
 * Diagnoses "Only an assigned interviewer can evaluate this interview".
 * To submit an evaluation the login account must satisfy BOTH:
 *   (1) users.employee_id is set (account is linked to an employee)
 *   (2) that employee is a participant of the interview (interview_participants)
 *
 * Usage (PowerShell):
 *   $env:DATABASE_URL="<production connection string>"
 *   node evaluation-access-doctor.mjs --email=you@company.com --interview=123
 *   node evaluation-access-doctor.mjs --email=you@company.com --candidate="اسم المرشح"
 *   node evaluation-access-doctor.mjs --email=you@company.com        # lists recent interviews
 */
import postgres from "postgres";

const arg = (k) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : null;
};
const email = arg("email");
const interviewId = arg("interview") ? Number(arg("interview")) : null;
const candidate = arg("candidate");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL to your PRODUCTION connection string first.");
  process.exit(1);
}
const sql = postgres(url, { ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : "require", max: 1 });
const line = (s) => console.log(s);
const q = (v) => (v == null ? "NULL" : v);

try {
  // ---- (A) account ----
  let account = null;
  if (email) {
    account = (await sql`
      SELECT u.id AS user_id, u.email, u.status, r.name AS role,
             u.employee_id, e.name_en AS employee, e.employment_status
      FROM users u JOIN roles r ON r.id=u.role_id
      LEFT JOIN employees e ON e.id=u.employee_id
      WHERE lower(u.email)=lower(${email})`)[0] || null;
    line("\n===== ACCOUNT =====");
    if (!account) line(`No user found for email: ${email}`);
    else {
      console.table([account]);
      if (account.employee_id == null)
        line("⚠ This account is NOT linked to an employee (employee_id NULL) → it can NEVER evaluate. Use the interviewer's own employee account.");
    }
  }

  // ---- (B) locate interview(s) ----
  let interviews = [];
  if (interviewId) {
    interviews = await sql`
      SELECT i.id, i.status, i.scheduled_at, c.name AS candidate, j.title AS job, ps.name_en AS stage
      FROM interviews i
      JOIN candidate_applications a ON a.id=i.application_id
      JOIN candidates c ON c.id=a.candidate_id
      JOIN job_openings j ON j.id=a.job_id
      LEFT JOIN interview_plan_stages ps ON ps.id=i.plan_stage_id
      WHERE i.id=${interviewId}`;
  } else if (candidate) {
    interviews = await sql`
      SELECT i.id, i.status, i.scheduled_at, c.name AS candidate, j.title AS job, ps.name_en AS stage
      FROM interviews i
      JOIN candidate_applications a ON a.id=i.application_id
      JOIN candidates c ON c.id=a.candidate_id
      JOIN job_openings j ON j.id=a.job_id
      LEFT JOIN interview_plan_stages ps ON ps.id=i.plan_stage_id
      WHERE c.name ILIKE ${"%" + candidate + "%"}
      ORDER BY i.scheduled_at DESC LIMIT 25`;
  } else {
    interviews = await sql`
      SELECT i.id, i.status, i.scheduled_at, c.name AS candidate, j.title AS job, ps.name_en AS stage
      FROM interviews i
      JOIN candidate_applications a ON a.id=i.application_id
      JOIN candidates c ON c.id=a.candidate_id
      JOIN job_openings j ON j.id=a.job_id
      LEFT JOIN interview_plan_stages ps ON ps.id=i.plan_stage_id
      ORDER BY i.scheduled_at DESC LIMIT 25`;
  }
  line("\n===== INTERVIEW(S) =====");
  if (!interviews.length) { line("No interview matched."); await sql.end(); process.exit(0); }
  console.table(interviews);
  if (!interviewId && interviews.length > 1) {
    line("\nMore than one match. Re-run with --interview=<id> for a full diagnosis.");
    await sql.end(); process.exit(0);
  }

  const iv = interviews[0];

  // ---- (C) participants + their login accounts + evaluation status ----
  const parts = await sql`
    SELECT p.employee_id, e.name_en AS interviewer, e.employment_status,
           u.email AS login_email,
           COALESCE(ev.status,'none') AS evaluation_status
    FROM interview_participants p
    JOIN employees e ON e.id=p.employee_id
    LEFT JOIN users u ON u.employee_id=p.employee_id
    LEFT JOIN interview_evaluations ev ON ev.interview_id=p.interview_id AND ev.interviewer_employee_id=p.employee_id
    WHERE p.interview_id=${iv.id}
    ORDER BY p.id`;
  line("\n===== ASSIGNED INTERVIEWERS =====");
  if (!parts.length) line("No interviewers are assigned to this interview.");
  else console.table(parts);

  // ---- (D) verdict ----
  line("\n===== DIAGNOSIS =====");
  if (account) {
    const isParticipant = account.employee_id != null && parts.some((p) => Number(p.employee_id) === Number(account.employee_id));
    if (isParticipant) line(`✅ ${email} IS an assigned interviewer for interview ${iv.id} — it can evaluate. If it still fails, check the account is active and re-login.`);
    else if (account.employee_id == null) {
      const withLogin = parts.filter((p) => p.login_email);
      line(`❌ ${email} is not linked to an employee, so it is not an interviewer here.`);
      if (withLogin.length) line(`➡ FIX (recommended): log in as one of the assigned interviewers instead: ${withLogin.map((p) => p.login_email).join(", ")}`);
      else line("➡ The assigned interviewers have no login accounts — create one via the Users screen, then evaluate from it.");
    } else {
      line(`❌ ${email} (employee_id=${account.employee_id}, "${account.employee}") is NOT among the assigned interviewers of interview ${iv.id}.`);
      line("➡ FIX option 1: log in as an already-assigned interviewer above.");
      line("➡ FIX option 2: add this employee as an interviewer. Review, then run this ONE statement on production:");
      line("");
      line(`   BEGIN;`);
      line(`   INSERT INTO interview_participants (interview_id, employee_id, required, status, created_at, updated_at)`);
      line(`   SELECT ${iv.id}, ${account.employee_id}, 1, 'assigned', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP`);
      line(`   WHERE NOT EXISTS (SELECT 1 FROM interview_participants WHERE interview_id=${iv.id} AND employee_id=${account.employee_id});`);
      line(`   COMMIT;`);
      line("");
      line("   (Undo: DELETE FROM interview_participants WHERE interview_id=" + iv.id + " AND employee_id=" + account.employee_id + ";)");
    }
  } else {
    line("Pass --email=<your login email> to get a personalized verdict and the exact fix.");
  }
} catch (e) {
  console.error("ERROR:", e.message);
  process.exit(1);
} finally {
  await sql.end();
}
