"use client";
import { useEffect, useState, type ReactNode } from 'react';
import { CalendarClock, FileText, HeartPulse, Scale, UserCog, GitBranch, Fingerprint } from 'lucide-react';
import { BiometricSettingsSection, useBiometricSetup } from './biometric-settings-section';
import { InfoNotice, SettingsSubnav, StatusBadge } from './settings/settings-ui';
import { useHrSettings } from './settings/hr/shared';
import { DocumentTypesSection } from './settings/hr/document-types';
import { DeductionRulesSection } from './settings/hr/deduction-rules';
import { MedicalPlansSection } from './settings/hr/medical-plans';
import { AttendanceTypesSection } from './settings/hr/attendance-types';

/** HR policies and responsibility assignments keep their existing data sources and permissions. */
const SECTIONS = [
  { id: 'documents', ar: 'أنواع المستندات', en: 'Document Types', descriptionAr: 'أنواع المستندات التي يرفعها الموظفون وما إذا كانت إلزامية.', descriptionEn: 'The document types employees upload and whether each one is mandatory.', icon: <FileText size={16} aria-hidden="true" /> },
  { id: 'deductions', ar: 'قواعد الخصم والعمل الإضافي', en: 'Deduction & Overtime Rules', descriptionAr: 'خصومات الغياب والتأخير ومعاملات العمل الإضافي حسب نطاق الدقائق.', descriptionEn: 'Absence and late-arrival deductions and overtime multipliers by minute range.', icon: <Scale size={16} aria-hidden="true" /> },
  { id: 'medical', ar: 'خطط التأمين الطبي', en: 'Medical Insurance Plans', descriptionAr: 'خطط التأمين الطبي وشركات التأمين ونسب مساهمة الموظف والشركة.', descriptionEn: 'Medical insurance plans, providers and the employee and company contribution split.', icon: <HeartPulse size={16} aria-hidden="true" /> },
  { id: 'attendance', ar: 'أنواع الحضور', en: 'Attendance Types', descriptionAr: 'أنواع الدوام والورديات وأوقاتها وسماحية التأخير.', descriptionEn: 'Work and shift types, their hours and late allowance.', icon: <CalendarClock size={16} aria-hidden="true" /> },
  { id: 'responsibility', ar: 'مسؤولو الموارد البشرية', en: 'HR Responsibles', descriptionAr: 'مسؤولو الموارد البشرية حسب الشركة والفرع.', descriptionEn: 'HR responsibles by company and branch.', icon: <UserCog size={16} aria-hidden="true" /> },
  { id: 'approval-workflows', ar: 'إدارة مسارات الاعتماد', en: 'Approval workflows', descriptionAr: 'تحديد الموافقين وترتيبهم لكل نوع طلب في كل شركة أو قسم.', descriptionEn: 'Configure approvers and their order for each request type, by company or department.', icon: <GitBranch size={16} aria-hidden="true" /> },
  { id: 'biometric', ar: 'أجهزة البصمة', en: 'Biometric Devices', descriptionAr: 'إضافة أجهزة البصمة وربطها برابط المكتب. تُسحب البصمات تلقائيًا.', descriptionEn: 'Add biometric devices and link them to the office connector. Punches are pulled automatically.', icon: <Fingerprint size={16} aria-hidden="true" /> },
] as const;
type SectionId = typeof SECTIONS[number]['id'];

export function HrSettings({ rtl, notify, hrResponsibility, approvalWorkflows }: { rtl: boolean; notify: (message: string) => void; hrResponsibility?: ReactNode; approvalWorkflows?: ReactNode }) {
  const { data, status, reload, save, remove } = useHrSettings(rtl, notify);
  const [section, setSection] = useState<SectionId>('documents');
  useEffect(() => {
    const timer = window.setTimeout(() => { try { const saved = window.localStorage.getItem('hr.settingsSection'); if (saved && SECTIONS.some(item => item.id === saved)) setSection(saved as SectionId); } catch { /* storage unavailable */ } }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const chooseSection = (id: SectionId) => { setSection(id); try { window.localStorage.setItem('hr.settingsSection', id); } catch { /* storage unavailable */ } };
  const biometric = useBiometricSetup();
  const sections = SECTIONS.filter(item => (item.id !== 'responsibility' || hrResponsibility) && (item.id !== 'approval-workflows' || approvalWorkflows) && (item.id !== 'biometric' || biometric.data?.canManageDevices));
  const selected = sections.find(item => item.id === section) ?? sections[0];
  const activeSection = selected.id;
  const count = (id: SectionId) => data && id !== 'responsibility' && id !== 'approval-workflows' && id !== 'biometric' ? { documents: data.documentTypes, deductions: data.deductionRules, medical: data.medicalPlans, attendance: data.attendanceTypes }[id].length : undefined;
  const props = data ? { rtl, data, save, remove } : null;
  return <section className="panel settings-panel" dir={rtl ? 'rtl' : 'ltr'} aria-labelledby="hr-settings-title">
    <div className="org-settings-intro">
      <header className="settings-panel-head">
        <div>
          <h2 id="hr-settings-title">{rtl ? 'إعدادات الموارد البشرية' : 'HR Settings'}</h2>
          <p>{rtl ? 'إدارة أنواع المستندات وقواعد الخصم والتأمين الطبي وأنواع الحضور.' : 'Manage document types, deduction rules, medical insurance and attendance types.'}</p>
        </div>
        {activeSection !== 'responsibility' && activeSection !== 'approval-workflows' && activeSection !== 'biometric' && data && !data.canManage && <StatusBadge rtl={rtl} tone="gray" label={rtl ? 'عرض فقط' : 'View only'} />}
      </header>
      <SettingsSubnav level="primary" rtl={rtl} label={rtl ? 'أقسام إعدادات الموارد البشرية' : 'HR settings sections'} active={activeSection} onChange={id => chooseSection(id as SectionId)}
        items={sections.map(item => ({ id: item.id, label: rtl ? item.ar : item.en, icon: item.icon, count: count(item.id) }))} />
      <p className="org-settings-context" aria-live="polite" aria-atomic="true">{rtl ? selected.descriptionAr : selected.descriptionEn}</p>
    </div>
    {activeSection === 'responsibility' ? hrResponsibility : activeSection === 'approval-workflows' ? approvalWorkflows : activeSection === 'biometric' ? <BiometricSettingsSection rtl={rtl} notify={notify} {...biometric} /> : <>
    {status === 'loading' && <p className="settings-muted" role="status">{rtl ? 'جارٍ تحميل الإعدادات...' : 'Loading settings...'}</p>}
    {status === 'error' && <InfoNotice tone="warn">{rtl ? 'تعذر تحميل إعدادات الموارد البشرية. تحقق من الاتصال وحاول مرة أخرى.' : 'Unable to load the HR settings. Check your connection and try again.'} <button type="button" className="outline" onClick={() => void reload()}>{rtl ? 'إعادة المحاولة' : 'Retry'}</button></InfoNotice>}
    {status === 'forbidden' && <InfoNotice tone="warn">{rtl ? 'ليست لديك صلاحية عرض إعدادات الموارد البشرية.' : 'You do not have permission to view HR settings.'}</InfoNotice>}
    {props && <>
      {activeSection === 'documents' && <DocumentTypesSection {...props} />}
      {activeSection === 'deductions' && <DeductionRulesSection {...props} />}
      {activeSection === 'medical' && <MedicalPlansSection {...props} />}
      {activeSection === 'attendance' && <AttendanceTypesSection {...props} />}
    </>}
    </>}
  </section>;
}
