import { withDatabase } from "../route-helpers";
import { enforceRateLimit, requireActor, requirePermission } from "../api-security";
import { exportBiometricRecords } from "../../attendance/biometric-query";
import { excelWorkbook } from "../../reports/excel-workbook";
import { branchHrEmployeeIds } from "../../employees/hr-data-scope";

export async function GET(request: Request) {
  return withDatabase("Unable to export biometric attendance", async db => {
    const actor = await requireActor(request, db);
    await requirePermission(db, actor, "attendance", "view");
    if (!["Super Admin", "HR Manager"].includes(actor.roleName)) throw new Response("Only HR can view biometric devices", { status: 403 });
    const url = new URL(request.url), arabic = url.searchParams.get("lang") === "ar";
    await enforceRateLimit(db, request, "biometric-export", 30, 3600, actor.id);
    const report = await exportBiometricRecords(db, url, arabic, await branchHrEmployeeIds(db, actor));
    await db.prepare("INSERT INTO audit_logs (user_id,action,module,record_type,record_id,new_value,ip_address,created_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)")
      .bind(actor.id, "biometric_attendance_exported", "attendance", "attendance_device_punch", url.searchParams.get("tab") === "punches" ? "punches" : "daily", JSON.stringify({ from: url.searchParams.get("from") || "", to: url.searchParams.get("to") || "", q: url.searchParams.get("q") || "", rows: report.rows.length, limited: report.limited }), request.headers.get("cf-connecting-ip")).run();
    return new Response(excelWorkbook(report.columns, report.rows, arabic, report.sheet), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${report.filename}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "x-report-limited": String(report.limited) } });
  });
}
