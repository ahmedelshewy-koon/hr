import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PAGE_MODULES } from "../app/page-availability.ts";
import { PAGE_IDS, PAGE_LABELS, resolveNotificationDestination } from "../app/navigation-labels.ts";
import { localizeApiMessage } from "../app/api-messages.ts";

const employeePages = ["dashboard", "portal", "lifecycle", "learning"];

test("every registered page has exactly one approved Arabic and English name", () => {
  assert.deepEqual([...PAGE_IDS].sort(), Object.keys(PAGE_MODULES).sort());
  for (const page of PAGE_IDS) {
    assert.match(PAGE_LABELS[page].ar, /[؀-ۿ]/, `${page} needs an Arabic name`);
    assert.ok(PAGE_LABELS[page].en.trim(), `${page} needs an English name`);
  }
  const arabic = PAGE_IDS.map(page => PAGE_LABELS[page].ar);
  assert.equal(new Set(arabic).size, arabic.length, "two pages share the same Arabic name");
});

test("notification links resolve only to pages the user can open", () => {
  assert.deepEqual(resolveNotificationDestination("employees?employee=7", PAGE_IDS), { page: "employees", employeeId: 7 });
  assert.deepEqual(resolveNotificationDestination("approvals", PAGE_IDS), { page: "approvals" });
  assert.deepEqual(resolveNotificationDestination("/learning", employeePages), { page: "learning" });
  // An employee cannot open the management pages, so they get their own portal instead of an unrelated first menu item.
  assert.deepEqual(resolveNotificationDestination("employees?employee=7", employeePages), { page: "portal" });
  assert.deepEqual(resolveNotificationDestination("assets", employeePages), { page: "portal" });
  // No accessible alternative: report "nothing to open" rather than redirecting somewhere unrelated.
  assert.equal(resolveNotificationDestination("approvals", employeePages), null);
  assert.equal(resolveNotificationDestination("recruitment", employeePages), null);
  assert.equal(resolveNotificationDestination("payroll", []), null);
  // Malformed or unknown targets never invent a record id or a page.
  assert.deepEqual(resolveNotificationDestination("employees?employee=abc", PAGE_IDS), { page: "employees" });
  assert.deepEqual(resolveNotificationDestination("employees?employee=-3", PAGE_IDS), { page: "employees" });
  assert.deepEqual(resolveNotificationDestination("bogus", employeePages), { page: "dashboard" });
  assert.deepEqual(resolveNotificationDestination(null, employeePages), { page: "dashboard" });
});

test("API errors reach the Arabic interface in Arabic and stay untouched in English", () => {
  assert.equal(localizeApiMessage("Employee not found", true), "لم يتم العثور على الموظف");
  assert.equal(localizeApiMessage("Employee not found", false), "Employee not found");
  assert.equal(localizeApiMessage("Request failed (503)", true), "تعذر تنفيذ الطلب (503)");
  assert.equal(localizeApiMessage("Rejection reason is required", true), "سبب الرفض مطلوب");
  assert.equal(localizeApiMessage("Work email is required", true), "حقل «البريد الوظيفي» مطلوب");
  // Messages the server already writes in Arabic pass through, and unknown English never leaks.
  assert.equal(localizeApiMessage("كلمة المرور الحالية غير صحيحة", true), "كلمة المرور الحالية غير صحيحة");
  assert.doesNotMatch(localizeApiMessage("Some brand new backend failure", true), /[A-Za-z]/);
});

