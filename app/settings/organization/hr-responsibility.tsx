"use client";
import { useMemo, useState, type ReactNode } from 'react';
import type { Row } from '../../ui-types';
import { isActive, nameOf, optionsFor } from '../../organization/selectors.ts';
import { HR_PRECEDENCE, hrEligible, pick, sortHrRules } from '../../organization/settings-model.ts';
import { HR_RULE_TYPE_LABEL, hrIneligibility, hrReasonText, hrRuleBranchChoices, hrRuleIssues, hrRuleType, hrSetupSummary, hrSourceText, hrUsableFor, resolveEmployeeHrResponsibility, type HrRuleImpact, type HrRuleType } from '../../organization/hr-responsibility.ts';
import { CURRENT_STATUSES, useOrganization } from './context';
import { ReviewPending, issueText, useImpactReview, type ImpactPreview } from './impact-review';
import { AddButton, formatCount, InfoNotice, MasterDataDrawer, MasterDataTable, MasterDataToolbar, OpenButton, SelectField, SettingsSubnav, StatusBadge, useMasterFilter } from '../settings-ui';
import { useDrawerForm } from '../use-drawer-form';
import './organization-sections.css';

const hrLabel = (hr: Row | undefined | null, rtl: boolean) => hr ? `${nameOf(hr, rtl)}${hr.email ? ` — ${hr.email}` : ''}` : '—';
const byId = (rows: Row[], id: unknown) => rows.find(row => Number(row.id) === Number(id));
const NO_ELIGIBLE = { ar: 'لا يوجد مسؤول موارد بشرية مؤهل. اربط حساب مستخدم بصلاحية الموارد البشرية بموظف نشط أولًا.', en: 'No eligible HR Responsible is available. Link an HR-capable user account to an active employee first.' };

/** Snapshot data with fallbacks for older callers that only pass the /api/hr roster. */
function useHrData() {
  const org = useOrganization();
  const roster = org.hrRoster ?? org.hrResponsibles;
  const employees = org.hrEmployees ?? org.employees;
  const usable = roster.filter(hr => hrUsableFor(hr));
  const summary = useMemo(() => hrSetupSummary(org.catalog, roster, employees), [org.catalog, roster, employees]);
  return { ...org, roster, hrEmployeesList: employees, usable, summary, unlinked: org.unlinkedHrAccounts ?? [] };
}

export function HrResponsibilitySection() {
  const [tab, setTab] = useState<'rules' | 'tester' | 'roster'>('rules');
  const { rtl, catalog, roster } = useHrData();
  return <>
    <header className="hr-header">
      <h3 className="settings-section-title">{rtl ? 'مسؤولية الموارد البشرية' : 'HR Responsibility'}</h3>
      <p className="settings-muted">{rtl ? 'حدّد مسؤول الموارد البشرية حسب الشركة والفرع. تُضبط الاستثناءات الخاصة بموظف معيّن من ملف الموظف.' : 'Assign HR responsibility by company and branch. Employee-specific exceptions can be set from the Employee Profile.'}</p>
    </header>
    <HrSummary />
    <SetupBlockers />
    <PrecedenceLegend />
    <SettingsSubnav level="secondary" rtl={rtl} label={rtl ? 'مسؤولية الموارد البشرية' : 'HR responsibility'} active={tab} onChange={id => setTab(id as 'rules' | 'tester' | 'roster')}
      items={[
        { id: 'rules', label: rtl ? 'قواعد مسؤولية الموارد البشرية' : 'HR Responsibility Rules', count: catalog.hrRules.length },
        { id: 'tester', label: rtl ? 'اختبار مسؤولية الموارد البشرية' : 'Test HR Responsibility' },
        { id: 'roster', label: rtl ? 'قائمة المؤهلين' : 'Eligible roster', count: roster.length },
      ]} />
    {tab === 'rules' ? <RulesTab /> : tab === 'tester' ? <ResolutionTester /> : <RosterTab />}
  </>;
}

