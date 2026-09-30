"use client";

import { AlertOctagon, AlertTriangle, Briefcase, CalendarCheck, CalendarDays, CheckCircle2, ClipboardCheck, Clock3, FileWarning, GraduationCap, Hourglass, Info, Laptop, LogOut, Timer, TimerReset, UserMinus, UserPlus, UserX, Users } from "lucide-react";
import { useState } from "react";
import { AttendanceChart, Badge, BarList, DataTable, Delta, Empty, ExportButton, Kpi, KpiGrid, Ltr, Meter, Panel, PersonCell, StackBar, type ReportContext, type Tone } from "./reports-widgets";
import { daysLabel, durationLabel, hasBaseline, namedLabel, percent } from "./reports/report-format";
import type { Highlight, ReportTab } from "./reports/report-highlights";
import { statusLabel } from "./reports/report-labels";
import type { ReportOverview } from "./reports/report-types";

type Props = { data: ReportOverview; ctx: ReportContext };

const TONE_ICON = { bad: AlertOctagon, warn: AlertTriangle, info: Info, good: CheckCircle2 } as const;
const rateTone = (rate: number): Tone => (rate >= 95 ? "good" : rate >= 90 ? "warn" : "bad");
const shown = (total: number, count: number, rtl: boolean, fmt: (value: number) => string) => (total > count ? (rtl ? `يعرض أول ${fmt(count)} من ${fmt(total)}.` : `Showing the first ${fmt(count)} of ${fmt(total)}.`) : undefined);
const nz = (value: number, fmt: (value: number) => string) => (value ? fmt(value) : "—");
const hoursOrDays = (hours: number, rtl: boolean, fmt: (value: number) => string) => (hours >= 48 ? daysLabel(hours / 24, rtl, fmt) : rtl ? `${fmt(Math.round(hours))} ساعة` : `${fmt(Math.round(hours))} h`);

function dueBadge(daysLeft: number, rtl: boolean, fmt: (value: number) => string) {
  if (daysLeft < 0) return <Badge tone="bad">{rtl ? `منتهي منذ ${daysLabel(-daysLeft, true, fmt)}` : `Expired ${daysLabel(-daysLeft, false, fmt)} ago`}</Badge>;
  if (daysLeft === 0) return <Badge tone="warn">{rtl ? "ينتهي اليوم" : "Expires today"}</Badge>;
  return <Badge tone={daysLeft <= 14 ? "warn" : "info"}>{rtl ? `متبقي ${daysLabel(daysLeft, true, fmt)}` : `${daysLabel(daysLeft, false, fmt)} left`}</Badge>;
}

const HIGHLIGHTS_COLLAPSED = 6;

export function HighlightList({ items, ctx, goTo }: { items: Highlight[]; ctx: ReportContext; goTo: (tab: ReportTab) => void }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, HIGHLIGHTS_COLLAPSED);
  return <>
    <ul className="rp-highlights">{visible.map(item => {
      const Icon = TONE_ICON[item.tone];
      return <li key={item.id} className={item.tone}>
        <button type="button" onClick={() => goTo(item.tab)} title={ctx.rtl ? "افتح التفاصيل" : "Open the details"}><Icon size={18}/><span>{item.text}</span></button>
      </li>;
    })}</ul>
    {items.length > HIGHLIGHTS_COLLAPSED && <button type="button" className="text-button rp-more" onClick={() => setExpanded(value => !value)}>
      {expanded ? (ctx.rtl ? "عرض أقل" : "Show fewer") : ctx.rtl ? `عرض كل البنود (${ctx.fmt(items.length)})` : `Show all ${ctx.fmt(items.length)} items`}
    </button>}
  </>;
}

export function OverviewTab({ data, ctx, highlights, goTo }: Props & { highlights: Highlight[]; goTo: (tab: ReportTab) => void }) {
  const { rtl, fmt } = ctx, t = (ar: string, en: string) => (rtl ? ar : en);
  const now = data.attendance.totals, before = data.attendance.previous, hasBefore = hasBaseline(now.workdays, before.workdays);
  const attendRate = percent(now.attended, now.workdays), absentRate = percent(now.absent, now.workdays);
  const pending = data.approvals.pendingNow, docs = data.documents;
  return <>
    <Panel title={t("أهم ما يحتاج انتباهك", "What needs your attention")} note={t("ملخص تلقائي من بيانات الفترة المختارة — اضغط على أي بند لفتح تفاصيله.", "An automatic summary of the selected period — click any item to see the detail.")}>
      <HighlightList items={data.attendance.totals.workdays || data.workforce.active ? highlights : []} ctx={ctx} goTo={goTo}/>
    </Panel>
    <KpiGrid>
      <Kpi icon={Users} label={t("الموظفون الحاليون", "Current employees")} value={fmt(data.workforce.active)} hint={t(`${fmt(data.workforce.hires.total)} انضموا · ${fmt(data.workforce.leavers.total)} غادروا في الفترة`, `${fmt(data.workforce.hires.total)} joined · ${fmt(data.workforce.leavers.total)} left in the period`)}/>
      <Kpi icon={CalendarCheck} label={t("نسبة الحضور", "Attendance rate")} value={now.workdays ? `${fmt(attendRate)}%` : "—"} tone={now.workdays ? rateTone(attendRate) : "neutral"} delta={now.workdays && hasBefore ? <Delta current={attendRate} previous={percent(before.attended, before.workdays)} points rtl={rtl} fmt={fmt}/> : null}/>
      <Kpi icon={UserX} label={t("نسبة الغياب", "Absence rate")} value={now.workdays ? `${fmt(absentRate)}%` : "—"} hint={t(`${fmt(now.absent)} يوم غياب`, `${fmt(now.absent)} absent days`)} tone={absentRate >= 10 ? "bad" : absentRate >= 5 ? "warn" : "good"} delta={now.workdays && hasBefore ? <Delta current={absentRate} previous={percent(before.absent, before.workdays)} points worseWhenUp rtl={rtl} fmt={fmt}/> : null}/>
      <Kpi icon={TimerReset} label={t("أيام التأخير", "Late arrivals")} value={fmt(now.late_days)} hint={t(`إجمالي ${durationLabel(now.late_minutes, true)}`, `${durationLabel(now.late_minutes, false)} in total`)} delta={hasBefore ? <Delta current={now.late_days} previous={before.late_days} worseWhenUp rtl={rtl} fmt={fmt}/> : null}/>
      <Kpi icon={CalendarDays} label={t("أيام الإجازة المعتمدة", "Approved leave days")} value={fmt(data.leave.totals.approved_days)} hint={t(`${fmt(data.leave.onLeaveToday)} في إجازة اليوم`, `${fmt(data.leave.onLeaveToday)} on leave today`)} delta={<Delta current={data.leave.totals.approved_days} previous={data.leave.totals.previous_approved_days} neutral rtl={rtl} fmt={fmt}/>}/>
      <Kpi icon={ClipboardCheck} label={t("طلبات بانتظار الاعتماد", "Requests awaiting approval")} value={fmt(pending.manager + pending.hr)} tone={pending.overdue ? "bad" : pending.manager + pending.hr ? "warn" : "good"} hint={pending.overdue ? t(`${fmt(pending.overdue)} قيد الانتظار أكثر من 3 أيام`, `${fmt(pending.overdue)} waiting over 3 days`) : undefined}/>
      {docs && <Kpi icon={FileWarning} label={t("مستندات تحتاج إجراء", "Documents needing action")} value={fmt(docs.totals.expired + docs.totals.expiring)} tone={docs.totals.expired ? "bad" : docs.totals.expiring ? "warn" : "good"} hint={t(`${fmt(docs.totals.expired)} منتهي · ${fmt(docs.totals.expiring)} ينتهي خلال 30 يومًا`, `${fmt(docs.totals.expired)} expired · ${fmt(docs.totals.expiring)} within 30 days`)}/>}
      <Kpi icon={UserMinus} label={t("معدل ترك العمل", "Turnover")} value={`${fmt(data.workforce.turnoverRate)}%`} tone={data.workforce.turnoverRate >= 5 ? "warn" : "neutral"} hint={t(`${fmt(data.workforce.leavers.total)} غادروا في الفترة`, `${fmt(data.workforce.leavers.total)} left in the period`)}/>
    </KpiGrid>
    <div className="rp-grid two">
      <Panel title={t("الحضور اليومي", "Daily attendance")} note={t("كل عمود يوم عمل: في الموعد / متأخر / غائب.", "Each column is a working day: on time / late / absent.")} action={<button type="button" className="text-button" onClick={() => goTo("attendance")}>{t("التفاصيل", "Details")}</button>}>
        <AttendanceChart points={data.attendance.daily} dateLabel={ctx.dateLabel} fmt={fmt} labels={{ onTime: t("في الموعد", "On time"), late: t("متأخر", "Late"), absent: t("غائب", "Absent"), empty: t("لا توجد سجلات حضور في هذه الفترة.", "No attendance records in this period.") }}/>
      </Panel>
      <Panel title={t("الموظفون حسب القسم", "Employees by department")} action={<button type="button" className="text-button" onClick={() => goTo("workforce")}>{t("التفاصيل", "Details")}</button>}>
        <BarList rows={data.workforce.byDepartment.map(row => ({ label: namedLabel(row, rtl), value: row.count }))} fmt={fmt} empty={t("لا يوجد موظفون.", "No employees.")}/>
      </Panel>
    </div>
  </>;
}

