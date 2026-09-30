/**
 * Arabic wording for the machine values the report tables print (statuses, request kinds, tenure bands, ...).
 * Unknown values fall back to the humanised English so nothing renders as a raw `snake_case` key.
 */
const AR: Record<string, string> = {
  // employment
  active: "نشط", probation: "تحت التجربة", notice_period: "فترة إشعار", inactive: "غير نشط", deleted: "محذوف",
  full_time: "دوام كامل", part_time: "دوام جزئي", contract: "عقد محدد المدة", temporary: "مؤقت", intern: "متدرب",
  egypt: "مصر", saudi_arabia: "السعودية", jordan: "الأردن", united_arab_emirates: "الإمارات", uae: "الإمارات", kuwait: "الكويت", qatar: "قطر", bahrain: "البحرين", oman: "عُمان", lebanon: "لبنان", sudan: "السودان", syria: "سوريا", palestine: "فلسطين", yemen: "اليمن", iraq: "العراق", both: "كلا البلدين", unknown: "غير محدد",
  lt1: "أقل من سنة", "1to3": "من سنة إلى 3 سنوات", "3to5": "من 3 إلى 5 سنوات", gt5: "أكثر من 5 سنوات",
  // attendance
  present: "حاضر", late: "متأخر", absent: "غائب", leave: "إجازة", remote: "عن بُعد", office: "المكتب", holiday: "عطلة رسمية",
  non_working_day: "يوم راحة", needs_review: "يحتاج مراجعة", scheduled: "مجدول", missing_check_out: "بدون انصراف", missing_check_in: "بدون حضور",
  // requests and approvals
  open: "مفتوح", resolved: "تمت المعالجة", pending: "قيد الانتظار", pending_manager: "بانتظار المدير", pending_hr: "بانتظار الموارد البشرية",
  hr_approved: "معتمد", approved: "معتمد", rejected: "مرفوض", manager_rejected: "رفضه المدير", hr_rejected: "رفضته الموارد البشرية", cancelled: "ملغي",
  manager: "المدير", hr: "الموارد البشرية", expense: "مصروفات", certificate: "شهادات", attendance_correction: "تصحيح حضور", late_arrival: "تأخير", early_departure: "انصراف مبكر",
  work_from_home: "عمل عن بُعد", wfh: "عمل عن بُعد", overtime: "عمل إضافي", permission: "إذن",
  // documents
  valid: "ساري", expiring: "ينتهي قريبًا", expiring_soon: "قارب على الانتهاء", expired: "منتهي", no_expiry: "بدون تاريخ انتهاء", archived: "مؤرشف",
  // talent
  draft: "مسودة", self_review: "تقييم ذاتي", manager_review: "تقييم المدير", hr_review: "مراجعة الموارد البشرية", completed: "مكتمل", in_progress: "قيد التنفيذ",
  assigned: "مُسند", available: "متاح", failed: "غير ناجح", submitted: "تم الإرسال", annual: "سنوي", quarterly: "ربع سنوي", monthly: "شهري", semiannual: "نصف سنوي",
  onboarding: "تهيئة موظف جديد", offboarding: "إنهاء خدمة", hired: "تم التعيين", offer: "عرض وظيفي", on_hold: "معلّق مؤقتًا", closed: "مغلق",
  applied: "تم التقديم", screening: "الفرز", shortlisted: "القائمة المختصرة", interview: "المقابلة", good: "جيدة", excellent: "ممتازة", fair: "مقبولة", poor: "ضعيفة", damaged: "تالفة",
  laptop: "حاسوب محمول", mobile: "هاتف محمول", sim: "شريحة اتصال", monitor: "شاشة", keyboard: "لوحة مفاتيح", mouse: "ماوس", access_card: "بطاقة دخول", headset: "سماعة رأس", other: "أخرى",
  linkedin: "لينكدإن", referral: "ترشيح موظف", website: "الموقع الإلكتروني", agency: "مكتب توظيف", manual: "إدخال يدوي", email: "بريد إلكتروني",
  resignation: "استقالة", termination: "إنهاء من الشركة", end_of_contract: "انتهاء العقد", retirement: "تقاعد",
};

export const humanize = (key: string) => {
  const text = key.replaceAll("_", " ").replace(/\s+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export function statusLabel(key: unknown, rtl: boolean) {
  const text = String(key ?? "").trim();
  if (!text) return "—";
  const code = text.toLowerCase().replaceAll("-", "_").replace(/\s+/g, "_");
  if (!rtl && code === "hr") return "HR";
  return rtl ? AR[code] ?? humanize(text) : humanize(text);
}
