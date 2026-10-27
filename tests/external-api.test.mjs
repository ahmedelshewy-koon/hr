import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createClient, idParam, matchClient, pageQuery, parseClients, publicClient, sinceParam, statusParam } from "../app/external-api/access.ts";
import { formatDepartment, formatEmployee, page } from "../app/external-api/format.ts";

const request = headers => new Request("http://localhost/api/external/employees", { headers });

test("a created key authenticates as x-api-key or a Bearer token; other keys are refused", async () => {
  const { key, client } = await createClient([], " CRM ", 1);
  assert.equal(client.name, "CRM");
  assert.match(key, /^hrx_[\w-]{43}$/);
  assert.equal(client.hint, key.slice(-4));
  assert.ok(!JSON.stringify(publicClient(client)).includes(client.hash), "the list never exposes the hash");
  assert.equal((await matchClient(request({ "x-api-key": key }), [client])).id, client.id);
  assert.equal((await matchClient(request({ authorization: `Bearer ${key}` }), [client])).id, client.id);
  for (const headers of [{}, { "x-api-key": "hrx_wrong" }, { "x-api-key": "plain-key" }]) {
    await assert.rejects(matchClient(request(headers), [client]), response => response.status === 401);
  }
  await assert.rejects(matchClient(request({ "x-api-key": key }), []), response => response.status === 401);
});

test("key names are required and unique, ignoring case", async () => {
  const { client } = await createClient([], "CRM", 1);
  await assert.rejects(createClient([client], "crm", 1), response => response.status === 409);
  await assert.rejects(createClient([], "  ", 1), response => response.status === 400);
});

test("a malformed stored setting yields no clients", () => {
  assert.deepEqual(parseClients("not json"), []);
  assert.deepEqual(parseClients('{"clients":[{"id":"1","name":"x","hash":"short"}]}'), []);
});

test("paging is clamped and filters are validated", () => {
  const params = value => new URLSearchParams(value);
  assert.deepEqual(pageQuery(params("page=0&page_size=9999")), { page: 1, pageSize: 500, offset: 0 });
  assert.deepEqual(pageQuery(params("page=3&page_size=50")), { page: 3, pageSize: 50, offset: 100 });
  assert.equal(idParam(params("department_id=7"), "department_id"), 7);
  assert.throws(() => idParam(params("department_id=x"), "department_id"), response => response.status === 400);
  assert.deepEqual(statusParam(params("status=active,probation,active")), ["active", "probation"]);
  assert.throws(() => statusParam(params("status=deleted")), response => response.status === 400);
  assert.equal(sinceParam(params("updated_since=2026-10-01")), "2026-10-01T00:00:00.000Z");
  assert.throws(() => sinceParam(params("updated_since=yesterday")), response => response.status === 400);
});

test("employees carry work information only, never salary, identity, bank or personal details", () => {
  const employee = formatEmployee({
    id: 5, employee_code: "E5", name_en: "Sara", name_ar: "سارة", employment_status: "active", department_id: 2,
    department_name_en: "IT", department_name_ar: "تقنية", manager_id: 3, manager_code: "E3", manager_name_en: "Ali",
    company_id: null, salary: 9000, identification_number: "123", bank_iban: "SA00", personal_phone: "050", updated_at: "2026-10-01 10:00:00+03",
  });
  assert.equal(employee.company, null);
  assert.deepEqual(employee.manager, { id: 3, employee_code: "E3", name_en: "Ali", name_ar: null });
  assert.equal(employee.updated_at, "2026-10-01T07:00:00.000Z");
  const text = JSON.stringify(employee);
  for (const secret of ["9000", "SA00", "\"123\"", "050"]) assert.ok(!text.includes(secret), secret);
});

test("departments and pages have a stable shape", () => {
  const department = formatDepartment({ id: 1, name_en: "IT", name_ar: "تقنية", unit_type: "department", parent_id: null, active_employees: "4" });
  assert.equal(department.active_employees, 4);
  assert.equal(department.manager, null);
  assert.deepEqual(page([1, 2], { page: 1, pageSize: 2 }, 3), { data: [1, 2], page: 1, page_size: 2, total: 3, has_more: true });
});

test("the queries never select salary, identity, bank or personal columns", () => {
  const source = readFileSync(new URL("../app/external-api/queries.ts", import.meta.url), "utf8");
  for (const column of ["salary", "identification_number", "passport_number", "bank_", "personal_phone", "birth_date", "address"]) {
    assert.ok(!source.includes(`e.${column}`), column);
  }
});
