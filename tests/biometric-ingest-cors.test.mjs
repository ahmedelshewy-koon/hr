import assert from "node:assert/strict";
import test from "node:test";
import { corsPreflightResponse, withIngestCors } from "../app/attendance/biometric-cors.ts";

test("biometric ingest permits a cross-origin API-key POST preflight", () => {
  const response = corsPreflightResponse();
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-methods"), "POST");
  assert.match(response.headers.get("access-control-allow-headers") || "", /x-api-key/i);
  assert.match(response.headers.get("access-control-allow-headers") || "", /content-type/i);
  assert.match(response.headers.get("access-control-allow-headers") || "", /authorization/i);
});

test("biometric ingest exposes API errors to a cross-origin sender", async () => {
  const response = withIngestCors(new Response(JSON.stringify({ message: "Invalid API key" }), { status: 401, headers: { "content-type": "application/json" } }));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal((await response.json()).message, "Invalid API key");
});
