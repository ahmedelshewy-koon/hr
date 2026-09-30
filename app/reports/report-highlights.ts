import { durationLabel, hasBaseline, percent, personName, trend } from "./report-format.ts";
import type { ReportOverview } from "./report-types.ts";

export type ReportTab = "overview" | "workforce" | "attendance" | "leave" | "approvals" | "documents" | "talent";
export type HighlightTone = "bad" | "warn" | "info" | "good";
export type Highlight = { id: string; tone: HighlightTone; tab: ReportTab; text: string };

const TONE_ORDER: Record<HighlightTone, number> = { bad: 0, warn: 1, info: 2, good: 3 };
const OVERDUE_APPROVAL_DAYS = 3;

/**
 * Turns the raw figures into the handful of sentences an HR manager actually needs: what is wrong, what is
 * drifting, and what is fine. Thresholds live here, in one place, so the wording and the rule cannot disagree.
 */
export function buildHighlights(data: ReportOverview, rtl: boolean, format: (value: number) => string = value => String(value)): Highlight[] {
  const t = (ar: string, en: string) => (rtl ? ar : en);
  const items: Highlight[] = [];
  const add = (id: string, tone: HighlightTone, tab: ReportTab, text: string) => items.push({ id, tone, tab, text });
  const n = format;

  const { attendance, approvals, leave, workforce, documents } = data;
  const now = attendance.totals, before = attendance.previous, comparable = hasBaseline(now.workdays, before.workdays);
  if (now.workdays > 0) {
    const absentRate = percent(now.absent, now.workdays), attendRate = percent(now.attended, now.workdays), previousRate = percent(before.absent, before.workdays);
    if (absentRate >= 5) {
      const compare = comparable ? t(` (الفترة السابقة ${n(previousRate)}%)`, ` (previous period ${n(previousRate)}%)`) : "";
      add("absence", absentRate >= 10 ? "bad" : "warn", "attendance", t(`نسبة الغياب ${n(absentRate)}% — ${n(now.absent)} يوم غياب من ${n(now.workdays)} يوم عمل${compare}.`, `Absence rate is ${n(absentRate)}% — ${n(now.absent)} absent days out of ${n(now.workdays)} working days${compare}.`));
    } else if (attendRate >= 95) {
      add("attendance-good", "good", "attendance", t(`نسبة الحضور ${n(attendRate)}% خلال الفترة.`, `Attendance rate is ${n(attendRate)}% for the period.`));
    }
    const lateRate = percent(now.late_days, now.attended), lateTrend = comparable ? trend(now.late_days, before.late_days) : null;
    if (lateRate >= 15 && now.late_days >= 5) {
      add("late", "warn", "attendance", t(`${n(now.late_days)} يوم تأخير (${n(lateRate)}% من أيام الحضور) بإجمالي ${durationLabel(now.late_minutes, true)}.`, `${n(now.late_days)} late arrivals (${n(lateRate)}% of attended days) totalling ${durationLabel(now.late_minutes, false)}.`));
    }
    if (lateTrend && lateTrend.direction === "up" && lateTrend.change >= 25 && before.late_days >= 5) {
      add("late-trend", "warn", "attendance", t(`التأخير زاد ${n(lateTrend.change)}% عن الفترة السابقة (${n(before.late_days)} ← ${n(now.late_days)} يوم).`, `Lateness is up ${n(lateTrend.change)}% on the previous period (${n(before.late_days)} → ${n(now.late_days)} days).`));
    }
  }
  if (now.missing_checkout > 0) add("checkout", "warn", "attendance", t(`${n(now.missing_checkout)} يوم بحضور بدون تسجيل انصراف — تحتاج مراجعة قبل الاحتساب.`, `${n(now.missing_checkout)} days have a check-in but no check-out and need review.`));
  if (attendance.openExceptions > 0) add("exceptions", "warn", "attendance", t(`${n(attendance.openExceptions)} استثناء حضور مفتوح بانتظار المعالجة.`, `${n(attendance.openExceptions)} attendance exceptions are open and waiting to be resolved.`));
  const worstLate = attendance.topLate[0];
  if (worstLate && worstLate.days >= 3) add("top-late", "info", "attendance", t(`الأكثر تأخيرًا: ${personName(worstLate, true)} (${n(worstLate.days)} أيام، ${durationLabel(worstLate.minutes, true)}).`, `Most late: ${personName(worstLate, false)} (${n(worstLate.days)} days, ${durationLabel(worstLate.minutes, false)}).`));

  const pending = approvals.pendingNow;
  const oldest = approvals.oldest.rows[0];
  if (pending.overdue > 0) add("approvals-overdue", "bad", "approvals", t(`${n(pending.overdue)} طلب قيد الانتظار منذ أكثر من ${n(OVERDUE_APPROVAL_DAYS)} أيام${oldest ? ` — أقدمها ${n(oldest.age_days)} يومًا` : ""}.`, `${n(pending.overdue)} requests have waited more than ${n(OVERDUE_APPROVAL_DAYS)} days${oldest ? ` — the oldest ${n(oldest.age_days)} days` : ""}.`));
  else if (pending.manager + pending.hr > 0) add("approvals-pending", "info", "approvals", t(`${n(pending.manager + pending.hr)} طلب بانتظار الاعتماد (${n(pending.manager)} عند المدير، ${n(pending.hr)} عند الموارد البشرية).`, `${n(pending.manager + pending.hr)} requests await approval (${n(pending.manager)} with the manager, ${n(pending.hr)} with HR).`));
  if (approvals.averageHours != null) {
    const days = Math.round((approvals.averageHours / 24) * 10) / 10;
    if (approvals.averageHours >= 48) add("approval-speed", "warn", "approvals", t(`متوسط زمن اعتماد الطلب ${n(days)} يوم — أبطأ من المعتاد.`, `Requests take ${n(days)} days to decide on average — slower than usual.`));
    else if (approvals.averageHours <= 24 && approvals.totals.total >= 5) add("approval-speed", "good", "approvals", t(`الطلبات تُحسم بسرعة: المتوسط ${n(Math.round(approvals.averageHours))} ساعة.`, `Requests are decided quickly: ${n(Math.round(approvals.averageHours))} hours on average.`));
  }

  if (leave.onLeaveToday > 0) add("on-leave", "info", "leave", t(`${n(leave.onLeaveToday)} موظف في إجازة اليوم.`, `${n(leave.onLeaveToday)} employees are on leave today.`));
  if (leave.upcoming.total > 0) add("upcoming-leave", "info", "leave", t(`${n(leave.upcoming.total)} إجازة معتمدة حالية أو قادمة خلال 14 يومًا.`, `${n(leave.upcoming.total)} approved leaves are running or start within 14 days.`));
  const leaveTrend = trend(leave.totals.approved_days, leave.totals.previous_approved_days);
  if (leaveTrend && leaveTrend.direction === "up" && leaveTrend.change >= 30 && leave.totals.approved_days >= 5) add("leave-trend", "info", "leave", t(`أيام الإجازة المعتمدة زادت ${n(leaveTrend.change)}% عن الفترة السابقة.`, `Approved leave days are up ${n(leaveTrend.change)}% on the previous period.`));
  const topBalance = leave.highBalances[0];
  if (topBalance) {
    const remaining = topBalance.entitlement - topBalance.used - topBalance.pending;
    if (remaining >= 15) add("balance", "info", "leave", t(`أعلى رصيد إجازة سنوية متبقٍ: ${personName(topBalance, true)} (${n(remaining)} يومًا لم تُستخدم).`, `Largest unused annual leave: ${personName(topBalance, false)} (${n(remaining)} days not yet taken).`));
  }

  if (documents) {
    if (documents.totals.expired > 0) add("docs-expired", "bad", "documents", t(`${n(documents.totals.expired)} مستند منتهي الصلاحية ويحتاج تجديدًا.`, `${n(documents.totals.expired)} documents have expired and need renewal.`));
    if (documents.totals.expiring > 0) add("docs-expiring", "warn", "documents", t(`${n(documents.totals.expiring)} مستند ينتهي خلال 30 يومًا.`, `${n(documents.totals.expiring)} documents expire within 30 days.`));
    if (documents.missing.total > 0) add("docs-missing", "warn", "documents", t(`${n(documents.missing.total)} مستند مطلوب غير مرفوع في ملفات الموظفين.`, `${n(documents.missing.total)} required documents are missing from employee files.`));
  }

  if (workforce.contractsEnding.total > 0) add("contracts", "warn", "workforce", t(`${n(workforce.contractsEnding.total)} عقد ينتهي خلال 60 يومًا.`, `${n(workforce.contractsEnding.total)} contracts end within 60 days.`));
  if (workforce.leavers.total > 0) add("leavers", workforce.turnoverRate >= 5 ? "warn" : "info", "workforce", t(`غادر ${n(workforce.leavers.total)} موظف خلال الفترة (معدل دوران ${n(workforce.turnoverRate)}%).`, `${n(workforce.leavers.total)} employees left in the period (turnover ${n(workforce.turnoverRate)}%).`));
  if (workforce.hires.total > 0) add("hires", "good", "workforce", t(`انضم ${n(workforce.hires.total)} موظف جديد خلال الفترة.`, `${n(workforce.hires.total)} new employees joined in the period.`));

  const { learning, lifecycle, assets, recruitment } = data;
  if (learning?.mandatoryOverdue.total) add("training-overdue", "bad", "talent", t(`${n(learning.mandatoryOverdue.total)} برنامج تدريبي إلزامي تجاوز موعد الإكمال.`, `${n(learning.mandatoryOverdue.total)} mandatory courses are past due.`));
  if (learning?.certificates.total) add("certificates", "warn", "talent", t(`${n(learning.certificates.total)} شهادة تدريب منتهية أو تنتهي خلال 60 يومًا.`, `${n(learning.certificates.total)} training certificates have expired or expire within 60 days.`));
  if (assets?.unreturned.total) add("assets", "bad", "talent", t(`${n(assets.unreturned.total)} عهدة لم تُسلَّم من موظفين انتهت خدمتهم أو في إنهاء الخدمة.`, `${n(assets.unreturned.total)} assets are still held by leavers or employees being offboarded.`));
  if (lifecycle?.overdueTasks.total) add("lifecycle", "warn", "talent", t(`${n(lifecycle.overdueTasks.total)} مهمة تهيئة أو إنهاء خدمة متأخرة.`, `${n(lifecycle.overdueTasks.total)} onboarding/offboarding tasks are overdue.`));
  if (recruitment?.stalled) add("stalled", "warn", "talent", t(`${n(recruitment.stalled)} مرشح متوقف في مرحلته أكثر من 14 يومًا.`, `${n(recruitment.stalled)} candidates have sat in one stage for over 14 days.`));

  if (!items.some(item => item.tone === "bad" || item.tone === "warn")) add("all-clear", "good", "overview", t("لا توجد تنبيهات تحتاج تدخلًا في هذه الفترة.", "Nothing needs attention in this period."));
  return items.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}
