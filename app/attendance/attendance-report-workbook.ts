import { columnName, xml, zip } from "../reports/excel-workbook.ts";

type Day = Record<string, unknown>;
type Total = Record<string, unknown>;
type Cell = { v: string | number; s: number };
type Sheet = { name: string; rows: Cell[][]; merges: string[]; widths: number[]; freezeRows: number; heights: Record<number, number> };

// Style ids into styles.xml below.
const S = { text: 0, title: 1, header: 2, day: 3, amber: 4, red: 5, blue: 6, grey: 7, total: 8, sheetTitle: 9, number: 10, redBold: 11 } as const;

const STATUS_AR: Record<string, string> = { present: "حاضر", late: "متأخر", absent: "غائب", leave: "إجازة", holiday: "عطلة رسمية", remote: "عن بُعد", needs_review: "يحتاج مراجعة", non_working_day: "يوم راحة", scheduled: "مجدول" };
const STATUS_EN: Record<string, string> = { present: "Present", late: "Late", absent: "Absent", leave: "On leave", holiday: "Official holiday", remote: "Remote", needs_review: "Needs review", non_working_day: "Day off", scheduled: "Scheduled" };

const weekday = (day: unknown, arabic: boolean) => /^\d{4}-\d{2}-\d{2}$/.test(String(day)) ? new Intl.DateTimeFormat(arabic ? "ar-EG" : "en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(String(day) + "T12:00:00Z")) : "";
const duration = (minutes: unknown, arabic: boolean) => {
  const total = Math.max(0, Math.round(Number(minutes) || 0)), hours = Math.floor(total / 60), rest = total % 60;
  if (!total) return "—";
  return arabic ? [hours ? `${hours} س` : "", rest ? `${rest} د` : ""].filter(Boolean).join(" ") : [hours ? `${hours}h` : "", rest ? `${rest}m` : ""].filter(Boolean).join(" ");
};
const deduction = (wageDays: unknown, fixed: unknown, arabic: boolean) => {
  const days = Number(wageDays) || 0, amount = Number(fixed) || 0, format = (value: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(value);
  return [days ? (arabic ? `${format(days)} يوم` : `${format(days)} day${days === 1 ? "" : "s"}`) : "", amount ? format(amount) : ""].filter(Boolean).join(" + ") || "—";
};
const hours = (minutes: unknown) => Math.round((Math.max(0, Number(minutes) || 0) / 60) * 100) / 100;
const employeeName = (row: Day, arabic: boolean) => String((arabic ? row.employee_name_ar || row.employee_name : row.employee_name) ?? "");
const departmentName = (row: Day, arabic: boolean) => String((arabic ? row.department_name_ar || row.department_name : row.department_name) ?? "");
const dayStyle = (status: string) => (["late", "needs_review"].includes(status) ? S.amber : status === "absent" ? S.red : status === "leave" ? S.blue : ["non_working_day", "holiday"].includes(status) ? S.grey : S.day);

function sheetXml(sheet: Sheet, arabic: boolean) {
  const rows = sheet.rows.map((cells, index) => {
    const height = sheet.heights[index];
    return `<row r="${index + 1}"${height ? ` ht="${height}" customHeight="1"` : ""}>${cells.map((cell, col) => typeof cell.v === "number"
      ? `<c r="${columnName(col)}${index + 1}" s="${cell.s}"><v>${cell.v}</v></c>`
      : `<c r="${columnName(col)}${index + 1}" t="inlineStr" s="${cell.s}"><is><t xml:space="preserve">${xml(cell.v)}</t></is></c>`).join("")}</row>`;
  }).join("");
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const pane = sheet.freezeRows ? `<pane ySplit="${sheet.freezeRows}" topLeftCell="A${sheet.freezeRows + 1}" activePane="bottomLeft" state="frozen"/>` : "";
  const merges = sheet.merges.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map(ref => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` : "";
  return `<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0" showGridLines="0" rightToLeft="${arabic ? 1 : 0}">${pane}</sheetView></sheetViews><cols>${sheet.widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${rows}</sheetData>${merges}</worksheet>`;
}

const styles = (ns: string) => {
  const border = '<border><left style="thin"><color rgb="FFD0D5D2"/></left><right style="thin"><color rgb="FFD0D5D2"/></right><top style="thin"><color rgb="FFD0D5D2"/></top><bottom style="thin"><color rgb="FFD0D5D2"/></bottom><diagonal/></border>';
  const fill = (rgb: string) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
  const center = '<alignment horizontal="center" vertical="center" wrapText="1"/>', start = '<alignment horizontal="start" vertical="center"/>';
  const xf = (font: number, fillId: number, borderId: number, alignment: string) => `<xf numFmtId="2" fontId="${font}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${alignment}</xf>`;
  return `<styleSheet xmlns="${ns}"><fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="15"/><color rgb="FF0F5F4A"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFB42318"/><name val="Calibri"/></font></fonts>`
    + `<fills count="9"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fill("0F5F4A")}${fill("DDEFE8")}${fill("FFF1D6")}${fill("FDE2E2")}${fill("E1ECFA")}${fill("EFEFEA")}${fill("CFE5DC")}</fills>`
    + `<borders count="2"><border/>${border}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="12">${xf(0, 0, 1, center)}${xf(2, 2, 0, start)}${xf(1, 3, 1, center)}${xf(0, 0, 1, center)}${xf(0, 4, 1, center)}${xf(0, 5, 1, center)}${xf(0, 6, 1, center)}${xf(0, 7, 1, center)}${xf(1, 8, 1, center)}${xf(3, 0, 0, start)}${xf(0, 0, 1, center)}${xf(4, 5, 1, center)}</cellXfs>`
    + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
};

/**
 * Two-sheet workbook: a one-row-per-employee summary, then each employee's days as a block
 * (name band, header, one coloured row per day, totals row with lateness and deduction).
 * `days` must be ordered by employee then date.
 */
export function attendanceWorkbook({ days, totals, from, to, arabic }: { days: Day[]; totals: Total[]; from: string; to: string; arabic: boolean }) {
  const t = (en: string, ar: string) => arabic ? ar : en;
  const statuses = arabic ? STATUS_AR : STATUS_EN;
  const cell = (v: string | number, s: number): Cell => ({ v, s });
  const period = `${from} → ${to}`;

  const summaryHead = [t("Employee", "الموظف"), t("Code", "الرقم"), t("Department", "القسم"), t("Days attended", "أيام الحضور"), t("Absent days", "أيام الغياب"), t("Leave days", "أيام الإجازة"), t("Hours worked", "ساعات العمل"), t("Late days", "أيام التأخير"), t("Total late", "مدة التأخير"), t("Early leave", "انصراف مبكر"), t("Overtime", "أوفر تايم"), t("Deduction", "الخصم")];
  const summary: Sheet = { name: t("Summary", "الملخص"), rows: [[cell(`${t("Attendance summary per employee", "ملخص الحضور لكل موظف")} · ${period}`, S.sheetTitle)], summaryHead.map(label => cell(label, S.header))], merges: [`A1:${columnName(summaryHead.length - 1)}1`], widths: [30, 11, 20, 12, 12, 12, 13, 12, 14, 14, 14, 16], freezeRows: 2, heights: { 0: 26, 1: 24 } };
  for (const row of totals) {
    const hasDeduction = Number(row.deduction_wage_days) > 0 || Number(row.deduction_fixed_amount) > 0;
    summary.rows.push([cell(employeeName(row, arabic), S.day), cell(String(row.employee_code ?? ""), S.day), cell(departmentName(row, arabic) || "—", S.day), cell(Number(row.attended_days) || 0, S.number), cell(Number(row.absent_days) || 0, Number(row.absent_days) > 0 ? S.redBold : S.number), cell(Number(row.leave_days) || 0, S.number), cell(hours(row.worked_minutes), S.number), cell(Number(row.late_days) || 0, Number(row.late_days) > 0 ? S.amber : S.number), cell(duration(row.late_minutes, arabic), Number(row.late_minutes) > 0 ? S.amber : S.number), cell(duration(row.early_minutes, arabic), S.number), cell(duration(row.overtime_minutes, arabic), S.number), cell(deduction(row.deduction_wage_days, row.deduction_fixed_amount, arabic), hasDeduction ? S.redBold : S.number)]);
  }

  const detailHead = [t("Date", "التاريخ"), t("Day", "اليوم"), t("Schedule", "الدوام"), t("Check-in", "الحضور"), t("Check-out", "الانصراف"), t("Hours", "ساعات العمل"), t("Late", "التأخير"), t("Early leave", "انصراف مبكر"), t("Overtime", "أوفر تايم"), t("Status", "الحالة"), t("Deduction", "الخصم"), t("Deduction rule", "سبب الخصم")];
  const last = columnName(detailHead.length - 1);
  const detail: Sheet = { name: t("Daily detail", "التفصيل اليومي"), rows: [[cell(`${t("Daily attendance per employee", "الحضور اليومي لكل موظف")} · ${period}`, S.sheetTitle)]], merges: [`A1:${last}1`], widths: [13, 12, 15, 10, 10, 12, 12, 13, 12, 22, 14, 26], freezeRows: 0, heights: { 0: 26 } };
  const blank = () => detail.rows.push([]);
  for (let start = 0; start < days.length;) {
    let end = start;
    while (end < days.length && days[end].employee_id === days[start].employee_id) end++;
    const group = days.slice(start, end), first = group[0];
    blank();
    detail.merges.push(`A${detail.rows.length + 1}:${last}${detail.rows.length + 1}`);
    detail.heights[detail.rows.length] = 22;
    detail.rows.push([cell(`${employeeName(first, arabic)}  ·  ${first.employee_code ?? ""}  ·  ${departmentName(first, arabic) || "—"}`, S.title), ...detailHead.slice(1).map(() => cell("", S.title))]);
    detail.rows.push(detailHead.map(label => cell(label, S.header)));
    for (const row of group) {
      const style = dayStyle(String(row.status)), costs = Number(row.deduction_wage_days) > 0 || Number(row.deduction_fixed_amount) > 0;
      detail.rows.push([cell(String(row.work_date), style), cell(weekday(row.work_date, arabic), style), cell(row.scheduled_in ? `${row.scheduled_in} – ${row.scheduled_out ?? ""}` : "—", style), cell(String(row.actual_in || "—"), style), cell(String(row.actual_out || "—"), style), cell(row.actual_out ? hours(row.worked_minutes) : "—", style), cell(duration(row.late_minutes, arabic), Number(row.late_minutes) > 0 ? S.amber : style), cell(duration(row.early_minutes, arabic), style), cell(duration(row.overtime_minutes, arabic), style), cell(statuses[String(row.status)] || String(row.status ?? ""), style), cell(deduction(row.deduction_wage_days, row.deduction_fixed_amount, arabic), costs ? S.redBold : style), cell(String((arabic ? row.deduction_rule_ar || row.deduction_rule_en : row.deduction_rule_en) ?? "") || "—", style)]);
    }
    const sum = (key: string) => group.reduce((total, row) => total + (Number(row[key]) || 0), 0);
    const lateDays = group.filter(row => Number(row.late_minutes) > 0).length, absentDays = group.filter(row => row.status === "absent").length;
    detail.rows.push([cell(t("Total", "الإجمالي"), S.total), cell("", S.total), cell("", S.total), cell("", S.total), cell("", S.total), cell(hours(sum("worked_minutes")), S.total), cell(duration(sum("late_minutes"), arabic), S.total), cell(duration(sum("early_minutes"), arabic), S.total), cell(duration(sum("overtime_minutes"), arabic), S.total), cell(`${t("Late", "تأخير")} ${lateDays} · ${t("Absent", "غياب")} ${absentDays}`, S.total), cell(deduction(Math.round(sum("deduction_wage_days") * 10000) / 10000, sum("deduction_fixed_amount"), arabic), S.total), cell("", S.total)]);
    start = end;
  }

  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const sheets = [summary, detail];
  const sheetName = (name: string) => xml(name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  return zip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${sheetName(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": styles(ns),
    ...Object.fromEntries(sheets.map((sheet, index) => [`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet, arabic)])),
  });
}
