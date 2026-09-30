"use client";
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { Row } from './ui-types';
import { assignmentFields, assignmentOptions, changeAssignmentForm, retainedOptions, type OrganizationCatalog } from './organization/assignment-policy';
import { organizationMessage, type OrganizationIssue } from './organization/org-errors';
import { issueExplanation } from './organization-assignment-fields';
import './organization-settings.css';

const CURRENT = ['active', 'probation', 'notice_period'];
const EDITABLE = ['companyId', 'branchId', 'departmentId', 'sectionId', 'teamId', 'positionId', 'jobTitleId', 'gradeId', 'workLocationId'] as const;
const LABELS: Record<string, [string, string]> = { company_id: ['Company', 'الشركة'], branch_id: ['Branch', 'الفرع'], department_id: ['Department', 'الإدارة'], section_id: ['Section', 'القسم الفرعي'], team_id: ['Team', 'الفريق'], position_id: ['Position', 'الوظيفة'], job_title_id: ['Job title', 'المسمى الوظيفي'], grade_id: ['Grade', 'الدرجة'], work_location_id: ['Work location', 'مقر العمل'], assignment_effective_date: ['Effective date', 'تاريخ السريان'] };
type Preview = { root_employee_id: number; valid: boolean; issues: OrganizationIssue[]; changes: { employee_id: number; name_en: string | null; name_ar: string | null; before: Row; after: Row; fields: { field: string; before: unknown; after: unknown }[] }[] };

// Companies may still carry only the legacy `name`; never fall back to a bare id while a name exists.
const nameOf = (row: Row | undefined, rtl: boolean) => String((rtl ? row?.name_ar || row?.name_en : row?.name_en || row?.name_ar) || row?.name || (row ? `#${row.id}` : '—'));
function formOf(employee: Row): Row {
  return Object.fromEntries([...Object.entries(assignmentFields).map(([key, column]) => [key, employee[column] ? String(employee[column]) : '']), ['employeeId', employee.id]]);
}
/** A report's starting draft in the destination company: only values that are still valid are kept; nothing is inferred. */
function destinationDraft(employee: Row, companyId: string, catalog: OrganizationCatalog, employees: Row[]): Row {
  let draft: Row = { ...formOf(employee), companyId };
  if (String(employee.company_id ?? '') === companyId) return draft;
  const keep = (key: string) => { const opts = assignmentOptions(catalog, draft, employees)[key] ?? []; if (draft[key] && !opts.some(o => String(o.id) === String(draft[key]))) draft = { ...draft, [key]: '' }; };
  for (const key of ['branchId', 'departmentId', 'sectionId', 'teamId', 'positionId', 'jobTitleId', 'workLocationId']) keep(key);
  return draft;
}

