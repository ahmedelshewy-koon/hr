import { withDatabase } from "../route-helpers";
import { enforceRateLimit } from "../api-security";
import { authenticateAgent, handleAgentRequest } from "../../attendance/biometric-agents";

// A full device download is a few MB of JSON; this leaves ample headroom without accepting unbounded bodies.
const MAX_BODY_BYTES = 64 * 1024 * 1024;

/** Called by the office connector (scripts/biometric-agent), authenticated by its bearer token rather than a session. */
export async function POST(request: Request) {
  return withDatabase("Biometric connector request failed", async db => {
    await enforceRateLimit(db, request, "biometric-agent-ip", 3000, 3600);
    const agent = await authenticateAgent(db, request);
    await enforceRateLimit(db, request, "biometric-agent", 1500, 3600, agent.id);
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) throw new Response("Request is too large", { status: 413 });
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) throw new Response("Request is too large", { status: 413 });
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(body); } catch { throw new Response("Invalid JSON", { status: 400 }); }
    return Response.json(await handleAgentRequest(db, agent, request, payload ?? {}), { headers: { "cache-control": "no-store" } });
  });
}