export function WorkforceTab({ data, ctx }: Props) {
  const { rtl, fmt } = ctx, t = (ar: string, en: string) => (rtl ? ar : en), w = data.workforce;
  const daysToEnd = (iso: string) => Math.round((Date.parse(iso) - Date.parse(data.today)) / 86400000);
  return <>
    <KpiGrid>
      <Kpi icon={Users} label={t("الموظفون الحاليون", "Current employees")} value={fmt(w.active)} hint={t("نشط + تحت التجربة + فترة إشعار", "active + probation + notice period")}/>
      <Kpi icon={UserPlus} label={t("انضموا في الفترة", "Joined in the period")} value={fmt(w.hires.total)} tone={w.hires.total ? "good" : "neutral"}/>
      <Kpi icon={UserMinus} label={t("غادروا في الفترة", "Left in the period")} value={fmt(w.leavers.total)} tone={w.turnoverRate >= 5 ? "warn" : "neutral"} hint={t(`معدل الدوران ${fmt(w.turnoverRate)}%`, `Turnover ${fmt(w.turnoverRate)}%`)}/>
      <Kpi icon={Hourglass} label={t("متوسط مدة الخدمة", "Average tenure")} value={rtl ? `${fmt(w.averageTenureYears)} سنة` : `${fmt(w.averageTenureYears)} yrs`}/>
      <Kpi icon={FileWarning} label={t("عقود تنتهي خلال 60 يومًا", "Contracts ending in 60 days")} value={fmt(w.contractsEnding.total)} tone={w.contractsEnding.total ? "warn" : "good"}/>
    </KpiGrid>
    <div className="rp-grid two">
      <Panel title={t("حسب القسم", "By department")}><BarList rows={w.byDepartment.map(row => ({ label: namedLabel(row, rtl), value: row.count }))} fmt={fmt} empty={t("لا توجد بيانات.", "No data.")}/></Panel>
      <Panel title={t("حسب مدة الخدمة", "By length of service")}><BarList rows={w.byTenure.map(row => ({ label: statusLabel(row.key, rtl), value: row.count }))} fmt={fmt} empty={t("لا توجد بيانات.", "No data.")}/></Panel>
      <Panel title={t("حسب الدولة", "By country")}><BarList rows={w.byCountry.map(row => ({ label: statusLabel(row.key || "unknown", rtl), value: row.count, tone: "good" }))} fmt={fmt} empty={t("لا توجد بيانات.", "No data.")}/></Panel>
      <Panel title={t("حسب نوع التوظيف", "By employment type")}><BarList rows={w.byType.map(row => ({ label: statusLabel(row.key, rtl), value: row.count, tone: "warn" }))} fmt={fmt} empty={t("لا توجد بيانات.", "No data.")}/></Panel>
    </div>
    <Panel title={t("عقود على وشك الانتهاء", "Contracts about to end")} note={t("العقود المنتهية خلال 60 يومًا من اليوم.", "Contracts ending within 60 days from today.")}>
      <DataTable rows={w.contractsEnding.rows} empty={t("لا توجد عقود تنتهي قريبًا.", "No contracts end soon.")} footer={shown(w.contractsEnding.total, w.contractsEnding.rows.length, rtl, fmt)} columns={[
        { header: t("الموظف", "Employee"), cell: row => <PersonCell person={row} rtl={rtl}/> },
        { header: t("تاريخ الانتهاء", "Ends on"), cell: row => <Ltr>{row.date}</Ltr> },
        { header: t("المتبقي", "Remaining"), cell: row => dueBadge(daysToEnd(row.date), rtl, fmt) },
      ]}/>
    </Panel>
    <div className="rp-grid two">
      <Panel title={t("انضموا في الفترة", "Joined in the period")}>
        <DataTable rows={w.hires.rows} empty={t("لا توجد تعيينات في هذه الفترة.", "No hires in this period.")} footer={shown(w.hires.total, w.hires.rows.length, rtl, fmt)} columns={[
          { header: t("الموظف", "Employee"), cell: row => <PersonCell person={row} rtl={rtl}/> },
          { header: t("تاريخ البدء", "Start date"), cell: row => <Ltr>{row.date}</Ltr> },
        ]}/>
      </Panel>
      <Panel title={t("غادروا في الفترة", "Left in the period")}>
        <DataTable rows={w.leavers.rows} empty={t("لا توجد حالات مغادرة في هذه الفترة.", "Nobody left in this period.")} footer={shown(w.leavers.total, w.leavers.rows.length, rtl, fmt)} columns={[
          { header: t("الموظف", "Employee"), cell: row => <PersonCell person={row} rtl={rtl}/> },
          { header: t("آخر يوم", "Last day"), cell: row => <Ltr>{row.date}</Ltr> },
        ]}/>
      </Panel>
    </div>
    <div className="rp-actions"><ExportButton label={t("تصدير بيانات الموظفين (CSV)", "Export employee data (CSV)")} busy={ctx.exporting === "employees"} onClick={() => ctx.exportCsv("employees")}/></div>
  </>;
}

