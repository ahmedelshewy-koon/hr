import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the HR application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>[^<]*HR/i);
  assert.match(html, /class="brand-logo"/);
  assert.match(html, /Dashboard/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
});

test("keeps starter preview assets out of the production app", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<HRApp/);
  assert.match(layout, /HR/);
  assert.match(packageJson, /"postgres"/);
  assert.doesNotMatch(page, /codex-preview|SkeletonPreview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  const previewFiles = await readdir(new URL("../app/_sites-preview", import.meta.url));
  assert.deepEqual(previewFiles, []);
});

test("renders workforce departments, job titles, and organization chart from API data", async () => {
  const app = await readFile(new URL("../app/hr-app.tsx", import.meta.url), "utf8");
  assert.match(app, /<JobTitleTable[^>]*rows=\{data\?\.jobTitles\}/);
  assert.match(app, /<DepartmentGrid[^>]*rows=\{data\?\.departments\}/);
  assert.match(app, /Managing Director\|العضو المنتدب/);
  assert.match(app, /org-department-list/);
  assert.doesNotMatch(app, /Layla Alotaibi|Youssef Nassar|Commercial Director/);
});
