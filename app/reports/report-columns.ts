import { statusLabel } from "./report-labels.ts";

/**
 * Human headings and values for the CSV exports.
 *
 * The export queries name their columns after the database (`employee_code`, `final_status`, ...), which is
 * meaningless to the person opening the file in Excel. Headings and the common status values are translated here.
 */
type Label = { en: string; ar: string };

const COLUMNS: Record<string, Label> = {
  employee_code: { en: "Employee code", ar: "كود الموظف" }, employee_name: { en: "Employee", ar: "الموظف" }, employee: { en: "Employee", ar: "الموظف" },
  name_en: { en: "Name (English)", ar: "الاسم بالإنجليزية" }, name_ar: { en: "Name (Arabic)", ar: "الاسم بالعربية" }, name: { en: "Name", ar: "الاسم" },
  department: { en: "Department", ar: "القسم" }, job_title: { en: "Job title", ar: "المسمى الوظيفي" }, work_email: { en: "Work email", ar: "البريد الوظيفي" },
  work_phone: { en: "Work phone", ar: "هاتف العمل" }, start_date: { en: "Start date", ar: "تاريخ البدء" }, end_date: { en: "End date", ar: "تاريخ الانتهاء" },
  employment_status: { en: "Employment status", ar: "حالة التوظيف" }, employment_type: { en: "Employment type", ar: "نوع التوظيف" }, country: { en: "Country", ar: "الدولة" },
  work_location: { en: "Work location", ar: "موقع العمل" },
  company: { en: "Company", ar: "الشركة" }, missing_fields: { en: "Missing required fields", ar: "الحقول المطلوبة الناقصة" },
  work_date: { en: "Date", ar: "التاريخ" }, scheduled_in: { en: "Scheduled in", ar: "الحضور المجدول" }, scheduled_out: { en: "Scheduled out", ar: "الانصراف المجدول" },
  actual_in: { en: "Check-in", ar: "وقت الحضور" }, actual_out: { en: "Check-out", ar: "وقت الانصراف" }, worked_minutes: { en: "Worked minutes", ar: "دقائق العمل" },
  late_minutes: { en: "Late minutes", ar: "دقائق التأخير" }, early_minutes: { en: "Early-leave minutes", ar: "دقائق الانصراف المبكر" }, attendance_type: { en: "Work mode", ar: "نمط العمل" },
  status: { en: "Status", ar: "الحالة" }, exception_type: { en: "Exception", ar: "الاستثناء" }, exception_state: { en: "Exception status", ar: "حالة الاستثناء" },
  request_code: { en: "Request no.", ar: "رقم الطلب" }, leave_type: { en: "Leave type", ar: "نوع الإجازة" }, from_date: { en: "From", ar: "من" }, to_date: { en: "To", ar: "إلى" },
  requested_days: { en: "Days", ar: "عدد الأيام" }, submitted: { en: "Submitted", ar: "تاريخ التقديم" }, final_status: { en: "Status", ar: "الحالة" }, current_stage: { en: "Current stage", ar: "المرحلة الحالية" },
  type: { en: "Request type", ar: "نوع الطلب" }, stage: { en: "Stage", ar: "المرحلة" }, action: { en: "Decision", ar: "القرار" }, reason: { en: "Reason", ar: "السبب" },
  created_at: { en: "Date", ar: "التاريخ" }, approver: { en: "Approver", ar: "المعتمِد" },
  category: { en: "Category", ar: "التصنيف" }, document_number: { en: "Document no.", ar: "رقم المستند" }, issue_date: { en: "Issue date", ar: "تاريخ الإصدار" },
  expiry_date: { en: "Expiry date", ar: "تاريخ الانتهاء" }, state: { en: "Validity", ar: "الصلاحية" }, uploaded_at: { en: "Uploaded", ar: "تاريخ الرفع" },
  job: { en: "Job", ar: "الوظيفة" }, job_status: { en: "Job status", ar: "حالة الوظيفة" }, openings_count: { en: "Openings", ar: "عدد الشواغر" }, applications: { en: "Applications", ar: "عدد المتقدمين" },
  candidate: { en: "Candidate", ar: "المرشح" }, email: { en: "Email", ar: "البريد الإلكتروني" }, candidate_stage: { en: "Stage", ar: "المرحلة" }, source: { en: "Source", ar: "المصدر" }, outcome: { en: "Outcome", ar: "النتيجة" },
  lifecycle_type: { en: "Process", ar: "العملية" }, reason_type: { en: "Reason", ar: "السبب" }, last_working_date: { en: "Last working day", ar: "آخر يوم عمل" },
  tasks: { en: "Tasks", ar: "المهام" }, completed_tasks: { en: "Completed tasks", ar: "المهام المكتملة" }, overdue_tasks: { en: "Overdue tasks", ar: "المهام المتأخرة" }, progress: { en: "Progress %", ar: "نسبة الإنجاز %" },
  asset_code: { en: "Asset code", ar: "كود العهدة" }, brand_model: { en: "Brand / model", ar: "الماركة / الموديل" }, serial_number: { en: "Serial number", ar: "الرقم التسلسلي" },
  asset_condition: { en: "Condition", ar: "الحالة الفنية" }, assigned_employee: { en: "Assigned to", ar: "مسندة إلى" }, assigned_at: { en: "Assigned on", ar: "تاريخ التسليم" }, returned_at: { en: "Returned on", ar: "تاريخ الإرجاع" },
  course: { en: "Course", ar: "البرنامج التدريبي" }, provider: { en: "Provider", ar: "الجهة المقدمة" }, course_type: { en: "Course type", ar: "نوع البرنامج" }, mandatory: { en: "Mandatory", ar: "إلزامية" },
  due_date: { en: "Due date", ar: "تاريخ الاستحقاق" }, completion_date: { en: "Completed on", ar: "تاريخ الإكمال" }, score: { en: "Score", ar: "الدرجة" }, certificate_expiry: { en: "Certificate expiry", ar: "انتهاء الشهادة" },
};

const VALUE_COLUMNS = new Set([
  "status", "state", "final_status", "current_stage", "employment_status", "employment_type", "attendance_type", "exception_type", "exception_state", "action", "stage",
  "job_status", "candidate_stage", "outcome", "lifecycle_type", "reason_type", "asset_condition", "course_type",
]);

export const csvColumnLabel = (key: string, arabic: boolean) => COLUMNS[key]?.[arabic ? "ar" : "en"] ?? key.replaceAll("_", " ");

export function csvValue(key: string, value: unknown, arabic: boolean) {
  if (key === "mandatory") return arabic ? (Number(value) ? "نعم" : "لا") : Number(value) ? "Yes" : "No";
  if (!VALUE_COLUMNS.has(key) || value == null || value === "") return value ?? "";
  return statusLabel(value, arabic);
}

/** A cell starting with = @ (or a +/- that is not a plain number or phone) would be run as a formula by Excel. */
export function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[=@\t\r]/.test(text) || /^[+-](?![\d\s()-]*$)/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
