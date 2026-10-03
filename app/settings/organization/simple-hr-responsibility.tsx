"use client";
import { useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { hrRuleBranchChoices } from '../../organization/hr-responsibility';
import { nameOf, optionsFor } from '../../organization/selectors';
import { SelectField } from '../settings-ui';
import { useOrganization } from './context';
import './simple-hr-responsibility.css';

const current = new Set(['active', 'probation', 'notice_period']);

export function SimpleHrResponsibility() {
  const { rtl, access, catalog, hrEmployees, employees, hrRoster, hrResponsibles, saveHrAssignment, deleteEntity } = useOrganization();
  const people = hrEmployees ?? employees;
  const roster = hrRoster ?? hrResponsibles;
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [hrDataScope, setHrDataScope] = useState('assigned');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [credential, setCredential] = useState<{ email: string; password: string } | null>(null);
  const branches = hrRuleBranchChoices(catalog, 'company_branch', companyId);
  const rules = catalog.hrRules.filter(rule => rule.company_id && rule.status === 'active');
  const rosterEntry = (userId: unknown) => roster.find(row => Number(row.user_id) === Number(userId));
  const scopeOfEmployee = (id: string) => String(roster.find(row => String(row.employee_id) === id)?.hr_data_scope ?? 'assigned');
  const remove = async (rule: typeof rules[number]) => {
    const place = `${nameOf(catalog.companies.find(row => Number(row.id) === Number(rule.company_id)), rtl)} · ${nameOf(catalog.branches.find(row => Number(row.id) === Number(rule.branch_id)), rtl)}`;
    if (!window.confirm(rtl ? `حذف تعيين ${place}؟ لن يكون لموظفي هذا الفرع مسؤول موارد بشرية حتى تعيّن غيره.` : `Remove the ${place} assignment? Its employees will have no HR responsible until you assign another.`)) return;
    setError(''); setBusy(true);
    try { await deleteEntity('hrRules', rule.id); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); }
  };
  const hrEmployee = (userId: unknown) => {
    const entry = roster.find(row => Number(row.user_id) === Number(userId));
    return people.find(row => Number(row.id) === Number(entry?.employee_id));
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setCredential(null); setBusy(true);
    try {
      const result = await saveHrAssignment(companyId, branchId, employeeId, hrDataScope);
      if (result.temporaryPassword) {
        const person = people.find(row => String(row.id) === employeeId);
        setCredential({ email: String(person?.work_email ?? ''), password: String(result.temporaryPassword) });
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <section className="simple-hr" aria-label={rtl ? 'تعيين مسؤول الموارد البشرية' : 'Assign HR responsible'}>
    <h3>{rtl ? 'تعيين مسؤول الموارد البشرية' : 'Assign HR responsible'}</h3>
    <form onSubmit={event => void save(event)}>
      <SelectField label={rtl ? 'الشركة' : 'Company'} value={companyId} required placeholder={rtl ? 'اختر الشركة' : 'Select company'} options={optionsFor(catalog.companies, rtl)} onChange={value => { setCompanyId(value); setBranchId(''); }} disabled={!access.canManage || busy} />
      <SelectField label={rtl ? 'الفرع' : 'Branch'} value={branchId} required placeholder={rtl ? 'اختر الفرع' : 'Select branch'} options={optionsFor(branches, rtl)} onChange={setBranchId} disabled={!access.canManage || busy || !companyId} />
      <SelectField label={rtl ? 'مسؤول الموارد البشرية' : 'HR responsible'} value={employeeId} required placeholder={rtl ? 'اختر موظفًا' : 'Select an employee'}
        options={people.map(person => ({ value: String(person.id), label: `${nameOf(person, rtl)}${person.employee_code ? ` — ${person.employee_code}` : ''}`, disabled: !current.has(String(person.employment_status ?? 'active')) }))}
        onChange={value => { setEmployeeId(value); setHrDataScope(scopeOfEmployee(value)); }} disabled={!access.canManage || busy} />
      <SelectField label={rtl ? 'يرى من الموظفين' : 'Can see'} value={hrDataScope} required
        options={[{ value: 'assigned', label: rtl ? 'موظفي الفروع المسؤول عنها فقط' : 'Only employees of the branches assigned to them' }, { value: 'all', label: rtl ? 'كل الموظفين (مدير الموارد البشرية)' : 'All employees (HR manager)' }]}
        onChange={setHrDataScope} disabled={!access.canManage || busy} />
      {access.canManage && <button type="submit" className="primary" disabled={busy || !companyId || !branchId || !employeeId}>{busy ? (rtl ? 'جارٍ الحفظ…' : 'Saving…') : (rtl ? 'حفظ' : 'Save')}</button>}
    </form>
    {error && <p className="settings-error" role="alert">{error}</p>}
    {credential && <div className="simple-hr-credential" role="status"><b>{rtl ? 'تم إنشاء حساب الموظف بصلاحية HR' : 'HR account created'}</b><p>{credential.email}</p><p>{rtl ? 'كلمة المرور المؤقتة (انسخها الآن):' : 'Temporary password (copy it now):'} <code dir="ltr">{credential.password}</code></p></div>}
    {rules.length > 0 && <div className="simple-hr-rules"><h4>{rtl ? 'التعيينات الحالية' : 'Current assignments'}</h4><div className="simple-hr-list">{rules.map(rule => { const seesAll = rosterEntry(rule.hr_user_id)?.hr_data_scope !== 'assigned' || rosterEntry(rule.hr_user_id)?.role_name === 'Super Admin'; return <div className="simple-hr-row" key={String(rule.id)}>
      <button type="button" className="simple-hr-pick" onClick={() => { setCompanyId(String(rule.company_id)); setBranchId(String(rule.branch_id)); setEmployeeId(String(hrEmployee(rule.hr_user_id)?.id ?? '')); setHrDataScope(seesAll ? 'all' : 'assigned'); setCredential(null); }}>
        <span>{nameOf(catalog.companies.find(row => Number(row.id) === Number(rule.company_id)), rtl)} · {nameOf(catalog.branches.find(row => Number(row.id) === Number(rule.branch_id)), rtl)}</span>
        <b>{nameOf(hrEmployee(rule.hr_user_id), rtl)} <small className={seesAll ? 'simple-hr-scope all' : 'simple-hr-scope'}>{seesAll ? (rtl ? 'يرى كل الموظفين' : 'Sees everyone') : (rtl ? 'يرى فروعه فقط' : 'Own branches only')}</small></b>
      </button>
      {access.canManage && <button type="button" className="simple-hr-delete" disabled={busy} title={rtl ? 'حذف التعيين' : 'Remove assignment'} aria-label={rtl ? 'حذف التعيين' : 'Remove assignment'} onClick={() => void remove(rule)}><Trash2 size={17} /></button>}
    </div>; })}</div></div>}
  </section>;
}
