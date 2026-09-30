// Training evaluation and certificate rules shared by the API, the evaluation popup and the certificate page,
// so all three agree on the criteria, the weights, the pass mark and what a certificate contains.
// No imports: this file is safe in a client bundle.
type Row = Record<string, unknown>;

/** The company name printed on every certificate. */
export const CERTIFICATE_ISSUER = { en: "Koon software solo", ar: "Koon software solo" };
export const CERTIFICATE_PREFIX = "KSS";

/** Overall score (0-100) a learner needs for the training to count as passed and a certificate to be issued. */
export const PASS_MARK = 60;

/** Weights add up to 100, so the overall score is a plain weighted average. */
export const EVALUATION_CRITERIA = [
  { key: "knowledge", weight: 25, en: "Theoretical knowledge", ar: "المعرفة النظرية", hintEn: "Understanding of the concepts covered in the program", hintAr: "استيعاب المفاهيم والمحتوى الذي قدّمه البرنامج" },
  { key: "practical", weight: 30, en: "Practical skills", ar: "المهارات العملية", hintEn: "Ability to apply what was learned on real tasks", hintAr: "القدرة على تطبيق ما تعلّمه في مهام فعلية" },
  { key: "assessment", weight: 20, en: "Final assessment", ar: "التقييم النهائي", hintEn: "Result of the closing test, exercise or project", hintAr: "نتيجة الاختبار أو التمرين أو المشروع الختامي" },
  { key: "attendance", weight: 15, en: "Attendance & commitment", ar: "الحضور والالتزام", hintEn: "Punctuality and completion of the required sessions", hintAr: "الانضباط في المواعيد وإتمام الجلسات المطلوبة" },
  { key: "participation", weight: 10, en: "Participation & teamwork", ar: "المشاركة والعمل الجماعي", hintEn: "Engagement in discussions and collaboration with others", hintAr: "التفاعل في النقاشات والتعاون مع الآخرين" },
] as const;

export const EVALUATION_GRADES = [
  { min: 90, key: "excellent", en: "Excellent", ar: "ممتاز" },
  { min: 80, key: "very_good", en: "Very Good", ar: "جيد جدًا" },
  { min: 70, key: "good", en: "Good", ar: "جيد" },
  { min: PASS_MARK, key: "pass", en: "Pass", ar: "مقبول" },
  { min: 0, key: "fail", en: "Not passed", ar: "لم يجتز" },
] as const;

export type Evaluation = {
  scores: Record<string, number>;
  overall: number;
  grade: string;
  passed: boolean;
  notes: string;
};

export type CertificateSignatory = {
  role: "instructor" | "department_manager" | "hr_manager";
  nameEn: string;
  nameAr: string;
  approvedAt?: string;
  userId?: number;
};

export type CertificateApproval = {
  role: "department_manager" | "hr_manager";
  employeeId: number | null;
  nameEn: string;
  nameAr: string;
  approvedAt?: string;
  userId?: number;
};

export function canApproveCertificate(approval: CertificateApproval, actor: {id: number; employeeId: number | null; roleName: string}, certificate: CertificateSnapshot) {
  if (approval.approvedAt || !actor.employeeId || actor.employeeId === certificate.employeeId) return false;
  if (certificate.approvals?.some(item => item.userId === actor.id || (item.approvedAt && item.employeeId === actor.employeeId))) return false;
  return approval.role === "hr_manager"
    ? ["HR Manager", "Super Admin"].includes(actor.roleName)
    : approval.employeeId ? actor.employeeId === approval.employeeId : actor.roleName === "Super Admin";
}

/** Everything a certificate shows, frozen when it is issued so later edits to the program or org chart never rewrite it. */
export type CertificateSnapshot = {
  version: 1;
  status?: "pending" | "issued";
  employeeId?: number;
  approvals?: CertificateApproval[];
  number: string;
  issuedAt: string;
  issuer: { en: string; ar: string };
  employee: { code: string; nameEn: string; nameAr: string; jobTitleEn: string | null; jobTitleAr: string | null };
  program: {
    title: string;
    provider: string | null;
    courseType: string;
    durationHours: number | null;
    startDate: string | null;
    endDate: string | null;
    completionDate: string;
    validityMonths: number | null;
  };
  instructor: { nameEn: string; nameAr: string } | null;
  signatories: CertificateSignatory[];
  result: { overall: number | null; grade: string | null; criteria: { key: string; score: number; weight: number }[] | null };
  expiry: string | null;
};

const bad = (message: string) => new Response(message, { status: 400 });
const roundTenth = (value: number) => Math.round(value * 10) / 10;

export function gradeFor(score: number) {
  return EVALUATION_GRADES.find(grade => score >= grade.min) ?? EVALUATION_GRADES[EVALUATION_GRADES.length - 1];
}

/** Weighted average of the criteria; a missing or non-numeric score counts as unrated and yields null. */
export function overallScore(scores: Record<string, unknown>): number | null {
  let total = 0;
  let weights = 0;
  for (const criterion of EVALUATION_CRITERIA) {
    const raw = scores[criterion.key];
    if (raw === null || raw === undefined || String(raw).trim() === "") return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    total += value * criterion.weight;
    weights += criterion.weight;
  }
  return weights ? roundTenth(total / weights) : null;
}

/** Validates the evaluation sent by the popup; every criterion is required and must sit between 0 and 100. */
export function parseEvaluation(input: unknown): Evaluation {
  const source = (input && typeof input === "object" ? input : {}) as Row;
  const rawScores = (source.scores && typeof source.scores === "object" ? source.scores : {}) as Row;
  const scores: Record<string, number> = {};
  for (const criterion of EVALUATION_CRITERIA) {
    const raw = rawScores[criterion.key];
    if (raw === null || raw === undefined || String(raw).trim() === "") throw bad("Every evaluation criterion needs a score");
    const value = Number(raw);
    if ((typeof raw !== "number" && typeof raw !== "string") || !Number.isFinite(value) || value < 0 || value > 100) throw bad("Score must be between 0 and 100");
    scores[criterion.key] = roundTenth(value);
  }
  const overall = overallScore(scores) as number;
  return { scores, overall, grade: gradeFor(overall).key, passed: overall >= PASS_MARK, notes: String(source.notes ?? "").trim().slice(0, 1000) };
}

/** Pass/fail wording for an overall score, in the requested language. */
export function gradeLabel(key: string, rtl: boolean) {
  const grade = EVALUATION_GRADES.find(item => item.key === key);
  return grade ? (rtl ? grade.ar : grade.en) : key;
}
