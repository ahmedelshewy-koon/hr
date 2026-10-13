import assert from "node:assert/strict";
import test from "node:test";
import { localToInstant, parseIngestRecords } from "../app/attendance/biometric-ingest.ts";

test("device wall-clock time resolves to the right instant in Cairo, including the DST switch", () => {
  assert.equal(localToInstant("2026-01-15", "09:00:00", "Africa/Cairo"), "2026-01-15T07:00:00.000Z");
  assert.equal(localToInstant("2026-07-15", "09:00:00", "Africa/Cairo"), "2026-07-15T06:00:00.000Z");
  assert.equal(localToInstant("2026-10-13", "12:34:11", "Africa/Cairo"), "2026-10-13T09:34:11.000Z");
  assert.equal(localToInstant("2026-10-13", "12:34:11", "Asia/Riyadh"), "2026-10-13T09:34:11.000Z");
});

test("records are validated, normalised and de-duplicated, with the unknown record type ignored", () => {
  const { punches, rejected } = parseIngestRecords([
    { employee_code: "22", date: "2026-10-13", time: "12:34:11", record_type: "unknown" },
    { employee_code: " 22 ", date: "2026-10-13", time: "12:34:11" },
    { employee_code: "8", date: "2026-10-13", time: "9:05" },
    { employee_code: "", date: "2026-10-13", time: "09:00:00" },
    { employee_code: "9", date: "13/10/2026", time: "09:00:00" },
    { employee_code: "9", date: "2026-10-13", time: "25:00:00" },
    null,
  ], "Africa/Cairo");
  assert.deepEqual(punches, [{ code: "22", at: "2026-10-13T09:34:11.000Z" }, { code: "8", at: "2026-10-13T06:05:00.000Z" }]);
  assert.deepEqual(rejected.map(item => item.index), [3, 4, 5, 6]);
});

test("an empty batch is valid, so the connection test passes", () => {
  assert.deepEqual(parseIngestRecords([], "Africa/Cairo"), { punches: [], rejected: [] });
});
