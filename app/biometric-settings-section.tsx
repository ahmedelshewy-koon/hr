"use client";
import { useCallback, useEffect, useState } from 'react';
import { Fingerprint, RefreshCw, Settings, Wifi } from 'lucide-react';
import './biometric-workspace.css';
import { BiometricSetup } from './biometric-setup';
import { BiometricWorkspace } from './biometric-workspace';
import { InfoNotice, StatusBadge } from './settings/settings-ui';
import type { Row } from './ui-types';

type SetupData = { canManageDevices: boolean; setupUnavailable: boolean; agents: Row[]; devices: Row[]; statusDevices: Row[] };
const dateTime = (value: unknown, rtl: boolean, timezone = 'Africa/Cairo') => {
  const instant = value ? new Date(String(value)) : null;
  if (!instant || !Number.isFinite(instant.getTime())) return '—';
  return new Intl.DateTimeFormat(rtl ? 'ar-EG' : 'en-GB', { timeZone: timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(instant);
};
const syncLabel = (status: string, rtl: boolean) => ({ queued: rtl ? 'بانتظار المزامنة' : 'Queued', running: rtl ? 'جارٍ السحب' : 'Syncing', success: rtl ? 'اكتملت' : 'Completed', failed: rtl ? 'تعذرت المزامنة' : 'Failed' } as Record<string, string>)[status] || status;

/** Device and office-connector setup data; only users who may manage devices get `canManageDevices`. */
export function useBiometricSetup() {
  const [data, setData] = useState<SetupData | null>(null);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(async () => {
    try {
      const response = await fetch('/api/hr?view=biometric&tab=users&page=1', { cache: 'no-store' });
      if (!response.ok) throw new Error('load failed');
      const body = await response.json();
      setData({ canManageDevices: Boolean(body.canManageDevices), setupUnavailable: Boolean(body.setupUnavailable), agents: body.agents || [], devices: body.allDevices || [], statusDevices: body.devices || [] });
      setFailed(false);
    } catch { setFailed(true); }
  }, []);
  useEffect(() => {
    const first = window.setTimeout(() => void reload(), 0);
    const timer = window.setInterval(() => { if (!document.hidden) void reload(); }, 15000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [reload]);
  return { data, failed, reload };
}

export function BiometricSettingsSection({ rtl, notify, data, failed, reload }: { rtl: boolean; notify: (message: string) => void; data: SetupData | null; failed: boolean; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => setNow(Date.now()), 0);
    return () => window.clearTimeout(timer);
  }, [data]);
  const [employees, setEmployees] = useState<Row[]>([]);
  useEffect(() => {
    let live = true;
    void fetch('/api/hr', { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(body => { if (live && body?.employees) setEmployees(body.employees); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  const t = (en: string, ar: string) => rtl ? ar : en;
  if (failed) return <InfoNotice tone="warn">{t('Unable to load biometric devices.', 'تعذر تحميل أجهزة البصمة.')} <button type="button" className="outline" onClick={() => void reload()}>{t('Retry', 'إعادة المحاولة')}</button></InfoNotice>;
  if (!data) return <p className="settings-muted" role="status">{t('Loading devices...', 'جارٍ تحميل الأجهزة...')}</p>;
  if (data.setupUnavailable) return <InfoNotice tone="warn">{t('Device setup needs the database update (migration 0032) first.', 'إعداد الأجهزة يحتاج تحديث قاعدة البيانات (migration 0032) أولًا.')}</InfoNotice>;
  return <div className="biometric-settings-section">
    <div className="biometric-workspace">
      {(data.statusDevices).map(device => {
        const fresh = device.last_seen_at && now - new Date(device.last_seen_at).getTime() < Math.max(600, Number(device.sync_interval_seconds) * 2) * 1000;
        const online = device.status === "online" && fresh;
        const pending = ["queued", "running"].includes(device.latest_sync_status);
        return <article className="biometric-device" key={device.id}>
          <div className="biometric-device-title"><span className="biometric-device-icon"><Fingerprint size={30}/></span><div><small>{rtl ? "جهاز البصمة · " : "BIOMETRIC DEVICE · "}{device.name}</small><h2>{device.model}</h2><span dir="ltr">{device.ip_address}:{device.port}</span></div></div>
          <div className="biometric-device-status"><span className={online ? "bio-connected" : "bio-disconnected"}><Wifi size={15}/>{online ? (rtl ? "متصل" : "Connected") : (rtl ? "غير متصل حاليًا" : "Not connected")}</span><small>{rtl ? "آخر مزامنة ناجحة" : "Last successful sync"}</small><b>{dateTime(device.last_sync_at, rtl, device.timezone)}</b></div>
          <div className="biometric-device-action"><span className="bio-connected"><RefreshCw size={16} className={pending ? "bio-spinning" : ""}/>{pending ? syncLabel(device.latest_sync_status, rtl) : rtl ? "مزامنة تلقائية" : "Automatic sync"}</span><small>{rtl ? "تُسحب البصمات تلقائيًا بمجرد أن يبصم الموظف" : "Punches are pulled automatically as soon as someone punches"}</small></div>
          {device.last_error && <p className="biometric-connection-error" role="status">{rtl ? "آخر محاولة لم تكتمل: " : "Last attempt failed: "}{device.last_error}</p>}
          {pending && <p className="biometric-connection-error" role="status">{rtl ? "طلب المزامنة ينتظر خدمة الربط على شبكة المكتب. لو استمر الانتظار، تأكد أن كمبيوتر الربط يعمل." : "Waiting for the office sync service. If this persists, check that the connector computer is running."}</p>}
        </article>;
      })}
    </div>
    <InfoNotice>{t('Punches are pulled automatically as soon as someone uses the device; no manual sync is needed.', 'تُسحب البصمات تلقائيًا بمجرد أن يبصم أي موظف على الجهاز، دون الحاجة لمزامنة يدوية.')}</InfoNotice>
    <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0', display: 'grid', gap: 8 }}>
      {data.devices.map(device => <li key={String(device.id)} style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Fingerprint size={18} aria-hidden="true" /><b>{String(device.name)}</b><span dir="ltr">{String(device.ip_address)}:{String(device.port)}</span>
        <StatusBadge rtl={rtl} tone={Number(device.enabled) ? 'green' : 'gray'} label={Number(device.enabled) ? t('Enabled', 'مفعّل') : t('Disabled', 'متوقف')} />
      </li>)}
      {!data.devices.length && <li className="settings-muted">{t('No biometric device yet.', 'لم تتم إضافة جهاز بصمة بعد.')}</li>}
    </ul>
    <button type="button" className="primary" onClick={() => setOpen(true)}><Settings size={16} aria-hidden="true" />{t('Manage devices', 'إدارة الأجهزة')}</button>
    {open && <BiometricSetup rtl={rtl} agents={data.agents} devices={data.devices} notify={notify} onChanged={() => void reload()} onClose={() => setOpen(false)} />}
    <div className="biometric-settings-data" style={{ marginTop: 24 }}><BiometricWorkspace rtl={rtl} employees={employees} notify={notify} onMapped={() => undefined} /></div>
  </div>;
}