export function HrSummary() {
  const { rtl, summary } = useHrData();
  const tiles: [string, string, number][] = [
    ['القواعد النشطة', 'Active Rules', summary.activeRules],
    ['موظفون تم تحديد مسؤولهم', 'Employees Resolved', summary.resolved],
    ['موظفون لديهم استثناء', 'Employees With Overrides', summary.overrides],
    ['يحتاج إعداد الموارد البشرية', 'Needs HR Setup', summary.needsSetup],
  ];
  return <dl className="hr-summary" aria-label={rtl ? 'ملخص مسؤولية الموارد البشرية' : 'HR responsibility summary'}>
    {tiles.map(([ar, en, value]) => <div key={en} className={en === 'Needs HR Setup' && value > 0 ? 'warn' : undefined}><dt>{rtl ? ar : en}</dt><dd>{formatCount(value, rtl)}</dd></div>)}
    {summary.unavailable > 0 && <div className="warn"><dt>{rtl ? 'مسؤول غير متاح' : 'HR unavailable'}</dt><dd>{formatCount(summary.unavailable, rtl)}</dd></div>}
  </dl>;
}

/** Why rules cannot be created yet, and the supported way to fix it. Nothing is linked from here. */
export function SetupBlockers() {
  const { rtl, usable, unlinked, hrCandidates, roster } = useHrData();
  const offRoster = hrCandidates.filter(candidate => !roster.some(hr => Number(hr.user_id) === Number(candidate.user_id) && hr.status === 'active'));
  if (usable.length && !unlinked.length) return null;
  return <div className="hr-blockers">
    {!usable.length && <InfoNotice tone="warn"><span><b>{pick(NO_ELIGIBLE, rtl)}</b>{' '}
      {offRoster.length
        ? (rtl ? `يوجد ${formatCount(offRoster.length, rtl)} حساب مؤهل غير مضاف إلى قائمة المؤهلين؛ أضفه من تبويب «قائمة المؤهلين».` : `${offRoster.length} eligible account(s) are not on the roster yet; add them from the “Eligible roster” tab.`)
        : (rtl ? 'من صفحة المستخدمين: أنشئ حسابًا لموظف حالي بدور مدير موارد بشرية (مدير النظام فقط)، أو غيّر دور حساب مرتبط بموظف.' : 'In Users: create an account for a current employee with the HR Manager role (Super Admin only), or change the role of an account that is already linked to an employee.')}
    </span></InfoNotice>}
    {unlinked.length > 0 && <InfoNotice tone={usable.length ? 'info' : 'warn'}><span>
      {rtl ? `حسابات بصلاحية الموارد البشرية غير مرتبطة بموظف (${formatCount(unlinked.length, rtl)}) ولا يمكن أن تكون مسؤول موارد بشرية: ` : `HR-capable accounts not linked to an employee (${unlinked.length}) cannot act as HR Responsible: `}
      <span dir="ltr">{unlinked.map(account => String(account.email)).join(', ')}</span>.{' '}
      {rtl ? 'لا توجد حاليًا طريقة في الواجهة لربط حساب موجود بموظف؛ يمكن إنشاء حساب جديد للموظف من صفحة المستخدمين.' : 'The interface has no way to link an existing account to an employee; a new account can be created for the employee from Users.'}
    </span></InfoNotice>}
  </div>;
}

/** Evaluation order, first match wins. Employee-level overrides come from the profile and are never created here. */
export function PrecedenceLegend() {
  const { rtl } = useOrganization();
  return <section aria-label={rtl ? 'أولوية التوجيه' : 'Routing precedence'}>
    <h3 className="settings-section-title">{rtl ? 'أولوية تحديد مسؤول الموارد البشرية' : 'How the HR responsible is chosen'}</h3>
    <ol className="hr-precedence">
      {HR_PRECEDENCE.map(step => <li key={step.rank}><b className="hr-rank">{formatCount(step.rank, rtl)}</b><span><b>{pick(step.label, rtl)}</b><small>{pick(step.hint, rtl)}</small></span></li>)}
      <li><b className="hr-rank">{formatCount(4, rtl)}</b><span><b>{rtl ? 'لا يوجد مسؤول' : 'No HR Responsible'}</b><small>{rtl ? '«يحتاج إعداد الموارد البشرية» — لا يُعيَّن أحد تلقائيًا' : '“Needs HR Setup” — nobody is assigned silently'}</small></span></li>
    </ol>
  </section>;
}

