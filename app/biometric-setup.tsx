"use client";

import { localizeApiMessage } from "./api-messages";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, KeyRound, Pencil, Plus, Power, Server, X } from "lucide-react";
import type { Row } from "./ui-types";

type Props = { rtl: boolean; agents: Row[]; devices: Row[]; notify: (message: string) => void; onChanged: () => void; onClose: () => void };
type DeviceForm = { id: number | null; name: string; model: string; ipAddress: string; port: string; timezone: string; agentId: string; enabled: boolean };

// The connector polls every 15 seconds; allow a few missed polls before calling it disconnected.
const connectorOnline = (agent: Row) => Boolean(agent.enabled) && Boolean(agent.last_seen_at) && Date.now() - new Date(String(agent.last_seen_at)).getTime() < 90000;
const when = (value: unknown, rtl: boolean) => value ? new Intl.DateTimeFormat(rtl ? "ar-EG" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(String(value))) : "—";

async function post(payload: Row) {
  const response = await fetch("/api/hr", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) throw new Error(localizeApiMessage(data.error || "Unable to complete action"));
  return data;
}

/** One PowerShell line: download the installer from this server and run it with the new token. */
export function connectorInstallCommand(origin: string, token: string) {
  return `[Net.ServicePointManager]::SecurityProtocol='Tls12'; $f="$env:TEMP\\hr-connector-install.ps1"; iwr -UseBasicParsing '${origin}/biometric-agent/install.ps1' -OutFile $f; powershell -NoProfile -ExecutionPolicy Bypass -File $f -ServerUrl '${origin}' -Token '${token}'`;
}

