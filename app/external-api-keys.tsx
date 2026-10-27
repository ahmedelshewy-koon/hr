"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { Row } from "./ui-types";
import { localizeApiMessage } from "./api-messages";
import { AddButton, InfoNotice, MasterDataDrawer, MasterDataTable, TextField } from "./settings/settings-ui";

const formatTime = (value: unknown, rtl: boolean) =>
  value ? new Intl.DateTimeFormat(rtl ? "ar-SA-u-nu-arab" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(value))) : "—";

/** API keys that let other systems read employees and departments (/api/external/*). Super Admin only. */
export function ExternalApiKeys({ rtl, notify }: { rtl: boolean; notify: (message: string) => void }) {
  const L = (ar: string, en: string) => (rtl ? ar : en);
  const [clients, setClients] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The new key, shown once until the panel is dismissed.
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/external-keys", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      setClients(((await response.json()) as { clients: Row[] }).clients);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  const failure = async (response: Response, fallback: string) => {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    return localizeApiMessage(body.error || fallback, rtl);
  };

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/external-keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      if (!response.ok) throw new Error(await failure(response, "Unable to create the API key"));
      const body = (await response.json()) as { key: string; client: Row };
      setCreated({ name: String(body.client.name), key: body.key });
      setCopied(false);
      setCreating(false);
      setName("");
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (row: Row) => {
    if (!window.confirm(L(`إلغاء مفتاح «${row.name}»؟ سيتوقف أي نظام يستخدمه فورًا.`, `Revoke the key "${row.name}"? Any system using it stops working at once.`))) return;
    const response = await fetch(`/api/external-keys?id=${encodeURIComponent(String(row.id))}`, { method: "DELETE" });
    if (!response.ok) { notify(await failure(response, "Unable to revoke the API key")); return; }
    await reload();
    notify(L("تم إلغاء المفتاح", "Key revoked"));
  };

  const copy = async () => {
    if (!created) return;
    try { await navigator.clipboard.writeText(created.key); setCopied(true); } catch { /* the key stays selectable */ }
  };

  return <section className="panel settings-panel" dir={rtl ? "rtl" : "ltr"} aria-labelledby="external-keys-title">
    <header className="settings-panel-head">
      <div>
        <h2 id="external-keys-title">{L("مفاتيح الربط مع الأنظمة الأخرى", "API keys for other systems")}</h2>
        <p>{L("مفتاح لكل نظام يقرأ بيانات الموظفين والأقسام عبر الـ API، بدون رواتب أو بيانات شخصية. يظهر المفتاح مرة واحدة عند إنشائه.", "One key per system that reads employees and departments through the API, without salaries or personal data. A key is shown once, when it is created.")}</p>
      </div>
      <AddButton label={L("إنشاء مفتاح", "Create key")} onClick={() => { setError(""); setCreating(true); }} />
    </header>
    {created && <InfoNotice>
      <b>{L(`مفتاح «${created.name}»: انسخه الآن، لن يظهر مرة أخرى.`, `Key for "${created.name}": copy it now, it will not be shown again.`)}</b>{" "}
      <code dir="ltr" className="external-key-value">{created.key}</code>{" "}
      <button type="button" className="outline" onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? L("تم النسخ", "Copied") : L("نسخ", "Copy")}</button>{" "}
      <button type="button" className="outline" onClick={() => setCreated(null)}>{L("تم", "Done")}</button>
    </InfoNotice>}
    {failed && <InfoNotice tone="warn">{L("تعذر تحميل المفاتيح.", "Unable to load the keys.")} <button type="button" className="outline" onClick={() => void reload()}>{L("إعادة المحاولة", "Retry")}</button></InfoNotice>}
    {clients && <MasterDataTable caption={L("مفاتيح الربط", "API keys")} rows={clients} rowKey={row => row.id} actionsLabel={L("الإجراءات", "Actions")}
      emptyTitle={L("لا توجد مفاتيح", "No keys")} emptyText={L("أنشئ مفتاحًا لكل نظام يحتاج قراءة بيانات الموظفين.", "Create a key for each system that needs to read employee data.")}
      columns={[
        { key: "name", header: L("النظام", "System"), render: row => <b>{String(row.name)}</b> },
        { key: "hint", header: L("المفتاح", "Key"), render: row => <code dir="ltr">hrx_…{String(row.hint)}</code> },
        { key: "created", header: L("أُنشئ", "Created"), render: row => formatTime(row.created_at, rtl) },
        { key: "used", header: L("آخر استخدام", "Last used"), render: row => (row.last_used_at ? formatTime(row.last_used_at, rtl) : L("لم يُستخدم", "Never")) },
      ]}
      actions={row => <button type="button" className="outline danger" onClick={() => void revoke(row)}>{L("إلغاء", "Revoke")}</button>} />}
    {creating && <MasterDataDrawer rtl={rtl} eyebrow={L("مفتاح ربط", "API KEY")} title={L("مفتاح جديد", "New key")} busy={busy} error={error}
      submitLabel={L("إنشاء", "Create")} submitDisabled={!name.trim()} onClose={() => setCreating(false)} onSubmit={create}>
      <TextField label={L("اسم النظام", "System name")} required maxLength={80} value={name} onChange={setName} hint={L("مثال: CRM", "Example: CRM")} />
    </MasterDataDrawer>}
  </section>;
}