test("every API message the server can raise has an Arabic translation", async () => {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (/\.ts$/.test(entry.name)) files.push(path);
    }
  }
  await walk(fileURLToPath(new URL("../app", import.meta.url)));
  const messages = new Set();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/new Response\("([A-Z][^"$`]{5,140})"/g)) messages.add(match[1]);
  }
  assert.ok(messages.size > 100, "expected to find the server's validation messages");
  const untranslated = [...messages].filter(message => /^(Unable to|Request failed)/.test(localizeApiMessage(message, true)) || /[A-Za-z]{4}/.test(localizeApiMessage(message, true)));
  const generic = [...messages].filter(message => localizeApiMessage(message, true).startsWith("تعذر تنفيذ الإجراء"));
  assert.deepEqual(untranslated, [], "these messages would show English in the Arabic UI");
  assert.deepEqual(generic, [], "these messages only get the generic Arabic fallback; add a specific translation");
});

test("every notification title the server emits has an Arabic title in the bell", async () => {
  const [app, service, learning, lifecycle, assets, recruitment] = await Promise.all([
    "hr-app.tsx", "notifications/notification-service.ts", "api/learning/route.ts", "api/lifecycle/route.ts",
    "api/assets/route.ts", "recruitment/recruitment-api.ts",
  ].map(file => readFile(new URL(`../app/${file}`, import.meta.url), "utf8")));
  const titles = /const NOTIFICATION_TITLES[\s\S]*?\n\};/.exec(app)?.[0] ?? "";
  const known = new Set([...titles.matchAll(/^\s+([a-z_]+):\[/gm)].map(match => match[1]));
  const emitted = new Set();
  for (const source of [service, learning, lifecycle, assets, recruitment]) {
    for (const match of source.matchAll(/title:\s*"([a-z_]+)"/g)) emitted.add(match[1]);
  }
  // Operational alerts are inserted by SQL in the notification service: SELECT user,'type','title_key',...
  for (const match of service.matchAll(/SELECT [a-z_.]+,'[a-z_]+','([a-z_]+)'/g)) emitted.add(match[1]);
  // `CASE WHEN w.source_type=… THEN 'request' ELSE 'attendance_correction'` picks an entity_type, not a title.
  for (const match of service.matchAll(/CASE WHEN (?!w.source_type)[^']*?THEN '([a-z_]+)' ELSE '([a-z_]+)'/g)) { emitted.add(match[1]); emitted.add(match[2]); }
  emitted.add("onboarding_started").add("offboarding_started"); // built from a template literal (`${type}_started`)
  emitted.add("training_completed").add("training_updated");     // chosen by a ternary
  assert.ok(emitted.size >= 20, `expected to discover the emitted titles, found ${emitted.size}`);
  assert.deepEqual([...emitted].filter(title => !known.has(title)).sort(), []);
  for (const title of known) assert.match(new RegExp(`${title}:\\[[^\\]]*[\\u0600-\\u06FF]`).exec(titles)?.[0] ?? "", /[؀-ۿ]/);
});

test("Arabic wording keeps one term per concept (no legacy variants)", async () => {
  const banned = [
    [/كورس/, "use «برنامج تدريبي»"],
    [/الدور الوظيفي/, "«دور المستخدم» is the access role; «المسمى الوظيفي» is the job title"],
    [/مركز الاعتمادات|اعتماد الطلبات/, "the page is called «الاعتمادات»"],
    [/الموافقات|تتطلب موافقة/, "use the «اعتماد» family"],
    [/بدء العمل(?!ية)|بداية العمل|انتهاء العمل/, "use «تاريخ المباشرة» / «تاريخ انتهاء العقد»"],
    [/(?:^|[^ل])الانفصال|نوع الانفصال/, "use «إنهاء الخدمة»"],
    [/عن بعد/, "write «عن بُعد»"],
    [/اً/, "put the tanween before the alif (مؤقتًا)"],
    [/لوحة المعلومات|الداشبورد/, "the dashboard is «لوحة التحكم»"],
    [/معلق/, "use «قيد الانتظار» (or «غير مكتمل» for unfinished obligations)"],
  ];
  const offenders = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { if (entry.name !== "_sites-preview") await walk(path); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const source = await readFile(path, "utf8");
      for (const [pattern, hint] of banned) if (pattern.test(source)) offenders.push(`${path.split("/app/")[1]}: ${pattern} → ${hint}`);
    }
  }
  await walk(fileURLToPath(new URL("../app", import.meta.url)));
  assert.deepEqual(offenders, []);
});
