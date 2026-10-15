// This endpoint uses an API key, never a browser session cookie. Its callers may
// run on a separate origin, so browsers need both the preflight and POST response.
const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST",
  "access-control-allow-headers": "content-type, x-api-key, authorization",
};

export function corsPreflightResponse(): Response {
  return new Response(null, { status: 204, headers: { ...corsHeaders, "cache-control": "no-store" } });
}

export function withIngestCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", corsHeaders["access-control-allow-origin"]);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
