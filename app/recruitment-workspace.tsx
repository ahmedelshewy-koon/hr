"use client";

import { localizeApiMessage } from "./api-messages";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Columns3,
  Eye,
  FileSearch,
  FileText,
  History,
  LayoutList,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  UserRoundSearch,
  Users,
  X,
} from "lucide-react";
import { localizedDisplayValue } from "./localization";
import {
  CandidateDrawer,
  DecisionDrawer,
  JobDrawer,
  ScheduleDrawer,
} from "./recruitment/recruitment-forms";
import "./recruitment-workspace.css";
import "./recruitment-layout.css";
import { InterviewTemplateEditor } from "./recruitment/interview-template-editor";
import type { Row } from "./ui-types";

type View = "overview" | "jobs" | "candidates" | "interviews" | "setup";
type Route = { view: View; id?: number; applicationId?: number };
const t = (rtl: boolean, en: string, ar: string) => (rtl ? ar : en),
  person = (rtl: boolean, row?: Row) =>
    rtl
      ? row?.name_ar || row?.name_en || row?.name || "—"
      : row?.name_en || row?.name || "—";
const num = (value: unknown, rtl: boolean) =>
  new Intl.NumberFormat(rtl ? "ar-EG" : "en-US", {
    maximumFractionDigits: 1,
  }).format(Number(value) || 0);
const date = (value: unknown, rtl: boolean, withTime = false) =>
  value
    ? new Intl.DateTimeFormat(
        rtl ? "ar-EG" : "en-US",
        withTime
          ? {
              day: "numeric",
              month: "short",
              hour: "numeric",
              minute: "2-digit",
            }
          : { day: "numeric", month: "short", year: "numeric" },
      ).format(new Date(String(value)))
    : "—";
