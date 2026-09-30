"use client";
import { useCallback, useMemo, useState } from 'react';
import { Building2, BriefcaseBusiness, MapPin, Network, UserCog } from 'lucide-react';
import { localizeApiMessage } from './api-messages';
import type { Row } from './ui-types';
import { bilingualMessage, type OrganizationAccess } from './organization/settings-model.ts';
import { InfoNotice, SettingsSubnav, StatusBadge } from './settings/settings-ui';
import { consumeOrganizationSection, useOrganizationSnapshot } from './settings/use-organization-snapshot';
import { OrganizationSettingsContext, type OrganizationSettingsValue } from './settings/organization/context';
import { issueText, type ImpactPreview } from './settings/organization/impact-review';
import type { OrganizationIssue } from './organization/org-errors';
import { CompaniesAndBranches } from './settings/organization/companies-branches';
import { DepartmentsSection } from './settings/organization/departments';
import { PositionsSection } from './settings/organization/positions';
import { WorkLocationsSection } from './settings/organization/work-locations';
import { SimpleHrResponsibility } from './settings/organization/simple-hr-responsibility';

/**
 * Settings → Organizational Structure. Settings hold the controlled master data, the Employee Profile stores each
 * employee's actual assignment, and the organization chart is derived from those assignments and manager lines.
 */
const SECTIONS = [
  { id: 'companies', ar: 'الشركات والفروع', en: 'Companies & Branches', descriptionAr: 'إدارة الشركات وربطها بالفروع المتاحة داخل النظام.', descriptionEn: 'Manage companies and connect them to the branches available in the system.', icon: <Building2 size={16} aria-hidden="true" /> },
  { id: 'departments', ar: 'الإدارات', en: 'Departments', descriptionAr: 'إدارة الإدارات والأقسام الفرعية وربطها بالشركات.', descriptionEn: 'Manage departments and sections and link them to companies.', icon: <Network size={16} aria-hidden="true" /> },
  { id: 'positions', ar: 'الوظائف', en: 'Positions', descriptionAr: 'إدارة الوظائف المستخدمة في تعيينات الموظفين.', descriptionEn: 'Manage positions used in employee assignments.', icon: <BriefcaseBusiness size={16} aria-hidden="true" /> },
  { id: 'locations', ar: 'مقار العمل', en: 'Work Locations', descriptionAr: 'إدارة مقار ومواقع العمل وربطها بتعيينات الموظفين.', descriptionEn: 'Manage work locations and sites and link them to employee assignments.', icon: <MapPin size={16} aria-hidden="true" /> },
  { id: 'hr', ar: 'مسؤولية الموارد البشرية', en: 'HR Responsibility', descriptionAr: 'إدارة قواعد مسؤولية الموارد البشرية حسب الشركة والفرع.', descriptionEn: 'Manage HR responsibility rules by company and branch.', icon: <UserCog size={16} aria-hidden="true" /> },
];

type Props = {
  rtl: boolean;
  access: OrganizationAccess;
  employees: Row[];
  hrResponsibles: Row[];
  hrCandidates: Row[];
  /** Legacy job-title API; job titles stay one catalog with its own permission. */
  onSaveJobTitle: (payload: Row) => Promise<void>;
  onSaveHrResponsible: (payload: Row) => Promise<void>;
  /** Refresh the rest of the app after a master-data change. */
  onChanged: () => Promise<void> | void;
  notify: (message: string) => void;
};

/** Localized error with the exact blocking entities; keeps the structured fields for callers that need them. */
function settingsError(body: Row, status: number, rtl: boolean): Error {
  if (body instanceof Error && !(body as Row).code) return body;
  const details = (body.details ?? {}) as Row;
  const issues = (Array.isArray(details.issues) ? details.issues : []) as OrganizationIssue[];
  const main: OrganizationIssue | null = body.code ? { code: body.code, field: body.field, message_ar: body.message_ar, message_en: body.message_en, blocking_entity: body.blocking_entity, details: body.details } : null;
  const raw = String(body.error || body.message || `Request failed (${status})`);
  const text = main ? [issueText(main, rtl), ...issues.slice(1).map(issue => issueText(issue, rtl))].join(' • ') : (bilingualMessage(raw, rtl) ?? localizeApiMessage(raw, rtl));
  return Object.assign(new Error(text), main ? { code: main.code, field: main.field, issues: issues.length ? issues : [main] } : {});
}

