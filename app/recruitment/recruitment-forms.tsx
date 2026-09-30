"use client";

import { useEffect, useState } from "react";
import { CalendarClock, FilePlus2, X } from "lucide-react";
import { useRecruitmentDialog } from "./use-recruitment-dialog";
import type { Row } from "../ui-types";

type Run = (payload: Row) => Promise<Row>;
const t = (rtl: boolean, en: string, ar: string) => (rtl ? ar : en);
const value = (rtl: boolean, row: Row) =>
  rtl ? row.name_ar || row.name_en || row.name : row.name_en || row.name;
const list = (value: unknown): string[] => {
  try {
    const parsed = Array.isArray(value)
      ? value
      : JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

function Drawer({
  rtl,
  title,
  subtitle,
  close,
  children,
}: {
  rtl: boolean;
  title: string;
  subtitle: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const dialogRef = useRecruitmentDialog(close);
  return (
    <div className="ats-modal-layer">
      <button
        className="ats-modal-scrim"
        onClick={close}
        aria-label={t(rtl, "Close", "إغلاق")}
      />
      <aside ref={dialogRef} className="ats-drawer" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <header>
          <div>
            <span>{t(rtl, "RECRUITMENT", "التوظيف")}</span>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button
            className="icon-btn"
            onClick={close}
            aria-label={t(rtl, "Close", "إغلاق")}
          >
            <X />
          </button>
        </header>
        {children}
      </aside>
    </div>
  );
}
const Field = ({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) => (
  <label className={`ats-field ${wide ? "wide" : ""}`}>
    <span>{label}</span>
    {children}
  </label>
);

export function JobDrawer({
  rtl,
  data,
  close,
  run,
}: {
  rtl: boolean;
  data: Row;
  close: () => void;
  run: Run;
}) {
  const [form, setForm] = useState<Row>({
      employmentType: "full_time",
      openingsCount: 1,
      status: "open",
      templateId: data.templates?.[0]?.id || "",
    }),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const save = async () => {
    try {
      setSaving(true);
      setError("");
      await run({
        action: "create_job",
        ...form,
        departmentId: Number(form.departmentId) || null,
        hiringManagerEmployeeId: Number(form.hiringManagerEmployeeId) || null,
        recruiterEmployeeId: Number(form.recruiterEmployeeId) || null,
        templateId: Number(form.templateId) || null,
        openingsCount: Number(form.openingsCount) || 1,
        requirements: [],
        screeningQuestions: [],
      });
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer
      rtl={rtl}
      title={t(rtl, "Create job", "إنشاء وظيفة")}
      subtitle={t(
        rtl,
        "Enter the basic information for the new job.",
        "أدخل المعلومات الأساسية للوظيفة الجديدة.",
      )}
      close={close}
    >
      <div className="ats-drawer-body">
        <section className="ats-form-section">
          <h3>{t(rtl, "Basic information", "المعلومات الأساسية")}</h3>
          <div className="ats-form-grid">
            <Field label={t(rtl, "Job title", "المسمى الوظيفي")} wide>
              <input
                required
                value={form.title || ""}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>
            <Field label={t(rtl, "Department", "القسم")}>
              <select
                value={form.departmentId || ""}
                onChange={(e) =>
                  setForm({ ...form, departmentId: e.target.value })
                }
              >
                <option value="">—</option>
                {data.departments?.map((row: Row) => (
                  <option key={row.id} value={row.id}>
                    {value(rtl, row)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t(rtl, "Location", "الموقع")}>
              <input
                value={form.location || ""}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </Field>
            <Field label={t(rtl, "Employment type", "نوع التوظيف")}>
              <select
                value={form.employmentType}
                onChange={(e) =>
                  setForm({ ...form, employmentType: e.target.value })
                }
              >
                <option value="full_time">
                  {t(rtl, "Full time", "دوام كامل")}
                </option>
                <option value="part_time">
                  {t(rtl, "Part time", "دوام جزئي")}
                </option>
                <option value="contract">{t(rtl, "Contract", "عقد")}</option>
              </select>
            </Field>
            <Field label={t(rtl, "Openings", "عدد الشواغر")}>
              <input
                type="number"
                min="1"
                value={form.openingsCount}
                onChange={(e) =>
                  setForm({ ...form, openingsCount: e.target.value })
                }
              />
            </Field>
            <Field label={t(rtl, "Hiring manager", "مدير التوظيف")}>
              <select
                value={form.hiringManagerEmployeeId || ""}
                onChange={(e) =>
                  setForm({ ...form, hiringManagerEmployeeId: e.target.value })
                }
              >
                <option value="">—</option>
                {data.employees?.map((row: Row) => (
                  <option key={row.id} value={row.id}>
                    {value(rtl, row)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t(rtl, "Recruiter / HR owner", "أخصائي التوظيف")}>
              <select
                value={form.recruiterEmployeeId || ""}
                onChange={(e) =>
                  setForm({ ...form, recruiterEmployeeId: e.target.value })
                }
              >
                <option value="">—</option>
                {data.employees?.map((row: Row) => (
                  <option key={row.id} value={row.id}>
                    {value(rtl, row)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={t(rtl, "Target closing date", "تاريخ الإغلاق المستهدف")}
            >
              <input
                type="date"
                value={form.closingDate || ""}
                onChange={(e) =>
                  setForm({ ...form, closingDate: e.target.value })
                }
              />
            </Field>
            <Field label={t(rtl, "Interview template", "قالب المقابلات")}>
              <select
                value={form.templateId || ""}
                onChange={(e) =>
                  setForm({ ...form, templateId: e.target.value })
                }
              >
                <option value="">—</option>
                {data.templates?.map((row: Row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t(rtl, "Job status", "حالة الوظيفة")}>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="draft">{t(rtl, "Draft", "مسودة")}</option>
                <option value="open">{t(rtl, "Open", "مفتوحة")}</option>
              </select>
            </Field>
          </div>
        </section>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <footer className="ats-drawer-footer">
        <button className="outline" onClick={close}>
          {t(rtl, "Cancel", "إلغاء")}
        </button>
        <button
          className="primary"
          disabled={saving || !String(form.title || "").trim() || !form.templateId}
          onClick={() => void save()}
        >
          {saving
            ? t(rtl, "Creating…", "جارٍ الإنشاء…")
            : t(rtl, "Create job", "إنشاء الوظيفة")}
        </button>
      </footer>
    </Drawer>
  );
}

export function CandidateDrawer({
  rtl,
  data,
  fixedJobId,
  close,
  run,
}: {
  rtl: boolean;
  data: Row;
  fixedJobId?: number;
  close: () => void;
  run: Run;
}) {
  const [form, setForm] = useState<Row>({
      jobId:
        fixedJobId ||
        data.jobs?.find((j: Row) => j.status === "open")?.id ||
        "",
      source: "manual",
    }),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [questions, setQuestions] = useState<Row[]>(
      form.jobId ? data.screeningQuestions || [] : [],
    ),
    [answers, setAnswers] = useState<Row>({}),
    [questionsJobId, setQuestionsJobId] = useState(form.jobId);
  // Clearing the job clears its screening questions in the same render instead of in an effect.
  if (questionsJobId !== form.jobId) {
    setQuestionsJobId(form.jobId);
    if (!form.jobId) setQuestions([]);
  }
  useEffect(() => {
    if (!form.jobId) return;
    let active = true;
    void fetch(`/api/recruitment?view=job&id=${form.jobId}`, {
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (active && body) setQuestions(body.screeningQuestions || []);
      })
      .catch(() => {
        if (active) setQuestions([]);
      });
    return () => {
      active = false;
    };
  }, [form.jobId]);
  const save = async () => {
    try {
      setSaving(true);
      setError("");
      await run({
        action: "add_candidate",
        ...form,
        jobId: Number(form.jobId),
        totalExperience: Number(form.totalExperience) || null,
        skills: String(form.skills || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        languages: String(form.languages || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        screeningAnswers: answers,
      });
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer
      rtl={rtl}
      title={t(rtl, "Add candidate", "إضافة مرشح")}
      subtitle={t(
        rtl,
        "One candidate profile can retain applications for multiple jobs.",
        "يمكن لملف مرشح واحد الاحتفاظ بطلبات لعدة وظائف.",
      )}
      close={close}
    >
      <div className="ats-drawer-body">
        <div className="ats-form-grid">
          <Field label={t(rtl, "Job", "الوظيفة")} wide>
            <select
              disabled={Boolean(fixedJobId)}
              value={form.jobId}
              onChange={(e) => setForm({ ...form, jobId: e.target.value })}
            >
              <option value="">—</option>
              {data.jobs
                ?.filter((j: Row) => j.status === "open")
                .map((j: Row) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
            </select>
          </Field>
          <Field label={t(rtl, "Full name", "الاسم الكامل")}>
            <input
              value={form.name || ""}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label={t(rtl, "Email", "البريد الإلكتروني")}>
            <input
              type="email"
              dir="ltr"
              value={form.email || ""}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label={t(rtl, "Phone", "الهاتف")}>
            <input
              dir="ltr"
              value={form.phone || ""}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
          <Field label={t(rtl, "Location", "الموقع")}>
            <input
              value={form.location || ""}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </Field>
          <Field label={t(rtl, "Current job title", "المسمى الحالي")}>
            <input
              value={form.currentJobTitle || ""}
              onChange={(e) =>
                setForm({ ...form, currentJobTitle: e.target.value })
              }
            />
          </Field>
          <Field label={t(rtl, "Current company", "الشركة الحالية")}>
            <input
              value={form.currentCompany || ""}
              onChange={(e) =>
                setForm({ ...form, currentCompany: e.target.value })
              }
            />
          </Field>
          <Field
            label={t(rtl, "Total experience (years)", "إجمالي الخبرة (سنوات)")}
          >
            <input
              type="number"
              min="0"
              step=".5"
              value={form.totalExperience || ""}
              onChange={(e) =>
                setForm({ ...form, totalExperience: e.target.value })
              }
            />
          </Field>
          <Field
            label={t(
              rtl,
              "Skills (comma separated)",
              "المهارات (مفصولة بفواصل)",
            )}
            wide
          >
            <input
              value={form.skills || ""}
              onChange={(e) => setForm({ ...form, skills: e.target.value })}
            />
          </Field>
          <Field
            label={t(
              rtl,
              "Languages (comma separated)",
              "اللغات (مفصولة بفواصل)",
            )}
            wide
          >
            <input
              value={form.languages || ""}
              onChange={(e) => setForm({ ...form, languages: e.target.value })}
            />
          </Field>
          <Field label={t(rtl, "Source", "المصدر")}>
            <select
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
            >
              <option value="manual">
                {t(rtl, "Manual HR entry", "إدخال الموارد البشرية")}
              </option>
              <option value="referral">{t(rtl, "Referral", "ترشيح")}</option>
              <option value="career_site">
                {t(rtl, "Careers site", "موقع الوظائف")}
              </option>
              <option value="agency">{t(rtl, "Agency", "وكالة")}</option>
            </select>
          </Field>
          <Field label={t(rtl, "Notes", "ملاحظات")} wide>
            <textarea
              value={form.notes || ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
        </div>
        {questions.length > 0 && (
          <section className="ats-form-section ats-screening-fields">
            <h3>{t(rtl, "Screening questions", "أسئلة الفرز الأولي")}</h3>
            <p>
              {t(
                rtl,
                "Knockout answers are flagged for HR review and never auto-rejected.",
                "تُعلّم الإجابات الإلزامية لمراجعة الموارد البشرية ولا يُرفض المرشح تلقائيًا.",
              )}
            </p>
            {questions.map((question) => {
              const options = list(question.options_json),
                current = answers[String(question.id)] ?? "",
                update = (next: unknown) =>
                  setAnswers({ ...answers, [String(question.id)]: next });
              return (
                <label className="ats-field" key={question.id}>
                  <span>
                    {question.question} ·{" "}
                    {question.importance === "knockout"
                      ? t(
                          rtl,
                          "HR review flag",
                          "علامة لمراجعة الموارد البشرية",
                        )
                      : question.importance}
                  </span>
                  {question.answer_type === "yes_no" ||
                  question.answer_type === "single_choice" ? (
                    <select
                      value={String(current)}
                      onChange={(event) => update(event.target.value)}
                    >
                      <option value="">—</option>
                      {(question.answer_type === "yes_no"
                        ? [
                            { value: "Yes", label: t(rtl, "Yes", "نعم") },
                            { value: "No", label: t(rtl, "No", "لا") },
                          ]
                        : options.map((option) => ({ value: option, label: option }))
                      ).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={
                        question.answer_type === "number"
                          ? "number"
                          : question.answer_type === "date"
                            ? "date"
                            : "text"
                      }
                      value={String(current)}
                      placeholder={
                        question.answer_type === "multiple_choice"
                          ? t(
                              rtl,
                              "Separate choices with commas",
                              "افصل الاختيارات بفواصل",
                            )
                          : undefined
                      }
                      onChange={(event) =>
                        update(
                          question.answer_type === "multiple_choice"
                            ? event.target.value
                                .split(",")
                                .map((item) => item.trim())
                                .filter(Boolean)
                            : event.target.value,
                        )
                      }
                    />
                  )}
                </label>
              );
            })}
          </section>
        )}
        {error && <div className="form-error">{error}</div>}
      </div>
      <footer className="ats-drawer-footer">
        <button className="outline" onClick={close}>
          {t(rtl, "Cancel", "إلغاء")}
        </button>
        <button
          className="primary"
          disabled={saving || !form.jobId || !form.name || !form.email}
          onClick={() => void save()}
        >
          <FilePlus2 />
          {saving
            ? t(rtl, "Adding…", "جارٍ الإضافة…")
            : t(rtl, "Add candidate", "إضافة المرشح")}
        </button>
      </footer>
    </Drawer>
  );
}

export function ScheduleDrawer({
  rtl,
  data,
  interview,
  close,
  run,
}: {
  rtl: boolean;
  data: Row;
  interview?: Row | null;
  close: () => void;
  run: Run;
}) {
  const [form, setForm] = useState<Row>({
      planStageId: interview?.plan_stage_id || data.planStages?.[0]?.id || "",
      scheduledAt: interview?.scheduled_at
        ? new Date(interview.scheduled_at).toISOString().slice(0, 16)
        : "",
      durationMinutes:
        interview?.duration_minutes ||
        data.planStages?.[0]?.duration_minutes ||
        60,
      meetingMethod: interview?.meeting_method || "in_person",
      location: interview?.location || "",
      notes: interview?.notes || "",
      interviewerEmployeeIds: [],
    }),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const toggle = (id: number) =>
    setForm({
      ...form,
      interviewerEmployeeIds: (
        form.interviewerEmployeeIds as number[]
      ).includes(id)
        ? form.interviewerEmployeeIds.filter((x: number) => x !== id)
        : [...form.interviewerEmployeeIds, id],
    });
  const save = async () => {
    try {
      setSaving(true);
      setError("");
      await run({
        action: interview ? "reschedule_interview" : "schedule_interview",
        ...(interview
          ? { interviewId: interview.id }
          : { applicationId: data.application.id }),
        ...form,
        planStageId: Number(form.planStageId),
        durationMinutes: Number(form.durationMinutes),
        scheduledAt: new Date(form.scheduledAt).toISOString(),
      });
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer
      rtl={rtl}
      title={
        interview
          ? t(rtl, "Reschedule interview", "إعادة جدولة المقابلة")
          : t(rtl, "Schedule interview", "جدولة مقابلة")
      }
      subtitle={`${data.candidate?.name} · ${data.application?.job_title}`}
      close={close}
    >
      <div className="ats-drawer-body">
        <div className="ats-form-grid">
          {!interview && (
            <Field label={t(rtl, "Interview stage", "مرحلة المقابلة")} wide>
              <select
                value={form.planStageId}
                onChange={(e) => {
                  const stage = data.planStages.find(
                    (x: Row) => String(x.id) === e.target.value,
                  );
                  setForm({
                    ...form,
                    planStageId: e.target.value,
                    durationMinutes: stage?.duration_minutes || 60,
                  });
                }}
              >
                {data.planStages?.map((row: Row) => (
                  <option key={row.id} value={row.id}>
                    {rtl ? row.name_ar : row.name_en}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={t(rtl, "Date and time", "التاريخ والوقت")}>
            <input
              type="datetime-local"
              value={form.scheduledAt || ""}
              onChange={(e) =>
                setForm({ ...form, scheduledAt: e.target.value })
              }
            />
          </Field>
          <Field label={t(rtl, "Duration (minutes)", "المدة (دقيقة)")}>
            <input
              type="number"
              min="15"
              value={form.durationMinutes}
              onChange={(e) =>
                setForm({ ...form, durationMinutes: e.target.value })
              }
            />
          </Field>
          <Field label={t(rtl, "Meeting method", "طريقة المقابلة")}>
            <select
              value={form.meetingMethod}
              onChange={(e) =>
                setForm({ ...form, meetingMethod: e.target.value })
              }
            >
              <option value="in_person">{t(rtl, "In person", "حضوري")}</option>
              <option value="video">
                {t(rtl, "Video call", "اتصال مرئي")}
              </option>
              <option value="phone">{t(rtl, "Phone", "هاتف")}</option>
            </select>
          </Field>
          <Field
            label={t(rtl, "Location / meeting link", "الموقع / رابط الاجتماع")}
          >
            <input
              value={form.location || ""}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </Field>
        </div>
        {!interview && (
          <section className="ats-check-list">
            <h3>{t(rtl, "Interviewers", "المحاورون")}</h3>
            <p>
              {t(
                rtl,
                "Leave empty to resolve the roles configured in the interview plan.",
                "اتركها فارغة لاستخدام الأدوار المحددة في خطة المقابلات.",
              )}
            </p>
            {data.employees?.map((row: Row) => (
              <label key={row.id}>
                <input
                  type="checkbox"
                  checked={(form.interviewerEmployeeIds as number[]).includes(
                    Number(row.id),
                  )}
                  onChange={() => toggle(Number(row.id))}
                />
                <span>
                  <b>{value(rtl, row)}</b>
                  <small>{row.employee_code}</small>
                </span>
              </label>
            ))}
          </section>
        )}
        <Field label={t(rtl, "Notes", "ملاحظات")} wide>
          <textarea
            value={form.notes || ""}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </Field>
        {error && <div className="form-error">{error}</div>}
      </div>
      <footer className="ats-drawer-footer">
        <button className="outline" onClick={close}>
          {t(rtl, "Cancel", "إلغاء")}
        </button>
        <button
          className="primary"
          disabled={
            saving || !form.scheduledAt || (!interview && !form.planStageId)
          }
          onClick={() => void save()}
        >
          <CalendarClock />
          {saving
            ? t(rtl, "Saving…", "جارٍ الحفظ…")
            : interview
              ? t(rtl, "Save new schedule", "حفظ الموعد الجديد")
              : t(rtl, "Schedule interview", "جدولة المقابلة")}
        </button>
      </footer>
    </Drawer>
  );
}

export function DecisionDrawer({
  rtl,
  kind,
  data,
  close,
  run,
}: {
  rtl: boolean;
  kind: "reject" | "offer";
  data: Row;
  close: () => void;
  run: Run;
}) {
  // Lazy initializer: the default offer dates are read once, on mount, rather than
  // recomputed on every render.
  const [form, setForm] = useState<Row>(() =>
      kind === "reject"
        ? { communicationStatus: "not_sent" }
        : {
            offerDate: new Date().toISOString().slice(0, 10),
            joiningDate: new Date(Date.now() + 14 * 86400000)
              .toISOString()
              .slice(0, 10),
            position: data.application?.job_title,
          },
    ),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const save = async () => {
    try {
      setSaving(true);
      setError("");
      await run(
        kind === "reject"
          ? {
              action: "reject_application",
              applicationId: data.application.id,
              ...form,
            }
          : {
              action: "create_offer",
              applicationId: data.application.id,
              ...form,
            },
      );
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer
      rtl={rtl}
      title={
        kind === "reject"
          ? t(rtl, "Reject candidate", "رفض المرشح")
          : t(rtl, "Create offer", "إنشاء عرض")
      }
      subtitle={`${data.candidate?.name} · ${data.application?.job_title}`}
      close={close}
    >
      <div className="ats-drawer-body">
        <div className="ats-form-grid">
          {kind === "reject" ? (
            <>
              <Field label={t(rtl, "Rejection reason", "سبب الرفض")} wide>
                <select
                  value={form.reason || ""}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                >
                  <option value="">—</option>
                  <option value="requirements">
                    {t(rtl, "Requirements not met", "عدم استيفاء المتطلبات")}
                  </option>
                  <option value="experience">
                    {t(rtl, "Experience mismatch", "عدم توافق الخبرة")}
                  </option>
                  <option value="interview">
                    {t(rtl, "Interview outcome", "نتيجة المقابلة")}
                  </option>
                  <option value="position_closed">
                    {t(rtl, "Position closed", "إغلاق الوظيفة")}
                  </option>
                  <option value="other">{t(rtl, "Other", "أخرى")}</option>
                </select>
              </Field>
              <Field
                label={t(rtl, "Candidate communication", "التواصل مع المرشح")}
              >
                <select
                  value={form.communicationStatus}
                  onChange={(e) =>
                    setForm({ ...form, communicationStatus: e.target.value })
                  }
                >
                  <option value="not_sent">
                    {t(rtl, "Not sent", "لم يرسل")}
                  </option>
                  <option value="scheduled">
                    {t(rtl, "Scheduled", "مجدول")}
                  </option>
                  <option value="sent">{t(rtl, "Sent", "تم الإرسال")}</option>
                </select>
              </Field>
              <Field label={t(rtl, "Internal notes", "ملاحظات داخلية")} wide>
                <textarea
                  value={form.internalNotes || ""}
                  onChange={(e) =>
                    setForm({ ...form, internalNotes: e.target.value })
                  }
                />
              </Field>
            </>
          ) : (
            <>
              <Field label={t(rtl, "Offer date", "تاريخ العرض")}>
                <input
                  type="date"
                  value={form.offerDate}
                  onChange={(e) =>
                    setForm({ ...form, offerDate: e.target.value })
                  }
                />
              </Field>
              <Field
                label={t(rtl, "Proposed start date", "تاريخ البدء المقترح")}
              >
                <input
                  type="date"
                  value={form.joiningDate}
                  onChange={(e) =>
                    setForm({ ...form, joiningDate: e.target.value })
                  }
                />
              </Field>
              <Field label={t(rtl, "Position", "المنصب")} wide>
                <input
                  value={form.position || ""}
                  onChange={(e) =>
                    setForm({ ...form, position: e.target.value })
                  }
                />
              </Field>
              <Field label={t(rtl, "Notes", "ملاحظات")} wide>
                <textarea
                  value={form.notes || ""}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </Field>
            </>
          )}
        </div>
        {error && <div className="form-error">{error}</div>}
      </div>
      <footer className="ats-drawer-footer">
        <button className="outline" onClick={close}>
          {t(rtl, "Cancel", "إلغاء")}
        </button>
        <button
          className={kind === "reject" ? "ats-danger" : "primary"}
          disabled={
            saving ||
            (kind === "reject"
              ? !form.reason
              : !form.offerDate || !form.joiningDate)
          }
          onClick={() => void save()}
        >
          {saving
            ? t(rtl, "Saving…", "جارٍ الحفظ…")
            : kind === "reject"
              ? t(rtl, "Confirm rejection", "تأكيد الرفض")
              : t(rtl, "Create offer", "إنشاء العرض")}
        </button>
      </footer>
    </Drawer>
  );
}
