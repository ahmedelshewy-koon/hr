import { withDatabase } from "../../route-helpers";
import { enforceRateLimit } from "../../api-security";
import { authenticateClient, idParam, pageQuery, sinceParam, statusParam } from "../../../external-api/access";
import { formatEmployee, page } from "../../../external-api/format";
import { readEmployees } from "../../../external-api/queries";

/**
 * GET /api/external/employees?page=&page_size=&status=&department_id=&company_id=&updated_since=
 * For other systems, authenticated by an API key (x-api-key) instead of a session. Read only.
 */
export async function GET(request: Request) {
  return withDatabase("Unable to load employees", async db => {
    await enforceRateLimit(db, request, "external-api-ip", 600, 60);
    const client = await authenticateClient(db, request);
    await enforceRateLimit(db, request, "external-api", 120, 60, client.id);
    const params = new URL(request.url).searchParams;
    const query = pageQuery(params);
    const { rows, total } = await readEmployees(db, {
      ...query,
      statuses: statusParam(params),
      departmentId: idParam(params, "department_id"),
      companyId: idParam(params, "company_id"),
      updatedSince: sinceParam(params),
    });
    return Response.json(page(rows.map(formatEmployee), query, total), { headers: { "cache-control": "no-store" } });
  });
}
