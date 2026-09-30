import { withDatabase } from "../../route-helpers";
import { loadPermissions, requireActor, requirePermission } from "../../api-security";
import { parseReportPeriod } from "../../../reports/report-period";
import { loadReportOverview } from "../../../reports/report-overview-service";

export async function GET(request: Request) {
  return withDatabase("Unable to load report insights", async db => {
    const actor = await requireActor(request, db);
    await requirePermission(db, actor, "reports", "view");
    const period = parseReportPeriod(new URL(request.url));
    const overview = await loadReportOverview(db, actor, await loadPermissions(db, actor), period);
    return Response.json(overview, { headers: { "cache-control": "private, no-store" } });
  });
}
