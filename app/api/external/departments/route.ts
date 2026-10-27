import { withDatabase } from "../../route-helpers";
import { enforceRateLimit } from "../../api-security";
import { authenticateClient, idParam, pageQuery } from "../../../external-api/access";
import { formatDepartment, page } from "../../../external-api/format";
import { readDepartments } from "../../../external-api/queries";

/**
 * GET /api/external/departments?page=&page_size=&company_id=
 * Organizational units (companies, departments, sections, teams) with parent, manager and head count.
 * For other systems, authenticated by an API key (x-api-key) instead of a session. Read only.
 */
export async function GET(request: Request) {
  return withDatabase("Unable to load departments", async db => {
    await enforceRateLimit(db, request, "external-api-ip", 600, 60);
    const client = await authenticateClient(request);
    await enforceRateLimit(db, request, "external-api", 120, 60, client.name);
    const params = new URL(request.url).searchParams;
    const query = pageQuery(params);
    const { rows, total } = await readDepartments(db, { ...query, companyId: idParam(params, "company_id") });
    return Response.json(page(rows.map(formatDepartment), query, total), { headers: { "cache-control": "no-store" } });
  });
}
