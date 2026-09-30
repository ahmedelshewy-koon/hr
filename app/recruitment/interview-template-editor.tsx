"use client";
import { useState, type ReactNode } from "react";
import { useRecruitmentDialog } from "./use-recruitment-dialog";
import type { Row } from "../ui-types";
import { localizedDisplayValue } from "../localization";

const blankStage = (): Row => ({ nameEn: "", nameAr: "", durationMinutes: 45, aggregationWeight: 100, passingGuidance: "", requiredFeedback: true, independentEvaluations: true, interviewers: [{ roleKey: "recruiter", required: true }], questionIds: [], criteria: [{ nameEn: "", nameAr: "", weight: 100, required: true }] });
export function InterviewTemplateEditor({ rtl, data, template, run, close }: { rtl: boolean; data: Row; template: Row; run: (payload: Row) => Promise<Row>; close: () => void }) {
  const t = (en: string, ar: string) => rtl ? ar : en;
  const [form, setForm] = useState<Row>(() => ({
    name: template.name || "", scopeType: template.scope_type || "company", departmentId: template.department_id || "", jobId: template.job_id || "", jobFamily: template.job_family || "", description: template.description || "", status: template.status || "active",
    stages: template.id ? (data.templateStages || []).filter((s: Row) => s.template_id === template.id).map((s: Row) => ({
      stageKey: s.stage_key, nameEn: s.name_en, nameAr: s.name_ar, durationMinutes: s.duration_minutes, aggregationWeight: s.aggregation_weight, passingGuidance: s.passing_guidance || "", requiredFeedback: !!s.required_feedback, independentEvaluations: !!s.independent_evaluations,
      interviewers: (data.templateInterviewers || []).filter((x: Row) => x.template_stage_id === s.id).map((x: Row) => ({ roleKey: x.employee_id ? "" : x.role_key, employeeId: x.employee_id || "", required: !!x.required })),
      questionIds: (data.templateQuestions || []).filter((x: Row) => x.template_stage_id === s.id).map((x: Row) => x.question_id),
      criteria: (data.templateCriteria || []).filter((x: Row) => x.template_stage_id === s.id).map((x: Row) => ({ nameEn: x.name_en, nameAr: x.name_ar, description: x.description || "", weight: x.weight, required: !!x.required })),
    })) : [blankStage()],
  }));
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const dialogRef = useRecruitmentDialog(() => { if (!saving) close(); });
  const field = (label: string, child: ReactNode, wide = false) => <label className={wide ? "ats-field wide" : "ats-field"}><span>{label}</span>{child}</label>;
  const set = (key: string, value: unknown) => setForm({ ...form, [key]: value });
  const stageSet = (index: number, key: string, value: unknown) => set("stages", form.stages.map((s: Row, i: number) => i === index ? { ...s, [key]: value } : s));
  const move = (index: number, delta: number) => { const stages = [...form.stages]; [stages[index], stages[index + delta]] = [stages[index + delta], stages[index]]; set("stages", stages); };
  const save = async () => {
    setError("");
    const total = (rows: Row[], key: string) => rows.reduce((sum, row) => sum + Number(row[key]), 0);
    if (!form.stages.length || Math.abs(total(form.stages, "aggregationWeight") - 100) > .001 || form.stages.some((s: Row) => !s.criteria.length || Math.abs(total(s.criteria, "weight") - 100) > .001)) {
      setError(t("Stage weights and each scorecard must total 100%.", "مجموع أوزان المراحل، ومعايير كل مرحلة، لازم يكون ١٠٠٪.")); return;
    }
    setSaving(true);
    try { await run({ ...form, templateId: template.id, action: template.id ? "update_template" : "create_template" }); close(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  return <div className="ats-modal-layer" dir={rtl ? "rtl" : "ltr"}>
    <button className="ats-modal-scrim" onClick={() => !saving && close()} aria-label={t("Close", "إغلاق")} />
    <aside ref={dialogRef} tabIndex={-1} className="ats-drawer ats-template-editor" role="dialog" aria-modal="true" aria-label={t("Edit interview template", "تعديل قالب المقابلات")}>
      <header><h2>{template.id ? t("Edit interview template", "تعديل قالب المقابلات") : t("New interview template", "قالب مقابلات جديد")}</h2><button className="outline" disabled={saving} onClick={close}>{t("Cancel", "إلغاء")}</button></header>
      <form onSubmit={e => { e.preventDefault(); void save(); }} className="ats-template-edit-form">
      <fieldset disabled={saving}>
      <p>{t("Changes apply to future jobs. Existing interview plans keep their saved settings.", "التعديلات تُستخدم للوظائف الجديدة. خطط مقابلات الوظائف الحالية تحتفظ بإعداداتها المحفوظة.")}</p>
      <div className="ats-form-grid">
        {field(t("Name", "اسم القالب"), <input required value={form.name} onChange={e => set("name", e.target.value)} />)}
        {field(t("Status", "الحالة"), <select value={form.status} onChange={e => set("status", e.target.value)}><option value="active">{t("Active", "نشط")}</option><option value="inactive">{t("Inactive", "غير نشط")}</option></select>)}
        {field(t("Scope", "النطاق"), <select value={form.scopeType} onChange={e => set("scopeType", e.target.value)}>{["company", "department", "job_family", "job"].map(x => <option key={x} value={x}>{localizedDisplayValue(x, rtl)}</option>)}</select>)}
        {form.scopeType === "department" && field(t("Department", "القسم"), <select required value={form.departmentId} onChange={e => set("departmentId", e.target.value)}><option value="">—</option>{data.departments?.map((x: Row) => <option key={x.id} value={x.id}>{rtl ? x.name_ar || x.name_en : x.name_en}</option>)}</select>)}
        {form.scopeType === "job" && field(t("Job", "الوظيفة"), <select required value={form.jobId} onChange={e => set("jobId", e.target.value)}><option value="">—</option>{data.jobs?.map((x: Row) => <option key={x.id} value={x.id}>{x.title}</option>)}</select>)}
        {form.scopeType === "job_family" && field(t("Job family", "العائلة الوظيفية"), <input required value={form.jobFamily} onChange={e => set("jobFamily", e.target.value)} />)}
        {field(t("Description", "وصف القالب"), <textarea value={form.description} onChange={e => set("description", e.target.value)} />, true)}
      </div>
      {form.stages.map((s: Row, index: number) => <section className="ats-template-stage-editor" key={index}>
        <header><h3>{t("Stage", "المرحلة")} {index + 1}</h3><div className="ats-editor-actions"><button type="button" className="outline" disabled={!index} onClick={() => move(index, -1)}>{t("Move up", "نقل لأعلى")}</button><button type="button" className="outline" disabled={index === form.stages.length - 1} onClick={() => move(index, 1)}>{t("Move down", "نقل لأسفل")}</button><button type="button" className="outline" onClick={() => set("stages", form.stages.filter((_: Row, i: number) => i !== index))}>{t("Remove stage", "حذف المرحلة")}</button></div></header>
        <div className="ats-form-grid">
          {field(t("Arabic name", "اسم المرحلة بالعربية"), <input required value={s.nameAr} onChange={e => stageSet(index, "nameAr", e.target.value)} />)}
          {field(t("English name", "اسم المرحلة بالإنجليزية"), <input required value={s.nameEn} onChange={e => stageSet(index, "nameEn", e.target.value)} />)}
          {field(t("Duration (minutes)", "المدة بالدقائق"), <input required type="number" min="15" value={s.durationMinutes} onChange={e => stageSet(index, "durationMinutes", Number(e.target.value))} />)}
          {field(t("Interview score weight %", "نسبة المرحلة من تقييم المقابلات %"), <input required type="number" min="0.01" max="100" step="any" value={s.aggregationWeight} onChange={e => stageSet(index, "aggregationWeight", Number(e.target.value))} />)}
          {field(t("Guidance", "إرشادات المرحلة"), <textarea value={s.passingGuidance} onChange={e => stageSet(index, "passingGuidance", e.target.value)} />, true)}
        </div>
        <div className="ats-stage-toggles">
          <label><input type="checkbox" checked={s.requiredFeedback} onChange={e => stageSet(index, "requiredFeedback", e.target.checked)} /> {t("Feedback required", "الملاحظات مطلوبة")}</label>
          <label><input type="checkbox" checked={s.independentEvaluations} onChange={e => stageSet(index, "independentEvaluations", e.target.checked)} /> {t("Independent evaluations", "تقييمات مستقلة")}</label>
        </div>
        <div className="ats-stage-subsection">
        <h4>{t("Interviewers", "المحاورون")}</h4>
        {s.interviewers.map((x: Row, i: number) => <div className="ats-template-assignment" key={i}>
          {field(t("Role or employee", "دور المحاور أو الموظف"), <select required value={x.employeeId ? `employee:${x.employeeId}` : x.roleKey || ""} onChange={e => { const v = e.target.value; stageSet(index, "interviewers", s.interviewers.map((r: Row, j: number) => j === i ? { ...r, roleKey: v.startsWith("employee:") ? "" : v, employeeId: v.startsWith("employee:") ? Number(v.slice(9)) : null } : r)); }}><option value="">—</option>{[["recruiter", "أخصائي التوظيف"], ["hiring_manager", "مدير التوظيف"], ["department_manager", "مدير القسم"]].map(([v, ar]) => <option value={v} key={v}>{rtl ? ar : v.replaceAll("_", " ")}</option>)}{data.employees?.map((e: Row) => <option key={e.id} value={`employee:${e.id}`}>{rtl ? e.name_ar || e.name_en : e.name_en}</option>)}</select>)}
          <label><input type="checkbox" checked={x.required} onChange={e => stageSet(index, "interviewers", s.interviewers.map((r: Row, j: number) => j === i ? { ...r, required: e.target.checked } : r))} />{t("Required", "إلزامي")}</label>
          <button type="button" className="outline" onClick={() => stageSet(index, "interviewers", s.interviewers.filter((_: Row, j: number) => j !== i))}>{t("Remove", "حذف")}</button>
        </div>)}
        <button type="button" className="outline" onClick={() => stageSet(index, "interviewers", [...s.interviewers, { roleKey: "recruiter", required: true }])}>{t("Add interviewer", "إضافة محاور")}</button>
        </div>
        <div className="ats-stage-subsection">
        <h4>{t("Questions", "الأسئلة")}</h4>
        <div className="ats-check-list">{data.questions?.filter((q: Row) => q.status === "active" || s.questionIds.includes(q.id)).map((q: Row) => <label key={q.id}><input type="checkbox" checked={s.questionIds.includes(q.id)} onChange={e => stageSet(index, "questionIds", e.target.checked ? [...s.questionIds, q.id] : s.questionIds.filter((id: number) => id !== q.id))} /> {q.question}</label>)}</div>
        </div>
        <div className="ats-stage-subsection">
        <h4>{t("Scorecard criteria", "معايير بطاقة التقييم")}</h4>
        {s.criteria.map((c: Row, i: number) => { const change = (key: string, value: unknown) => stageSet(index, "criteria", s.criteria.map((r: Row, j: number) => j === i ? { ...r, [key]: value } : r)); return <div className="ats-template-criterion" key={i}><div className="ats-form-grid">
          {field(t("Arabic name", "اسم المعيار بالعربية"), <input required value={c.nameAr} onChange={e => change("nameAr", e.target.value)} />)}
          {field(t("English name", "اسم المعيار بالإنجليزية"), <input required value={c.nameEn} onChange={e => change("nameEn", e.target.value)} />)}
          {field(t("Weight %", "وزن المعيار %"), <input required type="number" min="0.01" max="100" step="any" value={c.weight} onChange={e => change("weight", Number(e.target.value))} />)}
          {field(t("Guidance", "إرشادات المعيار"), <textarea value={c.description || ""} onChange={e => change("description", e.target.value)} />, true)}
        </div><div className="ats-criterion-actions"><label><input type="checkbox" checked={c.required} onChange={e => change("required", e.target.checked)} /> {t("Required", "إلزامي")}</label><button type="button" className="outline" onClick={() => stageSet(index, "criteria", s.criteria.filter((_: Row, j: number) => j !== i))}>{t("Remove criterion", "حذف المعيار")}</button></div></div>; })}
        <button type="button" className="outline" onClick={() => stageSet(index, "criteria", [...s.criteria, { nameEn: "", nameAr: "", weight: 0, required: true }])}>{t("Add criterion", "إضافة معيار")}</button>
        </div>
      </section>)}
      <button type="button" className="outline" onClick={() => set("stages", [...form.stages, { ...blankStage(), aggregationWeight: 0 }])}>{t("Add stage", "إضافة مرحلة")}</button>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="ats-editor-actions"><button className="primary" disabled={saving}>{saving ? t("Saving…", "جارٍ الحفظ…") : t("Save template", "حفظ القالب")}</button></div>
      </fieldset></form>
    </aside>
  </div>;
}