/* ------------------------------------------------------------------ tester */

export function ResolutionTester() {
  const { rtl, catalog, roster, hrEmployeesList } = useHrData();
  const [mode, setMode] = useState<'employee' | 'scope'>('employee');
  const [employeeId, setEmployeeId] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const current = hrEmployeesList.filter(e => CURRENT_STATUSES.includes(String(e.employment_status ?? 'active')));
  const employee = byId(current, employeeId);
  const branches = companyId ? hrRuleBranchChoices(catalog, 'company_branch', companyId) : [];
  const probe = mode === 'employee' ? (employee ?? null) : companyId && branchId ? { company_id: companyId, branch_id: branchId } : null;
  const result = probe ? resolveEmployeeHrResponsibility({ employee: probe, catalog, roster }) : null;
  const fact = (label: string, value: ReactNode) => <p><span className="hr-source-label">{label}</span><b>{value}</b></p>;
  return <section className="hr-tester" aria-label={rtl ? 'اختبار مسؤولية الموارد البشرية' : 'Test HR Responsibility'}>
    <h3 className="settings-section-title">{rtl ? 'اختبار مسؤولية الموارد البشرية' : 'Test HR Responsibility'}</h3>
    <div className="hr-tester-fields">
      <SelectField label={rtl ? 'طريقة الاختبار' : 'Test by'} value={mode} onChange={value => setMode(value as 'employee' | 'scope')}
        options={[{ value: 'employee', label: rtl ? 'موظف' : 'Employee' }, { value: 'scope', label: rtl ? 'الشركة + الفرع' : 'Company + Branch' }]} />
      {mode === 'employee'
        ? <SelectField label={rtl ? 'الموظف' : 'Employee'} value={employeeId} placeholder={rtl ? 'اختر موظفًا' : 'Select employee'} onChange={setEmployeeId}
            options={current.map(e => ({ value: String(e.id), label: `${nameOf(e, rtl)}${e.employee_code ? ` (${e.employee_code})` : ''}` }))} />
        : <>
          <SelectField label={rtl ? 'الشركة' : 'Company'} value={companyId} placeholder={rtl ? 'اختر الشركة' : 'Select company'} options={optionsFor(catalog.companies, rtl)} onChange={value => { setCompanyId(value); setBranchId(''); }} />
          <SelectField label={rtl ? 'الفرع' : 'Branch'} value={branchId} placeholder={rtl ? 'اختر الفرع' : 'Select branch'} disabled={!companyId} options={optionsFor(branches, rtl)} onChange={setBranchId}
            hint={companyId && !branches.length ? (rtl ? 'هذه الشركة غير مرتبطة بفروع.' : 'This company has no branches yet.') : undefined} />
        </>}
    </div>
    {result && <div className={`hr-tester-result${result.available ? '' : ' warn'}`} role="status">
      {mode === 'employee' && employee && <>
        {fact(rtl ? 'الشركة' : 'Company', nameOf(byId(catalog.companies, employee.company_id), rtl, rtl ? 'غير محددة' : 'Not set'))}
        {fact(rtl ? 'الفرع' : 'Branch', nameOf(byId(catalog.branches, employee.branch_id), rtl, rtl ? 'غير محدد' : 'Not set'))}
        {fact(rtl ? 'استثناء مسؤول الموارد البشرية' : 'Explicit HR Override', result.overrideUserId ? hrLabel(result.hr, rtl) : (rtl ? 'بدون' : 'None'))}
      </>}
      {fact(rtl ? 'مسؤول الموارد البشرية الفعلي' : 'Resolved HR Responsible', result.hrUserId ? hrLabel(result.hr, rtl) : (rtl ? 'يحتاج إعداد الموارد البشرية' : 'Needs HR Setup'))}
      {fact(rtl ? 'مصدر التحديد' : 'Resolution Source', hrSourceText(result, catalog, rtl))}
      {result.rule && fact(rtl ? 'القاعدة المطابقة' : 'Rule matched', `#${formatCount(Number(result.rule.id), rtl)} · ${pick(HR_RULE_TYPE_LABEL[hrRuleType(result.rule)], rtl)}`)}
      {!['override', 'rule'].includes(result.reason) && <InfoNotice tone="warn">{hrReasonText(result.reason, rtl)}</InfoNotice>}
      <p className="settings-muted">{rtl ? 'الاختبار للعرض فقط ولا يحفظ أي شيء.' : 'The tester only reads; nothing is saved.'}</p>
    </div>}
  </section>;
}

