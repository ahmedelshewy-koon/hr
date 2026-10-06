import type { Row } from '../ui-types';
import { assignmentDiagnostics, CURRENT_EMPLOYMENT, type OrganizationCatalog } from './assignment-policy.ts';
import { hrRuleIssues } from './hr-responsibility.ts';

export type IntegrityIssue = { code: string; type: string; id: number; message: string; details?: unknown };

/** Compares Arabic/English unit names the way people misspell them (ه/ة, ى/ي, hamza forms, spacing, case). */
export function normalizeOrgName(value: unknown): string {
  return String(value ?? '')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

const num = (value: unknown) => Number(value || 0);
const kindOf = (unit: Row) => String(unit.organization_kind || 'department');
const isActive = (row: Row) => row.status === 'active';

/**
 * Read-only structural checks of the saved organization: hierarchy, duplicates, job-title bindings, CEO positions,
 * HR rules and current employee assignments. Employee checks reuse assignmentDiagnostics, so this reports exactly
 * what the profile would flag; it never infers or repairs anything.
 */
export function organizationIntegrityIssues(catalog: OrganizationCatalog, employees: Row[] = [], roster: Row[] = []): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const add = (code: string, type: string, id: unknown, message: string, details?: unknown) => issues.push({ code, type, id: num(id), message, details });
  const units = new Map(catalog.departments.map(unit => [num(unit.id), unit]));
  const activeUnits = catalog.departments.filter(unit => isActive(unit) && unit.company_id);

  for (const unit of activeUnits) {
    const id = num(unit.id), parentId = num(unit.parent_id);
    if (parentId === id) { add('SELF_PARENT', 'unit', id, `Unit #${id} is its own parent`); continue; }
    const seen = new Set([id]);
    for (let cursor = units.get(parentId); cursor; cursor = units.get(num(cursor.parent_id))) {
      if (seen.has(num(cursor.id))) { add('HIERARCHY_CYCLE', 'unit', id, `Unit #${id} is inside a parent cycle`); break; }
      seen.add(num(cursor.id));
    }
    const parent = parentId ? units.get(parentId) : undefined;
    if (parentId && (!parent || !isActive(parent) || num(parent.company_id) !== num(unit.company_id)))
      add('PARENT_INVALID', 'unit', id, `Unit #${id} has a missing, inactive or cross-company parent #${parentId}`);
    const kind = kindOf(unit), parentKind = parent ? kindOf(parent) : null;
    if (kind === 'department' && parentId) add('KIND_PARENT', 'unit', id, `Department #${id} must not have a parent`);
    if (kind === 'section' && parentKind !== 'department') add('KIND_PARENT', 'unit', id, `Section #${id} must belong to a department`);
    if (kind === 'team' && !['department', 'section'].includes(String(parentKind))) add('KIND_PARENT', 'unit', id, `Team #${id} must belong to a department or section`);
    const manager = unit.manager_employee_id ? employees.find(e => num(e.id) === num(unit.manager_employee_id)) : undefined;
    if (manager && num(manager.company_id) !== num(unit.company_id))
      add('UNIT_MANAGER_COMPANY', 'unit', id, `Unit #${id} is managed by employee #${manager.id} of another company (#${manager.company_id ?? 'none'})`);
  }

  // Two active units of one company with the same Arabic or English name are the same logical unit.
  const seenNames = new Map<string, Row>();
  for (const unit of activeUnits) for (const [lang, name] of [['ar', unit.name_ar], ['en', unit.name_en]]) {
    const key = `${num(unit.company_id)}|${lang}|${normalizeOrgName(name)}`;
    if (!normalizeOrgName(name)) continue;
    const first = seenNames.get(key);
    if (first) add('DUPLICATE_UNIT', 'unit', unit.id, `Unit #${unit.id} duplicates #${first.id} (${String(name)}) in company #${unit.company_id}`, { duplicateOf: num(first.id), lang });
    else seenNames.set(key, unit);
  }

  const seenTitles = new Map<string, Row>();
  for (const title of catalog.jobTitles.filter(isActive)) {
    const bound = title.department_id ? units.get(num(title.department_id)) : undefined;
    if (title.department_id && (!bound || !isActive(bound) || kindOf(bound) !== 'department'))
      add('TITLE_BINDING', 'job_title', title.id, `Job title #${title.id} is bound to a missing, inactive or non-department unit #${title.department_id}`);
    // Unbound titles (company-level, e.g. CEO) are shared across companies by design and are not compared.
    if (!title.department_id) continue;
    for (const [lang, name] of [['ar', title.name_ar], ['en', title.name_en]]) {
      const key = `${num(title.department_id)}|${lang}|${normalizeOrgName(name)}`;
      const first = seenTitles.get(key);
      if (first) add('DUPLICATE_TITLE', 'job_title', title.id, `Job title #${title.id} duplicates #${first.id} (${String(name)}) in unit #${title.department_id}`, { duplicateOf: num(first.id), lang });
      else seenTitles.set(key, title);
    }
  }

  const ceoByCompany = new Map<number, number>();
  for (const position of catalog.positions.filter(isActive)) {
    for (const key of ['department_id', 'section_id', 'team_id']) {
      const unit = position[key] ? units.get(num(position[key])) : undefined;
      if (position[key] && (!unit || !isActive(unit) || num(unit.company_id) !== num(position.company_id)))
        add('POSITION_UNIT', 'position', position.id, `Position #${position.id} ${key} #${position[key]} is missing, inactive or outside company #${position.company_id}`);
    }
    if (num(position.is_ceo) === 1) {
      if (ceoByCompany.has(num(position.company_id))) add('DUPLICATE_CEO', 'position', position.id, `Company #${position.company_id} has more than one active CEO position`);
      ceoByCompany.set(num(position.company_id), num(position.id));
    }
  }

  for (const rule of catalog.hrRules.filter(isActive)) {
    for (const issue of hrRuleIssues(catalog, roster, { ...rule, rule_type: rule.company_id ? 'company_branch' : 'branch_fallback' }))
      add(`HR_RULE:${issue.code}`, 'hr_rule', rule.id, issue.message_en);
  }

  for (const employee of employees.filter(e => CURRENT_EMPLOYMENT.includes(String(e.employment_status)))) {
    const company = catalog.companies.find(c => num(c.id) === num(employee.company_id));
    if (!company || !isActive(company)) add('EMPLOYEE_COMPANY', 'employee', employee.id, `Employee #${employee.id} has no active company`);
    for (const issue of assignmentDiagnostics(catalog, employee, employees))
      add(`EMPLOYEE:${issue.code}`, 'employee', employee.id, issue.message_en, { field: issue.field });
  }
  return issues;
}