export function AttendanceTab({ data, ctx }: Props) {
  const { rtl, fmt } = ctx, t = (ar: string, en: string) => (rtl ? ar : en), a = data.attendance, now = a.totals, before = a.previous, hasBefore = hasBaseline(now.workdays, before.workdays);
  const attendRate = percent(now.attended, now.workdays), absentRate = percent(now.absent, now.workdays), lateRate = percent(now.late_days, now.attended);
  const departments = a.byDepartment.filter(row => row.workdays > 0).map(row => ({ ...row, rate: percent(row.attended, row.workdays) })).sort((x, y) => x.rate - y.rate || y.absent - x.absent);
  return <>
    <p className="rp-note">{t(`تشمل الأرقام موظفي الدوام الكامل حتى ${a.through}. اليوم الجاري لا يُحتسب لأنه لم ينتهِ بعد.`, `Figures cover full-time employees up to ${a.through}. Today is left out because it has not finished yet.`)}</p>
    <KpiGrid>
      <Kpi icon={CalendarCheck} label={t("نسبة الحضور", "Attendance rate")} value={now.workdays ? `${fmt(attendRate)}%` : "—"} tone={now.workdays ? rateTone(attendRate) : "neutral"} hint={t(`${fmt(now.attended)} من ${fmt(now.workdays)} يوم عمل`, `${fmt(now.attended)} of ${fmt(now.workdays)} working days`)} delta={now.workdays && hasBefore ? <Delta current={attendRate} previous={percent(before.attended, before.workdays)} points rtl={rtl} fmt={fmt}/> : null}/>
      <Kpi icon={UserX} label={t("أيام الغياب", "Absent days")} value={fmt(now.absent)} tone={absentRate >= 10 ? "bad" : absentRate >= 5 ? "warn" : "good"} hint={t(`${fmt(absentRate)}% من أيام العمل`, `${fmt(absentRate)}% of working days`)} delta={hasBefore ? <Delta current={now.absent} previous={before.absent} worseWhenUp rtl={rtl} fmt={fmt}/> : null}/>
      <Kpi icon={TimerReset} label={t("أيام التأخير", "Late arrivals")} value={fmt(now.late_days)} tone={lateRate >= 15 ? "warn" : "neutral"} hint={t(`${fmt(lateRate)}% من أيام الحضور · ${durationLabel(now.late_minutes, true)}`, `${fmt(lateRate)}% of attended days · ${durationLabel(now.late_minutes, false)}`)} delta={hasBefore ? <Delta current={now.late_days} previous={before.late_days} worseWhenUp rtl={rtl} fmt={fmt}/> : null}/>
      <Kpi icon={LogOut} label={t("انصراف مبكر", "Early departures")} value={fmt(now.early_days)} hint={t("أيام", "days")}/>
      <Kpi icon={Clock3} label={t("حضور بدون انصراف", "Check-in without check-out")} value={fmt(now.missing_checkout)} tone={now.missing_checkout ? "warn" : "good"} hint={now.missing_checkout ? t("تحتاج مراجعة", "need review") : undefined}/>
      <Kpi icon={AlertTriangle} label={t("استثناءات حضور مفتوحة", "Open attendance exceptions")} value={fmt(a.openExceptions)} tone={a.openExceptions ? "warn" : "good"} hint={a.openExceptions ? t("بانتظار المعالجة", "waiting to be resolved") : undefined}/>
      <Kpi icon={Timer} label={t("العمل الإضافي", "Overtime")} value={durationLabel(now.overtime_minutes, rtl)} hint={t(`${fmt(now.remote_days)} يوم عمل عن بُعد`, `${fmt(now.remote_days)} remote days`)}/>
    </KpiGrid>
    <Panel title={t("الحضور اليومي", "Daily attendance")} note={now.workdays > 0 && a.daily.length > 31 ? t("الفترة طويلة فتم تجميع كل عمود في أسبوع.", "The period is long, so each column groups a week.") : undefined}>
      <AttendanceChart points={a.daily} dateLabel={ctx.dateLabel} fmt={fmt} labels={{ onTime: t("في الموعد", "On time"), late: t("متأخر", "Late"), absent: t("غائب", "Absent"), empty: t("لا توجد سجلات حضور في هذه الفترة.", "No attendance records in this period.") }}/>
    </Panel>
    <Panel title={t("مقارنة الأقسام", "Departments compared")} note={t("مرتبة من الأقل التزامًا بالحضور إلى الأعلى.", "Ordered from the weakest attendance to the strongest.")}>
      <DataTable rows={departments} empty={t("لا توجد بيانات أقسام.", "No department data.")} columns={[
        { header: t("القسم", "Department"), cell: row => <b>{namedLabel(row, rtl)}</b> },
        { header: t("الموظفون", "Employees"), number: true, cell: row => fmt(row.employees) },
        { header: t("نسبة الحضور", "Attendance"), cell: row => <span className="rp-rate"><Meter value={row.rate} tone={rateTone(row.rate)}/>{fmt(row.rate)}%</span> },
        { header: t("أيام الغياب", "Absent"), number: true, cell: row => nz(row.absent, fmt) },
        { header: t("أيام التأخير", "Late"), number: true, cell: row => nz(row.late_days, fmt) },
        { header: t("مدة التأخير", "Time late"), number: true, cell: row => (row.late_minutes > 0 ? durationLabel(row.late_minutes, rtl) : "—") },
      ]}/>
    </Panel>
    <div className="rp-grid two">
      <Panel title={t("الأكثر تأخيرًا", "Most late")}>
        <DataTable rows={a.topLate} empty={t("لا توجد حالات تأخير.", "No late arrivals.")} columns={[
          { header: t("الموظف", "Employee"), cell: row => <PersonCell person={row} rtl={rtl}/> },
          { header: t("الأيام", "Days"), number: true, cell: row => fmt(row.days) },
          { header: t("المدة", "Time"), number: true, cell: row => durationLabel(row.minutes, rtl) },
        ]}/>
      </Panel>
      <Panel title={t("الأكثر غيابًا", "Most absent")}>
        <DataTable rows={a.topAbsent} empty={t("لا توجد حالات غياب.", "No absences.")} columns={[
          { header: t("الموظف", "Employee"), cell: row => <PersonCell person={row} rtl={rtl}/> },
          { header: t("أيام الغياب", "Absent days"), number: true, cell: row => fmt(row.days) },
        ]}/>
      </Panel>
    </div>
    <div className="rp-actions"><ExportButton label={t("تصدير سجل الحضور التفصيلي (CSV)", "Export the detailed attendance log (CSV)")} busy={ctx.exporting === "attendance"} onClick={() => ctx.exportCsv("attendance")}/></div>
  </>;
}