/* ------------------------------------------------------------------ rules */

export function HrImpactPanel({ rtl, preview, hrName }: { rtl: boolean; preview: ImpactPreview | null; hrName: (userId: unknown) => string }) {
  if (!preview) return null;
  const impact = (preview.impact?.hr ?? null) as HrRuleImpact | null;
  const names = (people: Row[]) => people.slice(0, 8).map(p => nameOf(p, rtl)).join(rtl ? '، ' : ', ') + (people.length > 8 ? (rtl ? ` و${formatCount(people.length - 8, rtl)} آخرين` : ` and ${people.length - 8} more`) : '');
  const line = (label: string, people: Row[]) => <li><span>{label}: <b>{formatCount(people.length, rtl)}</b></span>{people.length > 0 && <small>{names(people)}</small>}</li>;
  return <section className="org-impact" aria-live="polite" aria-label={rtl ? 'أثر التغيير' : 'Impact of this change'}>
    <h3>{rtl ? 'أثر التغيير قبل الحفظ' : 'Impact before saving'}</h3>
    {preview.blocking.length > 0 && <div className="settings-error" role="alert"><div><b>{rtl ? 'لا يمكن الحفظ:' : 'Cannot save:'}</b><ul>{preview.blocking.map((issue, index) => <li key={index}>{issueText(issue, rtl)}</li>)}</ul></div></div>}
    {impact && <ul className="hr-impact-list">
      <li><span>{rtl ? 'موظفون يمرّون عبر هذه القاعدة (قبل أو بعد)' : 'Employees resolving through this rule (before or after)'}: <b>{formatCount(impact.affected, rtl)}</b></span></li>
      {line(rtl ? `سيصبح مسؤولهم ${hrName(impact.after.hrUserId)}` : `Will resolve to ${hrName(impact.after.hrUserId)}`, impact.toThisRule)}
      {line(rtl ? 'ينتقلون إلى قاعدة أخرى' : 'Switch to another rule', impact.toOtherRule)}
      {line(rtl ? 'يصبحون «يحتاج إعداد الموارد البشرية»' : 'Become “Needs HR Setup”', impact.toNone)}
      {line(rtl ? 'لديهم استثناء ولن يتغيروا' : 'Have employee overrides and are unchanged', impact.overridesUnchanged)}
    </ul>}
    {preview.ok && <p className="settings-muted">{rtl ? 'لا تُعدَّل سجلات الموظفين؛ يتغير المسؤول المشتق فقط. اضغط «تأكيد وحفظ» للمتابعة.' : 'Employee records are not changed; only the derived HR Responsible changes. Press “Confirm and save” to continue.'}</p>}
  </section>;
}

