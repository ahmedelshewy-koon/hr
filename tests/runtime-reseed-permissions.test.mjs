// The runtime reseed (ensureSeed, run on the first API request whenever system_settings.seed_version differs from the
// release's SEED_VERSION) must never overwrite an existing permission row: customized grants and denials survive.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SEED_PERMISSION_SQL, seedPermissionRows } from "../app/api/hr/role-permission-seed.ts";

const route = readFileSync("app/api/hr/route.ts", "utf8").replace(/\r\n/g, "\n");
const seed = route.slice(route.indexOf("async function ensureSeed("), route.indexOf("async function ensureDemoData("));

test("the reseed's permission statement is insert-only", () => {
  assert.equal(SEED_PERMISSION_SQL, "INSERT INTO permissions (role_id,module,action,allowed) VALUES (?,?,?,?) ON CONFLICT(role_id,module,action) DO NOTHING");
});

test("ensureSeed never updates an existing permission", () => {
  assert.ok(seed.length > 1000, "ensureSeed located");
  // The only upsert left in the reseed is the seed marker itself.
  assert.deepEqual([...seed.matchAll(/"([^"]*DO UPDATE[^"]*)"/gi)].map(m => /'seed_version'/.test(m[1])), [true]);
  assert.doesNotMatch(seed, /UPDATE permissions/i);
  for (const m of seed.matchAll(/"([^"]*INTO permissions[^"]*)"/g)) assert.match(m[1], /INSERT OR IGNORE|DO NOTHING/, m[1]);
  assert.match(seed, /seedPermissionRows\(role\.id,moduleDefaults,ACTIONS\)\) await d1\.prepare\(SEED_PERMISSION_SQL\)/);
  // The only permission DELETE removes the rows of the retired legacy roles.
  assert.deepEqual([...seed.matchAll(/DELETE FROM permissions[^"]*/g)].map(m => m[0]),
    ["DELETE FROM permissions WHERE role_id IN (SELECT id FROM roles WHERE name IN ('Admin','HR','Direct Manager'))"]);
});

test("seedPermissionRows: 1 for the default actions, an explicit 0 for the rest", () => {
  assert.deepEqual(seedPermissionRows(7, { payroll: [], staffing_blueprint: ["view"] }, ["view", "edit"]),
    [[7, "payroll", "view", 0], [7, "payroll", "edit", 0], [7, "staffing_blueprint", "view", 1], [7, "staffing_blueprint", "edit", 0]]);
});

test("the Permissions screen can still change permissions on purpose (administrator action, not the reseed)", () => {
  assert.match(route, /for\(const p of values\) await d1\.prepare\("INSERT INTO permissions \(role_id,module,action,allowed\) VALUES \(\?,\?,\?,\?\) ON CONFLICT\(role_id,module,action\) DO UPDATE/);
});
