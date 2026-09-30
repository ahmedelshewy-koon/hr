"use client";
import { useState, type FormEvent } from 'react';
import { hrRuleBranchChoices } from '../../organization/hr-responsibility';
import { nameOf, optionsFor } from '../../organization/selectors';
import { SelectField } from '../settings-ui';
import { useOrganization } from './context';
import './simple-hr-responsibility.css';

const current = new Set(['active', 'probation', 'notice_period']);

export function SimpleHrResponsibility() {
  const { rtl, access, catalog, hrEmployees, employees, hrRoster, hrResponsibles, saveHrAssignment } = useOrganization();
  const people = hrEmployees ?? employees;
  const roster = hrRoster ?? hrResponsibles;
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [credential, setCredential] = useState<{ email: string; password: string } | null>(null);
  const branches = hrRuleBranchChoices(catalog, 'company_branch', companyId);
  const rules = catalog.hrRules.filter(rule => rule.company_id && rule.status === 'active');
  const hrEmployee = (userId: unknown) => {
    const entry = roster.find(row => Number(row.user_id) === Number(userId));
    return people.find(row => Number(row.id) === Number(entry?.employee_id));
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setCredential(null); setBusy(true);
    try {
      const result = await saveHrAssignment(companyId, branchId, employeeId);
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
        onChange={setEmployeeId} disabled={!access.canManage || busy} />
      {access.canManage && <button type="submit" className="primary" disabled={busy || !companyId || !branchId || !employeeId}>{busy ? (rtl ? 'جارٍ الحفظ…' : 'Saving…') : (rtl ? 'حفظ' : 'Save')}</button>}
    </form>
    {error && <p className="settings-error" role="alert">{error}</p>}
    {credential && <div className="simple-hr-credential" role="status"><b>{rtl ? 'تم إنشاء حساب الموظف بصلاحية HR' : 'HR account created'}</b><p>{credential.email}</p><p>{rtl ? 'كلمة المرور المؤقتة (انسخها الآن):' : 'Temporary password (copy it now):'} <code dir="ltr">{credential.password}</code></p></div>}
    {rules.length > 0 && <div className="simple-hr-rules"><h4>{rtl ? 'التعيينات الحالية' : 'Current assignments'}</h4><div className="simple-hr-list">{rules.map(rule => <button type="button" key={String(rule.id)} onClick={() => { setCompanyId(String(rule.company_id)); setBranchId(String(rule.branch_id)); setEmployeeId(String(hrEmployee(rule.hr_user_id)?.id ?? '')); setCredential(null); }}>
      <span>{nameOf(catalog.companies.find(row => Number(row.id) === Number(rule.company_id)), rtl)} · {nameOf(catalog.branches.find(row => Number(row.id) === Number(rule.branch_id)), rtl)}</span><b>{nameOf(hrEmployee(rule.hr_user_id), rtl)}</b>
    </button>)}</div></div>}
  </section>;
}