export function RulesTab() {
  const { rtl, access, catalog, roster, usable, summary, saveEntity, previewEntity } = useHrData();
  const drawer = useDrawerForm();
  const review = useImpactReview();
  const [toggleError, setToggleError] = useState('');
  const fmt = (value: number) => formatCount(value, rtl);
  const sorted = sortHrRules(catalog.hrRules, catalog, rtl);
  const hrOf = (userId: unknown) => roster.find(hr => Number(hr.user_id) === Number(userId));
  const list = useMasterFilter(sorted, row => `${nameOf(byId(catalog.branches, row.branch_id), rtl)} ${nameOf(byId(catalog.companies, row.company_id), rtl, '')} ${hrLabel(hrOf(row.hr_user_id), rtl)}`);
  const form = drawer.form;
  const type = (form?.rule_type ?? 'company_branch') as HrRuleType;
  const record = (row: Row): Row => ({ id: row.id || undefined, rule_type: row.rule_type, company_id: row.rule_type === 'branch_fallback' ? null : row.company_id || null, branch_id: row.branch_id || null, hr_user_id: row.hr_user_id || null, status: row.status });
  const preview = review.current(form ? record(form) : null);
  const branchChoices = form ? hrRuleBranchChoices(catalog, type, form.company_id) : [];
  const branchOptions = [...branchChoices, ...(form?.branch_id && !branchChoices.some(b => Number(b.id) === Number(form.branch_id)) ? [{ ...(byId(catalog.branches, form.branch_id) ?? { id: form.branch_id }), status: 'inactive' }] : [])];
  const hrOptions = roster.filter(hr => hrUsableFor(hr) || Number(hr.user_id) === Number(form?.hr_user_id))
    .map(hr => ({ value: String(hr.user_id), label: hrLabel(hr, rtl) + (hrUsableFor(hr) ? '' : (rtl ? ' (غير متاح)' : ' (unavailable)')), disabled: !hrUsableFor(hr) }));
  const draftIssues = form ? hrRuleIssues(catalog, roster, record(form)).filter(issue => issue.code === 'HR_RULE_DUPLICATE') : [];
  const commit = (row: Row) => review.run(record(row), () => previewEntity('hrRules', record(row)), token => saveEntity('hrRules', { ...record(row), confirmImpact: token }));
  const open = (row?: Row) => { review.reset(); drawer.open(row ? { ...row, rule_type: hrRuleType(row) } : { rule_type: 'company_branch', status: 'active' }); };
  const save = () => drawer.submit(() => commit(form!));
  // Activate/deactivate from the table opens the drawer with the new status and the server's impact preview.
  const toggle = async (row: Row) => {
    setToggleError('');
    const next = { ...row, rule_type: hrRuleType(row), status: isActive(row) ? 'inactive' : 'active' };
    review.reset(); drawer.open(next);
    try { await commit(next); drawer.close(); } catch (reason) { if (!(reason instanceof ReviewPending)) setToggleError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const hrName = (userId: unknown) => nameOf(hrOf(userId), rtl, rtl ? 'لا أحد' : 'nobody');
  const canAdd = access.canManage && usable.length > 0;
  return <>
    {toggleError && <p className="settings-error" role="alert">{toggleError}</p>}
    {!catalog.hrRules.length
      ? <div className="settings-empty hr-empty">
        <h4>{rtl ? 'لم تُضبط أي قواعد لمسؤولية الموارد البشرية بعد.' : 'No HR responsibility rules configured yet.'}</h4>
        <p>{rtl ? 'أضف قاعدة «الشركة + الفرع» لتعيين مسؤول الموارد البشرية للموظفين تلقائيًا.' : 'Add a Company + Branch rule to automatically assign an HR Responsible to employees.'}</p>
        {canAdd && <AddButton label={rtl ? 'إضافة قاعدة مسؤولية موارد بشرية' : 'Add HR Responsibility Rule'} onClick={() => open()} />}
        {access.canManage && !usable.length && <p className="settings-muted">{pick(NO_ELIGIBLE, rtl)}</p>}
      </div>
      : <>
        <MasterDataToolbar rtl={rtl} query={list.query} onQuery={list.setQuery} status={list.status} onStatus={list.setStatus} count={list.shown.length}>
          {canAdd && <AddButton label={rtl ? 'إضافة قاعدة مسؤولية موارد بشرية' : 'Add HR Responsibility Rule'} onClick={() => open()} />}
        </MasterDataToolbar>
        <MasterDataTable caption={rtl ? 'قواعد مسؤولية الموارد البشرية' : 'HR responsibility rules'} rows={list.shown} rowKey={row => row.id} actionsLabel={rtl ? 'الإجراءات' : 'Actions'}
          emptyTitle={rtl ? 'لا توجد نتائج' : 'No matching rules'}
          columns={[
            { key: 'company', header: rtl ? 'الشركة' : 'Company', render: row => row.company_id ? nameOf(byId(catalog.companies, row.company_id), rtl) : <span className="settings-chip">{rtl ? 'أي شركة' : 'Any company'}</span> },
            { key: 'branch', header: rtl ? 'الفرع' : 'Branch', render: row => nameOf(byId(catalog.branches, row.branch_id), rtl) },
            { key: 'hr', header: rtl ? 'مسؤول الموارد البشرية' : 'HR Responsible', render: row => { const hr = hrOf(row.hr_user_id); return <span className="settings-name"><b>{nameOf(hr, rtl)}</b><small>{hr?.email}</small>{isActive(row) && !hrUsableFor(hr) && <span className="settings-chip warn">{rtl ? 'غير متاح' : 'Unavailable'}</span>}</span>; } },
            { key: 'type', header: rtl ? 'نوع القاعدة' : 'Rule Type', render: row => <span className="hr-rank-cell"><b className="hr-rank">{fmt(hrRuleType(row) === 'company_branch' ? 2 : 3)}</b>{pick(HR_RULE_TYPE_LABEL[hrRuleType(row)], rtl)}</span> },
            { key: 'affected', header: rtl ? 'الموظفون المتأثرون' : 'Employees Affected', className: 'num', render: row => isActive(row) ? fmt(summary.perRule[String(row.id)] ?? 0) : <span className="settings-sub">—</span> },
            { key: 'status', header: rtl ? 'الحالة' : 'Status', render: row => <StatusBadge rtl={rtl} active={isActive(row)} /> },
          ]}
          actions={row => <>
            <OpenButton rtl={rtl} canManage={access.canManage} name={nameOf(byId(catalog.branches, row.branch_id), rtl)} onClick={() => open(row)} />
            {access.canManage && <button type="button" className="outline" onClick={() => void toggle(row)}>{isActive(row) ? (rtl ? 'إلغاء التفعيل' : 'Deactivate') : (rtl ? 'تفعيل' : 'Activate')}</button>}
          </>} />
      </>}
    {summary.needsSetup > 0 && catalog.hrRules.length > 0 && <InfoNotice tone="warn">{rtl ? `${fmt(summary.needsSetup)} موظفًا حاليًا بلا قاعدة مطابقة ولا استثناء (يحتاج إعداد الموارد البشرية).` : `${fmt(summary.needsSetup)} current employees have no matching rule and no override (Needs HR Setup).`}</InfoNotice>}
    {form && <MasterDataDrawer rtl={rtl} readOnly={!access.canManage} busy={drawer.busy} error={drawer.error} onClose={() => { review.reset(); drawer.close(); }} onSubmit={save}
      eyebrow={rtl ? 'قاعدة مسؤولية موارد بشرية' : 'HR RESPONSIBILITY RULE'} title={form.id ? `${nameOf(byId(catalog.companies, form.company_id), rtl, rtl ? 'أي شركة' : 'Any company')} + ${nameOf(byId(catalog.branches, form.branch_id), rtl)}` : (rtl ? 'قاعدة جديدة' : 'New rule')}
      submitLabel={preview?.ok ? (rtl ? 'تأكيد وحفظ' : 'Confirm and save') : undefined} submitDisabled={Boolean(preview && !preview.ok) || draftIssues.length > 0}
      review={<HrImpactPanel rtl={rtl} preview={preview} hrName={hrName} />}>
      <SelectField label={rtl ? 'نوع القاعدة' : 'Rule Type'} value={type} required onChange={value => drawer.change({ rule_type: value, company_id: value === 'branch_fallback' ? '' : form.company_id, branch_id: '' })}
        options={[{ value: 'company_branch', label: pick(HR_RULE_TYPE_LABEL.company_branch, rtl) }, { value: 'branch_fallback', label: pick(HR_RULE_TYPE_LABEL.branch_fallback, rtl) }]}
        hint={type === 'company_branch' ? (rtl ? 'تنطبق على موظفي شركة واحدة داخل فرع واحد.' : 'Applies to one company within one branch.') : (rtl ? 'تنطبق على أي شركة في الفرع لا تملك قاعدة «الشركة + الفرع».' : 'Applies to any company in the branch that has no Company + Branch rule.')} />
      {type === 'company_branch' && <SelectField label={rtl ? 'الشركة' : 'Company'} value={form.company_id} required placeholder={rtl ? 'اختر الشركة' : 'Select company'} options={optionsFor(catalog.companies, rtl, form.company_id)}
        onChange={value => drawer.change({ company_id: value, branch_id: hrRuleBranchChoices(catalog, 'company_branch', value).some(b => Number(b.id) === Number(form.branch_id)) ? form.branch_id : '' })} />}
      <SelectField label={rtl ? 'الفرع' : 'Branch'} value={form.branch_id} required disabled={type === 'company_branch' && !form.company_id} placeholder={rtl ? 'اختر الفرع' : 'Select branch'} options={optionsFor(branchOptions, rtl, form.branch_id)} onChange={value => drawer.change({ branch_id: value })}
        hint={type === 'company_branch' ? (form.company_id && !branchChoices.length ? (rtl ? 'هذه الشركة غير مرتبطة بفروع نشطة.' : 'This company has no active linked branches.') : (rtl ? 'تظهر فقط الفروع المرتبطة بالشركة.' : 'Only branches linked to the company are shown.')) : (rtl ? 'تظهر الفروع النشطة المرتبطة بشركة واحدة على الأقل.' : 'Active branches linked to at least one company.')} />
      <SelectField label={rtl ? 'مسؤول الموارد البشرية' : 'HR Responsible'} value={form.hr_user_id} required placeholder={rtl ? 'اختر مسؤولًا' : 'Select HR Responsible'} options={hrOptions} onChange={value => drawer.change({ hr_user_id: value })}
        hint={hrOptions.length ? (rtl ? 'يمكن أن يكون الشخص نفسه مسؤولًا عن عدة شركات وفروع.' : 'The same person may be responsible for several companies and branches.') : pick(NO_ELIGIBLE, rtl)} />
      <SelectField label={rtl ? 'الحالة' : 'Status'} value={form.status} onChange={value => drawer.change({ status: value })}
        options={[{ value: 'active', label: rtl ? 'نشط' : 'Active' }, { value: 'inactive', label: rtl ? 'غير نشط' : 'Inactive' }]} />
      {draftIssues.map((issue, index) => <InfoNotice key={index} tone="warn">{rtl ? issue.message_ar : issue.message_en}</InfoNotice>)}
      {form.id && !preview && <InfoNotice>{rtl ? `موظفون يمرّون حاليًا عبر هذه القاعدة: ${fmt(summary.perRule[String(form.id)] ?? 0)}. سيُعرض أثر أي تغيير قبل الحفظ.` : `Employees currently resolving through this rule: ${fmt(summary.perRule[String(form.id)] ?? 0)}. The impact of any change is shown before saving.`}</InfoNotice>}
    </MasterDataDrawer>}
  </>;
}

/* ------------------------------------------------------------------ roster */

export function RosterTab() {
  const { rtl, access, catalog, roster, hrCandidates, saveHrResponsible } = useHrData();
  const drawer = useDrawerForm();
  const [error, setError] = useState('');
  const [pending, setPending] = useState<number | null>(null);
  const list = useMasterFilter(roster, row => `${row.name_ar} ${row.name_en} ${row.email}`);
  const rulesOf = (row: Row) => catalog.hrRules.filter(rule => isActive(rule) && Number(rule.hr_user_id) === Number(row.user_id)).length;
  const candidates = hrCandidates.filter(candidate => !roster.some(hr => Number(hr.user_id) === Number(candidate.user_id) && hr.status === 'active'));
  const toggle = async (row: Row) => { setError(''); setPending(Number(row.user_id)); try { await saveHrResponsible({ action: 'save_hr_responsible', hrUserId: row.user_id, active: row.status !== 'active' }); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setPending(null); } };
  const add = () => drawer.submit(() => saveHrResponsible({ action: 'save_hr_responsible', hrUserId: drawer.form?.hrUserId }));
  const reason = (row: Row) => { const invalid = hrIneligibility({ ...row, status: 'active' }); return invalid ? (rtl ? invalid.ar : invalid.en) : ''; };
  return <>
    <InfoNotice>{rtl ? 'المؤهل: حساب نشط بدور مدير موارد بشرية أو مدير نظام ومرتبط بموظف حالي. يُضاف الحساب إلى القائمة هنا، ويُنشأ أو يُعدَّل من صفحة المستخدمين.' : 'Eligible: an active HR Manager or Super Admin account linked to a current employee. Add it to the roster here; create or change the account in Users.'}</InfoNotice>
    <MasterDataToolbar rtl={rtl} query={list.query} onQuery={list.setQuery} status={list.status} onStatus={list.setStatus} count={list.shown.length}>
      {access.canManage && <AddButton label={rtl ? 'إضافة مسؤول' : 'Add HR responsible'} onClick={() => drawer.open({ hrUserId: '' })} />}
    </MasterDataToolbar>
    {error && <p className="settings-error" role="alert">{error}</p>}
    <MasterDataTable caption={rtl ? 'قائمة المؤهلين' : 'Eligible HR roster'} rows={list.shown} rowKey={row => row.user_id} actionsLabel={rtl ? 'الإجراءات' : 'Actions'}
      emptyTitle={rtl ? 'القائمة فارغة' : 'The roster is empty'} emptyText={rtl ? 'يظهر هنا فقط من لديه حساب نشط بدور مدير موارد بشرية أو مدير نظام ومرتبط بموظف حالي. أنشئ الحساب أو اربطه من صفحة المستخدمين.' : 'Only people with an active HR Manager or Super Admin account linked to a current employee appear. Create or link the account from the Users page.'}
      columns={[
        { key: 'name', header: rtl ? 'المسؤول' : 'Person', render: row => <span className="settings-name"><b>{nameOf(row, rtl)}</b><small>{row.email}</small></span> },
        { key: 'eligible', header: rtl ? 'الأهلية' : 'Eligibility', render: row => <span className="settings-name"><StatusBadge rtl={rtl} active={hrEligible(row)} tone={hrEligible(row) ? 'green' : 'orange'} label={hrEligible(row) ? (rtl ? 'مؤهل' : 'Eligible') : (rtl ? 'غير متاح' : 'Unavailable')} />{!hrEligible(row) && reason(row) && <small>{reason(row)}</small>}</span> },
        { key: 'status', header: rtl ? 'الحالة' : 'Status', render: row => <StatusBadge rtl={rtl} active={row.status === 'active'} /> },
        { key: 'rules', header: rtl ? 'قواعد نشطة' : 'Active rules', render: row => formatCount(rulesOf(row), rtl) },
      ]}
      actions={access.canManage ? (row => <>
        <button type="button" className="outline" disabled={pending === Number(row.user_id) || (row.status === 'active' && rulesOf(row) > 0) || (row.status !== 'active' && !hrEligible(row))} onClick={() => void toggle(row)}>
          {row.status === 'active' ? (rtl ? 'تعطيل' : 'Deactivate') : (rtl ? 'تفعيل' : 'Activate')}</button></>) : undefined} />
    {drawer.form && <MasterDataDrawer rtl={rtl} busy={drawer.busy} error={drawer.error} onClose={drawer.close} onSubmit={add} eyebrow={rtl ? 'مسؤول موارد بشرية' : 'HR RESPONSIBLE'} title={rtl ? 'إضافة مسؤول' : 'Add HR responsible'} submitLabel={rtl ? 'إضافة' : 'Add'}>
      <SelectField label={rtl ? 'الموظف' : 'Employee'} value={drawer.form.hrUserId} required placeholder={rtl ? 'اختر موظفًا' : 'Select an employee'} onChange={value => drawer.change({ hrUserId: value })}
        options={candidates.map(candidate => ({ value: String(candidate.user_id), label: hrLabel(candidate, rtl) }))}
        hint={candidates.length ? undefined : pick(NO_ELIGIBLE, rtl)} />
    </MasterDataDrawer>}
  </>;
}
