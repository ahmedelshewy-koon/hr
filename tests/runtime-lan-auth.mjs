import assert from "node:assert/strict";

const base = process.env.LAN_TEST_URL;
if (!base) throw new Error("Set LAN_TEST_URL to the local server's LAN URL");
const state = await fetch(`${base}/api/auth`);
assert.equal(state.status, 200, "LAN visitors must reach portal authentication");
assert.equal((await state.json()).authenticated, false);
const rejected = await fetch(`${base}/api/auth`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: "http://untrusted.example" },
  body: "{}",
});
assert.equal(rejected.status, 403, "Cross-origin writes must remain blocked");
const protectedData = await fetch(`${base}/api/hr`);
assert.equal(protectedData.status, 401, "LAN access must not bypass portal login");
console.log("LAN authentication and access protections passed");