const get = async (query = "") => {
  const response = await fetch(`/api/recruitment${query}`, {
      cache: "no-store",
    }),
    body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(localizeApiMessage(body.error || "Unable to load recruitment"));
  return body as Row;
};
const post = async (payload: Row) => {
  const response = await fetch("/api/recruitment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(localizeApiMessage(body.error || "Recruitment action failed"));
  return body as Row;
};
function Status({ value, rtl }: { value: unknown; rtl: boolean }) {
  const status = String(value || "draft"),
    tone = [
      "open",
      "completed",
      "hired",
      "accepted",
      "submitted",
      "strong_match",
    ].includes(status)
      ? "green"
      : [
            "scheduled",
            "screening",
            "shortlisted",
            "active",
            "good_match",
          ].includes(status)
        ? "blue"
        : ["pending", "draft", "on_hold", "requires_review"].includes(status)
          ? "amber"
          : ["rejected", "cancelled", "no_hire", "weak_match"].includes(status)
            ? "red"
            : "gray";
  return (
    <span className={`ats-status ${tone}`}>
      <i />
      {localizedDisplayValue(status, rtl, status.replaceAll("_", " "))}
    </span>
  );
}
function Empty({
  rtl,
  kind = "records",
  action,
  label,
}: {
  rtl: boolean;
  kind?: string;
  action?: () => void;
  label?: string;
}) {
  return (
    <div className="ats-empty">
      <BriefcaseBusiness />
      <h3>
        {kind === "jobs"
          ? t(rtl, "No jobs yet", "لا توجد وظائف بعد")
          : t(rtl, "No records in this queue", "لا توجد سجلات في هذه القائمة")}
      </h3>
      <p>
        {kind === "jobs"
          ? t(
              rtl,
              "Create your first job to start receiving and evaluating candidates.",
              "أنشئ أول وظيفة لبدء استقبال المرشحين وتقييمهم.",
            )
          : t(
              rtl,
              "New activity will appear here when the workflow advances.",
              "ستظهر الأنشطة الجديدة هنا عند تقدم مسار العمل.",
            )}
      </p>
      {action && (
        <button className="primary" onClick={action}>
          <Plus />
          {label || t(rtl, "Create", "إنشاء")}
        </button>
      )}
    </div>
  );
}
function ErrorState({
  rtl,
  message,
  retry,
}: {
  rtl: boolean;
  message: string;
  retry: () => void;
}) {
  return (
    <div className="ats-error" role="alert">
      <AlertTriangle />
      <b>{t(rtl, "Recruitment could not be loaded", "تعذر تحميل التوظيف")}</b>
      <span>{message}</span>
      <button className="outline" onClick={retry}>
        <RefreshCw />
        {t(rtl, "Retry", "إعادة المحاولة")}
      </button>
    </div>
  );
}
function PageLoading({ rtl }: { rtl: boolean }) {
  return (
    <div className="ats-loading">
      <RefreshCw />
      {t(rtl, "Loading recruitment workspace…", "جارٍ تحميل مساحة التوظيف…")}
    </div>
  );
}

function Overview({
  rtl,
  data,
  openJob,
  navigate,
  openJobDetail,
  openInterview,
}: {
  rtl: boolean;
  data: Row;
  openJob: () => void;
  navigate: (view: View) => void;
  openJobDetail: (id: number) => void;
  openInterview: (id: number) => void;
}) {
  const k = data.kpis || {},
    cards = [
      ["open_jobs", "Open jobs", "الوظائف المفتوحة", BriefcaseBusiness],
      ["active_candidates", "Active candidates", "المرشحون النشطون", Users],
      ["new_candidates", "New candidates", "المرشحون الجدد", FileSearch],
      ["shortlisted", "Shortlisted", "القائمة المختصرة", ClipboardCheck],
      ["today", "Interviews today", "مقابلات اليوم", CalendarClock],
      ["pending_evaluations", "Pending feedback", "تقييمات قيد الانتظار", CircleDot],
      ["pending_offers", "Pending offers", "عروض قيد الانتظار", ClipboardCheck],
      [
        "decisions_required",
        "Decisions required",
        "قرارات مطلوبة",
        AlertTriangle,
      ],
    ] as const;
  return (
    <>
      <div className="ats-kpis">
        {cards.map(([key, en, ar, Icon]) => (
          <article key={key}>
            <span>
              <Icon />
            </span>
            <div>
              <strong>{num(k[key], rtl)}</strong>
              <small>{t(rtl, en, ar)}</small>
            </div>
          </article>
        ))}
      </div>
      <div className="ats-overview-grid">
        <section className="ats-panel ats-jobs">
          <header>
            <div>
              <h2>{t(rtl, "Open jobs", "الوظائف المفتوحة")}</h2>
              <p>
                {t(
                  rtl,
                  "Current workload and funnel movement by job",
                  "حجم العمل وحركة مسار التوظيف لكل وظيفة",
                )}
              </p>
            </div>
            <button onClick={() => navigate("jobs")}>
              {t(rtl, "View all", "عرض الكل")}
              <ChevronRight />
            </button>
          </header>
          {data.jobs?.some((job: Row) => job.status === "open") ? (
            <div className="ats-table">
              <div className="row head">
                <span>{t(rtl, "Job", "الوظيفة")}</span>
                <span>{t(rtl, "Department", "القسم")}</span>
                <span>{t(rtl, "Applicants", "المتقدمون")}</span>
                <span>{t(rtl, "Interview", "المقابلات")}</span>
                <span>{t(rtl, "Offers", "العروض")}</span>
                <span>{t(rtl, "Status", "الحالة")}</span>
                <span>{t(rtl, "Opened", "تاريخ الفتح")}</span>
              </div>
              {data.jobs
                .filter((job: Row) => job.status === "open")
                .map((job: Row) => (
                  <button
                    className="row"
                    key={job.id}
                    onClick={() => openJobDetail(Number(job.id))}
                  >
                    <span>
                      <b>{job.title}</b>
                      <small>{job.location || "—"}</small>
                    </span>
                    <span>
                      {rtl ? job.department_name_ar : job.department_name}
                    </span>
                    <span>{num(job.applicants, rtl)}</span>
                    <span>{num(job.in_interview, rtl)}</span>
                    <span>{num(job.offers, rtl)}</span>
                    <span>
                      <Status value={job.status} rtl={rtl} />
                    </span>
                    <span>{date(job.created_date, rtl)}</span>
                  </button>
                ))}
            </div>
          ) : (
            <Empty
              rtl={rtl}
              kind="jobs"
              action={openJob}
              label={t(rtl, "Create job", "إنشاء وظيفة")}
            />
          )}
        </section>
        <aside className="ats-panel ats-actions">
          <header>
            <div>
              <h2>{t(rtl, "Action required", "إجراءات مطلوبة")}</h2>
              <p>
                {t(
                  rtl,
                  "Queues that need a human decision",
                  "قوائم تنتظر قرارًا بشريًا",
                )}
              </p>
            </div>
          </header>
          {data.actionRequired?.length ? (
            <div>
              {data.actionRequired.map((item: Row) => (
                <button
                  key={item.kind}
                  onClick={() => navigate(item.target as View)}
                >
                  <span className="ats-action-icon">
                    <AlertTriangle />
                  </span>
                  <b>
                    {t(
                      rtl,
                      item.kind === "screening"
                        ? "CVs awaiting screening"
                        : item.kind === "feedback"
                          ? "Interview feedback missing"
                          : item.kind === "offers"
                            ? "Offers awaiting action"
                            : item.kind === "decisions"
                              ? "Candidates awaiting decision"
                              : "Interviews today",
                      item.kind === "screening"
                        ? "سير ذاتية تنتظر الفرز"
                        : item.kind === "feedback"
                          ? "تقييمات مقابلات ناقصة"
                          : item.kind === "offers"
                            ? "عروض تنتظر الإجراء"
                            : item.kind === "decisions"
                              ? "مرشحون ينتظرون القرار"
                              : "مقابلات اليوم",
                    )}
                  </b>
                  <strong>{num(item.count, rtl)}</strong>
                  <ChevronRight />
                </button>
              ))}
            </div>
          ) : (
            <div className="ats-clear">
              <ClipboardCheck />
              <b>{t(rtl, "Queues are clear", "لا توجد قوائم قيد الانتظار")}</b>
              <span>
                {t(
                  rtl,
                  "There are no urgent recruitment actions right now.",
                  "لا توجد إجراءات توظيف عاجلة حاليًا.",
                )}
              </span>
            </div>
          )}
        </aside>
      </div>
      {data.myInterviews?.length > 0 && (
        <section className="ats-panel ats-my-preview">
          <header>
            <div>
              <h2>{t(rtl, "My interviews", "مقابلاتي")}</h2>
              <p>
                {t(
                  rtl,
                  "Assigned interviews that need your attention",
                  "المقابلات المسندة إليك والتي تحتاج انتباهك",
                )}
              </p>
            </div>
            <button onClick={() => navigate("interviews")}>
              {t(rtl, "Open workspace", "فتح المساحة")}
              <ChevronRight />
            </button>
          </header>
          <div className="ats-card-grid">
            {data.myInterviews.slice(0, 4).map((item: Row) => (
              <button
                className="ats-interview-card"
                key={item.id}
                onClick={() => openInterview(Number(item.id))}
              >
                <CalendarClock />
                <span>
                  <b>{item.candidate_name}</b>
                  <small>
                    {item.job_title} ·{" "}
                    {rtl ? item.stage_name_ar : item.stage_name}
                  </small>
                </span>
                <time>{date(item.scheduled_at, rtl, true)}</time>
                <Status value={item.evaluation_status} rtl={rtl} />
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function JobsView({
  rtl,
  data,
  openJob,
  openJobDetail,
}: {
  rtl: boolean;
  data: Row;
  openJob: () => void;
  openJobDetail: (id: number) => void;
}) {
  const [query, setQuery] = useState("");
  const rows = (data.jobs || []).filter((row: Row) =>
    `${row.title} ${row.department_name} ${row.department_name_ar} ${row.location}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  return (
    <section className="ats-panel ats-list-panel">
      <header className="ats-list-head">
        <div>
          <h2>{t(rtl, "Jobs", "الوظائف")}</h2>
          <p>
            {t(
              rtl,
              "Openings, owners, and live application movement",
              "الشواغر والمسؤولون وحركة طلبات التوظيف",
            )}
          </p>
        </div>
        <button className="primary" onClick={openJob}>
          <Plus />
          {t(rtl, "Create job", "إنشاء وظيفة")}
        </button>
      </header>
      <div className="ats-filter">
        <label>
          <Search />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(rtl, "Search jobs…", "ابحث في الوظائف…")}
          />
        </label>
        <span>
          {num(rows.length, rtl)} {t(rtl, "jobs", "وظيفة")}
        </span>
      </div>
      {rows.length ? (
        <div className="ats-table ats-job-table">
          <div className="row head">
            <span>{t(rtl, "Job", "الوظيفة")}</span>
            <span>{t(rtl, "Department", "القسم")}</span>
            <span>{t(rtl, "Hiring manager", "مدير التوظيف")}</span>
            <span>{t(rtl, "Recruiter", "أخصائي التوظيف")}</span>
            <span>{t(rtl, "Applicants", "المتقدمون")}</span>
            <span>{t(rtl, "Status", "الحالة")}</span>
            <span>{t(rtl, "Closing", "الإغلاق")}</span>
          </div>
          {rows.map((job: Row) => (
            <button
              className="row"
              key={job.id}
              onClick={() => openJobDetail(Number(job.id))}
            >
              <span>
                <b>{job.title}</b>
                <small>
                  {job.location || "—"} · {job.openings_count}{" "}
                  {t(rtl, "openings", "شواغر")}
                </small>
              </span>
              <span>{rtl ? job.department_name_ar : job.department_name}</span>
              <span>
                {rtl ? job.hiring_manager_name_ar : job.hiring_manager_name}
              </span>
              <span>{rtl ? job.recruiter_name_ar : job.recruiter_name}</span>
              <span>{num(job.applicants, rtl)}</span>
              <span>
                <Status value={job.status} rtl={rtl} />
              </span>
              <span>{date(job.closing_date, rtl)}</span>
            </button>
          ))}
        </div>
      ) : (
        <Empty
          rtl={rtl}
          kind="jobs"
          action={openJob}
          label={t(rtl, "Create job", "إنشاء وظيفة")}
        />
      )}
    </section>
  );
}

function JobDetail({
  rtl,
  data,
  back,
  run,
  openCandidate,
  addCandidate,
}: {
  rtl: boolean;
  data: Row;
  back: () => void;
  run: (payload: Row) => Promise<Row>;
  openCandidate: (id: number, applicationId: number) => void;
  addCandidate: () => void;
}) {
  const [tab, setTab] = useState("overview"),
    job = data.job || {},
    tabs = [
      ["overview", "Overview", "نظرة عامة"],
      ["requirements", "Requirements", "المتطلبات"],
      ["candidates", "Candidates", "المرشحون"],
      ["plan", "Interview plan", "خطة المقابلات"],
      ["activity", "Activity", "النشاط"],
    ];
  const [editingRequirements, setEditingRequirements] = useState(false),
    [editedRequirements, setRequirementDraft] = useState<Row[]>([]);
  const savedRequirements: Row[] = (data.requirements || []).map(
    (item: Row, index: number) => ({
      category: item.category,
      name: item.name,
      description: item.description || "",
      priority: item.priority,
      weight: Number(item.weight),
      minimumValue: item.minimum_value || "",
      notes: item.notes || "",
      sortOrder: (index + 1) * 10,
    }),
  );
  // Outside edit mode the draft mirrors the saved requirements; starting an edit takes a copy to work on.
  const requirementDraft = editingRequirements
      ? editedRequirements
      : savedRequirements,
    toggleRequirementEditing = () => {
      if (!editingRequirements) setRequirementDraft(savedRequirements);
      setEditingRequirements(!editingRequirements);
    };
  const [actionError, setActionError] = useState("");
  const saveRequirements = async () => {
    setActionError("");
    try {
      await run({
        action: "update_job_requirements",
        jobId: job.id,
        requirements: requirementDraft.map((item) => ({
          ...item,
          weight: 100 / requirementDraft.length,
        })),
      });
      setEditingRequirements(false);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    }
    };
  return (
    <>
      {actionError && <div className="form-error" role="alert">{actionError}</div>}
      <header className="ats-detail-head">
        <button className="ats-back" onClick={back}>
          {rtl ? <ArrowRight /> : <ArrowLeft />}
          {t(rtl, "Back to jobs", "العودة إلى الوظائف")}
        </button>
        <div>
          <span>{rtl ? job.department_name_ar : job.department_name}</span>
          <h1>{job.title}</h1>
          <p>
            {job.location || "—"} ·{" "}
            {localizedDisplayValue(job.employment_type, rtl)} ·{" "}
            {job.openings_count} {t(rtl, "openings", "شواغر")}
          </p>
        </div>
        <Status value={job.status} rtl={rtl} />
        <button className="primary" onClick={addCandidate}>
          <Plus />
          {t(rtl, "Add candidate", "إضافة مرشح")}
        </button>
      </header>
      <nav className="ats-detail-tabs">
        {tabs.map(([id, en, ar]) => (
          <button
            className={tab === id ? "active" : ""}
            key={id}
            onClick={() => setTab(id)}
          >
            {t(rtl, en, ar)}
          </button>
        ))}
      </nav>
      {tab === "overview" && (
        <div className="ats-detail-grid">
          <section className="ats-panel ats-copy-panel">
            <h2>{t(rtl, "Job summary", "ملخص الوظيفة")}</h2>
            <p>
              {job.summary ||
                job.description ||
                t(rtl, "No summary provided.", "لم يُضف ملخص بعد.")}
            </p>
            <h3>{t(rtl, "Responsibilities", "المسؤوليات")}</h3>
            <p className="pre">{job.responsibilities || "—"}</p>
          </section>
          <aside className="ats-panel ats-facts">
            <h2>{t(rtl, "Ownership", "المسؤولية")}</h2>
            <dl>
              <div>
                <dt>{t(rtl, "Hiring manager", "مدير التوظيف")}</dt>
                <dd>
                  {rtl ? job.hiring_manager_name_ar : job.hiring_manager_name}
                </dd>
              </div>
              <div>
                <dt>{t(rtl, "Recruiter", "أخصائي التوظيف")}</dt>
                <dd>{rtl ? job.recruiter_name_ar : job.recruiter_name}</dd>
              </div>
              <div>
                <dt>{t(rtl, "Opened", "تاريخ الفتح")}</dt>
                <dd>{date(job.created_date, rtl)}</dd>
              </div>
              <div>
                <dt>{t(rtl, "Target close", "الإغلاق المستهدف")}</dt>
                <dd>{date(job.closing_date, rtl)}</dd>
              </div>
            </dl>
          </aside>
        </div>
      )}
      {tab === "requirements" && (
        <section className="ats-panel ats-requirements">
          <header>
            <div>
              <h2>
                {t(
                  rtl,
                  "Job requirements",
                  "متطلبات الوظيفة",
                )}
              </h2>
              <p>
                {t(
                  rtl,
                  "Specify the requirements, categories, and priorities for this job.",
                  "حدد متطلبات الوظيفة وفئة كل متطلب وأولويته.",
                )}
              </p>
            </div>
            <div className="ats-requirement-actions">
              <button
                className="outline"
                onClick={toggleRequirementEditing}
              >
                <Pencil />
                {editingRequirements
                  ? t(rtl, "Cancel", "إلغاء")
                  : t(rtl, "Edit requirements", "تعديل المتطلبات")}
              </button>
            </div>
          </header>
          {editingRequirements ? (
            <div className="ats-requirement-editor">
              {requirementDraft.map((item, index) => (
                <article className="ats-repeat-card" key={index}>
                  <button
                    className="ats-remove"
                    aria-label={t(rtl, "Remove requirement", "حذف المتطلب")}
                    onClick={() =>
                      setRequirementDraft(
                        requirementDraft.filter(
                          (_, itemIndex) => itemIndex !== index,
                        ),
                      )
                    }
                  >
                    <X />
                  </button>
                  <div className="ats-form-grid">
                    <label className="ats-field">
                      <span>{t(rtl, "Requirement", "المتطلب")}</span>
                      <input
                        value={item.name}
                        onChange={(event) =>
                          setRequirementDraft(
                            requirementDraft.map((row, itemIndex) =>
                              itemIndex === index
                                ? { ...row, name: event.target.value }
                                : row,
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="ats-field">
                      <span>{t(rtl, "Category", "الفئة")}</span>
                      <select
                        value={item.category}
                        onChange={(event) =>
                          setRequirementDraft(
                            requirementDraft.map((row, itemIndex) =>
                              itemIndex === index
                                ? { ...row, category: event.target.value }
                                : row,
                            ),
                          )
                        }
                      >
                        {[
                          "work_experience",
                          "technical_skills",
                          "domain_experience",
                          "education",
                          "certifications",
                          "language",
                          "location",
                          "availability",
                          "other",
                        ].map((value) => (
                          <option key={value} value={value}>
                            {localizedDisplayValue(value, rtl)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="ats-field">
                      <span>{t(rtl, "Priority", "الأولوية")}</span>
                      <select
                        value={item.priority}
                        onChange={(event) =>
                          setRequirementDraft(
                            requirementDraft.map((row, itemIndex) =>
                              itemIndex === index
                                ? { ...row, priority: event.target.value }
                                : row,
                            ),
                          )
                        }
                      >
                        <option value="required">
                          {t(rtl, "Required", "إلزامي")}
                        </option>
                        <option value="preferred">
                          {t(rtl, "Preferred", "مفضل")}
                        </option>
                      </select>
                    </label>
                  </div>
                </article>
              ))}
              <div className="ats-editor-actions">
                <button
                  className="outline"
                  onClick={() =>
                    setRequirementDraft([
                      ...requirementDraft,
                      {
                        category: "other",
                        name: "",
                        description: "",
                        priority: "preferred",
                        weight: 0,
                        sortOrder: (requirementDraft.length + 1) * 10,
                      },
                    ])
                  }
                >
                  <Plus />
                  {t(rtl, "Add requirement", "إضافة متطلب")}
                </button>
                <button
                  className="primary"
                  disabled={
                    requirementDraft.some((item) => !String(item.name || "").trim())
                  }
                  onClick={() => void saveRequirements()}
                >
                  <Check />
                  {t(rtl, "Save new version", "حفظ إصدار جديد")}
                </button>
              </div>
            </div>
          ) : (
            <div>
              {data.requirements?.map((item: Row) => (
                <article key={item.id}>
                  <div>
                    <b>{item.name}</b>
                    <small>
                      {localizedDisplayValue(item.category, rtl)} ·{" "}
                      {localizedDisplayValue(item.priority, rtl)}
                    </small>
                  </div>
                  <Status value={item.priority} rtl={rtl} />
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      {tab === "candidates" && (
        <section className="ats-panel ats-simple-list">
          <header>
            <div>
              <h2>{t(rtl, "Candidates for this job", "مرشحو هذه الوظيفة")}</h2>
              <p>
                {num(data.applications?.length, rtl)}{" "}
                {t(rtl, "applications", "طلبات")}
              </p>
            </div>
            <button className="primary" onClick={addCandidate}>
              <Plus />
              {t(rtl, "Add candidate", "إضافة مرشح")}
            </button>
          </header>
          {data.applications?.length ? (
            data.applications.map((item: Row) => (
              <button
                key={item.application_id}
                onClick={() =>
                  openCandidate(
                    Number(item.candidate_id),
                    Number(item.application_id),
                  )
                }
              >
                <span className="ats-person">
                  <UserRoundSearch />
                  <span>
                    <b>{item.name}</b>
                    <small>{item.email}</small>
                  </span>
                </span>
                <span>{rtl ? item.stage_name_ar : item.stage_name}</span>
                <strong>
                  {item.overall_score == null
                    ? "—"
                    : `${num(item.overall_score, rtl)}%`}
                </strong>
                <ChevronRight />
              </button>
            ))
          ) : (
            <Empty rtl={rtl} />
          )}
        </section>
      )}
      {tab === "plan" && (
        <section className="ats-plan">
          {data.planStages?.map((stage: Row, index: number) => {
            const interviewers =
                data.planInterviewers?.filter(
                  (x: Row) => Number(x.plan_stage_id) === Number(stage.id),
                ) || [],
              questions =
                data.planQuestions?.filter(
                  (x: Row) => Number(x.plan_stage_id) === Number(stage.id),
                ) || [],
              criteria =
                data.scorecardCriteria?.filter(
                  (x: Row) => Number(x.plan_stage_id) === Number(stage.id),
                ) || [];
            return (
              <article className="ats-panel" key={stage.id}>
                <span className="ats-step">{num(index + 1, rtl)}</span>
                <div className="ats-plan-main">
                  <header>
                    <div>
                      <h2>{rtl ? stage.name_ar : stage.name_en}</h2>
                      <p>
                        {stage.duration_minutes} {t(rtl, "minutes", "دقيقة")} ·{" "}
                        {num(stage.aggregation_weight, rtl)}%{" "}
                        {t(rtl, "of interview score", "من تقييم المقابلات")}
                      </p>
                    </div>
                    <Status value="active" rtl={rtl} />
                  </header>
                  <p>{stage.passing_guidance}</p>
                  <div className="ats-plan-meta">
                    <span>
                      <Users />
                      {interviewers
                        .map((x: Row) =>
                          x.employee_id
                            ? person(rtl, x)
                            : localizedDisplayValue(x.role_key, rtl),
                        )
                        .join("، ") || "—"}
                    </span>
                    <span>
                      <MessageSquareText />
                      {questions.length} {t(rtl, "questions", "أسئلة")}
                    </span>
                    <span>
                      <ClipboardCheck />
                      {criteria.length} {t(rtl, "criteria", "معايير")}
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}
      {tab === "activity" && <Timeline rtl={rtl} rows={data.activity || []} />}
    </>
  );
}

function CandidatesView({
  rtl,
  data,
  openCandidate,
  addCandidate,
}: {
  rtl: boolean;
  data: Row;
  openCandidate: (id: number, applicationId: number) => void;
  addCandidate: () => void;
}) {
  const [mode, setMode] = useState<"table" | "pipeline">("table"),
    [query, setQuery] = useState("");
  const rows = (data.candidates || []).filter((row: Row) =>
      `${row.name} ${row.email} ${row.job_title}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    ),
    stages = [
      ...new Set(rows.map((r: Row) => r.stage_key || r.application_status)),
    ];
  return (
    <section className="ats-panel ats-list-panel">
      <header className="ats-list-head">
        <div>
          <h2>{t(rtl, "Candidates", "المرشحون")}</h2>
          <p>
            {t(
              rtl,
              "One profile, complete application history, and explainable matching",
              "ملف واحد وسجل طلبات كامل ومطابقة قابلة للتفسير",
            )}
          </p>
        </div>
        <div className="ats-head-actions">
          <button
            className="outline"
            onClick={() => setMode(mode === "table" ? "pipeline" : "table")}
          >
            {mode === "table" ? <Columns3 /> : <LayoutList />}
            {mode === "table"
              ? t(rtl, "Pipeline", "المسار")
              : t(rtl, "Table", "الجدول")}
          </button>
          <button className="primary" onClick={addCandidate}>
            <Plus />
            {t(rtl, "Add candidate", "إضافة مرشح")}
          </button>
        </div>
      </header>
      <div className="ats-filter">
        <label>
          <Search />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(rtl, "Search candidates…", "ابحث في المرشحين…")}
          />
        </label>
        <span>
          {num(rows.length, rtl)} {t(rtl, "applications", "طلبات")}
        </span>
      </div>
      {!rows.length ? (
        query.trim() ? <div className="ats-clear"><Search /><b>{t(rtl, "No matching candidates", "لا يوجد مرشحون مطابقون للبحث")}</b><button className="outline" onClick={() => setQuery("")}>{t(rtl, "Clear search", "مسح البحث")}</button></div>
        : <Empty rtl={rtl} kind="candidates" action={addCandidate} label={t(rtl, "Add candidate", "إضافة مرشح")} />
      ) : mode === "table" ? (
        <div className="ats-table ats-candidate-table">
          <div className="row head">
            <span>{t(rtl, "Candidate", "المرشح")}</span>
            <span>{t(rtl, "Job", "الوظيفة")}</span>
            <span>{t(rtl, "Stage", "المرحلة")}</span>
            <span>{t(rtl, "Match", "المطابقة")}</span>
            <span>{t(rtl, "Days in stage", "أيام المرحلة")}</span>
            <span>{t(rtl, "Next interview", "المقابلة القادمة")}</span>
            <span>{t(rtl, "Status", "الحالة")}</span>
          </div>
          {rows.map((row: Row) => (
            <button
              className="row"
              key={row.application_id}
              onClick={() =>
                openCandidate(
                  Number(row.candidate_id),
                  Number(row.application_id),
                )
              }
            >
              <span>
                <b>{row.name}</b>
                <small>{row.current_job_title || row.email}</small>
              </span>
              <span>{row.job_title}</span>
              <span>{rtl ? row.stage_name_ar : row.stage_name}</span>
              <span className="ats-score-cell">
                <strong>
                  {row.overall_score == null
                    ? "—"
                    : `${num(row.overall_score, rtl)}%`}
                </strong>
                {Number(row.match_stale) > 0 && (
                  <small>{t(rtl, "Update needed", "يحتاج تحديثًا")}</small>
                )}
              </span>
              <span>{num(row.days_in_stage, rtl)}</span>
              <span>{date(row.next_interview, rtl, true)}</span>
              <span>
                <Status value={row.application_status} rtl={rtl} />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="ats-kanban">
          {stages.map((stage) => (
            <section key={stage as string}>
              <header>
                <b>{localizedDisplayValue(stage, rtl)}</b>
                <span>
                  {num(
                    rows.filter(
                      (r: Row) =>
                        (r.stage_key || r.application_status) === stage,
                    ).length,
                    rtl,
                  )}
                </span>
              </header>
              {rows
                .filter(
                  (r: Row) => (r.stage_key || r.application_status) === stage,
                )
                .map((row: Row) => (
                  <button
                    key={row.application_id}
                    onClick={() =>
                      openCandidate(
                        Number(row.candidate_id),
                        Number(row.application_id),
                      )
                    }
                  >
                    <b>{row.name}</b>
                    <small>{row.job_title}</small>
                    <div>
                      <strong>
                        {row.overall_score == null
                          ? "—"
                          : `${num(row.overall_score, rtl)}%`}
                      </strong>
                      <span>
                        {num(row.days_in_stage, rtl)} {t(rtl, "days", "أيام")}
                      </span>
                    </div>
                  </button>
                ))}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function CandidateDetail({
  rtl,
  data,
  back,
  run,
  openInterview,
  openSchedule,
  openDecision,
}: {
  rtl: boolean;
  data: Row;
  back: () => void;
  run: (payload: Row) => Promise<Row>;
  openInterview: (id: number) => void;
  openSchedule: (interview?: Row) => void;
  openDecision: (kind: "reject" | "offer") => void;
}) {
  const [tab, setTab] = useState("overview"),
    [uploading, setUploading] = useState(false),
    [file, setFile] = useState<File | null>(null),
    candidate = data.candidate || {},
    application = data.application || {},
    stages = data.stages || [],
    currentIndex = stages.findIndex(
      (x: Row) => Number(x.id) === Number(application.current_stage_id),
    ),
    match = data.match,
    offer = data.offers?.[0];
  const [correcting, setCorrecting] = useState(false),
    [correction, setCorrection] = useState<Row>({}),
    [actionError, setActionError] = useState("");
  const perform = async (action: () => Promise<unknown>) => {
    setActionError("");
    try { await action(); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)); }
  };
  // The form is only shown while correcting, so it is filled from the candidate when correction starts.
  const toggleCorrection = () => {
    if (!correcting)
      setCorrection({
        name: candidate.name || "",
        email: candidate.email || "",
        phone: candidate.phone || "",
        location: candidate.location || "",
        currentJobTitle: candidate.current_job_title || "",
        currentCompany: candidate.current_company || "",
        totalExperience: candidate.total_experience || "",
        skills: parseList(candidate.skills_json).join(", "),
        education: parseList(candidate.education_json).join(", "),
        languages: parseList(candidate.languages_json).join(", "),
        certifications: parseList(candidate.certifications_json).join(", "),
        projects: parseList(candidate.projects_json).join(", "),
        notes: candidate.notes || "",
      });
    setCorrecting(!correcting);
  };
  const saveCorrection = async () => {
    const commaList = (value: unknown) =>
      String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    await run({
      action: "update_candidate",
      applicationId: application.id,
      candidateId: candidate.id,
      documentId: data.documents?.[0]?.id,
      ...correction,
      totalExperience: Number(correction.totalExperience) || null,
      skills: commaList(correction.skills),
      education: commaList(correction.education),
      languages: commaList(correction.languages),
      certifications: commaList(correction.certifications),
      projects: commaList(correction.projects),
      correctedCv: {
        name: correction.name,
        email: correction.email,
        phone: correction.phone,
        location: correction.location,
        currentJobTitle: correction.currentJobTitle,
        currentCompany: correction.currentCompany,
        totalExperience: Number(correction.totalExperience) || null,
        skills: commaList(correction.skills),
        education: commaList(correction.education),
        languages: commaList(correction.languages),
        certifications: commaList(correction.certifications),
        projects: commaList(correction.projects),
      },
    });
    setCorrecting(false);
  };
  const move = (direction: number) => {
    const target = stages[currentIndex + direction];
    if (target)
      void perform(() => run({
        action: "move_application",
        applicationId: application.id,
        stageId: target.id,
      }));
  };
  const upload = async () => {
    if (!file) return;
    try {
      setUploading(true);
      const form = new FormData();
      form.set("applicationId", String(application.id));
      form.set("candidateId", String(candidate.id));
      form.set("file", file);
      const response = await fetch("/api/recruitment", {
          method: "POST",
          body: form,
        }),
        body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(localizeApiMessage(body.error || "Upload failed"));
      setFile(null);
      await run({ action: "run_match", applicationId: application.id });
    } finally {
      setUploading(false);
    }
  };
  const offerAction = async (action: string, status?: string) => {
    if (action === "convert_hire")
      await run({
        action,
        offerId: offer.id,
        nameAr: candidate.name,
        country: String(candidate.location || "")
          .toLowerCase()
          .includes("saudi")
          ? "Saudi Arabia"
          : "Egypt",
      });
    else
      await run({ action, offerId: offer.id, ...(status ? { status } : {}) });
  };
  const tabs = [
    ["overview", "Overview", "نظرة عامة"],
    ["cv", "CV", "السيرة الذاتية"],
    ["applications", "Applications", "طلبات التوظيف"],
    ["match", "Match analysis", "تحليل المطابقة"],
    ["interviews", "Interviews", "المقابلات"],
    ["evaluations", "Evaluations", "التقييمات"],
    ["activity", "Activity", "النشاط"],
  ];
  return (
    <>
      {actionError && <div className="form-error" role="alert">{actionError}</div>}
      <header className="ats-detail-head candidate">
        <button className="ats-back" onClick={back}>
          {rtl ? <ArrowRight /> : <ArrowLeft />}
          {t(rtl, "Back to candidates", "العودة إلى المرشحين")}
        </button>
        <div className="ats-candidate-title">
          <span className="ats-candidate-avatar">
            {String(candidate.name || "—")
              .split(" ")
              .map((x: string) => x[0])
              .join("")
              .slice(0, 2)}
          </span>
          <span>
            <h1>{candidate.name}</h1>
            <p>
              {candidate.current_job_title || candidate.email} ·{" "}
              {application.job_title}
            </p>
          </span>
        </div>
        <div className="ats-match-pill">
          <strong>{match ? `${num(match.overall_score, rtl)}%` : "—"}</strong>
          <small>
            {match
              ? t(rtl, "CV match", "مطابقة السيرة")
              : t(rtl, "Not analyzed", "لم يُحلل")}
          </small>
        </div>
        <div className="ats-decision-actions">
          <button
            className="outline"
            onClick={() =>
              void perform(() => run({
                action: "set_application_status",
                applicationId: application.id,
                status: "on_hold",
              }))
            }
          >
            {t(rtl, "Hold", "تعليق")}
          </button>
          <button
            className="ats-danger ghost"
            onClick={() => openDecision("reject")}
          >
            {t(rtl, "Reject", "رفض")}
          </button>
          {currentIndex > 0 && (
            <button className="outline" onClick={() => move(-1)}>
              {t(rtl, "Previous stage", "المرحلة السابقة")}
            </button>
          )}
          {currentIndex < stages.length - 2 && (
            <button className="primary" onClick={() => move(1)}>
              {t(rtl, "Next stage", "المرحلة التالية")}
            </button>
          )}
        </div>
      </header>
      <nav className="ats-detail-tabs">
        {tabs.map(([id, en, ar]) => (
          <button
            className={tab === id ? "active" : ""}
            key={id}
            onClick={() => setTab(id)}
          >
            {t(rtl, en, ar)}
          </button>
        ))}
      </nav>
      {tab === "overview" && (
        <div className="ats-review-layout">
          <main>
            <section className="ats-panel ats-candidate-summary">
              <header>
                <div>
                  <h2>{t(rtl, "Candidate summary", "ملخص المرشح")}</h2>
                  <p>
                    {candidate.email} · {candidate.phone || "—"}
                  </p>
                </div>
                <Status value={application.status} rtl={rtl} />
              </header>
              <dl>
                <div>
                  <dt>{t(rtl, "Current role", "الدور الحالي")}</dt>
                  <dd>{candidate.current_job_title || "—"}</dd>
                </div>
                <div>
                  <dt>{t(rtl, "Company", "الشركة")}</dt>
                  <dd>{candidate.current_company || "—"}</dd>
                </div>
                <div>
                  <dt>{t(rtl, "Experience", "الخبرة")}</dt>
                  <dd>
                    {candidate.total_experience
                      ? `${num(candidate.total_experience, rtl)} ${t(rtl, "years", "سنوات")}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>{t(rtl, "Location", "الموقع")}</dt>
                  <dd>{candidate.location || "—"}</dd>
                </div>
              </dl>
              <h3>{t(rtl, "Skills", "المهارات")}</h3>
              <div className="ats-tags">
                {parseList(candidate.skills_json).map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </section>
            <section className="ats-panel ats-next-action">
              <h2>{t(rtl, "Next action", "الإجراء التالي")}</h2>
              <div>
                <span>
                  <b>
                    {rtl ? application.stage_name_ar : application.stage_name}
                  </b>
                  <small>
                    {t(
                      rtl,
                      "Current configured stage",
                      "المرحلة الحالية المحددة",
                    )}
                  </small>
                </span>
                {[
                  "hr_interview",
                  "technical_interview",
                  "management_interview",
                ].includes(application.stage_key) && (
                  <button className="primary" onClick={() => openSchedule()}>
                    <CalendarClock />
                    {t(rtl, "Schedule interview", "جدولة مقابلة")}
                  </button>
                )}
                {application.stage_key === "offer" && !offer && (
                  <button
                    className="primary"
                    onClick={() => openDecision("offer")}
                  >
                    <FileText />
                    {t(rtl, "Create offer", "إنشاء عرض")}
                  </button>
                )}
              </div>
              {offer && (
                <div className="ats-offer-flow">
                  <span>
                    <b>{t(rtl, "Offer", "العرض")}</b>
                    <small>
                      {offer.position} · {date(offer.joining_date, rtl)}
                    </small>
                  </span>
                  <Status value={offer.approval_status} rtl={rtl} />
                  <Status value={offer.status} rtl={rtl} />
                  {data.permissions?.canAdmin &&
                    offer.approval_status === "pending" && (
                      <button onClick={() => void perform(() => offerAction("approve_offer"))}>
                        {t(rtl, "Approve", "اعتماد")}
                      </button>
                    )}
                  {offer.approval_status === "approved" &&
                    offer.status === "draft" && (
                      <button
                        onClick={() => void perform(() => offerAction("decide_offer", "sent"))}
                      >
                        {t(rtl, "Send", "إرسال")}
                      </button>
                    )}
                  {offer.status === "sent" && (
                    <button
                      onClick={() =>
                        void perform(() => offerAction("decide_offer", "accepted"))
                      }
                    >
                      {t(rtl, "Record acceptance", "تسجيل القبول")}
                    </button>
                  )}
                  {offer.status === "accepted" && (
                    <button
                      className="primary"
                      onClick={() => void perform(() => offerAction("convert_hire"))}
                    >
                      {t(rtl, "Hire & start onboarding", "تعيين وبدء التهيئة")}
                    </button>
                  )}
                </div>
              )}
            </section>
          </main>
          <aside>
            <MatchCard
              rtl={rtl}
              match={match}
              run={() =>
                run({ action: "run_match", applicationId: application.id })
              }
            />
            <section className="ats-panel ats-primary-actions">
              <h2>{t(rtl, "Application actions", "إجراءات الطلب")}</h2>
              <button
                onClick={() => move(1)}
                disabled={currentIndex >= stages.length - 2}
              >
                <Check />
                {t(rtl, "Move to next stage", "نقل للمرحلة التالية")}
              </button>
              <button onClick={() => openSchedule()}>
                <CalendarClock />
                {t(rtl, "Schedule interview", "جدولة مقابلة")}
              </button>
              <button className="danger" onClick={() => openDecision("reject")}>
                <X />
                {t(rtl, "Reject candidate", "رفض المرشح")}
              </button>
            </section>
          </aside>
        </div>
      )}
      {tab === "cv" && (
        <section className="ats-panel ats-cv">
          <header>
            <div>
              <h2>
                {t(
                  rtl,
                  "CV and extracted data",
                  "السيرة الذاتية والبيانات المستخرجة",
                )}
              </h2>
              <p>
                {t(
                  rtl,
                  "The original file is preserved; human corrections are never overwritten.",
                  "يُحفظ الملف الأصلي ولا تُستبدل التصحيحات البشرية تلقائيًا.",
                )}
              </p>
            </div>
            <button
              className="outline"
              onClick={toggleCorrection}
            >
              <Pencil />
              {correcting
                ? t(rtl, "Cancel correction", "إلغاء التصحيح")
                : t(rtl, "Correct extracted data", "تصحيح البيانات المستخرجة")}
            </button>
          </header>
          <div className="ats-upload">
            <label>
              <Upload />
              <span>
                {file?.name ||
                  t(
                    rtl,
                    "Choose PDF, DOCX, or TXT CV",
                    "اختر سيرة PDF أو DOCX أو TXT",
                  )}
              </span>
              <input
                type="file"
                accept=".pdf,.docx,.txt"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
            <button
              className="primary"
              disabled={!file || uploading}
              onClick={() => void perform(upload)}
            >
              {uploading
                ? t(rtl, "Uploading and parsing…", "جارٍ الرفع والتحليل…")
                : t(rtl, "Upload & parse", "رفع وتحليل")}
            </button>
          </div>
          {data.documents?.map((doc: Row) => (
            <article className="ats-document" key={doc.id}>
              <FileText />
              <span>
                <b>{doc.name}</b>
                <small>
                  {num(doc.size_bytes / 1024, rtl)} KB ·{" "}
                  {date(doc.created_at, rtl)} · {t(rtl, "Version", "الإصدار")}{" "}
                  {doc.version}
                </small>
              </span>
              <Status value={doc.parsing_status} rtl={rtl} />
              <a
                className="outline"
                href={`/api/recruitment/documents/${doc.id}`}
                target="_blank"
                rel="noreferrer"
              >
                <Eye />
                {t(rtl, "View", "عرض")}
              </a>
            </article>
          ))}
          {correcting && (
            <section className="ats-form-section ats-correction-form">
              <div className="ats-section-title">
                <div>
                  <h3>
                    {t(
                      rtl,
                      "Verified candidate data",
                      "بيانات المرشح المتحقق منها",
                    )}
                  </h3>
                  <p>
                    {t(
                      rtl,
                      "Saving creates a new candidate profile version and makes the current match stale.",
                      "ينشئ الحفظ إصدارًا جديدًا للملف ويجعل المطابقة الحالية بحاجة لإعادة التحليل.",
                    )}
                  </p>
                </div>
              </div>
              <div className="ats-form-grid">
                {[
                  ["name", "Full name", "الاسم الكامل"],
                  ["email", "Email", "البريد الإلكتروني"],
                  ["phone", "Phone", "الهاتف"],
                  ["location", "Location", "الموقع"],
                  ["currentJobTitle", "Current job title", "المسمى الحالي"],
                  ["currentCompany", "Current company", "الشركة الحالية"],
                  ["totalExperience", "Experience years", "سنوات الخبرة"],
                  ["skills", "Skills (comma separated)", "المهارات (بفواصل)"],
                  [
                    "education",
                    "Education (comma separated)",
                    "التعليم (بفواصل)",
                  ],
                  [
                    "languages",
                    "Languages (comma separated)",
                    "اللغات (بفواصل)",
                  ],
                  [
                    "certifications",
                    "Certifications (comma separated)",
                    "الشهادات (بفواصل)",
                  ],
                  [
                    "projects",
                    "Projects (comma separated)",
                    "المشروعات (بفواصل)",
                  ],
                ].map(([key, en, ar]) => (
                  <label className="ats-field" key={key}>
                    <span>{t(rtl, en, ar)}</span>
                    <input
                      type={
                        key === "totalExperience"
                          ? "number"
                          : key === "email"
                            ? "email"
                            : "text"
                      }
                      value={correction[key] ?? ""}
                      onChange={(event) =>
                        setCorrection({
                          ...correction,
                          [key]: event.target.value,
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="ats-correction-actions">
                <button
                  className="outline"
                  onClick={() => setCorrecting(false)}
                >
                  {t(rtl, "Cancel", "إلغاء")}
                </button>
                <button
                  className="primary"
                  disabled={!correction.name || !correction.email}
                  onClick={() => void perform(saveCorrection)}
                >
                  <Check />
                  {t(rtl, "Save verified data", "حفظ البيانات المتحققة")}
                </button>
              </div>
            </section>
          )}
          {data.parsedCv && (
            <pre className="ats-extracted">
              {JSON.stringify(
                data.parsedCv.corrected &&
                  Object.keys(data.parsedCv.corrected).length
                  ? data.parsedCv.corrected
                  : data.parsedCv.extracted,
                null,
                2,
              )}
            </pre>
          )}
        </section>
      )}
      {tab === "applications" && (
        <section className="ats-panel ats-simple-list">
          <header>
            <div>
              <h2>{t(rtl, "Application history", "سجل طلبات التوظيف")}</h2>
              <p>
                {t(
                  rtl,
                  "Previous applications and outcomes are retained.",
                  "تُحفظ الطلبات والنتائج السابقة.",
                )}
              </p>
            </div>
          </header>
          {data.applications?.map((item: Row) => (
            <div className="ats-static-row" key={item.id}>
              <BriefcaseBusiness />
              <span>
                <b>{item.job_title}</b>
                <small>
                  {date(item.applied_at, rtl)} ·{" "}
                  {rtl ? item.stage_name_ar : item.stage_name}
                </small>
              </span>
              <strong>
                {item.overall_score == null
                  ? "—"
                  : `${num(item.overall_score, rtl)}%`}
              </strong>
              <Status value={item.status} rtl={rtl} />
            </div>
          ))}
        </section>
      )}
      {tab === "match" && (
        <MatchAnalysis
          rtl={rtl}
          data={data}
          run={() =>
            run({ action: "run_match", applicationId: application.id })
          }
        />
      )}{" "}
      {tab === "interviews" && (
        <section className="ats-panel ats-simple-list">
          <header>
            <div>
              <h2>{t(rtl, "Interview history", "سجل المقابلات")}</h2>
              <p>
                {t(
                  rtl,
                  "Scheduling and feedback completion by stage",
                  "الجدولة واكتمال التقييم حسب المرحلة",
                )}
              </p>
            </div>
            <button className="primary" onClick={() => openSchedule()}>
              <Plus />
              {t(rtl, "Schedule", "جدولة")}
            </button>
          </header>
          {data.interviews?.length ? (
            data.interviews.map((item: Row) => (
              <div className="ats-interview-row" key={item.id}>
                <button onClick={() => openInterview(Number(item.id))}>
                  <span className="ats-person">
                    <CalendarClock />
                    <span>
                      <b>{rtl ? item.stage_name_ar : item.stage_name}</b>
                      <small>
                        {date(item.scheduled_at, rtl, true)} ·{" "}
                        {item.interviewer_count}{" "}
                        {t(rtl, "interviewers", "محاورين")}
                      </small>
                    </span>
                  </span>
                  <span>
                    {item.submitted_count}/{item.interviewer_count}{" "}
                    {t(rtl, "feedback", "تقييمات")}
                  </span>
                  <Status value={item.status} rtl={rtl} />
                  <ChevronRight />
                </button>
                {item.status === "scheduled" && data.permissions?.canEdit && (
                  <div>
                    <button
                      className="outline"
                      onClick={() => openSchedule(item)}
                    >
                      {t(rtl, "Reschedule", "إعادة الجدولة")}
                    </button>
                    <button
                      className="ats-danger ghost"
                      onClick={() => {
                        const reason = window.prompt(
                          t(rtl, "Cancellation reason", "سبب الإلغاء"),
                        );
                        if (reason)
                          void perform(() => run({
                            action: "cancel_interview",
                            interviewId: item.id,
                            reason,
                          }));
                      }}
                    >
                      {t(rtl, "Cancel", "إلغاء")}
                    </button>
                  </div>
                )}
              </div>
            ))
          ) : (
            <Empty rtl={rtl} />
          )}
        </section>
      )}
      {tab === "evaluations" && <Evaluations rtl={rtl} data={data} />}{" "}
      {tab === "activity" && (
        <Timeline
          rtl={rtl}
          rows={[...(data.stageHistory || []), ...(data.activity || [])]}
        />
      )}
    </>
  );
}

function parseList(value: unknown) {
  try {
    const list = Array.isArray(value)
      ? value
      : JSON.parse(String(value || "[]"));
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}
function MatchCard({
  rtl,
  match,
  run,
}: {
  rtl: boolean;
  match?: Row;
  run: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const analyze = async () => {
    setBusy(true); setError("");
    try { await run(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return (
    <section className="ats-panel ats-match-card">
      <header>
        <div>
          <h2>{t(rtl, "Candidate match", "مطابقة المرشح")}</h2>
          <p>{t(rtl, "Decision support only", "لدعم القرار فقط")}</p>
        </div>
        {match && <Status value={match.classification} rtl={rtl} />}
      </header>
      <div className="ats-match-score">
        <strong>{match ? `${num(match.overall_score, rtl)}%` : "—"}</strong>
        <span>
          {match
            ? localizedDisplayValue(match.classification, rtl)
            : t(rtl, "Not analyzed", "لم يُحلل")}
        </span>
      </div>
      {Number(match?.is_stale) > 0 && (
        <div className="ats-stale">
          <AlertTriangle />
          {t(
            rtl,
            "Requirements or candidate data changed. Re-run the match.",
            "تغيرت المتطلبات أو بيانات المرشح. أعد التحليل.",
          )}
        </div>
      )}
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="outline wide" disabled={busy} onClick={() => void analyze()}>
        <Sparkles />
        {match
          ? t(rtl, "Run match again", "إعادة المطابقة")
          : t(rtl, "Analyze match", "تحليل المطابقة")}
      </button>
    </section>
  );
}
function MatchAnalysis({
  rtl,
  data,
  run,
}: {
  rtl: boolean;
  data: Row;
  run: () => Promise<unknown>;
}) {
  const match = data.match;
  return (
    <div className="ats-match-analysis">
      <MatchCard rtl={rtl} match={match} run={run} />
      <section className="ats-panel ats-breakdown">
        <header>
          <div>
            <h2>{t(rtl, "Requirement breakdown", "تفصيل المتطلبات")}</h2>
            <p>
              {t(
                rtl,
                "Evidence status distinguishes confirmed, inferred, missing, and needs verification.",
                "حالة الدليل تميز بين المؤكد والمستنتج والمفقود وما يحتاج تحققًا.",
              )}
            </p>
          </div>
        </header>
        {data.requirementScores?.length ? (
          data.requirementScores.map((item: Row) => (
            <article key={item.id}>
              <div className="ats-breakdown-score">
                <strong>{num(item.score, rtl)}%</strong>
                <span style={{ width: `${item.score}%` }} />
              </div>
              <div>
                <b>{item.requirement_name}</b>
                <small>
                  {localizedDisplayValue(item.category, rtl)} ·{" "}
                  {num(item.weight, rtl)}%
                </small>
                <p>
                  <strong>
                    {localizedDisplayValue(item.evidence_status, rtl)}
                  </strong>{" "}
                  — {item.rationale}
                </p>
                {item.evidence && <blockquote>{item.evidence}</blockquote>}
              </div>
            </article>
          ))
        ) : (
          <Empty rtl={rtl} />
        )}
      </section>
      {match && (
        <aside className="ats-match-notes">
          <section className="ats-panel">
            <h2>{t(rtl, "Strong matches", "نقاط القوة")}</h2>
            {match.strong_matches?.map((x: string) => (
              <span key={x}>
                <Check />
                {x}
              </span>
            ))}
          </section>
          <section className="ats-panel warning">
            <h2>{t(rtl, "Missing / verify", "مفقود / يحتاج تحققًا")}</h2>
            {[
              ...(match.missing_requirements || []),
              ...(match.concerns || []),
            ].map((x: string) => (
              <span key={x}>
                <AlertTriangle />
                {x}
              </span>
            ))}
          </section>
          <section className="ats-panel">
            <h2>
              {t(rtl, "Suggested verification questions", "أسئلة تحقق مقترحة")}
            </h2>
            <small className="ats-ai-label">
              <Sparkles />
              {t(rtl, "System suggestion", "اقتراح النظام")}
            </small>
            {match.suggested_questions?.map((x: string) => (
              <p key={x}>{x}</p>
            ))}
          </section>
        </aside>
      )}
    </div>
  );
}
function Evaluations({ rtl, data }: { rtl: boolean; data: Row }) {
  const summary = data.evaluationSummary || {};
  return (
    <div className="ats-evaluation-summary">
      <section className="ats-panel">
        <header>
          <div>
            <h2>{t(rtl, "Consolidated evaluation", "التقييم الموحد")}</h2>
            <p>
              {t(
                rtl,
                "Shown only to authorized HR and hiring owners.",
                "يظهر فقط للموارد البشرية وأصحاب قرار التوظيف المصرح لهم.",
              )}
            </p>
          </div>
          {summary.allRequiredComplete ? (
            <Status value="completed" rtl={rtl} />
          ) : (
            <Status value="pending" rtl={rtl} />
          )}
        </header>
        <div className="ats-score-trio">
          <span>
            <b>
              {summary.cvMatch == null ? "—" : `${num(summary.cvMatch, rtl)}%`}
            </b>
            <small>{t(rtl, "CV match", "مطابقة السيرة")}</small>
          </span>
          <span>
            <b>
              {summary.interviewScore == null
                ? "—"
                : `${num(summary.interviewScore, rtl)}%`}
            </b>
            <small>{t(rtl, "Interview score", "تقييم المقابلات")}</small>
          </span>
          <span>
            <b>
              {summary.decisionSupportScore == null
                ? "—"
                : `${num(summary.decisionSupportScore, rtl)}%`}
            </b>
            <small>{t(rtl, "Decision support", "مؤشر دعم القرار")}</small>
          </span>
        </div>
        <p className="ats-formula">
          {t(
            rtl,
            `Formula: CV ${summary.formula?.cvWeight || 40}% + weighted interview stages ${summary.formula?.interviewWeight || 60}%.`,
            `المعادلة: السيرة ${summary.formula?.cvWeight || 40}٪ + مراحل المقابلات الموزونة ${summary.formula?.interviewWeight || 60}٪.`,
          )}
        </p>
        {summary.stageResults?.map((stage: Row) => (
          <div className="ats-stage-score" key={stage.id}>
            <span>
              <b>{stage.name}</b>
              <small>
                {stage.submitted}/{stage.required}{" "}
                {t(rtl, "submitted", "مكتمل")}
              </small>
            </span>
            <strong>
              {stage.score == null ? "—" : `${num(stage.score, rtl)}%`}
            </strong>
            <Status
              value={stage.complete ? "completed" : "pending"}
              rtl={rtl}
            />
          </div>
        ))}
      </section>
      <section className="ats-panel ats-individual-evals">
        <h2>{t(rtl, "Independent evaluations", "التقييمات المستقلة")}</h2>
        {data.evaluations?.map((item: Row) => (
          <article key={item.id}>
            <span>
              <b>{rtl ? item.interviewer_name_ar : item.interviewer_name}</b>
              <small>{rtl ? item.stage_name_ar : item.stage_name}</small>
            </span>
            <strong>{num(item.overall_score, rtl)}%</strong>
            <Status value={item.recommendation} rtl={rtl} />
            <p>{item.notes}</p>
          </article>
        ))}
      </section>
    </div>
  );
}

function InterviewsView({
  rtl,
  data,
  openInterview,
}: {
  rtl: boolean;
  data: Row;
  openInterview: (id: number) => void;
}) {
  const [tab, setTab] = useState("today"),
    today = new Date().toISOString().slice(0, 10),
    rows = (data.interviews || []).filter((item: Row) =>
      tab === "today"
        ? String(item.scheduled_at).slice(0, 10) === today
        : tab === "upcoming"
          ? new Date(item.scheduled_at) > new Date()
          : tab === "awaiting"
            ? item.my_evaluation_status !== "submitted"
            : item.status === "completed",
    );
  return (
    <section className="ats-panel ats-list-panel">
      <header className="ats-list-head">
        <div>
          <h2>{t(rtl, "Interviews", "المقابلات")}</h2>
          <p>
            {t(
              rtl,
              "My interviews and authorized hiring team schedule",
              "مقابلاتي وجدول فريق التوظيف المصرح به",
            )}
          </p>
        </div>
      </header>
      <nav className="ats-inline-tabs">
        {[
          ["today", "Today", "اليوم"],
          ["upcoming", "Upcoming", "القادمة"],
          ["awaiting", "Awaiting my evaluation", "بانتظار تقييمي"],
          ["completed", "Completed", "المكتملة"],
        ].map(([id, en, ar]) => (
          <button
            className={tab === id ? "active" : ""}
            key={id}
            onClick={() => setTab(id)}
          >
            {t(rtl, en, ar)}
          </button>
        ))}
      </nav>
      {rows.length ? (
        <div className="ats-card-grid ats-interview-grid">
          {rows.map((item: Row) => (
            <button
              className="ats-interview-card"
              key={item.id}
              onClick={() => openInterview(Number(item.id))}
            >
              <span className="ats-card-icon">
                <CalendarClock />
              </span>
              <span>
                <b>{item.candidate_name}</b>
                <small>{item.job_title}</small>
                <em>{rtl ? item.stage_name_ar : item.stage_name}</em>
              </span>
              <time>{date(item.scheduled_at, rtl, true)}</time>
              <div>
                <Status value={item.status} rtl={rtl} />
                <Status value={item.my_evaluation_status} rtl={rtl} />
              </div>
            </button>
          ))}
        </div>
      ) : (
        <Empty rtl={rtl} />
      )}
    </section>
  );
}

function InterviewDetail({
  rtl,
  data,
  back,
  run,
}: {
  rtl: boolean;
  data: Row;
  back: () => void;
  run: (payload: Row) => Promise<Row>;
}) {
  const interview = data.interview || {},
    submitted = data.myEvaluation?.status === "submitted",
    initialScores = Object.fromEntries(
      (data.myEvaluation?.scores || []).map((x: Row) => [
        x.criterion_id,
        x.score,
      ]),
    ),
    [scores, setScores] = useState<Row>(initialScores),
    [notes, setNotes] = useState(data.myEvaluation?.notes || ""),
    [recommendation, setRecommendation] = useState(
      data.myEvaluation?.recommendation || "",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const save = async (submit: boolean) => {
    try {
      setBusy(true);
      setError("");
      await run({
        action: submit ? "submit_evaluation" : "save_evaluation",
        interviewId: interview.id,
        notes,
        recommendation,
        scores: data.criteria
          .map((x: Row) => ({
            criterionId: x.id,
            score: Number(scores[x.id]) || 0,
          }))
          .filter((x: Row) => x.score),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <header className="ats-detail-head">
        <button className="ats-back" onClick={back}>
          {rtl ? <ArrowRight /> : <ArrowLeft />}
          {t(rtl, "Back to interviews", "العودة إلى المقابلات")}
        </button>
        <div>
          <span>{rtl ? interview.stage_name_ar : interview.stage_name}</span>
          <h1>{interview.candidate_name}</h1>
          <p>
            {interview.job_title} · {date(interview.scheduled_at, rtl, true)}
          </p>
        </div>
        <Status value={interview.status} rtl={rtl} />
      </header>
      <div className="ats-interview-workspace">
        <main>
          <section className="ats-panel ats-context">
            <header>
              <div>
                <h2>{t(rtl, "Candidate context", "سياق المرشح")}</h2>
                <p>
                  {t(
                    rtl,
                    "Only information relevant to this assigned interview is shown.",
                    "تظهر فقط المعلومات ذات الصلة بهذه المقابلة المسندة.",
                  )}
                </p>
              </div>
              {interview.match_score != null && (
                <strong>
                  {num(interview.match_score, rtl)}% {t(rtl, "match", "مطابقة")}
                </strong>
              )}
            </header>
            <dl>
              <div>
                <dt>{t(rtl, "Current role", "الدور الحالي")}</dt>
                <dd>{interview.current_job_title || "—"}</dd>
              </div>
              <div>
                <dt>{t(rtl, "Experience", "الخبرة")}</dt>
                <dd>
                  {interview.total_experience
                    ? `${interview.total_experience} ${t(rtl, "years", "سنوات")}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>{t(rtl, "Skills", "المهارات")}</dt>
                <dd>{interview.skills?.join("، ") || "—"}</dd>
              </div>
            </dl>
          </section>
          <section className="ats-panel ats-verify">
            <h2>{t(rtl, "Areas to verify", "نقاط تحتاج تحققًا")}</h2>
            {interview.concerns?.map((item: string) => (
              <p key={item}>
                <AlertTriangle />
                {item}
              </p>
            ))}
            {interview.suggestedQuestions?.map((item: string) => (
              <p key={item}>
                <Sparkles />
                {item}
                <small>{t(rtl, "Suggested", "مقترح")}</small>
              </p>
            ))}
          </section>
          <section className="ats-panel ats-questions">
            <h2>{t(rtl, "Assigned questions", "الأسئلة المسندة")}</h2>
            {data.questions?.map((item: Row, index: number) => (
              <article key={item.id}>
                <span>{num(index + 1, rtl)}</span>
                <div>
                  <b>{item.question}</b>
                  {item.what_good_looks_like && (
                    <details>
                      <summary>
                        {t(
                          rtl,
                          "What good looks like",
                          "مؤشرات الإجابة الجيدة",
                        )}
                      </summary>
                      <p>{item.what_good_looks_like}</p>
                    </details>
                  )}
                </div>
              </article>
            ))}
          </section>
          <section className="ats-panel ats-notes">
            <h2>{t(rtl, "Interview notes", "ملاحظات المقابلة")}</h2>
            <textarea
              disabled={submitted}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t(
                rtl,
                "Capture evidence and concise observations…",
                "سجل الأدلة والملاحظات المختصرة…",
              )}
            />
          </section>
        </main>
        <aside>
          <section className="ats-panel ats-scorecard">
            <header>
              <div>
                <h2>{t(rtl, "Scorecard", "بطاقة التقييم")}</h2>
                <p>
                  {t(
                    rtl,
                    "Score each criterion from 1 to 5.",
                    "قيّم كل معيار من 1 إلى 5.",
                  )}
                </p>
              </div>
              {submitted && <Status value="submitted" rtl={rtl} />}
            </header>
            {data.criteria?.map((item: Row) => (
              <label key={item.id}>
                <span>
                  <b>{rtl ? item.name_ar : item.name_en}</b>
                  <small>{num(item.weight, rtl)}%</small>
                </span>
                <select
                  disabled={submitted}
                  value={scores[item.id] || ""}
                  onChange={(e) =>
                    setScores({ ...scores, [item.id]: Number(e.target.value) })
                  }
                >
                  <option value="">—</option>
                  {[1, 2, 3, 4, 5].map((x) => (
                    <option value={x} key={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className="ats-recommend">
              <span>{t(rtl, "Overall recommendation", "التوصية العامة")}</span>
              <select
                disabled={submitted}
                value={recommendation}
                onChange={(e) => setRecommendation(e.target.value)}
              >
                <option value="">—</option>
                <option value="strong_hire">
                  {t(rtl, "Strong hire", "تعيين قوي")}
                </option>
                <option value="hire">{t(rtl, "Hire", "تعيين")}</option>
                <option value="mixed">
                  {t(rtl, "Mixed / needs review", "مختلط / يحتاج مراجعة")}
                </option>
                <option value="no_hire">
                  {t(rtl, "No hire", "عدم التعيين")}
                </option>
              </select>
            </label>
            {error && <div className="form-error">{error}</div>}
            {!submitted && (
              <div className="ats-submit-actions">
                <button
                  className="outline"
                  disabled={busy}
                  onClick={() => void save(false)}
                >
                  {t(rtl, "Save draft", "حفظ مسودة")}
                </button>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !recommendation ||
                    data.criteria.some((x: Row) => !scores[x.id])
                  }
                  onClick={() => void save(true)}
                >
                  {t(rtl, "Submit evaluation", "إرسال التقييم")}
                </button>
              </div>
            )}
            <p className="ats-privacy-note">
              {t(
                rtl,
                "Other interviewers’ ratings remain hidden until all required evaluations are submitted.",
                "تظل تقييمات المحاورين الآخرين مخفية حتى اكتمال جميع التقييمات المطلوبة.",
              )}
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}

function SetupView({
  rtl,
  data,
  run,
}: {
  rtl: boolean;
  data: Row;
  run: (payload: Row) => Promise<Row>;
}) {
  const [tab, setTab] = useState("templates"),
    [form, setForm] = useState<Row>({ questionType: "behavioral" }),
    [templateEdit, setTemplateEdit] = useState<Row | null>(null),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const add = async () => {
    try {
      setError("");
      setSaving(true);
      await run({ ...form, action: form.questionId ? "update_question" : "create_question" });
      setForm({ questionType: "behavioral" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setSaving(false); }
  };
  const removeTemplate = async (template: Row) => {
    if (!window.confirm(t(rtl, `Delete “${template.name}”? This cannot be undone.`, `هل تريد حذف قالب «${template.name}»؟ لا يمكن التراجع عن هذا الإجراء.`))) return;
    try { setError(""); await run({ action: "delete_template", templateId: template.id }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const removeQuestion = async (item: Row) => {
    if (!window.confirm(t(rtl, "Delete this question from the bank? This cannot be undone.", "هل تريد حذف هذا السؤال من البنك؟ لا يمكن التراجع عن هذا الإجراء."))) return;
    try { setError(""); await run({ action: "delete_question", questionId: item.id }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const removeStage = async (stage: Row) => {
    if (!window.confirm(t(rtl, "Delete this scorecard stage? This cannot be undone.", "هل تريد حذف بطاقة التقييم هذه؟ لا يمكن التراجع عن هذا الإجراء."))) return;
    try { setError(""); await run({ action: "delete_template_stage", templateStageId: stage.id }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return (
    <section className="ats-panel ats-setup">
      <header className="ats-list-head">
        <div>
          <h2>{t(rtl, "Interview setup", "إعداد المقابلات")}</h2>
          <p>
            {t(
              rtl,
              "Reusable templates, dynamic interviewers, questions, and scorecards",
              "قوالب قابلة لإعادة الاستخدام ومحاورون ديناميكيون وأسئلة وبطاقات تقييم",
            )}
          </p>
        </div>
      </header>
      <nav className="ats-inline-tabs">
        {[
          ["templates", "Templates", "القوالب"],
          ["questions", "Question bank", "بنك الأسئلة"],
          ["scorecards", "Scorecards", "بطاقات التقييم"],
        ].map(([id, en, ar]) => (
          <button
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
            key={id}
          >
            {t(rtl, en, ar)}
          </button>
        ))}
      </nav>
      {error && <div className="form-error ats-setup-error">{error}</div>}
      {tab === "templates" && (
        <div className="ats-template-workspace">
          <section className="ats-question-form ats-template-form">
            <h3>{t(rtl, "Interview templates", "قوالب المقابلات")}</h3>
            <p>{t(rtl, "Customize stages, interviewers, questions and scorecards.", "خصص المراحل والمحاورين والأسئلة وبطاقات التقييم.")}</p>
            <button className="primary" onClick={() => setTemplateEdit({})}><Plus />{t(rtl, "Create template", "إنشاء قالب")}</button>
          </section>
          <div className="ats-template-list">
            {data.templates?.map((template: Row) => (
              <article key={template.id}>
                <header>
                  <span>
                    <Settings2 />
                  </span>
                  <div>
                    <div className="ats-card-title-row">
                      <h3>{template.name}</h3>
                      <Status value={template.status} rtl={rtl} />
                    </div>
                    <p>
                      {localizedDisplayValue(template.scope_type, rtl)} ·{" "}
                      {rtl
                        ? template.department_name_ar
                        : template.department_name}
                    </p>
                  </div>
                  <div className="ats-card-actions">
                    <button className="ats-icon-button" onClick={() => setTemplateEdit(template)} aria-label={t(rtl, "Edit template", "تعديل القالب")} title={t(rtl, "Edit", "تعديل")}><Pencil size={16} /></button>
                    <button className="ats-icon-button danger" onClick={() => void removeTemplate(template)} aria-label={t(rtl, "Delete template", "حذف القالب")} title={t(rtl, "Delete", "حذف")}><Trash2 size={16} /></button>
                  </div>
                </header>
                <div>
                  {data.templateStages
                    ?.filter(
                      (x: Row) => Number(x.template_id) === Number(template.id),
                    )
                    .map((stage: Row, index: number) => (
                      <span key={stage.id}>
                        <b>{num(index + 1, rtl)}</b>
                        {rtl ? stage.name_ar : stage.name_en}
                        <small>
                          {stage.duration_minutes} {t(rtl, "min", "د")}
                        </small>
                      </span>
                    ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
      {tab === "questions" && (
        <div className="ats-setup-grid">
          <section className="ats-question-form">
            <h3>{form.questionId ? t(rtl, "Edit question", "تعديل السؤال") : t(rtl, "Add question", "إضافة سؤال")}</h3>
            <label>
              <span>{t(rtl, "Question", "السؤال")}</span>
              <textarea
                value={form.question || ""}
                onChange={(e) => setForm({ ...form, question: e.target.value })}
              />
            </label>
            <label>
              <span>{t(rtl, "Type", "النوع")}</span>
              <select
                value={form.questionType}
                onChange={(e) =>
                  setForm({ ...form, questionType: e.target.value })
                }
              >
                {[
                  "technical",
                  "behavioral",
                  "situational",
                  "leadership",
                  "communication",
                  "culture_fit",
                  "role_specific",
                  "verification",
                ].map((x) => (
                  <option key={x} value={x}>
                    {localizedDisplayValue(x, rtl)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>
                {t(rtl, "What good looks like", "مؤشرات الإجابة الجيدة")}
              </span>
              <textarea
                value={form.whatGoodLooksLike || ""}
                onChange={(e) =>
                  setForm({ ...form, whatGoodLooksLike: e.target.value })
                }
              />
            </label>
            <label>
              <span>{t(rtl, "Evaluation guidance", "إرشادات التقييم")}</span>
              <textarea
                value={form.evaluationGuidance || ""}
                onChange={(e) =>
                  setForm({ ...form, evaluationGuidance: e.target.value })
                }
              />
            </label>
            {form.questionId && <><label><span>{t(rtl, "Status", "الحالة")}</span><select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}><option value="active">{t(rtl, "Active", "نشط")}</option><option value="inactive">{t(rtl, "Inactive", "غير نشط")}</option></select></label><button className="outline" disabled={saving} onClick={() => { setForm({ questionType: "behavioral" }); setError(""); }}>{t(rtl, "Cancel editing", "إلغاء التعديل")}</button></>}
            <button
              className="primary"
              disabled={saving || !String(form.question || "").trim()}
              onClick={() => void add()}
            >
              <Plus />
              {form.questionId ? t(rtl, "Save changes", "حفظ التعديلات") : t(rtl, "Add to bank", "إضافة إلى البنك")}
            </button>
          </section>
          <div className="ats-question-bank">
            {data.questions?.map((item: Row) => (
              <article key={item.id}>
                <span>
                  <MessageSquareText />
                </span>
                <div>
                  <b>{item.question}</b>
                  <small>
                    {localizedDisplayValue(item.question_type, rtl)} ·{" "}
                    {item.skill ||
                      item.competency ||
                      t(rtl, "Company-wide", "على مستوى الشركة")}
                  </small>
                  {item.what_good_looks_like && (
                    <p>{item.what_good_looks_like}</p>
                  )}
                </div>
                <div className="ats-card-actions">
                  <button className="ats-icon-button" onClick={() => { setError(""); setForm({ questionId: item.id, question: item.question, questionType: item.question_type, whatGoodLooksLike: item.what_good_looks_like || "", evaluationGuidance: item.evaluation_guidance || "", status: item.status }); }} aria-label={t(rtl, "Edit question", "تعديل السؤال")} title={t(rtl, "Edit", "تعديل")}><Pencil size={16} /></button>
                  <button className="ats-icon-button danger" onClick={() => void removeQuestion(item)} aria-label={t(rtl, "Delete question", "حذف السؤال")} title={t(rtl, "Delete", "حذف")}><Trash2 size={16} /></button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
      {tab === "scorecards" && (
        <div className="ats-template-list">
          {data.templateStages?.map((stage: Row) => (
            <article key={stage.id}>
              <header>
                <span>
                  <ClipboardCheck />
                </span>
                <div>
                  <h3>{rtl ? stage.name_ar : stage.name_en}</h3>
                  <p>
                    {t(rtl, "Independent evaluations", "تقييمات مستقلة")} ·{" "}
                    {num(stage.aggregation_weight, rtl)}%
                  </p>
                </div>
                <div className="ats-card-actions">
                  <button className="ats-icon-button" onClick={() => { setTemplateEdit(data.templates.find((x: Row) => x.id === stage.template_id)); }} aria-label={t(rtl, "Edit scorecard", "تعديل بطاقة التقييم")} title={t(rtl, "Edit scorecard", "تعديل بطاقة التقييم")}><Pencil size={16} /></button>
                  <button className="ats-icon-button danger" onClick={() => void removeStage(stage)} aria-label={t(rtl, "Delete scorecard", "حذف بطاقة التقييم")} title={t(rtl, "Delete", "حذف")}><Trash2 size={16} /></button>
                </div>
              </header>
              <div>
                {data.templateCriteria
                  ?.filter(
                    (x: Row) =>
                      Number(x.template_stage_id) === Number(stage.id),
                  )
                  .map((item: Row) => (
                    <span key={item.id}>
                      {rtl ? item.name_ar : item.name_en}
                      <small>{num(item.weight, rtl)}%</small>
                    </span>
                  ))}
              </div>
            </article>
          ))}
        </div>
      )}
      {templateEdit && <InterviewTemplateEditor rtl={rtl} data={data} template={templateEdit} run={run} close={() => setTemplateEdit(null)} />}
    </section>
  );
}

function Timeline({ rtl, rows }: { rtl: boolean; rows: Row[] }) {
  return (
    <section className="ats-panel ats-timeline">
      <header>
        <div>
          <h2>{t(rtl, "Activity timeline", "الخط الزمني للنشاط")}</h2>
          <p>
            {t(
              rtl,
              "Immutable recruitment actions with actor and timestamp",
              "إجراءات توظيف غير قابلة للمحو مع المنفذ والتوقيت",
            )}
          </p>
        </div>
      </header>
      {rows.length ? (
        rows
          .sort((a, b) =>
            String(b.created_at).localeCompare(String(a.created_at)),
          )
          .map((item, index) => (
            <article key={`${item.id}-${index}`}>
              <span>
                <History />
              </span>
              <div>
                <b>
                  {localizedDisplayValue(item.action || item.stage_key, rtl)}
                </b>
                <p>{item.reason || item.actor_email || "—"}</p>
                <small>{date(item.created_at, rtl, true)}</small>
              </div>
            </article>
          ))
      ) : (
        <Empty rtl={rtl} />
      )}
    </section>
  );
}

export function RecruitmentWorkspace({
  rtl,
  notify,
}: {
  rtl: boolean;
  notify: (message: string) => void;
}) {
  const [route, setRoute] = useState<Route>({ view: "overview" }),
    [data, setData] = useState<Row | null>(null),
    [shared, setShared] = useState<Row>({}),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [modal, setModal] = useState<
      "job" | "candidate" | "schedule" | "reject" | "offer" | null
    >(null),
    [scheduledInterview, setScheduledInterview] = useState<Row | null>(null);
  const query = useMemo(
    () =>
      route.id
        ? route.view === "jobs"
          ? `?view=job&id=${route.id}`
          : route.view === "candidates"
            ? `?view=candidate&id=${route.id}&applicationId=${route.applicationId}`
            : route.view === "interviews"
              ? `?view=interview&id=${route.id}`
              : `?view=${route.view}`
        : `?view=${route.view}`,
    [route],
  );
  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError("");
      const next = await get(query);
      setData(next);
      setShared((current: Row) => ({
        ...current,
        employees: next.employees || current.employees,
        departments: next.departments || current.departments,
        templates: next.templates || current.templates,
        jobs: next.jobs || current.jobs,
        permissions: next.permissions || current.permissions,
        currentActor: next.currentActor || current.currentActor,
      }));
      if (
        next.currentActor?.roleName === "Employee" &&
        route.view === "overview" &&
        !route.id
      )
        setRoute({ view: "interviews" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [query, route.id, route.view]);
  useEffect(() => {
    // load() shows the loading state (which swaps the view for the spinner) before it fetches, and it must do
    // so whenever the route changes. Only a data-fetching library or moving the flag into every navigation
    // handler would avoid setting it here, and neither keeps the current behavior.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-route-change; see comment above
    void load();
  }, [load]);
  const run = async (payload: Row) => {
    const result = await post(payload);
    notify(t(rtl, "Recruitment action saved", "تم حفظ إجراء التوظيف"));
    await load(true);
    return result;
  };
  const navigate = (view: View) => setRoute({ view }),
    openJobDetail = (id: number) => setRoute({ view: "jobs", id }),
    openCandidate = (id: number, applicationId: number) =>
      setRoute({ view: "candidates", id, applicationId }),
    openInterview = (id: number) => setRoute({ view: "interviews", id }),
    employeeOnly =
      (data?.currentActor || shared.currentActor)?.roleName === "Employee",
    tabs = (
      employeeOnly
        ? [["interviews", "My interviews", "مقابلاتي"]]
        : [
            ["overview", "Overview", "نظرة عامة"],
            ["jobs", "Jobs", "الوظائف"],
            ["candidates", "Candidates", "المرشحون"],
            ["interviews", "Interviews", "المقابلات"],
            ...(shared.permissions?.canSetup
              ? [["setup", "Interview setup", "إعداد المقابلات"]]
              : []),
          ]
    ) as string[][];
  const merged = { ...shared, ...data, jobs: data?.jobs || shared.jobs };
  return (
    <section className="ats-page" dir={rtl ? "rtl" : "ltr"}>
      <header className="ats-heading">
        <div>
          <span>{t(rtl, "RECRUITMENT OPERATIONS", "عمليات التوظيف")}</span>
          <h1>
            {employeeOnly
              ? t(rtl, "My interviews", "مقابلاتي")
              : t(rtl, "Recruitment", "التوظيف")}
          </h1>
          <p>
            {employeeOnly
              ? t(
                  rtl,
                  "Your assigned interviews and private evaluations.",
                  "المقابلات المسندة إليك وتقييماتك الخاصة.",
                )
              : t(
                  rtl,
                  "Jobs, candidates, interviews, evidence, and human hiring decisions.",
                  "تابع الوظائف والمرشحين ونظّم المقابلات من مكان واحد.",
                )}
          </p>
        </div>
        {!employeeOnly && shared.permissions?.canCreate && (
          <button className="primary" onClick={() => setModal("job")}>
            <Plus />
            {t(rtl, "Create job", "إنشاء وظيفة")}
          </button>
        )}
      </header>
      {!route.id && (
        <nav
          className="ats-nav"
          aria-label={t(rtl, "Recruitment sections", "أقسام التوظيف")}
        >
          {tabs.map(([id, en, ar]) => (
            <button
              className={route.view === id ? "active" : ""}
              aria-current={route.view === id ? "page" : undefined}
              key={id}
              onClick={() => navigate(id as View)}
            >
              {t(rtl, en, ar)}
            </button>
          ))}
        </nav>
      )}
      {error ? (
        <ErrorState rtl={rtl} message={error} retry={() => void load()} />
      ) : loading ? (
        <PageLoading rtl={rtl} />
      ) : (
        data && (
          <>
            {route.view === "overview" && !route.id && (
              <Overview
                rtl={rtl}
                data={merged}
                openJob={() => setModal("job")}
                navigate={navigate}
                openJobDetail={openJobDetail}
                openInterview={openInterview}
              />
            )}{" "}
            {route.view === "jobs" && !route.id && (
              <JobsView
                rtl={rtl}
                data={merged}
                openJob={() => setModal("job")}
                openJobDetail={openJobDetail}
              />
            )}{" "}
            {route.view === "jobs" && route.id && (
              <JobDetail
                rtl={rtl}
                data={merged}
                back={() => navigate("jobs")}
                run={run}
                openCandidate={openCandidate}
                addCandidate={() => setModal("candidate")}
              />
            )}{" "}
            {route.view === "candidates" && !route.id && (
              <CandidatesView
                rtl={rtl}
                data={merged}
                openCandidate={openCandidate}
                addCandidate={() => setModal("candidate")}
              />
            )}{" "}
            {route.view === "candidates" && route.id && (
              <CandidateDetail
                rtl={rtl}
                data={merged}
                back={() => navigate("candidates")}
                run={run}
                openInterview={openInterview}
                openSchedule={(interview) => {
                  setScheduledInterview(interview || null);
                  setModal("schedule");
                }}
                openDecision={(kind) => setModal(kind)}
              />
            )}{" "}
            {route.view === "interviews" && !route.id && (
              <InterviewsView
                rtl={rtl}
                data={merged}
                openInterview={openInterview}
              />
            )}{" "}
            {route.view === "interviews" && route.id && (
              <InterviewDetail
                rtl={rtl}
                data={merged}
                back={() => navigate("interviews")}
                run={run}
              />
            )}{" "}
            {route.view === "setup" && (
              <SetupView rtl={rtl} data={merged} run={run} />
            )}
          </>
        )
      )}
      {modal === "job" && (
        <JobDrawer
          rtl={rtl}
          data={merged}
          close={() => setModal(null)}
          run={run}
        />
      )}{" "}
      {modal === "candidate" && (
        <CandidateDrawer
          rtl={rtl}
          data={merged}
          fixedJobId={route.view === "jobs" && route.id ? route.id : undefined}
          close={() => setModal(null)}
          run={run}
        />
      )}{" "}
      {modal === "schedule" && (
        <ScheduleDrawer
          rtl={rtl}
          data={merged}
          interview={scheduledInterview}
          close={() => {
            setScheduledInterview(null);
            setModal(null);
          }}
          run={run}
        />
      )}{" "}
      {(modal === "reject" || modal === "offer") && (
        <DecisionDrawer
          rtl={rtl}
          kind={modal}
          data={merged}
          close={() => setModal(null)}
          run={run}
        />
      )}
    </section>
  );
}
