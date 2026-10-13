"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BookText, ChevronDown, ChevronRight, Clock, Copy, Eye, Folder, Layers, Library, Plug, Plus, Save, Search, Send, Settings2, Trash2, WrapText, X } from 'lucide-react';
import type { Row } from './ui-types';
import { localizeApiMessage } from './api-messages';
import './integrations.css';

type Pair = { key: string; value: string; enabled: boolean; description: string };
type Draft = { tab: string; id?: number; integration_id: number; name: string; description: string; method: string; path: string; params: Pair[]; headers: Pair[]; path_vars: Pair[]; body_type: string; body: string; dirty: boolean };
type Sent = { ok: boolean; status?: number; statusText?: string; time: number; size?: number; truncated?: boolean; headers?: [string, string][]; body?: string; error_ar?: string; error_en?: string; url: string };
type HistoryItem = { at: number; draft: Draft; status?: number; ok: boolean; time: number };
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const AUTH_LABELS: Record<string, string> = { none: 'No Auth', bearer: 'Bearer Token', basic: 'Basic Auth', apikey: 'API Key' };
const blankPair = (): Pair => ({ key: '', value: '', enabled: true, description: '' });
const toPairs = (value: unknown): Pair[] => (Array.isArray(value) ? (value as Partial<Pair>[]).map(pair => ({ key: String(pair.key ?? ''), value: String(pair.value ?? ''), enabled: pair.enabled !== false, description: String(pair.description ?? '') })) : []);
const withSpare = (pairs: Pair[]) => (pairs.length && !pairs[pairs.length - 1].key && !pairs[pairs.length - 1].value ? pairs : [...pairs, blankPair()]);
const trimPairs = (pairs: Pair[]) => pairs.filter((pair, index) => pair.key || pair.value || pair.description || index === pairs.length - 1);
const filled = (pairs: Pair[]) => pairs.filter(pair => pair.key && pair.enabled);
const shortMethod = (method: string) => (method === 'DELETE' ? 'DEL' : method === 'OPTIONS' ? 'OPT' : method);
const parseLines = (text: string): Pair[] => text.split('\n').map(line => { const at = line.indexOf(':'); return at < 0 ? { ...blankPair(), key: line.trim() } : { ...blankPair(), key: line.slice(0, at).trim(), value: line.slice(at + 1).trim() }; }).filter(pair => pair.key);
const linesOf = (pairs: Pair[]) => pairs.filter(pair => pair.key).map(pair => `${pair.key}: ${pair.value}`).join('\n');
/** `:name` segments of the path part of a URL (not the port), in order, unique. */
const pathVarNames = (path: string) => { const clean = path.split('?')[0].replace(/^[a-z]+:\/\/[^/]*/i, '').replace(/\{\{[^}]*\}\}/g, ''); return [...new Set([...clean.matchAll(/\/:([A-Za-z_][\w-]*)/g)].map(match => match[1]))]; };
let tabSeq = 0;
const newDraft = (integration_id: number, row?: Row): Draft => ({
  tab: row ? `r${row.id}` : `n${++tabSeq}`, id: row ? Number(row.id) : undefined, integration_id,
  name: String(row?.name ?? 'New Request'), description: String(row?.description ?? ''), method: String(row?.method ?? 'GET'), path: String(row?.path ?? ''),
  params: toPairs(row?.params), headers: toPairs(row?.headers), path_vars: toPairs(row?.path_vars), body_type: String(row?.body_type ?? 'none'), body: String(row?.body ?? ''), dirty: !row,
});
const sizeLabel = (bytes = 0) => (bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${Math.round(bytes / 1024)}KB` : `${(bytes / 1048576).toFixed(1)}MB`);
const prettyBody = (text = '') => { try { return JSON.stringify(JSON.parse(text), null, 4); } catch { return text; } };
const isJson = (text = '') => { try { JSON.parse(text); return true; } catch { return false; } };
const MAX_LINES = 3000;

/** Pretty-printed JSON with line numbers and Postman-like token colours. */
function CodeView({ text, json, wrap }: { text: string; json: boolean; wrap: boolean }) {
  const lines = useMemo(() => text.split('\n'), [text]);
  const tokens = (line: string): ReactNode[] => {
    if (!json) return [line];
    const out: ReactNode[] = []; let last = 0, i = 0;
    for (const match of line.matchAll(/("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g)) {
      if (match.index! > last) out.push(line.slice(last, match.index));
      const cls = match[1] ? (match[2] ? 'pm-k' : 'pm-s') : match[3] ? 'pm-n' : 'pm-b';
      out.push(<span key={i++} className={cls}>{match[1] ? match[1] : match[0]}</span>);
      if (match[2]) out.push(match[2]);
      last = match.index! + match[0].length;
    }
    if (last < line.length) out.push(line.slice(last));
    return out;
  };
  return <div className={`pm-code-view${wrap ? ' is-wrap' : ''}`} dir="ltr">
    {lines.slice(0, MAX_LINES).map((line, index) => <div className="pm-line" key={index}><span className="pm-ln">{index + 1}</span><span className="pm-lc">{tokens(line)}</span></div>)}
    {lines.length > MAX_LINES && <div className="pm-line"><span className="pm-ln" /><span className="pm-lc pm-more">… {lines.length - MAX_LINES} more lines (use Raw)</span></div>}
  </div>;
}

/** Key / Value / Description grid shared by params, path variables, headers, body form and variables. */
function KvTable({ pairs, onChange, readOnlyKeys, bulk, onBulk, spare = true }: { pairs: Pair[]; onChange: (pairs: Pair[]) => void; readOnlyKeys?: boolean; bulk?: boolean; onBulk?: () => void; spare?: boolean }) {
  const rows = spare ? withSpare(pairs) : pairs;
  const set = (index: number, change: Partial<Pair>) => onChange(trimPairs(rows.map((pair, i) => (i === index ? { ...pair, ...change } : pair))));
  return <table className="pm-kv">
    <thead><tr><th /><th>KEY</th><th>VALUE</th><th>DESCRIPTION</th><th className="pm-bulk">{bulk && <button type="button" onClick={onBulk}>Bulk edit</button>}</th></tr></thead>
    <tbody>{rows.map((pair, index) => <tr key={index}>
      <td>{(pair.key || pair.value) && !readOnlyKeys ? <input type="checkbox" checked={pair.enabled} aria-label="enabled" onChange={event => set(index, { enabled: event.target.checked })} /> : null}</td>
      <td><input value={pair.key} placeholder="Key" dir="ltr" readOnly={readOnlyKeys} onChange={event => set(index, { key: event.target.value })} /></td>
      <td><input value={pair.value} placeholder="Value" dir="ltr" className={/\{\{.*\}\}/.test(pair.value) ? 'has-var' : ''} onChange={event => set(index, { value: event.target.value })} /></td>
      <td><input value={pair.description} placeholder="Description" dir="ltr" onChange={event => set(index, { description: event.target.value })} /></td>
      <td>{!readOnlyKeys && (pair.key || pair.value) && <button type="button" className="pm-icon" aria-label="Remove" onClick={() => onChange(trimPairs(rows.filter((_, i) => i !== index)))}><X size={13} /></button>}</td>
    </tr>)}</tbody>
  </table>;
}

/** Integrations: a Postman-style workbench — rail + collections, request builder, response viewer and documentation. */
export function IntegrationsWorkspace({ rtl, notify }: { rtl: boolean; notify: (message: string) => void }) {
  const L = (ar: string, en: string) => (rtl ? ar : en);
  const [data, setData] = useState<{ integrations: Row[]; requests: Row[] } | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const request = ++latest.current;
    try {
      const response = await fetch('/api/integrations', { cache: 'no-store' });
      if (response.status === 401) window.dispatchEvent(new Event('portal-session-expired'));
      if (request !== latest.current) return;
      if (response.status === 403) { setStatus('forbidden'); return; }
      if (!response.ok) throw new Error(String(response.status));
      setData(await response.json()); setStatus('ready');
    } catch { if (request === latest.current) setStatus('error'); }
  }, []);
  useEffect(() => {
    const requests = latest;
    const timer = window.setTimeout(() => void reload(), 0);
    return () => { window.clearTimeout(timer); ++requests.current; };
  }, [reload]);
  const post = useCallback(async (url: string, payload: Row) => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({})) as Row;
    if (response.status === 401) window.dispatchEvent(new Event('portal-session-expired'));
    if (!response.ok) throw new Error(String((rtl ? body.message_ar : body.message_en) || localizeApiMessage(String(body.error || `Request failed (${response.status})`), rtl)));
    return body;
  }, [rtl]);

  const [rail, setRail] = useState<'collections' | 'environments' | 'history'>('collections');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [tabs, setTabs] = useState<Draft[]>([]);
  const [active, setActive] = useState('');
  const [section, setSection] = useState<'params' | 'auth' | 'headers' | 'body'>('params');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [resTab, setResTab] = useState<'body' | 'headers'>('body');
  const [view, setView] = useState<'pretty' | 'raw' | 'preview'>('pretty');
  const [wrap, setWrap] = useState(true);
  const [docs, setDocs] = useState(true);
  const [envOpen, setEnvOpen] = useState(false);
  const [responses, setResponses] = useState<Record<string, Sent | 'sending'>>({});
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [editing, setEditing] = useState<Row | null>(null);
  const [modalTab, setModalTab] = useState<'overview' | 'auth' | 'headers' | 'variables'>('overview');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!editing) return;
    document.querySelector<HTMLInputElement>('.pm-modal-title')?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setEditing(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);
  const draft = tabs.find(item => item.tab === active) ?? null;
  const response = draft ? responses[draft.tab] : undefined;
  const integrationOf = (id: number) => data?.integrations.find(row => Number(row.id) === id);
  const patch = (change: Partial<Draft>) => setTabs(list => list.map(item => (item.tab === active ? { ...item, ...change, dirty: true } : item)));

  const openRequest = (row: Row) => {
    const tab = `r${row.id}`;
    setTabs(list => (list.some(item => item.tab === tab) ? list : [...list, newDraft(Number(row.integration_id), row)]));
    setActive(tab); setBulkOpen(false);
  };
  const openNew = (integrationId: number) => { const item = newDraft(integrationId); setTabs(list => [...list, item]); setActive(item.tab); setSection('params'); setBulkOpen(false); };
  const closeTab = (tab: string) => {
    const target = tabs.find(item => item.tab === tab);
    if (target?.dirty && !window.confirm(L('هذا الطلب به تغييرات غير محفوظة. إغلاقه؟', 'This request has unsaved changes. Close it anyway?'))) return;
    const rest = tabs.filter(item => item.tab !== tab);
    setTabs(rest);
    if (active === tab) setActive(rest[rest.length - 1]?.tab ?? '');
  };

  const send = async () => {
    if (!draft) return;
    const tab = draft.tab, snapshot = draft;
    setResponses(map => ({ ...map, [tab]: 'sending' }));
    const sync = (names: string[]) => names.map(key => snapshot.path_vars.find(pair => pair.key === key) ?? { ...blankPair(), key });
    let result: Sent;
    try {
      result = await post('/api/integrations/send', { integration_id: snapshot.integration_id, method: snapshot.method, path: snapshot.path, params: snapshot.params, headers: snapshot.headers, path_vars: sync(pathVarNames(snapshot.path)), body_type: snapshot.body_type, body: snapshot.body }) as unknown as Sent;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      result = { ok: false, time: 0, url: snapshot.path, error_ar: message, error_en: message };
    }
    setResponses(map => ({ ...map, [tab]: result }));
    setResTab('body');
    setHistory(list => [{ at: Date.now(), draft: { ...snapshot, tab: `n${++tabSeq}` }, status: result.status, ok: result.ok, time: result.time }, ...list].slice(0, 50));
  };
  const saveDraft = async () => {
    if (!draft) return;
    try {
      const names = pathVarNames(draft.path);
      const body = await post('/api/integrations', { action: 'save_request', record: { ...draft, path_vars: names.map(key => draft.path_vars.find(pair => pair.key === key) ?? { ...blankPair(), key }) } });
      const saved = body.record as Row;
      setTabs(list => list.map(item => (item.tab === draft.tab ? newDraft(Number(saved.integration_id), saved) : item)));
      setResponses(map => { const { [draft.tab]: kept, ...rest } = map; return kept ? { ...rest, [`r${saved.id}`]: kept } : rest; });
      setActive(`r${saved.id}`);
      await reload(); notify(L('تم حفظ الطلب', 'Request saved'));
    } catch (reason) { notify(reason instanceof Error ? reason.message : String(reason)); }
  };
  const removeRequest = async (row: Row) => {
    if (!window.confirm(L(`حذف الطلب «${row.name}»؟`, `Delete the request "${row.name}"?`))) return;
    try { await post('/api/integrations', { action: 'delete_request', record: { id: row.id } }); setTabs(list => list.filter(item => item.id !== Number(row.id))); await reload(); }
    catch (reason) { notify(reason instanceof Error ? reason.message : String(reason)); }
  };

  const openIntegration = (row?: Row) => {
    setFormError(''); setModalTab('overview');
    setEditing(row
      ? { ...row, variables: toPairs(row.variables), default_headers: toPairs(row.default_headers) }
      : { name: '', base_url: '', auth_type: 'none', description: '', variables: [], default_headers: [], auth_token: '', auth_username: '', auth_password: '', auth_key_name: 'X-API-Key', auth_key_value: '', auth_key_in: 'header' });
  };
  const saveIntegration = async () => {
    if (!editing) return;
    setBusy(true); setFormError('');
    try { await post('/api/integrations', { action: 'save_integration', record: editing }); setEditing(null); await reload(); notify(L('تم حفظ التكامل', 'Integration saved')); }
    catch (reason) { setFormError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); }
  };
  const removeIntegration = async () => {
    if (!editing?.id || !window.confirm(L(`حذف التكامل «${editing.name}» وكل طلباته؟`, `Delete the integration "${editing.name}" and all its requests?`))) return;
    try { await post('/api/integrations', { action: 'delete_integration', record: { id: editing.id } }); setTabs(list => list.filter(item => item.integration_id !== Number(editing.id))); setEditing(null); await reload(); }
    catch (reason) { setFormError(reason instanceof Error ? reason.message : String(reason)); }
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.integrations ?? []).map(integration => ({
      integration,
      requests: (data?.requests ?? []).filter(row => Number(row.integration_id) === Number(integration.id) && (!needle || `${row.name} ${row.path} ${integration.name}`.toLowerCase().includes(needle))),
    })).filter(group => !needle || group.requests.length || String(group.integration.name).toLowerCase().includes(needle));
  }, [data, query]);

  if (status === 'loading') return <section className="panel settings-panel" role="status"><p className="settings-muted">{L('جارٍ التحميل...', 'Loading...')}</p></section>;
  if (status === 'forbidden') return <section className="panel settings-panel"><p className="settings-muted">{L('التكاملات متاحة لمدير النظام فقط.', 'Integrations are available to the Super Admin only.')}</p></section>;
  if (status === 'error' || !data) return <section className="panel settings-panel"><p className="settings-muted">{L('تعذر تحميل التكاملات.', 'Unable to load the integrations.')} <button type="button" className="outline" onClick={() => void reload()}>{L('إعادة المحاولة', 'Retry')}</button></p></section>;

  const integration = draft ? integrationOf(draft.integration_id) : undefined;
  const sent = response && response !== 'sending' ? response : null;
  const statusClass = sent?.ok && sent.status ? (sent.status < 300 ? 'ok' : sent.status < 400 ? 'redirect' : 'bad') : 'bad';
  const names = draft ? pathVarNames(draft.path) : [];
  const pathVars = draft ? names.map(key => draft.path_vars.find(pair => pair.key === key) ?? { ...blankPair(), key }) : [];
  const defaultHeaders = filled(toPairs(integration?.default_headers));
  const variables = filled(toPairs(integration?.variables));
  const contentType = sent?.headers?.find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? '';
  const bodyIsJson = isJson(sent?.body);
  const copy = (value: string) => { void navigator.clipboard?.writeText(value).then(() => notify(L('تم النسخ', 'Copied')), () => {}); };
  const hasAuth = integration && integration.auth_type !== 'none';
  const dot = (on: boolean) => on ? <i className="pm-ok" aria-hidden="true" /> : null;

  // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- workbench shortcuts (Ctrl+Enter / Ctrl+S) bubble from the focused field
  return <section className="pm" dir="ltr" aria-label={L('التكاملات', 'Integrations')} onKeyDown={event => {
    if (!draft || !(event.ctrlKey || event.metaKey)) return;
    if (event.key === 'Enter') { event.preventDefault(); void send(); }
    else if (event.key.toLowerCase() === 's') { event.preventDefault(); void saveDraft(); }
  }}>
    <nav className="pm-rail" aria-label="Workbench">
      {([['collections', Library, L('المجموعات', 'Collections')], ['environments', Layers, L('المتغيرات', 'Environments')], ['history', Clock, L('السجل', 'History')]] as const).map(([id, Icon, label]) =>
        <button key={id} type="button" className={rail === id ? 'is-active' : ''} aria-pressed={rail === id} onClick={() => setRail(id)}><Icon size={20} strokeWidth={1.6} /><span>{label}</span></button>)}
    </nav>

    <aside className="pm-side">
      <div className="pm-side-bar">
        <button type="button" className="pm-new" onClick={() => openIntegration()} title={L('تكامل جديد', 'New integration')}><Plus size={14} /> {L('جديد', 'New')}</button>
        <label className="pm-search"><Search size={13} aria-hidden="true" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={L('بحث', 'Search')} aria-label={L('بحث', 'Search')} /></label>
      </div>
      <div className="pm-tree">
        {rail === 'collections' && <>
          {!filtered.length && (query
            ? <p className="pm-empty">{L('لا نتائج مطابقة.', 'No matching results.')}</p>
            : <button type="button" className="pm-empty-card" onClick={() => openIntegration()}><Plug size={20} /><b>{L('أضف أول تكامل', 'Add your first integration')}</b><span>{L('رابط أساسي + مصادقة + متغيرات', 'Base URL + auth + variables')}</span></button>)}
          {filtered.map(({ integration: item, requests }) => {
            const id = Number(item.id), open = !collapsed.has(id) || Boolean(query);
            return <div key={id} className="pm-group">
              <div className="pm-row pm-group-row">
                <button type="button" className="pm-row-main" onClick={() => setCollapsed(set => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); return next; })} aria-expanded={open}>
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<Folder size={15} /><span>{String(item.name)}</span>
                </button>
                <button type="button" className="pm-icon" onClick={() => openNew(id)} aria-label={L('طلب جديد', 'Add request')} title={L('طلب جديد', 'Add request')}><Plus size={14} /></button>
                <button type="button" className="pm-icon" onClick={() => openIntegration(item)} aria-label={L('إعدادات التكامل', 'Integration settings')} title={L('إعدادات التكامل', 'Integration settings')}><Settings2 size={14} /></button>
              </div>
              {open && requests.map(row => <div key={String(row.id)} className={`pm-row pm-req${active === `r${row.id}` ? ' is-active' : ''}`}>
                <button type="button" className="pm-row-main" onClick={() => openRequest(row)}><b className={`pm-m pm-m-${String(row.method).toLowerCase()}`}>{shortMethod(String(row.method))}</b><span>{String(row.name)}</span></button>
                <button type="button" className="pm-icon pm-del" onClick={() => void removeRequest(row)} aria-label={L('حذف الطلب', 'Delete request')}><Trash2 size={13} /></button>
              </div>)}
            </div>;
          })}
        </>}
        {rail === 'environments' && <>
          {!data.integrations.length && <p className="pm-empty">{L('أضف تكاملًا أولًا لتعريف متغيراته.', 'Add an integration first to define its variables.')}</p>}
          {data.integrations.map(item => <div key={String(item.id)} className="pm-env">
            <button type="button" className="pm-env-head" onClick={() => openIntegration(item)}><Layers size={14} /><b>{String(item.name)}</b><Settings2 size={13} /></button>
            {filled(toPairs(item.variables)).length ? <ul>{filled(toPairs(item.variables)).map(pair => <li key={pair.key}><code>{`{{${pair.key}}}`}</code><span>{pair.value}</span></li>)}</ul> : <p className="pm-empty">{L('لا متغيرات. افتح الإعدادات لإضافتها.', 'No variables. Open settings to add some.')}</p>}
          </div>)}
        </>}
        {rail === 'history' && <>
          {!history.length && <p className="pm-empty">{L('الطلبات التي ترسلها في هذه الجلسة تظهر هنا.', 'Requests you send in this session appear here.')}</p>}
          {history.filter(item => !query || `${item.draft.name} ${item.draft.path}`.toLowerCase().includes(query.toLowerCase())).map(item => <div key={item.at} className="pm-row pm-hist">
            <button type="button" className="pm-row-main" onClick={() => { const copyDraft = { ...item.draft, tab: `n${++tabSeq}`, dirty: true }; setTabs(list => [...list, copyDraft]); setActive(copyDraft.tab); }}>
              <b className={`pm-m pm-m-${item.draft.method.toLowerCase()}`}>{shortMethod(item.draft.method)}</b><span>{item.draft.path || item.draft.name}</span><em className={item.ok && item.status && item.status < 400 ? 'ok' : 'bad'}>{item.ok ? item.status : 'ERR'}</em>
            </button>
          </div>)}
        </>}
      </div>
    </aside>

    <div className="pm-main">
      <div className="pm-tabs" role="tablist">
        {tabs.map(item => <div key={item.tab} role="tab" aria-selected={item.tab === active} className={`pm-tab${item.tab === active ? ' is-active' : ''}`}>
          <button type="button" onClick={() => setActive(item.tab)}><b className={`pm-m pm-m-${item.method.toLowerCase()}`}>{shortMethod(item.method)}</b><span>{item.name}</span>{item.dirty && <i className="pm-dot" aria-label={L('غير محفوظ', 'Unsaved')} />}</button>
          <button type="button" className="pm-icon" onClick={() => closeTab(item.tab)} aria-label={L('إغلاق', 'Close')}><X size={13} /></button>
        </div>)}
        {data.integrations.length > 0 && <button type="button" className="pm-icon pm-newtab" onClick={() => openNew(Number(draft?.integration_id ?? data.integrations[0].id))} aria-label={L('طلب جديد', 'New request')}><Plus size={16} /></button>}
        <span className="pm-grow" />
        {integration && <div className="pm-envsel">
          <button type="button" onClick={() => setEnvOpen(open => !open)} aria-expanded={envOpen}>{String(integration.name)} <ChevronDown size={13} /></button>
          <button type="button" className="pm-icon" onClick={() => setEnvOpen(open => !open)} aria-label={L('عرض المتغيرات', 'Quick look at variables')}><Eye size={15} /></button>
          {envOpen && <div className="pm-pop" role="dialog" aria-label="Variables">
            <header><b>{String(integration.name)}</b><button type="button" className="pm-link" onClick={() => { setEnvOpen(false); openIntegration(integration); }}>{L('تعديل', 'Edit')}</button></header>
            {variables.length ? <table><tbody>{variables.map(pair => <tr key={pair.key}><td><code>{pair.key}</code></td><td>{pair.value}</td></tr>)}</tbody></table> : <p className="pm-empty">{L('لا متغيرات معرّفة.', 'No variables defined.')}</p>}
          </div>}
        </div>}
      </div>

      {!draft && <div className="pm-blank"><div className="pm-welcome">
        <span className="pm-welcome-icon"><Plug size={26} aria-hidden="true" /></span>
        <h3>{L('اربط نظامك بأي خدمة خارجية', 'Connect to any external service')}</h3>
        <p>{L('جرّب واجهات الـ API واحفظها كطلبات جاهزة، مع مصادقة ومتغيرات تُطبَّق تلقائيًا.', 'Try APIs and keep them as ready-made requests, with authorization and variables applied for you.')}</p>
        <ol className="pm-steps">
          <li><b>1</b><div><strong>{L('أنشئ تكاملًا', 'Create an integration')}</strong><span>{L('الرابط الأساسي والمصادقة والمتغيرات', 'Base URL, authorization and variables')}</span></div></li>
          <li><b>2</b><div><strong>{L('أضف طلبًا', 'Add a request')}</strong><span>{L('اختر النوع واكتب المسار والمعاملات', 'Pick the method, path and parameters')}</span></div></li>
          <li><b>3</b><div><strong>{L('اضغط Send', 'Press Send')}</strong><span>{L('شاهد الاستجابة واحفظ الطلب', 'Read the response and save the request')}</span></div></li>
        </ol>
        <div className="pm-welcome-actions">
          <button type="button" className="pm-send" onClick={() => openIntegration()}><Plus size={14} aria-hidden="true" /> {L('تكامل جديد', 'New integration')}</button>
          {data.integrations.length > 0 && <button type="button" className="pm-savebtn" onClick={() => openNew(Number(data.integrations[0].id))}>{L('طلب جديد', 'New request')}</button>}
        </div>
        {data.integrations.length > 0 && <div className="pm-cards">
          {data.integrations.map(item => {
            const own = data.requests.filter(row => Number(row.integration_id) === Number(item.id));
            return <div key={String(item.id)} className="pm-card">
              <header><Folder size={15} aria-hidden="true" /><b>{String(item.name)}</b><span>{own.length}</span></header>
              <small dir="ltr">{String(item.base_url || '—')}</small>
              {own.slice(0, 3).map(row => <button key={String(row.id)} type="button" onClick={() => openRequest(row)}><b className={`pm-m pm-m-${String(row.method).toLowerCase()}`}>{shortMethod(String(row.method))}</b><span>{String(row.name)}</span></button>)}
              <button type="button" className="pm-link" onClick={() => openNew(Number(item.id))}>+ {L('طلب جديد', 'New request')}</button>
            </div>;
          })}
        </div>}
      </div></div>}

      {draft && <div className={`pm-work${docs ? ' with-docs' : ''}`}>
        <div className="pm-center">
          <div className="pm-crumb">
            <span className="pm-http">HTTP</span>
            <span className="pm-path">{String(integration?.name ?? '')} /</span>
            <input className="pm-name" value={draft.name} onChange={event => patch({ name: event.target.value })} aria-label={L('اسم الطلب', 'Request name')} />
            <span className="pm-grow" />
            <button type="button" className="pm-savebtn" onClick={() => void saveDraft()} title="Ctrl + S"><Save size={14} /> {L('حفظ', 'Save')}</button>
            <button type="button" className={`pm-icon pm-sq${docs ? ' is-on' : ''}`} onClick={() => setDocs(open => !open)} aria-pressed={docs} aria-label={L('التوثيق', 'Documentation')} title={L('التوثيق', 'Documentation')}><BookText size={15} /></button>
          </div>
          <div className="pm-urlbar">
            <div className="pm-urlbox">
              <select className={`pm-method pm-m-${draft.method.toLowerCase()}`} value={draft.method} onChange={event => patch({ method: event.target.value })} aria-label="Method">{METHODS.map(method => <option key={method}>{method}</option>)}</select>
              <span className="pm-sep" />
              {integration?.base_url ? <span className="pm-base" title={String(integration.base_url)}>{String(integration.base_url)}</span> : null}
              <input value={draft.path} dir="ltr" placeholder={integration?.base_url ? '/path' : 'https://api.example.com/path'} onChange={event => patch({ path: event.target.value })} onKeyDown={event => { if (event.key === 'Enter') void send(); }} aria-label="URL" />
            </div>
            <button type="button" className="pm-send" onClick={() => void send()} disabled={response === 'sending'} title="Ctrl + Enter"><Send size={14} aria-hidden="true" /> {response === 'sending' ? L('جارٍ الإرسال', 'Sending') : 'Send'}</button>
          </div>
          <div className="pm-sections" role="tablist">
            <button type="button" role="tab" aria-selected={section === 'params'} className={section === 'params' ? 'is-active' : ''} onClick={() => setSection('params')}>Params{dot(filled(draft.params).length > 0 || names.length > 0)}</button>
            <button type="button" role="tab" aria-selected={section === 'auth'} className={section === 'auth' ? 'is-active' : ''} onClick={() => setSection('auth')}>Auth{dot(Boolean(hasAuth))}</button>
            <button type="button" role="tab" aria-selected={section === 'headers'} className={section === 'headers' ? 'is-active' : ''} onClick={() => setSection('headers')}>Headers{filled(draft.headers).length + defaultHeaders.length > 0 && <span className="pm-count">({filled(draft.headers).length + defaultHeaders.length})</span>}</button>
            <button type="button" role="tab" aria-selected={section === 'body'} className={section === 'body' ? 'is-active' : ''} onClick={() => setSection('body')}>Body{dot(draft.body_type !== 'none')}</button>
          </div>
          <div className="pm-editor">
            {section === 'params' && <>
              <h4>Query params</h4>
              {bulkOpen
                ? <div><textarea className="pm-code" dir="ltr" spellCheck={false} value={linesOf(draft.params)} onChange={event => patch({ params: parseLines(event.target.value) })} aria-label="Bulk edit" /><button type="button" className="pm-link" onClick={() => setBulkOpen(false)}>Key-Value edit</button></div>
                : <KvTable pairs={draft.params} onChange={params => patch({ params })} bulk onBulk={() => setBulkOpen(true)} />}
              {names.length > 0 && <><h4>Path variables</h4>
                <KvTable pairs={pathVars} spare={false} readOnlyKeys onChange={next => patch({ path_vars: next })} /></>}
            </>}
            {section === 'auth' && <div className="pm-auth">
              <p>{hasAuth
                ? L(`هذا الطلب يستخدم مصادقة التكامل «${String(integration?.name)}»: ${AUTH_LABELS[String(integration?.auth_type)]}.`, `This request uses the authorization of the integration "${String(integration?.name)}": ${AUTH_LABELS[String(integration?.auth_type)]}.`)
                : L('لا توجد مصادقة معرّفة لهذا التكامل.', 'No authorization is set on this integration.')}</p>
              {integration && <button type="button" className="pm-savebtn" onClick={() => openIntegration(integration)}>{L('تعديل مصادقة التكامل', 'Edit integration auth')}</button>}
            </div>}
            {section === 'headers' && <>
              <h4>Headers</h4>
              <KvTable pairs={draft.headers} onChange={headers => patch({ headers })} />
              {defaultHeaders.length > 0 && <><h4>{L('ترويسات موروثة من التكامل', 'Inherited from the integration')}</h4>
                <table className="pm-kv pm-ro"><tbody>{defaultHeaders.map(pair => <tr key={pair.key}><td dir="ltr"><b>{pair.key}</b></td><td dir="ltr">{pair.value}</td></tr>)}</tbody></table></>}
            </>}
            {section === 'body' && <div>
              <div className="pm-radios">{[['none', 'none'], ['json', 'raw (JSON)'], ['text', 'raw (Text)'], ['form', 'x-www-form-urlencoded']].map(([value, label]) => <label key={value}><input type="radio" name="body-type" checked={draft.body_type === value} onChange={() => patch({ body_type: value, body: value === 'form' ? '[]' : draft.body_type === 'form' ? '' : draft.body })} /> {label}</label>)}</div>
              {draft.body_type === 'none' && <p className="pm-hint">{L('هذا الطلب بلا محتوى.', 'This request does not have a body.')}</p>}
              {(draft.body_type === 'json' || draft.body_type === 'text') && <textarea className="pm-code" dir="ltr" spellCheck={false} value={draft.body} onChange={event => patch({ body: event.target.value })} placeholder={draft.body_type === 'json' ? '{\n    "key": "value"\n}' : ''} aria-label="Body" />}
              {draft.body_type === 'form' && (() => { let rows: Pair[] = []; try { rows = toPairs(JSON.parse(draft.body || '[]')); } catch { rows = []; } return <KvTable pairs={rows} onChange={next => patch({ body: JSON.stringify(next) })} />; })()}
            </div>}
          </div>

          <div className="pm-response" aria-live="polite">
            <div className="pm-res-head">
              <div className="pm-restabs" role="tablist">{(['body', 'headers'] as const).map(name => <button key={name} type="button" role="tab" aria-selected={resTab === name} className={resTab === name ? 'is-active' : ''} onClick={() => setResTab(name)}>{name === 'body' ? 'Body' : 'Headers'}{name === 'headers' && sent?.headers ? <span className="pm-count">({sent.headers.length})</span> : null}</button>)}</div>
              {sent?.ok && <div className="pm-meta"><b className={`pm-status ${statusClass}`}>{sent.status} {sent.statusText}</b><b className="pm-status ok">{sent.time} ms</b><b className="pm-status ok">{sizeLabel(sent.size)}</b></div>}
            </div>
            {sent?.ok && resTab === 'body' && <div className="pm-toolbar">
              <div className="pm-seg" role="tablist">{(['pretty', 'raw', 'preview'] as const).map(name => <button key={name} type="button" role="tab" aria-selected={view === name} className={view === name ? 'is-active' : ''} onClick={() => setView(name)}>{name[0].toUpperCase() + name.slice(1)}</button>)}</div>
              <span className="pm-chip">{bodyIsJson ? 'JSON' : /html/i.test(contentType) ? 'HTML' : 'Text'}</span>
              <button type="button" className={`pm-icon pm-sq${wrap ? ' is-on' : ''}`} onClick={() => setWrap(on => !on)} aria-pressed={wrap} aria-label="Word wrap" title="Word wrap"><WrapText size={15} /></button>
              <span className="pm-grow" />
              <button type="button" className="pm-icon" onClick={() => copy(view === 'pretty' ? prettyBody(sent.body) : sent.body ?? '')} aria-label={L('نسخ', 'Copy')} title={L('نسخ', 'Copy')}><Copy size={15} /></button>
            </div>}
            <div className="pm-res-body">
              {!response && <div className="pm-idle"><Send size={22} aria-hidden="true" /><p>{L('اضغط Send للحصول على استجابة', 'Click Send to get a response')}</p><small>Ctrl + Enter</small></div>}
              {response === 'sending' && <div className="pm-idle"><span className="pm-spin" aria-hidden="true" /><p>{L('جارٍ إرسال الطلب...', 'Sending request...')}</p></div>}
              {sent && !sent.ok && <p className="pm-error" role="alert">{rtl ? sent.error_ar : sent.error_en}</p>}
              {sent?.ok && resTab === 'body' && <>
                {sent.truncated && <p className="pm-error">{L('تم اقتطاع الاستجابة عند 2 ميغابايت.', 'The response was truncated at 2 MB.')}</p>}
                {!sent.body && <p className="pm-hint">{L('(استجابة فارغة)', '(empty response)')}</p>}
                {sent.body ? view === 'pretty' ? <CodeView text={prettyBody(sent.body)} json={bodyIsJson} wrap={wrap} />
                  : view === 'raw' ? <CodeView text={sent.body} json={false} wrap={wrap} />
                    : /html/i.test(contentType) ? <iframe className="pm-preview" title="Preview" sandbox="" srcDoc={sent.body} /> : <CodeView text={sent.body} json={false} wrap={wrap} /> : null}
              </>}
              {sent?.ok && resTab === 'headers' && <table className="pm-kv pm-ro"><tbody>{(sent.headers ?? []).map(([key, value]) => <tr key={key}><td dir="ltr"><b>{key}</b></td><td dir="ltr">{value}</td></tr>)}</tbody></table>}
            </div>
          </div>
        </div>

        {docs && <aside className="pm-docs" aria-label="Documentation">
          <header><BookText size={16} /><h3>{L('التوثيق', 'Documentation')}</h3><button type="button" className="pm-icon" onClick={() => setDocs(false)} aria-label={L('إغلاق', 'Close')}><X size={15} /></button></header>
          <div className="pm-url-chip" dir="ltr">{`${String(integration?.base_url ?? '')}${draft.path}` || '—'}</div>
          <textarea className="pm-doc-text" value={draft.description} onChange={event => patch({ description: event.target.value })} placeholder={L('اكتب وصفًا لهذا الطلب...', 'Describe what this request does...')} aria-label={L('وصف الطلب', 'Request description')} />
          <h5>Authorization <span>{AUTH_LABELS[String(integration?.auth_type ?? 'none')]}</span></h5>
          <p>{hasAuth ? L(`يستخدم هذا الطلب مصادقة التكامل ${String(integration?.name)}.`, `This request is using an authorization helper from integration ${String(integration?.name)}.`) : L('بدون مصادقة.', 'No authorization.')}</p>
          {(filled(draft.headers).length + defaultHeaders.length) > 0 && <><h5>Request Header</h5>
            <dl>{[...defaultHeaders, ...filled(draft.headers)].map(pair => <div key={pair.key}><dt>{pair.key}</dt><dd>{pair.value}</dd></div>)}</dl></>}
          {pathVars.length > 0 && <><h5>Path Variables</h5>
            <dl>{pathVars.map(pair => <div key={pair.key}><dt>{pair.key}</dt><dd>{pair.value || '—'}{pair.description && <small>{pair.description}</small>}</dd></div>)}</dl></>}
        </aside>}
      </div>}
    </div>

    {editing && <div className="pm-modal-back">
      <div className="pm-modal" role="dialog" aria-modal="true" aria-label={L('إعدادات التكامل', 'Integration settings')}>
        <header className="pm-modal-head">
          <Folder size={18} aria-hidden="true" />
          <input className="pm-modal-title" value={String(editing.name)} placeholder={L('اسم التكامل', 'Integration name')} onChange={event => setEditing({ ...editing, name: event.target.value })} aria-label={L('الاسم', 'Name')} maxLength={120} />
          <span className="pm-grow" />
          <button type="button" className="pm-icon" onClick={() => setEditing(null)} aria-label={L('إغلاق', 'Close')}><X size={18} /></button>
        </header>
        <div className="pm-modal-tabs" role="tablist">
          {([['overview', 'Overview', L('نظرة عامة', 'Overview')], ['auth', 'Authorization', L('المصادقة', 'Authorization')], ['headers', 'Headers', L('الترويسات', 'Headers')], ['variables', 'Variables', L('المتغيرات', 'Variables')]] as const).map(([id, en, label]) =>
            <button key={id} type="button" role="tab" aria-selected={modalTab === id} className={modalTab === id ? 'is-active' : ''} onClick={() => setModalTab(id)}>
              {rtl ? label : en}
              {id === 'headers' && filled(toPairs(editing.default_headers)).length > 0 && <span className="pm-count">({filled(toPairs(editing.default_headers)).length})</span>}
              {id === 'variables' && filled(toPairs(editing.variables)).length > 0 && <span className="pm-count">({filled(toPairs(editing.variables)).length})</span>}
              {id === 'auth' && editing.auth_type !== 'none' && <i className="pm-ok" aria-hidden="true" />}
            </button>)}
        </div>
        <div className="pm-modal-body">
          {modalTab === 'overview' && <div className="pm-form">
            <label className="pm-field"><span>{L('الرابط الأساسي (Base URL)', 'Base URL')}</span>
              <input dir="ltr" maxLength={500} value={String(editing.base_url)} placeholder="https://api.example.com/v1" onChange={event => setEditing({ ...editing, base_url: event.target.value })} />
              <small>{L('يُضاف قبل مسار كل طلب في هذا التكامل. يُسمح بعناوين http/https العامة فقط.', 'Prepended to the path of every request in this integration. Only public http/https addresses are allowed.')}</small></label>
            <label className="pm-field"><span>{L('الوصف', 'Description')}</span>
              <textarea rows={6} maxLength={1000} value={String(editing.description ?? '')} onChange={event => setEditing({ ...editing, description: event.target.value })} /></label>
          </div>}
          {modalTab === 'auth' && <div className="pm-auth-grid">
            <div className="pm-field"><span>{L('نوع المصادقة', 'Auth Type')}</span>
              <select value={String(editing.auth_type)} onChange={event => setEditing({ ...editing, auth_type: event.target.value })}>
                {Object.entries(AUTH_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <small>{L('تُطبَّق تلقائيًا على كل طلب في هذا التكامل، ولا تصل إلى المتصفح.', 'Applied automatically to every request in this integration; it never reaches the browser.')}</small></div>
            <div className="pm-form">
              {editing.auth_type === 'none' && <p className="pm-hint">{L('هذا التكامل لا يستخدم مصادقة.', 'This integration does not use any authorization.')}</p>}
              {editing.auth_type === 'bearer' && <label className="pm-field"><span>Token</span>
                <input dir="ltr" type="password" maxLength={4000} autoComplete="off" value={String(editing.auth_token ?? '')} onChange={event => setEditing({ ...editing, auth_token: event.target.value })} />
                <small>{L('اتركه كما هو للإبقاء على القيمة المحفوظة.', 'Leave as is to keep the stored value.')}</small></label>}
              {editing.auth_type === 'basic' && <>
                <label className="pm-field"><span>Username</span><input dir="ltr" autoComplete="off" value={String(editing.auth_username ?? '')} onChange={event => setEditing({ ...editing, auth_username: event.target.value })} /></label>
                <label className="pm-field"><span>Password</span><input dir="ltr" type="password" autoComplete="new-password" value={String(editing.auth_password ?? '')} onChange={event => setEditing({ ...editing, auth_password: event.target.value })} />
                  <small>{L('اتركه كما هو للإبقاء على القيمة المحفوظة.', 'Leave as is to keep the stored value.')}</small></label></>}
              {editing.auth_type === 'apikey' && <>
                <label className="pm-field"><span>Key</span><input dir="ltr" value={String(editing.auth_key_name ?? '')} onChange={event => setEditing({ ...editing, auth_key_name: event.target.value })} /></label>
                <label className="pm-field"><span>Value</span><input dir="ltr" type="password" maxLength={4000} autoComplete="off" value={String(editing.auth_key_value ?? '')} onChange={event => setEditing({ ...editing, auth_key_value: event.target.value })} />
                  <small>{L('اتركه كما هو للإبقاء على القيمة المحفوظة.', 'Leave as is to keep the stored value.')}</small></label>
                <label className="pm-field"><span>Add to</span>
                  <select value={String(editing.auth_key_in ?? 'header')} onChange={event => setEditing({ ...editing, auth_key_in: event.target.value })}><option value="header">Header</option><option value="query">Query Params</option></select></label></>}
            </div>
          </div>}
          {modalTab === 'headers' && <div>
            <p className="pm-hint">{L('ترويسات تُرسل مع كل طلب في هذا التكامل.', 'Headers sent with every request in this integration.')}</p>
            <KvTable pairs={toPairs(editing.default_headers)} onChange={default_headers => setEditing({ ...editing, default_headers })} />
          </div>}
          {modalTab === 'variables' && <div>
            <p className="pm-hint">{L('استخدم المتغير كـ {{name}} في الرابط والمعاملات والترويسات والمحتوى.', 'Use a variable as {{name}} in the URL, params, headers and body.')}</p>
            <KvTable pairs={toPairs(editing.variables)} onChange={variables => setEditing({ ...editing, variables })} />
          </div>}
        </div>
        <footer className="pm-modal-foot">
          {Boolean(editing.id) && <button type="button" className="pm-danger" onClick={() => void removeIntegration()}><Trash2 size={14} aria-hidden="true" /> {L('حذف التكامل', 'Delete integration')}</button>}
          {formError && <p className="pm-error" role="alert">{formError}</p>}
          <span className="pm-grow" />
          <button type="button" className="pm-savebtn" onClick={() => setEditing(null)}>{L('إلغاء', 'Cancel')}</button>
          <button type="button" className="pm-send" disabled={busy} onClick={() => void saveIntegration()}>{busy ? L('جارٍ الحفظ...', 'Saving...') : L('حفظ', 'Save')}</button>
        </footer>
      </div>
    </div>}
  </section>;
}