export function TeamTransferDialog({ rtl, root, rootDraft, catalog, employees, onClose, onDone }: { rtl: boolean; root: Row; rootDraft: Row; catalog: OrganizationCatalog; employees: Row[]; onClose: () => void; onDone: () => void | Promise<void> }) {
  const companyId = String(rootDraft.companyId ?? '');
  const byManager = useMemo(() => { const map = new Map<number, Row[]>(); for (const e of employees) if (e.manager_id && e.employment_status !== 'deleted') { const list = map.get(Number(e.manager_id)) ?? []; list.push(e); map.set(Number(e.manager_id), list); } return map; }, [employees]);
  const [included, setIncluded] = useState<number[]>(() => (byManager.get(Number(root.id)) ?? []).map(e => Number(e.id)));
  const [drafts, setDrafts] = useState<Record<number, Row>>(() => Object.fromEntries((byManager.get(Number(root.id)) ?? []).map(e => [Number(e.id), destinationDraft(e, companyId, catalog, employees)])));
  const [effectiveDate, setEffectiveDate] = useState(String(rootDraft.assignmentEffectiveDate ?? ''));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reviewedKey, setReviewedKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const employee = (id: number) => employees.find(e => Number(e.id) === id);
  // Candidates: the whole current reporting subtree of the manager (reports of reports can be added).
  const subtree = useMemo(() => { const out: Row[] = []; const walk = (id: number, depth: number) => { for (const e of byManager.get(id) ?? []) { out.push({ ...e, depth }); walk(Number(e.id), depth + 1); } }; walk(Number(root.id), 0); return out; }, [byManager, root.id]);
  const members = [{ employeeId: Number(root.id), ...Object.fromEntries(EDITABLE.map(k => [k, rootDraft[k] ?? ''])) }, ...included.map(id => ({ employeeId: id, ...Object.fromEntries(EDITABLE.map(k => [k, drafts[id]?.[k] ?? ''])) }))];
  const payload = { rootEmployeeId: Number(root.id), members, ...(effectiveDate ? { assignmentEffectiveDate: effectiveDate } : {}) };
  const key = JSON.stringify(payload);
  const reviewed = preview && reviewedKey === key ? preview : null;
  const toggle = (e: Row, on: boolean) => {
    setIncluded(list => on ? [...list, Number(e.id)] : list.filter(id => id !== Number(e.id)));
    if (on && !drafts[Number(e.id)]) setDrafts(d => ({ ...d, [Number(e.id)]: destinationDraft(e, companyId, catalog, employees) }));
  };
  const change = (id: number, field: string, value: string) => setDrafts(d => { try { return { ...d, [id]: changeAssignmentForm({ ...d[id], managerId: '' }, field, value, catalog) }; } catch (reason) { setError(organizationMessage(reason, rtl)); return d; } });
  const call = async (mode: 'preview' | 'commit', body: Row) => {
    const response = await fetch('/api/organization/team-transfer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, mode }) });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) window.dispatchEvent(new Event('portal-session-expired'));
    if (!response.ok) throw Object.assign(new Error(String(data.error || `Request failed (${response.status})`)), data);
    return data;
  };
  const runPreview = async () => { setBusy(true); setError(''); try { setPreview(await call('preview', payload) as Preview); setReviewedKey(key); } catch (reason) { setError(organizationMessage(reason, rtl)); } finally { setBusy(false); } };
  const commit = async () => {
    if (!reviewed?.valid) return;
    setBusy(true); setError('');
    try {
      const reviewedMembers = members.map(m => ({ ...m, reviewed: reviewed.changes.find(c => c.employee_id === m.employeeId)?.before }));
      await call('commit', { ...payload, members: reviewedMembers });
      window.dispatchEvent(new Event('hr-data-changed'));
      await onDone();
    } catch (reason) { setError(organizationMessage(reason, rtl)); setPreview(null); } finally { setBusy(false); }
  };
  const lookup = (field: string, id: unknown) => {
    if (id === null || id === '' || id === undefined) return rtl ? 'غير محدد' : 'Not assigned';
    if (field === 'assignment_effective_date') return String(id);
    const table: Record<string, Row[]> = { company_id: catalog.companies, branch_id: catalog.branches, department_id: catalog.departments, section_id: catalog.departments, team_id: catalog.departments, position_id: catalog.positions, job_title_id: catalog.jobTitles, grade_id: catalog.grades, work_location_id: catalog.workLocations };
    return `${nameOf(table[field]?.find(r => Number(r.id) === Number(id)), rtl)} (#${id})`;
  };
  const selectFor = (id: number, field: string, labelText: string) => {
    const draft = drafts[id] ?? {};
    const options = assignmentOptions(catalog, draft, employees)[field] ?? [];
    return <label className="field"><span>{labelText}</span><select value={draft[field] || ''} onChange={e => change(id, field, e.target.value)}><option value="">{rtl ? 'بدون / اختر' : 'None / select'}</option>{retainedOptions(options, catalog[({ branchId: 'branches', departmentId: 'departments', sectionId: 'departments', teamId: 'departments', positionId: 'positions', jobTitleId: 'jobTitles' } as Record<string, keyof OrganizationCatalog>)[field]] as Row[], draft[field]).map(r => <option key={r.id} value={r.id} disabled={r.retained}>{nameOf(r, rtl)}{r.retained ? (rtl ? ' (محفوظة — غير صالحة في الوجهة)' : ' (retained — not valid at destination)') : ''}</option>)}</select></label>;
  };
  return <div className="modal-layer modal-center"><button type="button" className="modal-scrim" onClick={onClose} aria-label={rtl ? 'إغلاق' : 'Close'} />
    <aside className="modal-dialog org-team-transfer" role="dialog" aria-modal="true" aria-labelledby="team-transfer-title" dir={rtl ? 'rtl' : 'ltr'}>
      <div className="drawer-head"><div><span className="eyebrow">{rtl ? 'نقل تنظيمي للفريق' : 'TEAM ORGANIZATIONAL TRANSFER'}</span><h2 id="team-transfer-title">{nameOf(root, rtl)} → {nameOf(catalog.companies.find(c => String(c.id) === companyId), rtl)}</h2>
        <p>{rtl ? 'ينتقل المدير وفريقه المحدد معًا في عملية واحدة. تبقى خطوط التبعية (المدير المباشر) كما هي ولا تُمسح مؤقتًا. يُرفض النقل الجزئي للفريق.' : 'The manager and the selected team move together in one transaction. Reporting lines (direct managers) are preserved and never cleared temporarily. Partial team moves are refused.'}</p></div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={rtl ? 'إغلاق' : 'Close'}><X size={20} /></button></div>
      <div className="form-body">
        {error && <p className="form-error" role="alert">{error}</p>}
        {!companyId && <p className="settings-note warn">{rtl ? 'اختر شركة الوجهة للمدير أولًا في ملفه.' : 'Choose the manager\'s destination company in the profile first.'}</p>}
        <label className="field"><span>{rtl ? 'تاريخ سريان التعيين (اختياري)' : 'Assignment effective date (optional)'}</span><input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} /></label>
        <h3>{rtl ? 'أعضاء الفريق' : 'Team members'}</h3>
        {subtree.length === 0 && <p className="settings-muted">{rtl ? 'لا يوجد مرؤوسون لهذا المدير.' : 'This manager has no direct reports.'}</p>}
        <ul className="org-transfer-members">{subtree.map(e => { const id = Number(e.id), on = included.includes(id); const current = CURRENT.includes(String(e.employment_status)); return <li key={id} style={{ paddingInlineStart: Number(e.depth) * 16 }}>
          <label className="org-transfer-member"><input type="checkbox" checked={on} onChange={event => toggle(e, event.target.checked)} /> <b>{nameOf(e, rtl)}</b> <small>{e.employee_code}{!current ? ` · ${e.employment_status}` : ''} · {rtl ? 'الشركة الحالية' : 'current company'}: {lookup('company_id', e.company_id)}</small></label>
          {on && <div className="org-transfer-fields">{selectFor(id, 'branchId', rtl ? 'الفرع' : 'Branch')}{selectFor(id, 'departmentId', rtl ? 'الإدارة' : 'Department')}{selectFor(id, 'sectionId', rtl ? 'القسم الفرعي' : 'Section')}{selectFor(id, 'positionId', rtl ? 'الوظيفة' : 'Position')}{selectFor(id, 'jobTitleId', rtl ? 'المسمى' : 'Job title')}</div>}
        </li>; })}</ul>
        {reviewed && <section className="org-assignment-review" aria-label={rtl ? 'مراجعة النقل' : 'Transfer review'}>
          <h3>{rtl ? 'مراجعة قبل التأكيد' : 'Review before confirming'}</h3>
          {reviewed.issues.length > 0 && <div className="settings-error" role="alert"><ul>{reviewed.issues.map((issue, index) => { const who = employee(Number((issue.details as Row)?.employee_id)); return <li key={index}>{who ? `${nameOf(who, rtl)}: ` : ''}{issueExplanation(issue, rtl)}{Array.isArray((issue.details as Row)?.reports) ? ` — ${((issue.details as Row).reports as Row[]).map(r => nameOf(employee(Number(r.id)) ?? r, rtl)).join(rtl ? '، ' : ', ')}` : ''}</li>; })}</ul></div>}
          <table><thead><tr><th>{rtl ? 'الموظف' : 'Employee'}</th><th>{rtl ? 'الحقل' : 'Field'}</th><th>{rtl ? 'قبل' : 'Before'}</th><th>{rtl ? 'بعد' : 'After'}</th></tr></thead>
            <tbody>{reviewed.changes.flatMap(change => { const fields = change.fields.filter(f => f.field !== 'team_id' && f.field !== 'grade_id'); return fields.map((f, index) => <tr key={`${change.employee_id}-${f.field}`}>{index === 0 && <th rowSpan={fields.length}>{rtl ? change.name_ar || change.name_en : change.name_en || change.name_ar}</th>}<td>{(LABELS[f.field] ?? [f.field, f.field])[rtl ? 1 : 0]}</td><td>{lookup(f.field, f.before)}</td><td>{lookup(f.field, f.after)}</td></tr>); })}</tbody></table>
          <p className="settings-muted">{rtl ? 'المدير المباشر ومسؤول الموارد البشرية لكل موظف لا يتغيران.' : 'Each employee\'s direct manager and HR override stay unchanged.'}</p>
        </section>}
      </div>
      <div className="drawer-footer"><span className="spacer" /><button type="button" className="outline" onClick={onClose}>{rtl ? 'إلغاء' : 'Cancel'}</button>
        {reviewed?.valid ? <button type="button" className="primary" disabled={busy} onClick={() => void commit()}>{busy ? (rtl ? 'جارٍ النقل...' : 'Transferring...') : (rtl ? 'تأكيد نقل الفريق' : 'Confirm team transfer')}</button>
          : <button type="button" className="primary" disabled={busy || !companyId} onClick={() => void runPreview()}>{busy ? (rtl ? 'جارٍ التحقق...' : 'Checking...') : (rtl ? 'معاينة النقل' : 'Preview transfer')}</button>}</div>
    </aside></div>;
}