export function LeaveTab({ data, ctx }: Props) {
  const { rtl, fmt } = ctx, t = (ar: string, en: string) => (rtl ? ar : en), l = data.leave;
  return <>
    <p className="rp-note">{t("الأرقام تخص الإجازات التي تبدأ داخل الفترة المختارة.", "Figures cover leave that starts inside the selected period.")}</p>
    <KpiGrid>
      <Kpi icon={CalendarDays} label={t("أيام إجازة معتمدة", "Approved leave days")} value={fmt(l.totals.approved_days)} delta={<Delta current={l.totals.approved_days} previous={l.totals.previous_approved_days} neutral rtl={rtl} fmt={fmt}/>}/>
      <Kpi icon={ClipboardCheck} label={t("طلبات الإجازة", "Leave requests")} value={fmt(l.totals.requests)} hint={t(`${fmt(l.totals.approved)} معتمد`, `${fmt(l.totals.approved)} approved`)}/>
      <Kpi icon={Hourglass} label={t("بانتظار القرار", "Awaiting a decision")} value={fmt(l.totals.pending)} tone={l.totals.pending ? "warn" : "good"}/>
      <Kpi icon={UserX} label={t("مرفوضة", "Rejected")} value={fmt(l.totals.rejected)}/>
      <Kpi icon={Users} label={t("في إجازة اليوم", "On leave today")} value={fmt(l.onLeaveToday)}/>
    </KpiGrid>
    <div className="rp-grid two">
      <Panel title={t("حسب نوع الإجازة", "By leave type")}>
        <DataTable rows={l.byType} empty={t("لا توجد طلبات إجازة في هذه الفترة.", "No leave requests in this period.")} columns={[
          { header: t("النوع", "Type"), cell: row => <b>{namedLabel(row, rtl)}</b> },
          { header: t("الطلبات", "Requests"), number: true, cell: row => fmt(row.requests) },
          { header: t("معتمد", "Approved"), number: true, cell: row => nz(row.approved, fmt) },
          { header: t("قيد الانتظار", "Waiting"), number: true, cell: row => nz(row.pending, fmt) },
          { header: t("مرفوض", "Rejected"), number: true, cell: row => nz(row.rejected, fmt) },
          { header: t("الأيام", "Days"), number: true, cell: row => <b>{fmt(row.approved_days)}</b> },
        ]}/>
      </Panel>
      <Panel title={t("أيام الإجازة حسب القسم", "Leave days by department")}>
        <BarList rows={l.byDepartment.map(row => ({ label: namedLabel(row, rtl), value: row.days }))} fmt={fmt} empty={t("لا توجد إجازات معتمدة.", "No approved leave.")}/>
      </Panel>
    </div>
    <Panel title={t(`أرصدة الإجازات لسنة ${l.balanceYear}`, `Leave balances for ${l.balanceYear}`)} note={t("موظفون حاليون فقط.", "Current employees only.")}>
      <DataTable rows={l.balances} empty={t("لا توجد أرصدة.", "No balances.")} columns={[
        { header: t("النوع", "Type"), cell: row => <b>{namedLabel(row, rtl)}</b> },
        { header: t("الموظفون", "Employees"), number: true, cell: row => fmt(row.employees) },
        { header: t("الاستحقاق", "Entitled"), number: true, cell: row => fmt(row.entitlement) },
        { header: t("المستخدم", "Used"), number: true, cell: row => nz(row.used, fmt) },
        { header: t("قيد الانتظار", "Pending"), number: true, cell: row => nz(row.pending, fmt) },
        { header: t("المتبقي", "Remaining"), number: true, cell: row => <b>{fmt(row.entitlement - row.used - row.pending)}</b> },
        { header: t("نسبة الاستخدام", "Used"), cell: row => <span className="rp-rate"><Meter value={percent(row.used, row.entitlement)} tone="info"/>{fmt(percent(row.used, row.entitlement))}%</span> },
      ]}/>
    </Panel>
    <div className="rp-grid two">
      <Panel title={t("الأكثر أخذًا للإجازات", "Most leave taken")}>
        <DataTable rows={l.topTakers} empty={t("لا توجد إجازات معتمدة.", "No approved leave.")} columns={[
          { header: t("الموظف", "Employee"), cell: row => <PersonCell person={row} rtl={rtl}/> },
          { header: t("الطلبات", "Requests"), number: true, cell: row => fmt(row.requests) },
          { header: t("الأيام", "Days"), number: true, cell: row => <b>{fmt(row.days)}</b> },
        ]}/>
      </Panel>
      <Panel title={t("أعلى رصيد إجازة سنوية متبقٍ", "Largest unused annual leave")} note={t("رصيد لم يُستخدم بعد — مفيد لتخطيط الإجازات.", "Not yet taken — useful for planning time off.")}>
        <DataTable rows={l.highBalances} empty={t("لا توجد أرصدة.", "No balances.")} columns={[
          { header: t("الموظف", "Employee"), cell: row => <PersonCell person={row} rtl={rtl}/> },
          { header: t("المستحق", "Entitled"), number: true, cell: row => fmt(row.entitlement) },
          { header: t("المتبقي", "Remaining"), number: true, cell: row => <b>{fmt(row.entitlement - row.used - row.pending)}</b> },
        ]}/>
      </Panel>
    </div>
    <Panel title={t("إجازات حالية وقادمة (14 يومًا)", "Current and upcoming leave (14 days)")}>
      <DataTable rows={l.upcoming.rows} empty={t("لا توجد إجازات معتمدة في هذه الفترة.", "No approved leave in this window.")} footer={shown(l.upcoming.total, l.upcoming.rows.length, rtl, fmt)} columns={[
        { header: t("الموظف", "Employee"), cell: row => <PersonCell person={row} rtl={rtl}/> },
        { header: t("النوع", "Type"), cell: row => (rtl ? row.leave_ar || row.leave_en : row.leave_en || row.leave_ar) },
        { header: t("من", "From"), cell: row => <Ltr>{row.from_date}</Ltr> },
        { header: t("إلى", "To"), cell: row => <Ltr>{row.to_date}</Ltr> },
        { header: t("الأيام", "Days"), number: true, cell: row => fmt(row.days) },
      ]}/>
    </Panel>
    <div className="rp-actions"><ExportButton label={t("تصدير طلبات الإجازة (CSV)", "Export leave requests (CSV)")} busy={ctx.exporting === "leave"} onClick={() => ctx.exportCsv("leave")}/></div>
  </>;
}