export function OrganizationSettings({ rtl, access, employees, hrResponsibles, hrCandidates, onSaveJobTitle, onSaveHrResponsible, onChanged, notify }: Props) {
  const { snapshot, status, reload } = useOrganizationSnapshot(access.canView);
  const [section, setSection] = useState(() => consumeOrganizationSection() ?? 'companies');
  const selectedSection = SECTIONS.find(item => item.id === section) ?? SECTIONS[0];

  const post = useCallback(async (payload: Row) => {
    const response = await fetch('/api/organization', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) window.dispatchEvent(new Event('portal-session-expired'));
    if (!response.ok) throw settingsError(body, response.status, rtl);
    return body;
  }, [rtl]);
  const saveEntity = useCallback(async (entity: string, record: Row) => {
    await post({ entity, record });
    await reload();
    await onChanged();
    notify(rtl ? 'تم حفظ الإعدادات' : 'Settings saved');
  }, [post, rtl, reload, onChanged, notify]);
  const previewEntity = useCallback(async (entity: string, record: Row) => await post({ action: 'preview', entity, record }) as ImpactPreview, [post]);
  const previewJobTitle = useCallback(async (payload: Row) => await post({ action: 'preview_job_title', record: payload }) as ImpactPreview, [post]);
  const deleteEntity = useCallback(async (entity: string, id: unknown) => {
    await post({ action: 'delete', entity, record: { id } });
    await reload();
    await onChanged();
    notify(rtl ? 'تم الحذف' : 'Deleted');
  }, [post, rtl, reload, onChanged, notify]);
  const forceDeleteEntity = useCallback(async (entity: string, id: unknown) => {
    await post({ action: 'force_delete', entity, record: { id } });
    await reload();
    await onChanged();
    notify(rtl ? 'تم الحذف بالقوة' : 'Force deleted');
  }, [post, rtl, reload, onChanged, notify]);
  const saveJobTitle = useCallback(async (payload: Row) => { try { await onSaveJobTitle(payload); } catch (error) { throw settingsError(error as Row, 400, rtl); } await reload(); await onChanged(); notify(rtl ? 'تم حفظ المسمى الوظيفي' : 'Job title saved'); }, [onSaveJobTitle, reload, onChanged, notify, rtl]);
  const saveHrResponsible = useCallback(async (payload: Row) => { await onSaveHrResponsible(payload); await reload(); await onChanged(); notify(rtl ? 'تم حفظ الإعدادات' : 'Settings saved'); }, [onSaveHrResponsible, reload, onChanged, notify, rtl]);
  const saveHrAssignment = useCallback(async (companyId: string, branchId: string, employeeId: string) => {
    const result = await post({ action: 'save_hr_assignment', companyId, branchId, employeeId });
    await reload(); await onChanged(); notify(rtl ? 'تم حفظ مسؤول الموارد البشرية' : 'HR responsible saved');
    return result;
  }, [post, reload, onChanged, notify, rtl]);

  const value = useMemo<OrganizationSettingsValue | null>(() => snapshot ? {
    rtl, access, catalog: snapshot.catalog, usage: snapshot.usage, occupants: snapshot.occupants, hrScopes: snapshot.hrScopes, legacyWorkLocations: snapshot.legacyWorkLocations, hrRoster: snapshot.hrRoster, hrEmployees: snapshot.hrEmployees, unlinkedHrAccounts: snapshot.unlinkedHrAccounts,
    employees, hrResponsibles, hrCandidates, saveEntity, saveJobTitle, saveHrResponsible, saveHrAssignment, previewEntity, previewJobTitle, deleteEntity, forceDeleteEntity, goTo: setSection,
  } : null, [snapshot, rtl, access, employees, hrResponsibles, hrCandidates, saveEntity, saveJobTitle, saveHrResponsible, saveHrAssignment, previewEntity, previewJobTitle, deleteEntity, forceDeleteEntity]);

  return <section className="panel settings-panel" dir={rtl ? 'rtl' : 'ltr'} aria-labelledby="org-settings-title">
    <div className="org-settings-intro">
    <header className="settings-panel-head">
      <div>
        <h2 id="org-settings-title">{rtl ? 'الهيكل التنظيمي' : 'Organizational Structure'}</h2>
        <p>{rtl ? 'إدارة الشركات والفروع والإدارات والوظائف وربطها بملف الموظف والمخطط التنظيمي.' : 'Manage companies, branches, departments and positions, linked to employee profiles and the organizational chart.'}</p>
      </div>
      {!access.canManage && <StatusBadge rtl={rtl} tone="gray" label={rtl ? 'عرض فقط' : 'View only'} />}
    </header>
    <SettingsSubnav level="primary" rtl={rtl} label={rtl ? 'أقسام الهيكل التنظيمي' : 'Organizational structure sections'} active={section} onChange={setSection}
      items={SECTIONS.map(item => ({ id: item.id, label: rtl ? item.ar : item.en, icon: item.icon }))} />
    <p className="org-settings-context" aria-live="polite" aria-atomic="true">{rtl ? selectedSection.descriptionAr : selectedSection.descriptionEn}</p>
    </div>
    {status === 'loading' && <p className="settings-muted" role="status">{rtl ? 'جارٍ تحميل الإعدادات...' : 'Loading settings...'}</p>}
    {status === 'error' && <InfoNotice tone="warn">{rtl ? 'تعذر تحميل إعدادات الهيكل التنظيمي. تحقق من الاتصال وحاول مرة أخرى.' : 'Unable to load the organizational settings. Check your connection and try again.'} <button type="button" className="outline" onClick={() => void reload()}>{rtl ? 'إعادة المحاولة' : 'Retry'}</button></InfoNotice>}
    {status === 'unavailable' && <InfoNotice>{rtl ? 'إعداد الهيكل التنظيمي غير متاح بعد في قاعدة البيانات.' : 'Organizational structure setup is not available in this database yet.'}</InfoNotice>}
    {value && <OrganizationSettingsContext.Provider value={value}>
      {section === 'companies' && <CompaniesAndBranches />}
      {section === 'departments' && <DepartmentsSection />}
      {section === 'positions' && <PositionsSection />}
      {section === 'locations' && <WorkLocationsSection />}
      {section === 'hr' && <SimpleHrResponsibility />}
    </OrganizationSettingsContext.Provider>}
  </section>;
}
