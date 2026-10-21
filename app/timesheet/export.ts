import { columnName, xml, zip } from "../reports/excel-workbook.ts";
import { deductionTypeLabel, deductionValueText, noticeLabel, num, rowStatusLabel, ruleName } from "./labels.ts";
import { deductionSummary, summarize, type SheetRow } from "./summary.ts";

type Cell = { v: string | number; s: number };
const S = { text: 0, header: 1, title: 2, total: 3, red: 4, amber: 5, grey: 6, blue: 7, green: 8, number: 9 } as const;

const rowStyle = (row: SheetRow) => {
  const status = String(row.status);
  if (num(row.is_absent) || status === "absent") return S.red;
  if (status === "rejected") return S.red;
  if (num(row.late_minutes) > 0 || num(row.early_leave_minutes) > 0 || status === "waiting_for_exit") return S.amber;
  if (["holiday", "vacation", "wfh"].includes(status)) return status === "wfh" ? S.blue : S.grey;
  if (status === "approved") return S.green;
  return S.text;
};

const sheetXml = (rows: Cell[][], widths: number[], arabic: boolean, freeze: number) => {
  const body = rows.map((cells, index) => `<row r="${index + 1}">${cells.map((cell, col) => typeof cell.v === "number"
    ? `<c r="${columnName(col)}${index + 1}" s="${cell.s}"><v>${cell.v}</v></c>`
    : `<c r="${columnName(col)}${index + 1}" t="inlineStr" s="${cell.s}"><is><t xml:space="preserve">${xml(cell.v)}</t></is></c>`).join("")}</row>`).join("");
  const pane = freeze ? `<pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/>` : "";
  return `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0" rightToLeft="${arabic ? 1 : 0}">${pane}</sheetView></sheetViews>`
    + `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${body}</sheetData></worksheet>`;
};

const styles = () => {
  const border = '<border><left style="thin"><color rgb="FFD0D5D2"/></left><right style="thin"><color rgb="FFD0D5D2"/></right><top style="thin"><color rgb="FFD0D5D2"/></top><bottom style="thin"><color rgb="FFD0D5D2"/></bottom><diagonal/></border>';
  const fill = (rgb: string) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
  const xf = (font: number, fillId: number, borderId: number) => `<xf numFmtId="0" fontId="${font}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`;
  return '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>'
    + `<fills count="9"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fill("0F5F4A")}${fill("CFE5DC")}${fill("FDE2E2")}${fill("FFF1D6")}${fill("EFEFEA")}${fill("E1ECFA")}${fill("DDEFE8")}</fills>`
    + `<borders count="2"><border/>${border}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="10">${xf(0, 0, 1)}${xf(2, 2, 1)}${xf(1, 0, 0)}${xf(1, 3, 1)}${xf(0, 4, 1)}${xf(0, 5, 1)}${xf(0, 6, 1)}${xf(0, 7, 1)}${xf(0, 8, 1)}${xf(0, 0, 1)}</cellXfs>`
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
};

const pick = (row: SheetRow, key: string, arabic: boolean) => String((arabic ? row[`${key}_ar`] || row[key] : row[key]) ?? "");
const decimal = (value: number) => Math.round(value * 100) / 100;