export function ApprovalsTab({ data, ctx }: Props) {
  const { rtl, fmt } = ctx, t = (ar: string, en: string) => (rtl ? ar : en), a = data.approvals, totals = a.totals;
  const waiting = totals.pending_manager + totals.pending_hr, other = Math.max(0, totals.total - totals.approved - waiting - totals.rejected - totals.cancelled);
  return <>
    <p className="rp-note">{t("الطلبات المقدَّمة داخل الفترة المختارة. قسم «قيد الانتظار الآن» يعرض كل ما ينتظر قرارًا اليوم بغض النظر عن تاريخه.", "Requests submitted in the selected period. The “pending now” block shows everything waiting for a decision today, whatever its date.")}</p>
    <KpiGrid>
      <Kpi icon={ClipboardCheck} label={t("طلبات مقدَّمة", "Requests submitted")} value={fmt(totals.total)} delta={<Delta current={totals.total} previous={totals.previous_total} neutral rtl={rtl} fmt={fmt}/>}/>
      <Kpi icon={CheckCircle2} label={t("معتمدة", "Approved")} value={fmt(totals.approved)} hint={`${fmt(percent(totals.approved, totals.total))}%`} tone="good"/>
      <Kpi icon={UserX} label={t("مرفوضة", "Rejected")} value={fmt(totals.rejected)} hint={`${fmt(percent(totals.rejected, totals.total))}%`}/>
      <Kpi icon={Timer} label={t("متوسط زمن القرار", "Average time to decide")} value={a.averageHours == null ? "—" : hoursOrDays(a.averageHours, rtl, fmt)} tone={a.averageHours != null && a.averageHours >= 48 ? "warn" : "neutral"} hint={t("من التقديم حتى آخر قرار", "from submission to the last decision")}/>
      <Kpi icon={Hourglass} label={t("قيد الانتظار الآن", "Pending now")} value={fmt(a.pendingNow.manager + a.pendingNow.hr)} tone={a.pendingNow.overdue ? "bad" : "neutral"} hint={t(`${fmt(a.pendingNow.manager)} عند المدير · ${fmt(a.pendingNow.hr)} عند الموارد البشرية`, `${fmt(a.pendingNow.manager)} with managers · ${fmt(a.pendingNow.hr)} with HR`)}/>
      <Kpi icon={AlertTriangle} label={t("متأخرة أكثر من 3 أيام", "Waiting over 3 days")} value={fmt(a.pendingNow.overdue)} tone={a.pendingNow.overdue ? "bad" : "good"}/>
    </KpiGrid>
    <Panel title={t("حالة طلبات الفترة", "Status of the period's requests")}>
      {totals.total ? <StackBar fmt={fmt} parts={[
        { label: t("معتمد", "Approved"), value: totals.approved, tone: "good" }, { label: t("عند المدير", "With manager"), value: totals.pending_manager, tone: "warn" },
        { label: t("عند الموارد البشرية", "With HR"), value: totals.pending_hr, tone: "info" }, { label: t("مرفوض", "Rejected"), value: totals.rejected, tone: "bad" },
        { label: t("ملغي", "Cancelled"), value: totals.cancelled, tone: "neutral" }, ...(other ? [{ label: t("أخرى", "Other"), value: other, tone: "neutral" as Tone }] : []),
      ]}/> : <Empty text={t("لا توجد طلبات في هذه الفترة.", "No requests in this period.")}/>}
    </Panel>
    <div className="rp-grid two">
      <Panel title={t("حسب نوع الطلب", "By request type")}>
        <DataTable rows={a.byKind} empty={t("لا توجد طلبات.", "No requests.")} columns={[
          { header: t("النوع", "Type"), cell: row => <b>{statusLabel(row.key, rtl)}</b> },
          { header: t("الإجمالي", "Total"), number: true, cell: row => fmt(row.total) },
          { header: t("معتمد", "Approved"), number: true, cell: row => nz(row.approved, fmt) },
          { header: t("قيد الانتظار", "Waiting"), number: true, cell: row => nz(row.pending, fmt) },
          { header: t("مرفوض", "Rejected"), number: true, cell: row => nz(row.rejected, fmt) },
        ]}/>
      </Panel>
      <Panel title={t("أقدم الطلبات قيد الانتظار", "Oldest pending requests")}>
        <DataTable rows={a.oldest.rows} empty={t("لا توجد طلبات قيد الانتظار — كل شيء محسوم.", "Nothing is pending — all decided.")} footer={shown(a.oldest.total, a.oldest.rows.length, rtl, fmt)} columns={[
          { header: t("الموظف", "Employee"), cell: row => <PersonCell person={row} rtl={rtl}/> },
          { header: t("الطلب", "Request"), cell: row => <div className="rp-person"><b>{statusLabel(row.kind, rtl)}</b><small><Ltr>{row.request_code}</Ltr></small></div> },
          { header: t("عند", "With"), cell: row => statusLabel(row.stage, rtl) },
          { header: t("منذ", "Waiting"), number: true, cell: row => <Badge tone={row.age_days >= 3 ? "bad" : "neutral"}>{daysLabel(row.age_days, rtl, fmt)}</Badge> },
        ]}/>
      </Panel>
    </div>
    <div className="rp-actions"><ExportButton label={t("تصدير سجل الاعتمادات (CSV)", "Export the approvals log (CSV)")} busy={ctx.exporting === "approvals"} onClick={() => ctx.exportCsv("approvals")}/></div>
  </>;
}

