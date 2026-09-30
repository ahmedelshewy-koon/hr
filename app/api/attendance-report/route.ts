import { withDatabase } from "../route-helpers";
import { enforceRateLimit, requireActor, requirePermission } from "../api-security";
import { exportAttendanceReportCsv, parseAttendanceReportFilters, readAttendanceReport } from "../../attendance/attendance-report";
import { branchHrEmployeeIds } from "../../employees/hr-data-scope";

export async function GET(request: Request) {
  return withDatabase("Unable to load the attendance report", async db => {
    const actor = await requireActor(request, db);
    await requirePermission(db, actor, "attendance", "view");
    if (!["Super Admin", "HR Manager"].includes(actor.roleName)) throw new Response("Only HR can view the attendance report", { status: 403 });
    const url = new URL(request.url), filters = parseAttendanceReportFilters(url), employeeIds = await branchHrEmployeeIds(db, actor);
    if (url.searchParams.get("format") === "csv") {
      await enforceRateLimit(db, request, "attendance-report-export", 30, 3600, actor.id);
      const report = await exportAttendanceReportCsv(db, filters, url.searchParams.get("lang") === "ar", employeeIds);
      await db.prepare("INSERT INTO audit_logs (user_id,action,module,record_type,record_id,new_value,ip_address,created_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)")
        .bind(actor.id, "attendance_report_exported", "attendance", "attendance_report", String(filters.employeeId || "all"), JSON.stringify({ ...filters, rows: report.total }), request.headers.get("cf-connecting-ip")).run();
      return new Response(report.csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${report.filename}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
    }
    return Response.json(await readAttendanceReport(db, filters, Number(url.searchParams.get("page")) || 1, employeeIds), { headers: { "cache-control": "no-store" } });
  });
}
