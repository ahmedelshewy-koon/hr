// Runs the real blueprint service against PostgreSQL: node tests/runtime-staffing-blueprint.mjs <DATABASE_URL>
// It WRITES (templates, blueprints, two scratch companies with departments and job titles), so it refuses any database whose
// name does not contain "check", "rehearsal", "clone" or "test". Never point it at the live database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const url = process.argv[2] || process.env.DATABASE_URL;
if (!url || !/\/[^/]*(check|rehearsal|clone|test)[^/]*$/i.test(url)) { console.error('Refusing to run: pass the URL of a disposable clone database (name containing check/rehearsal/clone/test).'); process.exit(2); }
process.env.DATABASE_URL = url;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = path.join(root, 'tmp'); fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, 'cloudflare-workers-stub.mjs'), 'export const env = {};\n');
const outfile = path.join(tmp, 'blueprint-runtime.bundle.mjs');
await build({ stdin: { contents: "export * from '../app/blueprint/service.ts'; export * from '../app/blueprint/policy.ts'; export { createDatabase } from '../db/postgres.ts';", resolveDir: tmp, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile, packages: 'external', alias: { 'cloudflare:workers': path.join(tmp, 'cloudflare-workers-stub.mjs') }, logLevel: 'error' });
const lib = await import(pathToFileURL(outfile).href);
const { createDatabase, ensureDefaults, readOverview, readBlueprint, generateCompanyBlueprint, savePosition, saveDepartment, removeDepartmentFromBlueprint, removePositionFromBlueprint, setCompanyBlueprintStatus, previewApplyBlueprint, applyBlueprint,
  createTemplate, setTemplateStatus, duplicateBlueprint, saveCompanyType, updateCompanyBlueprint, BlueprintError } = lib;

const db = createDatabase();
let passed = 0;
const check = async (title, fn) => { await fn(); passed++; console.log(`  ok  ${title}`); };
const rejects = async (promise, code) => { try { await promise; } catch (error) { assert.ok(error instanceof BlueprintError, `expected BlueprintError, got ${error}`); if (code) assert.equal(error.issue.code, code, error.message); return error; } assert.fail(`expected ${code} to be thrown`); };
const tag = `bpcheck${Date.now()}`;
const createdCompanies = [];

try {
  const admin = await db.prepare("SELECT u.id,u.email,u.role_id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Super Admin' AND u.status='active' ORDER BY u.id LIMIT 1").first();
  const actor = { id: Number(admin.id), roleId: Number(admin.role_id), roleName: 'Super Admin', employeeId: null, email: String(admin.email), hrDataScope: 'all' };
  const tx = fn => db.transaction(fn);
  const company = async (label) => { const row = await db.prepare("INSERT INTO companies (name,name_en,name_ar,status) VALUES (?,?,?,'active') RETURNING id").bind(`${tag} ${label}`, `${tag} ${label}`, `${tag} ${label}`).first(); createdCompanies.push(Number(row.id)); return Number(row.id); };
  const employeesBefore = await db.prepare("SELECT count(*)::int AS n, COALESCE(max(updated_at)::text,'') AS last FROM employees").first();
  const T = {};
  const typeId = async code => Number((await db.prepare('SELECT id FROM blueprint_company_types WHERE code=?').bind(code).first()).id);

  await check('first use seeds 12 company types and 48 editable templates, once', async () => {
    const seededNow = await ensureDefaults(db);
    assert.ok(seededNow || Number((await db.prepare('SELECT count(*)::int AS n FROM blueprint_company_types').first()).n) >= 12, 'defaults exist (seeded now or by an earlier run)');
    assert.equal(await ensureDefaults(db), false, 'idempotent');
    const overview = await readOverview(db);
    T.software = await typeId('software'); T.retail = await typeId('retail');
    assert.ok(overview.types.length >= 12);
    assert.ok(overview.templates.length >= 48);
    assert.ok(overview.templates.every(t => t.kind === 'template' && t.status === 'active' && t.isDefault && t.positionCount > 0));
    const sizes = overview.templates.filter(t => t.companyTypeId === overview.types.find(x => x.code === 'software').id).sort((a, b) => a.headcount - b.headcount).map(t => t.size);
    assert.deepEqual(sizes, ['micro', 'small', 'medium', 'large']);
  });

  let blueprintId, companyA;
  await check('generating by type and size copies the template into a draft company blueprint (templates stay untouched)', async () => {
    companyA = await company('A (new, empty)');
    const template = await db.prepare("SELECT id FROM staffing_blueprints WHERE kind='template' AND company_type_id=? AND size='small'").bind(T.software).first();
    const before = await readBlueprint(db, Number(template.id));
    const softwareType = T.software;
    blueprintId = await tx(t => generateCompanyBlueprint(t, actor, { companyTypeId: softwareType, size: 'small', companyId: companyA, expectedEmployees: 30, branches: 2, country: 'Egypt', businessModel: 'SaaS' }));
    const result = await readBlueprint(db, blueprintId);
    assert.deepEqual([result.blueprint.kind, result.blueprint.status, result.blueprint.companyId, result.blueprint.size, result.blueprint.expectedEmployees, result.blueprint.branchesCount], ['company', 'draft', companyA, 'small', 30, 2]);
    assert.equal(result.blueprint.sourceBlueprintId, Number(template.id));
    assert.ok(result.tree.positions.length > 5 && result.tree.departments.length > 3);
    const after = await readBlueprint(db, Number(template.id));
    assert.deepEqual(after.tree.positions.map(p => [p.title.en, p.headcount]), before.tree.positions.map(p => [p.title.en, p.headcount]), 'the template is unchanged');
    assert.ok(Math.abs(result.tree.positions.reduce((s, p) => s + p.headcount, 0) - 30) <= 8, 'expected employee count scaled the headcounts');
  });

  await check('a different size and type give a different structure', async () => {
    const r1 = await tx(async t => generateCompanyBlueprint(t, actor, { companyTypeId: T.retail, size: 'micro' }));
    const r2 = await tx(async t => generateCompanyBlueprint(t, actor, { companyTypeId: T.software, size: 'large' }));
    const a = await readBlueprint(db, r1), b = await readBlueprint(db, r2);
    assert.ok(a.tree.positions.length < b.tree.positions.length);
    assert.ok(a.tree.positions.some(p => p.title.en === 'Store Manager') && !b.tree.positions.some(p => p.title.en === 'Store Manager'));
    assert.ok(b.tree.departments.some(d => d.kind === 'team'));
    await rejects(tx(t => generateCompanyBlueprint(t, actor, { companyTypeId: 999999, size: 'small' })), 'TYPE_INVALID');
  });

  await check('editing: headcount, positions, departments, reporting lines, required/optional', async () => {
    const { tree } = await readBlueprint(db, blueprintId);
    const target = tree.positions.find(p => p.title.en === 'Backend Developer');
    await tx(t => savePosition(t, actor, blueprintId, target.id, { departmentId: target.departmentId, titleEn: target.title.en, titleAr: target.title.ar, headcount: 7, seniority: 'mid', required: false, parentPositionId: target.parentPositionId }, false));
    let now = (await readBlueprint(db, blueprintId)).tree.positions.find(p => p.id === target.id);
    assert.deepEqual([now.headcount, now.required], [7, false]);
    await rejects(tx(t => savePosition(t, actor, blueprintId, target.id, { departmentId: target.departmentId, titleEn: 'x', headcount: -1 }, false)), 'HEADCOUNT_INVALID');
    const dept = await tx(t => saveDepartment(t, actor, blueprintId, null, { nameEn: 'Legal', nameAr: 'الشؤون القانونية', kind: 'department', required: false }, false));
    const counsel = await tx(t => savePosition(t, actor, blueprintId, null, { departmentId: dept, titleEn: 'Legal Counsel', titleAr: 'مستشار قانوني', headcount: 1, seniority: 'senior' }, false));
    const junior = await tx(t => savePosition(t, actor, blueprintId, null, { departmentId: dept, titleEn: 'Paralegal', titleAr: 'مساعد قانوني', headcount: 2, seniority: 'junior', parentPositionId: counsel }, false));
    await rejects(tx(t => savePosition(t, actor, blueprintId, counsel, { departmentId: dept, titleEn: 'Legal Counsel', headcount: 1, parentPositionId: junior }, false)), 'PARENT_CYCLE');
    await rejects(tx(t => savePosition(t, actor, blueprintId, counsel, { departmentId: dept, titleEn: 'Legal Counsel', headcount: 1, parentPositionId: counsel }, false)), 'PARENT_INVALID');
    await tx(t => removePositionFromBlueprint(t, actor, blueprintId, counsel, false));
    now = (await readBlueprint(db, blueprintId)).tree.positions.find(p => p.id === junior);
    assert.equal(now.parentPositionId, null, 'removing a position releases the ones that reported to it');
    const section = await tx(t => saveDepartment(t, actor, blueprintId, null, { nameEn: 'Contracts', kind: 'team', parentId: dept }, false));
    await tx(t => removeDepartmentFromBlueprint(t, actor, blueprintId, dept, false));
    const after = (await readBlueprint(db, blueprintId)).tree;
    assert.ok(!after.departments.some(d => d.id === dept || d.id === section), 'the unit and its sub-unit are gone');
    assert.ok(!after.positions.some(p => p.id === junior), 'and so are the positions inside');
    await rejects(tx(t => saveDepartment(t, actor, blueprintId, null, { nameEn: 'X', kind: 'team', parentId: after.departments.find(d => d.kind === 'team')?.id ?? 999999 }, false)), 'PARENT_INVALID');
  });

  await check('approval freezes the blueprint; reopening makes it editable again', async () => {
    await tx(t => setCompanyBlueprintStatus(t, actor, blueprintId, 'approve'));
    const { tree } = await readBlueprint(db, blueprintId);
    await rejects(tx(t => savePosition(t, actor, blueprintId, tree.positions[0].id, { departmentId: tree.positions[0].departmentId, titleEn: 'x', headcount: 1 }, false)), 'BLUEPRINT_APPROVED');
    await tx(t => setCompanyBlueprintStatus(t, actor, blueprintId, 'reopen'));
    await tx(t => savePosition(t, actor, blueprintId, tree.positions[0].id, { departmentId: tree.positions[0].departmentId, titleEn: tree.positions[0].title.en, titleAr: tree.positions[0].title.ar, headcount: tree.positions[0].headcount }, false));
    await rejects(tx(t => setCompanyBlueprintStatus(t, actor, blueprintId, 'reopen')), 'NOT_APPROVED');
    await tx(t => setCompanyBlueprintStatus(t, actor, blueprintId, 'approve'));
  });

  await check('apply needs an approved blueprint with a company; a new company needs no extra confirmation', async () => {
    const loose = await tx(async t => generateCompanyBlueprint(t, actor, { companyTypeId: T.software, size: 'micro' }));
    await rejects(tx(t => applyBlueprint(t, actor, loose, false)), 'NOT_APPROVED');
    await tx(t => setCompanyBlueprintStatus(t, actor, loose, 'approve'));
    await rejects(tx(t => applyBlueprint(t, actor, loose, false)), 'COMPANY_REQUIRED');
    await rejects(previewApplyBlueprint(db, loose), 'COMPANY_REQUIRED');
    const preview = await previewApplyBlueprint(db, blueprintId);
    assert.equal(preview.plan.hasExistingStructure, false);
    assert.equal(preview.plan.counts.unitsReused, 0);
    assert.ok(preview.plan.counts.unitsToCreate > 3 && preview.plan.counts.titlesToCreate > 5);
  });

  let appliedSummary;
  await check('applying to a new company creates the departments, teams and job titles through the organization services and creates no employees', async () => {
    const tree = (await readBlueprint(db, blueprintId)).tree;
    appliedSummary = await tx(t => applyBlueprint(t, actor, blueprintId, false));
    assert.equal(appliedSummary.created.units, tree.departments.length);
    const units = (await db.prepare("SELECT id,parent_id,organization_kind,name_en,status FROM departments WHERE company_id=? ORDER BY id").bind(companyA).all()).results;
    assert.equal(units.length, tree.departments.length);
    assert.ok(units.every(u => u.status === 'active'));
    const topNames = tree.departments.filter(d => d.parentId === null).map(d => d.name.en).sort();
    assert.deepEqual(units.filter(u => u.parent_id === null).map(u => u.name_en).sort(), topNames);
    for (const team of tree.departments.filter(d => d.kind === 'team')) assert.ok(units.some(u => u.organization_kind === 'team' && u.name_en === team.name.en && u.parent_id !== null));
    const titles = (await db.prepare("SELECT j.name_en,j.department_id,d.company_id FROM job_titles j JOIN departments d ON d.id=j.department_id WHERE d.company_id=?").bind(companyA).all()).results;
    assert.equal(titles.length, appliedSummary.created.titles);
    assert.ok(titles.every(j => units.find(u => u.id === j.department_id).parent_id === null), 'job titles are bound to top-level departments');
    assert.equal((await readBlueprint(db, blueprintId)).blueprint.status, 'applied');
    assert.ok((await db.prepare("SELECT 1 AS x FROM audit_logs WHERE module='staffing_blueprint' AND action='blueprint_applied' AND record_id=?").bind(String(blueprintId)).first()));
    const employeesAfter = await db.prepare("SELECT count(*)::int AS n, COALESCE(max(updated_at)::text,'') AS last FROM employees").first();
    assert.deepEqual(employeesAfter, employeesBefore, 'no employee was created, moved or edited');
  });

  await check('an applied blueprint cannot be applied twice or edited', async () => {
    await rejects(tx(t => applyBlueprint(t, actor, blueprintId, true)), 'ALREADY_APPLIED');
    const { tree } = await readBlueprint(db, blueprintId);
    await rejects(tx(t => savePosition(t, actor, blueprintId, tree.positions[0].id, { departmentId: tree.positions[0].departmentId, titleEn: 'x', headcount: 1 }, false)), 'BLUEPRINT_APPLIED');
    await rejects(tx(t => setCompanyBlueprintStatus(t, actor, blueprintId, 'reopen')), 'NOT_APPROVED');
  });

  await check('an existing structure is detected, needs confirmation, is reused rather than duplicated, and is never modified', async () => {
    const companyB = await company('B (has structure)');
    const finance = await db.prepare("INSERT INTO departments (name_en,name_ar,company_id,organization_kind,branch_scope,status) VALUES ('finance','المالية',?,'department','all','active') RETURNING id,updated_at::text AS u").bind(companyB).first();
    const legacy = await db.prepare("INSERT INTO departments (name_en,name_ar,company_id,organization_kind,branch_scope,status) VALUES ('Legacy Unit','وحدة قديمة',?,'department','all','active') RETURNING id").bind(companyB).first();
    const title = await db.prepare("INSERT INTO job_titles (name_en,name_ar,department_id,status) VALUES ('Accountant','محاسب',?,'active') RETURNING id").bind(finance.id).first();
    const id = await tx(async t => generateCompanyBlueprint(t, actor, { companyTypeId: T.software, size: 'small', companyId: companyB }));
    await tx(t => setCompanyBlueprintStatus(t, actor, id, 'approve'));
    const preview = await previewApplyBlueprint(db, id);
    assert.equal(preview.plan.hasExistingStructure, true);
    assert.ok(preview.plan.conflicts.some(c => c.type === 'existing_structure') && preview.plan.conflicts.some(c => c.type === 'unit_exists') && preview.plan.conflicts.some(c => c.type === 'title_exists'));
    const error = await rejects(tx(t => applyBlueprint(t, actor, id, false)), 'EXISTING_STRUCTURE');
    assert.equal(error.issue.status, 409);
    assert.equal(Number((await db.prepare('SELECT count(*)::int AS n FROM departments WHERE company_id=?').bind(companyB).first()).n), 2, 'nothing was created without confirmation');
    const summary = await tx(t => applyBlueprint(t, actor, id, true));
    assert.ok(summary.reused.units >= 1 && summary.reused.titles >= 1);
    const financeRows = (await db.prepare("SELECT id FROM departments WHERE company_id=? AND lower(name_en)='finance'").bind(companyB).all()).results;
    assert.equal(financeRows.length, 1, 'Finance was reused, not duplicated');
    const accountants = (await db.prepare("SELECT id FROM job_titles WHERE department_id=? AND name_en='Accountant'").bind(finance.id).all()).results;
    assert.deepEqual(accountants.map(r => Number(r.id)), [Number(title.id)], 'the Accountant title was reused');
    const after = await db.prepare('SELECT name_en,name_ar,status,updated_at::text AS u FROM departments WHERE id=?').bind(finance.id).first();
    assert.deepEqual([after.name_en, after.name_ar, after.status, after.u], ['finance', 'المالية', 'active', finance.u], 'the existing unit was not modified');
    assert.equal((await db.prepare('SELECT status FROM departments WHERE id=?').bind(legacy.id).first()).status, 'active', 'units outside the blueprint are untouched');
  });

  await check('the library: custom types and templates can be created, duplicated, activated and archived; an edited template drives generation', async () => {
    const typeIdNew = await tx(t => saveCompanyType(t, actor, { nameEn: `${tag} Pharma`, nameAr: 'أدوية' }));
    const template = await tx(t => createTemplate(t, actor, { nameEn: `${tag} template`, nameAr: 'قالب', companyTypeId: typeIdNew, size: 'small' }));
    await rejects(tx(t => setTemplateStatus(t, actor, template, 'activate')), 'TEMPLATE_EMPTY');
    const dept = await tx(t => saveDepartment(t, actor, template, null, { nameEn: 'Lab', kind: 'department' }, true));
    await tx(t => savePosition(t, actor, template, null, { departmentId: dept, titleEn: 'Chemist', titleAr: 'كيميائي', headcount: 3, seniority: 'mid' }, true));
    const denied = await tx(t => savePosition(t, actor, template, null, { departmentId: dept, titleEn: 'X', headcount: 1 }, false)).catch(e => e);
    assert.ok(denied instanceof Response && denied.status === 403, 'only the library admin edits a template');
    await tx(t => setTemplateStatus(t, actor, template, 'activate'));
    const copy = await tx(t => duplicateBlueprint(t, actor, template));
    assert.equal((await readBlueprint(db, copy)).blueprint.status, 'draft');
    assert.equal((await readBlueprint(db, copy)).tree.positions.length, 1);
    const generated = await tx(t => generateCompanyBlueprint(t, actor, { companyTypeId: typeIdNew, size: 'small' }));
    assert.deepEqual((await readBlueprint(db, generated)).tree.positions.map(p => [p.title.en, p.headcount]), [['Chemist', 3]]);
    await tx(t => setTemplateStatus(t, actor, template, 'archive'));
    await rejects(tx(t => generateCompanyBlueprint(t, actor, { companyTypeId: typeIdNew, size: 'small' })), 'NO_TEMPLATE');
    // a company blueprint cannot go through the template transitions
    await rejects(tx(t => setTemplateStatus(t, actor, generated, 'activate')), 'NOT_TEMPLATE');
    await tx(t => updateCompanyBlueprint(t, actor, generated, { nameEn: 'Renamed', nameAr: 'اسم جديد', companyId: createdCompanies[0] }));
    assert.equal((await readBlueprint(db, generated)).blueprint.name.ar, 'اسم جديد');
  });

  console.log(`\n${passed} runtime checks passed`);
} finally {
  // Remove what this run created in the scratch database (blueprints cascade; organization rows created by apply are removed last).
  try {
    await db.prepare("DELETE FROM audit_logs WHERE module IN ('staffing_blueprint','job_titles','system_settings') AND created_at>=CURRENT_TIMESTAMP-INTERVAL '2 hours' AND (new_value LIKE ? OR module='staffing_blueprint')").bind(`%${tag}%`).run();
    for (const id of createdCompanies) {
      await db.prepare('DELETE FROM job_titles WHERE department_id IN (SELECT id FROM departments WHERE company_id=?)').bind(id).run();
      await db.prepare('DELETE FROM organization_branch_scopes WHERE department_id IN (SELECT id FROM departments WHERE company_id=?)').bind(id).run();
      await db.prepare('UPDATE staffing_blueprints SET company_id=NULL WHERE company_id=?').bind(id).run();
      await db.prepare('UPDATE departments SET parent_id=NULL WHERE company_id=?').bind(id).run();
      await db.prepare('DELETE FROM departments WHERE company_id=?').bind(id).run();
      await db.prepare('DELETE FROM companies WHERE id=?').bind(id).run();
    }
  } catch (error) { console.error('cleanup incomplete (scratch database only):', error.message); }
  await db.close();
  fs.rmSync(outfile, { force: true });
}