/** Timesheet grid (with the Grand Total row) and the Deduction Summary, following whatever filters produced `rows`. */
export function timesheetWorkbook({ rows, from, to, arabic }: { rows: SheetRow[]; from: string; to: string; arabic: boolean }) {
  const t = (en: string, ar: string) => (arabic ? ar : en);
  const cell = (v: string | number, s: number): Cell => ({ v, s });
  const head = [t("Date", "التاريخ"), t("Employee", "الموظف"), t("Code", "الرقم"), t("Department", "القسم"), t("Scheduled", "الدوام"), t("Actual", "الفعلي"), t("Changed In", "الحضور المعدّل"), t("Changed Out", "الانصراف المعدّل"),
    t("Work Hours", "ساعات العمل"), t("Late (min)", "التأخير (د)"), t("Early Leave (min)", "الانصراف المبكر (د)"), t("Overtime (min)", "الإضافي (د)"), t("Status", "الحالة"), t("Absent", "غياب"), t("Notice Status", "حالة الإشعار"),
    t("Deduction Type", "نوع الخصم"), t("Deduction Value", "قيمة الخصم"), t("Deduction Amount", "مبلغ الخصم"), t("Manager Note", "ملاحظة المدير"), t("Mail Sent", "تم إرسال البريد")];
  const grid: Cell[][] = [[cell(`${t("Timesheet", "كشف الدوام")} · ${from} → ${to}`, S.title)], head.map(label => cell(label, S.header))];
  for (const row of rows) {
    const s = rowStyle(row);
    grid.push([
      cell(String(row.work_date), s), cell(pick(row, "employee_name", arabic), s), cell(String(row.employee_code ?? ""), s), cell(pick(row, "department_name", arabic) || "—", s),
      cell(row.scheduled_start ? `${row.scheduled_start} – ${row.scheduled_end ?? ""}` : "—", s), cell(row.actual_start || row.actual_end ? `${row.actual_start ?? "—"} – ${row.actual_end ?? "—"}` : "—", s),
      cell(String(row.changed_start ?? ""), s), cell(String(row.changed_end ?? ""), s), cell(decimal(num(row.total_work_minutes) / 60), s), cell(num(row.late_minutes), s), cell(num(row.early_leave_minutes), s), cell(num(row.overtime_minutes), s),
      cell(rowStatusLabel(row, arabic), s), cell(num(row.is_absent) ? t("Yes", "نعم") : "", s), cell(noticeLabel(row, arabic), s),
      cell(deductionTypeLabel(row, arabic) || ruleName(row, arabic), s), cell(deductionValueText(row), s), cell(decimal(num(row.deduction_amount)), s), cell(String(row.manager_note ?? ""), s), cell(num(row.deduction_notification_sent) ? t("Mail Sent", "تم الإرسال") : "", s),
    ]);
  }
  const total = summarize(rows);
  grid.push([cell(t("Grand Total", "الإجمالي العام"), S.total), ...Array.from({ length: 7 }, () => cell("", S.total)), cell(decimal(total.workMinutes / 60), S.total), cell(total.lateMinutes, S.total), cell(total.earlyMinutes, S.total), cell(total.overtimeMinutes, S.total),
    cell(`${total.total}`, S.total), cell(total.absent, S.total), cell("", S.total), cell("", S.total), cell("", S.total), cell(total.totalDeduction, S.total), cell("", S.total), cell("", S.total)]);

  const { employees, grand } = deductionSummary(rows);
  const sumHead = [t("Employee", "الموظف"), t("Code", "الرقم"), t("Department", "القسم"), t("Late Count", "عدد التأخيرات"), t("Total Delay Min", "إجمالي دقائق التأخير"), t("Early Leave Count", "عدد الانصراف المبكر"), t("Total Early Leave Min", "إجمالي دقائق الانصراف المبكر"),
    t("Absent (with notice)", "غياب بإشعار"), t("Absent (without notice)", "غياب بدون إشعار"), t("Absent (unset)", "غياب غير محدد"), t("Total Deduction", "إجمالي الخصم")];
  const summary: Cell[][] = [[cell(`${t("Deduction Summary", "ملخص الخصومات")} · ${from} → ${to}`, S.title)], sumHead.map(label => cell(label, S.header))];
  for (const line of employees) summary.push([cell(pick(line as unknown as SheetRow, "employee_name", arabic), S.text), cell(line.employee_code, S.text), cell(pick(line as unknown as SheetRow, "department_name", arabic) || "—", S.text), cell(line.lateCount, S.text), cell(line.delayMinutes, S.text), cell(line.earlyCount, S.text), cell(line.earlyMinutes, S.text), cell(line.absentWithNotice, S.text), cell(line.absentWithoutNotice, S.text), cell(line.absentUnset, line.absentUnset ? S.amber : S.text), cell(line.totalDeduction, line.totalDeduction ? S.red : S.text)]);
  summary.push([cell(t("Grand Total", "الإجمالي العام"), S.total), cell("", S.total), cell("", S.total), cell(grand.lateCount, S.total), cell(grand.delayMinutes, S.total), cell(grand.earlyCount, S.total), cell(grand.earlyMinutes, S.total), cell(grand.absentWithNotice, S.total), cell(grand.absentWithoutNotice, S.total), cell(grand.absentUnset, S.total), cell(grand.totalDeduction, S.total)]);

  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const sheets = [{ name: t("Timesheet", "كشف الدوام"), xml: sheetXml(grid, [12, 24, 10, 20, 16, 16, 11, 11, 10, 10, 12, 11, 22, 8, 14, 18, 10, 12, 28, 12], arabic, 2) }, { name: t("Deduction Summary", "ملخص الخصومات"), xml: sheetXml(summary, [24, 10, 20, 12, 14, 14, 16, 14, 16, 14, 14], arabic, 2) }];
  return zip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name.slice(0, 31))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": styles(),
    ...Object.fromEntries(sheets.map((sheet, index) => [`xl/worksheets/sheet${index + 1}.xml`, sheet.xml])),
  });
}
