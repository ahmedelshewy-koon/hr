import assert from "node:assert/strict";
import test from "node:test";
import { localizeApiMessage } from "../app/api-messages.ts";
import {
  canRenewEnrollment,
  parseCourseInput,
  parseDurationHours,
  parseInstructor,
  parseMaterialTitle,
  parseMaterialUrl,
  summarizeEnrollments,
} from "../app/talent/learning-rules.ts";

// The rules throw `Response` objects (the API turns them into JSON errors), so read status and text back.
const failure = async (run) => {
  try {
    run();
  } catch (thrown) {
    assert.ok(thrown instanceof Response, `expected a Response, got ${thrown}`);
    return { status: thrown.status, message: await thrown.text() };
  }
  assert.fail("expected the call to be rejected");
};

const valid = { courseType: "online", startDate: "2026-10-01", endDate: "2026-10-05", durationHours: "12", instructorEmployeeId: 7 };

test("a program needs its dates, its duration in hours and who delivers it", async () => {
  assert.deepEqual(parseCourseInput(valid), {
    courseType: "online", startDate: "2026-10-01", endDate: "2026-10-05", validityMonths: null,
    durationHours: 12, instructorEmployeeId: 7, instructorName: null,
  });
  assert.equal((await failure(() => parseCourseInput({ ...valid, startDate: "" }))).message, "Start date is required");
  assert.equal((await failure(() => parseCourseInput({ ...valid, endDate: "" }))).message, "End date is required");
  assert.equal((await failure(() => parseCourseInput({ ...valid, endDate: "2026-09-30" }))).message, "End date cannot be before start date");
  assert.equal((await failure(() => parseCourseInput({ ...valid, durationHours: "" }))).message, "Program duration is required");
  assert.equal((await failure(() => parseCourseInput({ ...valid, instructorEmployeeId: 0 }))).message, "Instructor is required");
  assert.equal(parseCourseInput({ ...valid, endDate: "2026-10-01" }).endDate, "2026-10-01", "a one-day program is valid");
});

test("duration accepts fractions of an hour and rejects nonsense", async () => {
  assert.equal(parseDurationHours("1.5"), 1.5);
  assert.equal(parseDurationHours(1000), 1000);
  assert.equal(parseDurationHours("2.456"), 2.46, "kept to two decimals");
  for (const bad of [0, "-3", "abc", 1000.01, "0.001"]) {
    const { status, message } = await failure(() => parseDurationHours(bad));
    assert.equal(status, 400, String(bad));
    assert.match(message, /^Program duration must be more than 0 and at most 1000 hours$/, String(bad));
  }
});

test("the instructor is either a company employee or an external name, never both or neither", async () => {
  assert.deepEqual(parseInstructor({ instructorEmployeeId: "9" }), { instructorEmployeeId: 9, instructorName: null });
  assert.deepEqual(parseInstructor({ instructorName: "  Dr. Salma  " }), { instructorEmployeeId: null, instructorName: "Dr. Salma" });
  assert.equal((await failure(() => parseInstructor({ instructorEmployeeId: 9, instructorName: "Dr. Salma" }))).message, "Choose an internal instructor or enter an external name, not both");
  for (const input of [{}, { instructorEmployeeId: -4 }, { instructorEmployeeId: 1.5 }, { instructorName: "   " }]) {
    assert.equal((await failure(() => parseInstructor(input))).message, "Instructor is required", JSON.stringify(input));
  }
  assert.equal(parseInstructor({ instructorName: "x".repeat(500) }).instructorName.length, 200);
});

test("a material link must be a plain web address", async () => {
  assert.equal(parseMaterialUrl(" https://drive.google.com/file/d/abc/view "), "https://drive.google.com/file/d/abc/view");
  assert.equal(parseMaterialUrl("http://intranet.local/docs"), "http://intranet.local/docs");
  assert.equal((await failure(() => parseMaterialUrl(""))).message, "Material link is required");
  for (const bad of ["javascript:alert(1)", "data:text/html,<b>x</b>", "file:///c:/secret.pdf", "ftp://host/x", "not a url", "https://user:pass@host/x", `https://host/${"a".repeat(2100)}`]) {
    assert.equal((await failure(() => parseMaterialUrl(bad))).message, "Material link must be a valid http or https address", bad.slice(0, 40));
  }
  assert.equal(parseMaterialTitle("  Slides  "), "Slides");
  assert.equal((await failure(() => parseMaterialTitle("  "))).message, "Material title is required");
});

// The API translation test only scans `new Response("...")` literals, so the messages the rules build are checked here:
// any of them missing from the dictionary would reach the Arabic interface as the generic fallback.
test("every message the learning rules can raise has its own Arabic translation", async () => {
  const bad = [
    () => parseCourseInput({ ...valid, courseType: "x" }),
    () => parseCourseInput({ ...valid, startDate: "2026-02-30" }),
    () => parseCourseInput({ ...valid, endDate: "nope" }),
    () => parseCourseInput({ ...valid, startDate: "" }),
    () => parseCourseInput({ ...valid, endDate: "" }),
    () => parseCourseInput({ ...valid, endDate: "2026-09-01" }),
    () => parseCourseInput({ ...valid, validityMonths: 1.5 }),
    () => parseCourseInput({ ...valid, durationHours: "" }),
    () => parseCourseInput({ ...valid, durationHours: 5000 }),
    () => parseCourseInput({ ...valid, instructorEmployeeId: 0 }),
    () => parseCourseInput({ ...valid, instructorName: "Someone" }),
    () => parseMaterialTitle(""),
    () => parseMaterialUrl(""),
    () => parseMaterialUrl("javascript:1"),
  ];
  for (const run of bad) {
    const { message } = await failure(run);
    const arabic = localizeApiMessage(message, true);
    assert.match(arabic, /[\u0600-\u06FF]/, `${message} has no Arabic text`);
    assert.doesNotMatch(arabic, /^تعذر تنفيذ الإجراء/, `${message} only gets the generic fallback`);
    assert.doesNotMatch(arabic.replace(/https?/g, ""), /[A-Za-z]{4}/, `${message} still shows English words: ${arabic}`);
  }
  for (const message of ["Invalid due date", "Invalid completion date", "Invalid certificate expiry", "Score must be between 0 and 100"]) {
    assert.doesNotMatch(localizeApiMessage(message, true), /^تعذر تنفيذ الإجراء|[A-Za-z]{4}/, message);
  }
});

test("enrollment summary and renewal rules are unchanged by the new fields", () => {
  const today = "2026-09-19";
  const rows = [
    { status: "assigned", employee_id: 1, due_date: "2026-09-10", mandatory: 1 },
    { status: "completed", employee_id: 2, certificate_expiry: "2026-10-01" },
    { status: "cancelled", employee_id: 3, due_date: "2026-01-01", mandatory: 1 },
  ];
  assert.deepEqual(summarizeEnrollments(rows, today), {
    open: 1, inProgress: 0, completed: 1, learnersInTraining: 1, overdue: 1, mandatoryPending: 1, expiring: 1, expired: 0, completionRate: 50,
  });
  assert.equal(canRenewEnrollment({ status: "completed", certificate_expiry: "2026-09-01" }, today), true);
  assert.equal(canRenewEnrollment({ status: "completed", certificate_expiry: today }, today), false);
});