export function DocumentsTab({ data, ctx }: Props) {
  const { rtl, fmt } = ctx, t = (ar: string, en: string) => (rtl ? ar : en), d = data.documents;
  if (!d) return <Empty text={t("تقرير المستندات متاح للموارد البشرية فقط.", "The documents report is available to HR only.")}/>;
  return <>
    <KpiGrid>
      <Kpi icon={FileWarning} label={t("مستندات سارية", "Valid documents")} value={fmt(d.totals.valid + d.totals.no_expiry)} tone="good" hint={t(`من ${fmt(d.totals.active)} مستندًا نشطًا`, `of ${fmt(d.totals.active)} active documents`)}/>
      <Kpi icon={AlertTriangle} label={t("تنتهي خلال 30 يومًا", "Expiring in 30 days")} value={fmt(d.totals.expiring)} tone={d.totals.expiring ? "warn" : "good"}/>
      <Kpi icon={AlertOctagon} label={t("منتهية الصلاحية", "Expired")} value={fmt(d.totals.expired)} tone={d.totals.expired ? "bad" : "good"}/>
      <Kpi icon={ClipboardCheck} label={t("مستندات مطلوبة ناقصة", "Required documents missing")} value={fmt(d.missing.total)} tone={d.missing.total ? "warn" : "good"}/>
    </KpiGrid>
    <Panel title={t("حالة المستندات", "Document status")}>
      {d.totals.active ? <StackBar fmt={fmt} parts={[
        { label: t("ساري", "Valid"), value: d.totals.valid, tone: "good" }, { label: t("ينتهي خلال 30 يومًا", "Expiring in 30 days"), value: d.totals.expiring, tone: "warn" },
        { label: t("منتهي", "Expired"), value: d.totals.expired, tone: "bad" }, { label: t("بدون تاريخ انتهاء", "No expiry date"), value: d.totals.no_expiry, tone: "neutral" },
      ]}/> : <Empty text={t("لا توجد مستندات.", "No documents.")}/>}
    </Panel>
    <Panel title={t("مستندات تحتاج إجراء", "Documents that need action")} note={t("المنتهية أولًا ثم التي تنتهي خلال 30 يومًا.", "Expired first, then those expiring within 30 days.")}>
      <DataTable rows={d.attention.rows} empty={t("لا توجد مستندات تحتاج إجراء.", "No documents need action.")} footer={shown(d.attention.total, d.attention.rows.length, rtl, fmt)} columns={[
        { header: t("الموظف", "Employee"), cell: row => <PersonCell person={row} rtl={rtl}/> },
        { header: t("المستند", "Document"), cell: row => <div className="rp-person"><b>{row.name}</b><small>{rtl ? row.category_ar || row.category_en : row.category_en || row.category_ar}</small></div> },
        { header: t("تاريخ الانتهاء", "Expires"), cell: row => <Ltr>{row.expiry_date}</Ltr> },
        { header: t("الحالة", "Status"), cell: row => dueBadge(row.days_left, rtl, fmt) },
      ]}/>
    </Panel>
    <div className="rp-grid two">
      <Panel title={t("حسب التصنيف", "By category")}>
        <DataTable rows={d.byCategory} empty={t("لا توجد بيانات.", "No data.")} columns={[
          { header: t("التصنيف", "Category"), cell: row => <b>{namedLabel(row, rtl)}</b> },
          { header: t("الإجمالي", "Total"), number: true, cell: row => fmt(row.total) },
          { header: t("قريب الانتهاء", "Expiring"), number: true, cell: row => (row.expiring ? <Badge tone="warn">{fmt(row.expiring)}</Badge> : "—") },
          { header: t("منتهي", "Expired"), number: true, cell: row => (row.expired ? <Badge tone="bad">{fmt(row.expired)}</Badge> : "—") },
        ]}/>
      </Panel>
      <Panel title={t("مستندات مطلوبة ناقصة", "Required documents missing")} note={t("حسب التصنيف.", "By category.")}>
        <BarList rows={d.missing.byCategory.map(row => ({ label: namedLabel(row, rtl), value: row.count, tone: "warn" }))} fmt={fmt} empty={t("كل المستندات المطلوبة مرفوعة.", "All required documents are on file.")}/>
      </Panel>
    </div>
    <Panel title={t("موظفون ينقصهم مستندات", "Employees with missing documents")}>
      <DataTable rows={d.missing.employees} empty={t("لا يوجد نقص.", "Nothing missing.")} columns={[
        { header: t("الموظف", "Employee"), cell: row => <PersonCell person={row} rtl={rtl}/> },
        { header: t("العدد", "Count"), number: true, cell: row => fmt(row.count) },
        { header: t("المستندات الناقصة", "Missing documents"), cell: row => (rtl ? row.names_ar || row.names_en : row.names_en || row.names_ar) },
      ]}/>
    </Panel>
    <div className="rp-actions"><ExportButton label={t("تصدير المستندات (CSV)", "Export documents (CSV)")} busy={ctx.exporting === "documents"} onClick={() => ctx.exportCsv("documents")}/></div>
  </>;
}

type TalentId = "recruitment" | "lifecycle" | "assets" | "learning";

export function TalentTab({ data, ctx }: Props) {
  const { rtl } = ctx, t = (ar: string, en: string) => (rtl ? ar : en);
  const available = ([
    ["recruitment", t("التوظيف", "Recruitment"), data.recruitment], ["lifecycle", t("التهيئة وإنهاء الخدمة", "Onboarding & offboarding"), data.lifecycle],
    ["assets", t("العهد والأصول", "Assets"), data.assets], ["learning", t("التعلم والتطوير", "Learning"), data.learning],
  ] as [TalentId, string, unknown][]).filter(item => item[2]);
  const [chosen, setChosen] = useState<TalentId | null>(null);
  const active = available.find(item => item[0] === chosen)?.[0] ?? available[0]?.[0];
  if (!active) return <Empty text={t("لا تملك صلاحية عرض تقارير التوظيف أو التهيئة أو العهد أو التعلم.", "You do not have access to the recruitment, onboarding, assets or learning reports.")}/>;
  return <>
    <div className="rp-subtabs" role="tablist">{available.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={id === active} className={id === active ? "active" : ""} onClick={() => setChosen(id)}>{label}</button>)}</div>
    {active === "recruitment" && data.recruitment && <RecruitmentSection data={data.recruitment} ctx={ctx}/>}
    {active === "lifecycle" && data.lifecycle && <LifecycleSection data={data.lifecycle} ctx={ctx}/>}
    {active === "assets" && data.assets && <AssetsSection data={data.assets} ctx={ctx}/>}
    {active === "learning" && data.learning && <LearningSection data={data.learning} ctx={ctx}/>}
  </>;
}

