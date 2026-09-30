// Learning & development rules shared by the API and the workspace so both agree on what
// "overdue", "expiring" and "completion rate" mean. No imports: this file is safe in a client bundle.
type Row = Record<string, unknown>;

export const COURSE_TYPES = ["internal", "external", "online"];
export const LEARNER_STATUSES = ["active", "probation", "notice_period"];
export const LEARNER_STATUS_SQL = `(${LEARNER_STATUSES.map(status => `'${status}'`).join(",")})`;
export const OPEN_STATUSES = ["assigned", "in_progress"];
export const CERTIFICATE_WARNING_DAYS = 30;
export const LEARNING_ADMIN_ROLES = ["Super Admin", "HR Manager"];
export const MAX_DURATION_HOURS = 1000;
export const MATERIAL_KINDS = ["link", "file"];
export const MAX_MATERIALS_PER_COURSE = 20;
export const MAX_MATERIAL_BYTES = 20 * 1024 * 1024;
export const MATERIAL_FILE_ACCEPT = ".pdf,.png,.jpg,.jpeg";

export const ENROLLMENT_MOVES: Record<string, string[]> = {
  assigned: ["in_progress", "completed", "failed", "cancelled"],
  in_progress: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};
export const COURSE_MOVES: Record<string, string[]> = {
  draft: ["active", "cancelled"],
  active: ["completed", "cancelled"],
  completed: ["active"],
  cancelled: [],
};

const bad = (message: string) => new Response(message, { status: 400 });

export function optionalIsoDate(value: unknown, label: string): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) throw bad(`Invalid ${label}`);
  return raw;
}

export function optionalScore(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 100) throw bad("Score must be between 0 and 100");
  return score;
}

export function optionalMonths(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "" || Number(value) === 0) return null;
  const months = Number(value);
  if (!Number.isInteger(months) || months < 1 || months > 600) throw bad("Certificate validity must be a whole number of months between 1 and 600");
  return months;
}

/** Total contact time of a program, in hours (fractions allowed, e.g. 1.5). */
export function parseDurationHours(value: unknown): number {
  const raw = String(value ?? "").trim();
  if (!raw) throw bad("Program duration is required");
  const hours = Math.round(Number(raw) * 100) / 100;
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_DURATION_HOURS) throw bad(`Program duration must be more than 0 and at most ${MAX_DURATION_HOURS} hours`);
  return hours;
}

/** Who explains the program: exactly one of an internal employee or an external trainer's name. */
export function parseInstructor(input: Row) {
  const rawId = Number(input.instructorEmployeeId);
  const instructorEmployeeId = Number.isInteger(rawId) && rawId > 0 ? rawId : null;
  const instructorName = String(input.instructorName ?? "").trim().slice(0, 200) || null;
  if (instructorEmployeeId && instructorName) throw bad("Choose an internal instructor or enter an external name, not both");
  if (!instructorEmployeeId && !instructorName) throw bad("Instructor is required");
  return { instructorEmployeeId, instructorName };
}

export function parseCourseInput(input: Row) {
  const courseType = String(input.courseType ?? "").trim();
  if (!COURSE_TYPES.includes(courseType)) throw bad("Invalid course type");
  const startDate = optionalIsoDate(input.startDate, "start date");
  const endDate = optionalIsoDate(input.endDate, "end date");
  if (!startDate) throw bad("Start date is required");
  if (!endDate) throw bad("End date is required");
  if (endDate < startDate) throw bad("End date cannot be before start date");
  return { courseType, startDate, endDate, validityMonths: optionalMonths(input.validityMonths), durationHours: parseDurationHours(input.durationHours), ...parseInstructor(input) };
}

export function parseMaterialTitle(value: unknown): string {
  const title = String(value ?? "").trim().slice(0, 200);
  if (!title) throw bad("Material title is required");
  return title;
}

/** A material link must be a plain web address; anything else (javascript:, data:, file:) is refused. */
export function parseMaterialUrl(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) throw bad("Material link is required");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw bad("Material link must be a valid http or https address");
  }
  if (raw.length > 2000 || !/^https?:$/.test(url.protocol) || url.username || url.password) throw bad("Material link must be a valid http or https address");
  return url.toString();
}

export function addDays(isoDate: string, days: number) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

/** A finished enrollment can be assigned again when the attempt did not count or the certificate lapsed. */
export function canRenewEnrollment(row: Row, today: string) {
  if (row.status === "failed" || row.status === "cancelled") return true;
  return row.status === "completed" && Boolean(row.certificate_expiry) && String(row.certificate_expiry) < today;
}

/** Counts shown in the KPI tiles; cancelled work is excluded everywhere so it cannot skew compliance. */
export function summarizeEnrollments(rows: Row[], today: string, warningDays = CERTIFICATE_WARNING_DAYS) {
  const counted = rows.filter(row => row.status !== "cancelled");
  const open = counted.filter(row => OPEN_STATUSES.includes(String(row.status)));
  const completed = counted.filter(row => row.status === "completed");
  const horizon = addDays(today, warningDays);
  const expiry = (row: Row) => (row.certificate_expiry ? String(row.certificate_expiry) : "");
  return {
    open: open.length,
    inProgress: counted.filter(row => row.status === "in_progress").length,
    completed: completed.length,
    learnersInTraining: new Set(open.map(row => Number(row.employee_id))).size,
    overdue: open.filter(row => row.due_date && String(row.due_date) < today).length,
    mandatoryPending: open.filter(row => Number(row.mandatory) === 1).length,
    expiring: completed.filter(row => expiry(row) && expiry(row) >= today && expiry(row) <= horizon).length,
    expired: completed.filter(row => expiry(row) && expiry(row) < today).length,
    completionRate: counted.length ? Math.round((completed.length * 100) / counted.length) : 0,
  };
}