export function BiometricSetup({ rtl, agents, devices, notify, onChanged, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<DeviceForm | null>(null);
  const [agentName, setAgentName] = useState("");
  const [command, setCommand] = useState<{ agent: string; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const t = (en: string, ar: string) => rtl ? ar : en;
  const agentLabel = (id: unknown) => agents.find(agent => Number(agent.id) === Number(id))?.name as string | undefined;

  const run = async (work: () => Promise<void>) => {
    try { setBusy(true); setError(""); await work(); onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed"); }
    finally { setBusy(false); }
  };
  const showCommand = (agent: string, token: string) => { setCommand({ agent, text: connectorInstallCommand(window.location.origin, token) }); setCopied(false); };
  const createAgent = () => run(async () => {
    const name = agentName.trim() || t("Main office", "المكتب الرئيسي");
    const result = await post({ action: "create_attendance_agent", name });
    setAgentName(""); showCommand(name, result.token);
  });
  const rotate = (agent: Row) => {
    if (!window.confirm(t("A new install command will be created and the old one stops working until the new command is run on the office computer. Continue?", "سيتم إنشاء أمر تثبيت جديد، وسيتوقف الرابط الحالي حتى يتم تشغيل الأمر الجديد على كمبيوتر المكتب. متابعة؟"))) return;
    void run(async () => { const result = await post({ action: "rotate_attendance_agent_token", agentId: agent.id }); showCommand(String(agent.name), result.token); });
  };
  const toggleAgent = (agent: Row) => void run(async () => { await post({ action: "set_attendance_agent_enabled", agentId: agent.id, enabled: !Number(agent.enabled) }); });
  const copy = async () => { try { await navigator.clipboard.writeText(command!.text); setCopied(true); } catch { setCopied(false); } };
  const editDevice = (device?: Row) => {
    const firstAgent = agents.find(agent => Number(agent.enabled));
    setError("");
    setForm(device
      ? { id: Number(device.id), name: String(device.name || ""), model: String(device.model || ""), ipAddress: String(device.ip_address || ""), port: String(device.port || 4370), timezone: String(device.timezone || "Africa/Cairo"), agentId: device.agent_id ? String(device.agent_id) : "", enabled: Boolean(Number(device.enabled)) }
      : { id: null, name: "", model: "ZKTeco", ipAddress: "", port: "4370", timezone: "Africa/Cairo", agentId: firstAgent ? String(firstAgent.id) : "", enabled: true });
  };
  const saveDevice = () => form && run(async () => {
    const result = await post({ action: "save_attendance_device", id: form.id, name: form.name, model: form.model, ipAddress: form.ipAddress, port: Number(form.port), timezone: form.timezone, agentId: form.agentId ? Number(form.agentId) : null, enabled: form.enabled });
    setForm(null);
    notify(result.syncQueued ? t("Device saved. Downloading its records now.", "تم حفظ الجهاز، وجارٍ سحب بياناته الآن.") : t("Device saved.", "تم حفظ الجهاز."));
  });
  const field = (key: keyof DeviceForm, value: string | boolean) => setForm(current => current && { ...current, [key]: value });

  return <div className="modal-layer">
    <button className="modal-scrim" onClick={() => !busy && onClose()} aria-label={t("Close", "إغلاق")}/>
    <aside className="drawer attendance-drawer biometric-setup" role="dialog" aria-modal="true" aria-labelledby="bio-setup-title">
      <header><div><small>{t("BIOMETRIC SETUP", "إعداد البصمة")}</small><h2 id="bio-setup-title">{form ? (form.id ? t("Edit device", "تعديل الجهاز") : t("Add device", "إضافة جهاز")) : t("Devices & office connector", "الأجهزة ورابط المكتب")}</h2><p>{form ? t("The office connector reads the device at this address on the office network.", "رابط المكتب يقرأ الجهاز على هذا العنوان داخل شبكة المكتب.") : t("The HR app is online and the device is on the office network, so a small connector on an office computer reads the device and sends the records here.", "البرنامج على الإنترنت والجهاز على شبكة المكتب، لذلك يقرأ «رابط المكتب» الجهاز من كمبيوتر داخل الشبكة ويرسل البيانات للبرنامج.")}</p></div><button className="icon-btn" disabled={busy} onClick={onClose} aria-label={t("Close", "إغلاق")}><X/></button></header>
      <div className="attendance-form">
        {error && <div className="form-error" role="alert">{error}</div>}
        {form ? <>
          <label><span>{t("Device name", "اسم الجهاز")}</span><input value={form.name} onChange={event => field("name", event.target.value)} placeholder={t("Main entrance", "البوابة الرئيسية")} autoFocus/></label>
          <div className="bio-setup-pair">
            <label><span>{t("IP address", "عنوان IP")}</span><input dir="ltr" inputMode="decimal" value={form.ipAddress} onChange={event => field("ipAddress", event.target.value.trim())} placeholder="192.168.1.201"/></label>
            <label><span>{t("Port", "البورت")}</span><input dir="ltr" inputMode="numeric" value={form.port} onChange={event => field("port", event.target.value.replace(/\D/g, ""))} placeholder="4370"/></label>
          </div>
          <label><span>{t("Office connector", "رابط المكتب")}</span><select value={form.agentId} onChange={event => field("agentId", event.target.value)}>
            {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}{Number(agent.enabled) ? "" : t(" (disabled)", " (معطل)")}</option>)}
            <option value="">{t("None: sync service on the app server", "بدون: خدمة مزامنة على خادم البرنامج")}</option>
          </select>{!agents.length && <small className="bio-setup-hint">{t("Create an office connector first so the online app can reach this device.", "أنشئ رابط المكتب أولًا حتى يصل البرنامج المرفوع أونلاين لهذا الجهاز.")}</small>}</label>
          <div className="bio-setup-pair">
            <label><span>{t("Model", "الموديل")}</span><input value={form.model} onChange={event => field("model", event.target.value)}/></label>
            <label><span>{t("Time zone", "المنطقة الزمنية")}</span><input dir="ltr" value={form.timezone} onChange={event => field("timezone", event.target.value)}/></label>
          </div>
          <label className="bio-setup-check"><input type="checkbox" checked={form.enabled} onChange={event => field("enabled", event.target.checked)}/><span>{t("Enabled: read this device automatically", "مفعل: يُسحب من الجهاز تلقائيًا")}</span></label>
          <small className="bio-setup-hint">{t("The device's communication password (Comm Key) must be 0.", "يجب أن تكون كلمة مرور الاتصال (Comm Key) في الجهاز 0.")}</small>
        </> : <>
          {command && <section className="bio-setup-command" aria-live="polite">
            <b>{t("Install command for", "أمر التثبيت لـ")} {command.agent}</b>
            <ol>
              <li>{t("On a computer connected to the device network, install Node.js LTS from nodejs.org.", "على كمبيوتر متصل بشبكة الجهاز، ثبّت Node.js (نسخة LTS) من nodejs.org.")}</li>
              <li>{t("Open PowerShell as Administrator.", "افتح PowerShell كمسؤول (Run as administrator).")}</li>
              <li>{t("Paste this command and press Enter. It starts automatically with Windows afterwards.", "الصق هذا الأمر واضغط Enter. بعدها يعمل تلقائيًا مع تشغيل Windows.")}</li>
            </ol>
            <textarea dir="ltr" readOnly value={command.text} onFocus={event => event.currentTarget.select()} rows={4}/>
            <div className="bio-setup-command-actions"><button className="primary" onClick={() => void copy()}>{copied ? <Check size={16}/> : <Copy size={16}/>}{copied ? t("Copied", "تم النسخ") : t("Copy command", "نسخ الأمر")}</button><small>{t("This token is shown only once. Keep it private.", "هذا الرمز يظهر مرة واحدة فقط؛ لا تشاركه.")}</small></div>
          </section>}
          <section className="bio-setup-section">
            <h3><Server size={17}/>{t("Office connectors", "رابط المكتب")}</h3>
            {agents.map(agent => { const online = connectorOnline(agent); return <div className="bio-setup-row" key={agent.id}>
              <div><b>{agent.name}</b><small>{!Number(agent.enabled) ? t("Disabled", "معطل") : online ? t("Connected", "متصل") : agent.last_seen_at ? t("Not connected · last seen ", "غير متصل · آخر ظهور ") + when(agent.last_seen_at, rtl) : t("Waiting for installation", "بانتظار التثبيت")}{agent.agent_version ? " · v" + agent.agent_version : ""}</small></div>
              <span className={online ? "bio-linked" : "bio-warning"}>{online ? t("Online", "يعمل") : t("Offline", "متوقف")}</span>
              <button className="outline" disabled={busy} onClick={() => rotate(agent)}><KeyRound size={14}/>{t("Install command", "أمر التثبيت")}</button>
              <button className="outline" disabled={busy} onClick={() => toggleAgent(agent)}><Power size={14}/>{Number(agent.enabled) ? t("Disable", "تعطيل") : t("Enable", "تفعيل")}</button>
            </div>; })}
            <div className="bio-setup-add"><input value={agentName} onChange={event => setAgentName(event.target.value)} placeholder={t("Connector name, e.g. Main office", "اسم الرابط، مثل: المكتب الرئيسي")}/><button className="outline" disabled={busy} onClick={() => void createAgent()}><Plus size={15}/>{t("Create connector", "إنشاء رابط")}</button></div>
          </section>
          <section className="bio-setup-section">
            <h3>{t("Biometric devices", "أجهزة البصمة")}</h3>
            {devices.map(device => <div className="bio-setup-row" key={device.id}>
              <div><b>{device.name}</b><small dir="ltr">{device.ip_address}:{device.port}</small><small>{agentLabel(device.agent_id) || t("Sync service on the app server", "خدمة على خادم البرنامج")}</small></div>
              <span className={!Number(device.enabled) ? "bio-warning" : device.status === "online" ? "bio-linked" : "bio-warning"}>{!Number(device.enabled) ? t("Disabled", "معطل") : device.status === "online" ? t("Connected", "متصل") : t("Not connected", "غير متصل")}</span>
              <button className="outline" disabled={busy} onClick={() => editDevice(device)}><Pencil size={14}/>{t("Edit", "تعديل")}</button>
            </div>)}
            {!devices.length && <p className="bio-setup-hint">{t("No device yet. Add one with its IP address and port.", "لا يوجد جهاز بعد. أضف جهازًا بعنوان IP والبورت.")}</p>}
          </section>
        </>}
      </div>
      <footer>{form
        ? <><button className="outline" disabled={busy} onClick={() => { setForm(null); setError(""); }}>{rtl ? <ArrowRight size={16}/> : <ArrowLeft size={16}/>}{t("Back", "رجوع")}</button><button className="primary" disabled={busy || !form.name.trim() || !form.ipAddress || !form.port} onClick={() => void saveDevice()}>{form.id ? t("Save changes", "حفظ التعديلات") : t("Add & start sync", "إضافة وبدء السحب")}</button></>
        : <><button className="outline" disabled={busy} onClick={onClose}>{t("Close", "إغلاق")}</button><button className="primary" disabled={busy} onClick={() => editDevice()}><Plus size={16}/>{t("Add device", "إضافة جهاز")}</button></>}</footer>
    </aside>
  </div>;
}