function RecruitmentSection({ data, ctx }: { data: NonNullable<ReportOverview["recruitment"]>; ctx: ReportContext }) {
  const { rtl, fmt } = ctx, t = (ar: string, en: string) => (rtl ? ar : en);
  return <>
    <KpiGrid>
      <Kpi icon={Briefcase} label={t("وظائف مفتوحة", "Open jobs")} value={fmt(data.openJobs)} hint={t(`${fmt(data.openPositions)} شاغر`, `${fmt(data.openPositions)} positions`)}/>
      <Kpi icon={Users} label={t("مرشحون في المسار الآن", "Candidates in the pipeline")} value={fmt(data.pipeline)} tone={data.stalled ? "warn" : "neutral"} hint={data.stalled ? t(`${fmt(data.stalled)} متوقف أكثر من 14 يومًا`, `${fmt(data.stalled)} stalled over 14 days`) : undefined}/>
      <Kpi icon={UserPlus} label={t("تقدّموا في الفترة", "Applied in the period")} value={fmt(data.applications)}/>
      <Kpi icon={CheckCircle2} label={t("تم تعيينهم", "Hired")} value={fmt(data.hired)} tone={data.hired ? "good" : "neutral"} hint={t(`${fmt(data.rejected)} مرفوض`, `${fmt(data.rejected)} rejected`)}/>
      <Kpi icon={Timer} label={t("متوسط أيام التعيين", "Average days to hire")} value={data.avgDaysToHire == null ? "—" : fmt(data.avgDaysToHire)} hint={t("من التقديم حتى القرار", "from application to decision")}/>
    </KpiGrid>
    <div className="rp-grid two">
      <Panel title={t("المرشحون حسب المرحلة", "Candidates by stage")}><BarList rows={data.byStage.map(row => ({ label: namedLabel(row, rtl), value: row.count }))} fmt={fmt} empty={t("لا يوجد مرشحون في المسار.", "Nobody in the pipeline.")}/></Panel>
      <Panel title={t("مصادر التقديم", "Application sources")}>
        <DataTable rows={data.bySource} empty={t("لا توجد طلبات تقديم في هذه الفترة.", "No applications in this period.")} columns={[
          { header: t("المصدر", "Source"), cell: row => <b>{statusLabel(row.key, rtl)}</b> },
          { header: t("المتقدمون", "Applicants"), number: true, cell: row => fmt(row.applications) },
          { header: t("عُيّنوا", "Hired"), number: true, cell: row => nz(row.hired, fmt) },
        ]}/>
      </Panel>
    </div>
    <Panel title={t("الوظائف المفتوحة", "Open jobs")}>
      <DataTable rows={data.jobs} empty={t("لا توجد وظائف مفتوحة.", "No open jobs.")} columns={[
        { header: t("الوظيفة", "Job"), cell: row => <b>{row.title}</b> },
        { header: t("الشواغر", "Openings"), number: true, cell: row => fmt(row.openings_count) },
        { header: t("في المسار", "In pipeline"), number: true, cell: row => nz(row.pipeline, fmt) },
        { header: t("تم تعيينهم", "Hired"), number: true, cell: row => nz(row.hired, fmt) },
        { header: t("مفتوحة منذ", "Open since"), cell: row => <Ltr>{row.created_date}</Ltr> },
      ]}/>
    </Panel>
    <div className="rp-actions"><ExportButton label={t("تصدير تقرير التوظيف (CSV)", "Export the recruitment report (CSV)")} busy={ctx.exporting === "recruitment"} onClick={() => ctx.exportCsv("recruitment")}/></div>
  </>;
}

function LifecycleSection({ data, ctx }: { data: NonNullable<ReportOverview["lifecycle"]>; ctx: ReportContext }) {
  const { rtl, fmt } = ctx, t = (ar: string, en: string) => (rtl ? ar : en);
  return <>
    <KpiGrid>
      {data.types.map(row => <Kpi key={row.type} icon={row.type === "onboarding" ? UserPlus : UserMinus} label={row.type === "onboarding" ? t("تهيئة جارية", "Onboarding in progress") : t("إنهاء خدمة جارٍ", "Offboarding in progress")} value={fmt(row.lifecycles)} tone={row.overdue ? "warn" : "neutral"} hint={t(`${fmt(row.done)} من ${fmt(row.tasks)} مهمة مكتملة`, `${fmt(row.done)} of ${fmt(row.tasks)} tasks done`)}/>)}
      <Kpi icon={AlertTriangle} label={t("مهام متأخرة", "Overdue tasks")} value={fmt(data.overdueTasks.total)} tone={data.overdueTasks.total ? "warn" : "good"}/>
      <Kpi icon={CheckCircle2} label={t("اكتملت في الفترة", "Completed in the period")} value={fmt(data.completedInPeriod.reduce((sum, row) => sum + row.count, 0))}/>
    </KpiGrid>
    <Panel title={t("مهام متأخرة", "Overdue tasks")}>
      <DataTable rows={data.overdueTasks.rows} empty={t("لا توجد مهام متأخرة.", "No overdue tasks.")} footer={shown(data.overdueTasks.total, data.overdueTasks.rows.length, rtl, fmt)} columns={[
        { header: t("الموظف", "Employee"), cell: row => <PersonCell person={row} rtl={rtl}/> },
        { header: t("المهمة", "Task"), cell: row => <div className="rp-person"><b>{row.title}</b><small>{statusLabel(row.type, rtl)}</small></div> },
        { header: t("الاستحقاق", "Due"), cell: row => <Ltr>{row.due_date}</Ltr> },
        { header: t("التأخير", "Late by"), number: true, cell: row => <Badge tone="bad">{daysLabel(row.days_late, rtl, fmt)}</Badge> },
      ]}/>
    </Panel>
    <div className="rp-actions">
      <ExportButton label={t("تصدير تقرير التهيئة (CSV)", "Export onboarding (CSV)")} busy={ctx.exporting === "onboarding"} onClick={() => ctx.exportCsv("onboarding")}/>
      <ExportButton label={t("تصدير تقرير إنهاء الخدمة (CSV)", "Export offboarding (CSV)")} busy={ctx.exporting === "offboarding"} onClick={() => ctx.exportCsv("offboarding")}/>
    </div>
  </>;
}

function AssetsSection({ data, ctx }: { data: NonNullable<ReportOverview["assets"]>; ctx: ReportContext }) {
  const { rtl, fmt } = ctx, t = (ar: string, en: string) => (rtl ? ar : en), inventory = data.inventory;
  const count = (key: string) => inventory?.byStatus.find(row => row.key === key)?.count ?? 0;
  return <>
    <KpiGrid>
      {inventory && <>
        <Kpi icon={Laptop} label={t("إجمالي العهد", "Total assets")} value={fmt(inventory.byStatus.reduce((sum, row) => sum + row.count, 0))}/>
        <Kpi icon={Users} label={t("مُسندة", "Assigned")} value={fmt(count("assigned"))}/>
        <Kpi icon={CheckCircle2} label={t("متاحة", "Available")} value={fmt(count("available"))} tone="good"/>
        <Kpi icon={FileWarning} label={t("بحالة ضعيفة", "In poor condition")} value={fmt(inventory.poorCondition)} tone={inventory.poorCondition ? "warn" : "good"}/>
      </>}
      <Kpi icon={AlertOctagon} label={t("لم تُسلَّم من مغادرين", "Not returned by leavers")} value={fmt(data.unreturned.total)} tone={data.unreturned.total ? "bad" : "good"}/>
    </KpiGrid>
    {inventory && <Panel title={t("العهد حسب التصنيف", "Assets by category")}>
      <BarList rows={inventory.byCategory.map(row => ({ label: statusLabel(row.key, rtl), value: row.total, note: t(`${fmt(row.assigned)} مُسندة`, `${fmt(row.assigned)} assigned`) }))} fmt={fmt} empty={t("لا توجد عهد مسجلة.", "No assets recorded.")}/>
    </Panel>}
    <Panel title={t("عهد لدى موظفين منتهية خدمتهم أو في إنهاء الخدمة", "Assets held by leavers or employees being offboarded")}>
      <DataTable rows={data.unreturned.rows} empty={t("كل العهد مسلَّمة.", "Everything has been returned.")} footer={shown(data.unreturned.total, data.unreturned.rows.length, rtl, fmt)} columns={[
        { header: t("الموظف", "Employee"), cell: row => <PersonCell person={row} rtl={rtl}/> },
        { header: t("العهدة", "Asset"), cell: row => <div className="rp-person"><b>{row.asset_name}</b><small><Ltr>{row.asset_code}</Ltr> · {statusLabel(row.category, rtl)}</small></div> },
        { header: t("تاريخ التسليم", "Assigned on"), cell: row => <Ltr>{row.assigned_at}</Ltr> },
      ]}/>
    </Panel>
    <div className="rp-actions"><ExportButton label={t("تصدير العهد والأصول (CSV)", "Export assets (CSV)")} busy={ctx.exporting === "assets"} onClick={() => ctx.exportCsv("assets")}/></div>
  </>;
}

function LearningSection({ data, ctx }: { data: NonNullable<ReportOverview["learning"]>; ctx: ReportContext }) {
  const { rtl, fmt } = ctx, t = (ar: string, en: string) => (rtl ? ar : en);
  return <>
    <KpiGrid>
      <Kpi icon={GraduationCap} label={t("نسبة الإكمال", "Completion rate")} value={`${fmt(data.completionRate)}%`} hint={t(`${fmt(data.totals.completed)} مكتملة`, `${fmt(data.totals.completed)} completed`)}/>
      <Kpi icon={CheckCircle2} label={t("اكتملت في الفترة", "Completed in the period")} value={fmt(data.totals.completed_in_period)} tone="good"/>
      <Kpi icon={Hourglass} label={t("قيد التنفيذ", "In progress")} value={fmt(data.totals.in_progress)} hint={t(`${fmt(data.totals.assigned)} لم تبدأ`, `${fmt(data.totals.assigned)} not started`)}/>
      <Kpi icon={AlertOctagon} label={t("إلزامية متأخرة", "Mandatory overdue")} value={fmt(data.mandatoryOverdue.total)} tone={data.mandatoryOverdue.total ? "bad" : "good"}/>
      <Kpi icon={AlertTriangle} label={t("شهادات تنتهي خلال 60 يومًا", "Certificates expiring in 60 days")} value={fmt(data.certificates.total)} tone={data.certificates.total ? "warn" : "good"}/>
    </KpiGrid>
    <Panel title={t("برامج تدريبية إلزامية متأخرة", "Mandatory courses past due")}>
      <DataTable rows={data.mandatoryOverdue.rows} empty={t("لا توجد برامج تدريبية إلزامية متأخرة.", "No mandatory course is past due.")} footer={shown(data.mandatoryOverdue.total, data.mandatoryOverdue.rows.length, rtl, fmt)} columns={[
        { header: t("الموظف", "Employee"), cell: row => <PersonCell person={row} rtl={rtl}/> },
        { header: t("البرنامج التدريبي", "Course"), cell: row => <b>{row.course}</b> },
        { header: t("الاستحقاق", "Due"), cell: row => <Ltr>{row.due_date}</Ltr> },
        { header: t("التأخير", "Late by"), number: true, cell: row => <Badge tone="bad">{daysLabel(row.days_late, rtl, fmt)}</Badge> },
      ]}/>
    </Panel>
    <div className="rp-grid two">
      <Panel title={t("شهادات منتهية أو قاربت الانتهاء", "Certificates expired or expiring")}>
        <DataTable rows={data.certificates.rows} empty={t("لا توجد شهادات تحتاج تجديدًا.", "No certificate needs renewing.")} footer={shown(data.certificates.total, data.certificates.rows.length, rtl, fmt)} columns={[
          { header: t("الموظف", "Employee"), cell: row => <PersonCell person={row} rtl={rtl}/> },
          { header: t("البرنامج التدريبي", "Course"), cell: row => row.course },
          { header: t("الحالة", "Status"), cell: row => dueBadge(row.days_left, rtl, fmt) },
        ]}/>
      </Panel>
      <Panel title={t("نتائج البرامج التدريبية", "Course results")}>
        <DataTable rows={data.byCourse} empty={t("لا توجد برامج تدريبية مسندة.", "No courses assigned.")} columns={[
          { header: t("البرنامج التدريبي", "Course"), cell: row => <div className="rp-person"><b>{row.title}</b>{row.mandatory ? <small>{t("إلزامية", "Mandatory")}</small> : null}</div> },
          { header: t("المسجلون", "Enrolled"), number: true, cell: row => fmt(row.enrolled) },
          { header: t("الإكمال", "Completed"), cell: row => <span className="rp-rate"><Meter value={percent(row.completed, row.enrolled)} tone="good"/>{fmt(percent(row.completed, row.enrolled))}%</span> },
          { header: t("متوسط الدرجة", "Avg score"), number: true, cell: row => (row.avg_score == null ? "—" : fmt(row.avg_score)) },
        ]}/>
      </Panel>
    </div>
    <div className="rp-actions"><ExportButton label={t("تصدير تقرير التعلم (CSV)", "Export the learning report (CSV)")} busy={ctx.exporting === "learning"} onClick={() => ctx.exportCsv("learning")}/></div>
  </>;
}
