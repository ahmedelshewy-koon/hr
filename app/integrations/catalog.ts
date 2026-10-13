import type { TransactionDatabase } from '../../db/postgres';
import type { Row } from '../ui-types';

/**
 * Integrations: saved external API connections (base URL + auth + default headers) and their requests, driven from the
 * Postman-style workbench. Super Admin only. Secrets are write-only: lists return a mask, and a blank secret on save keeps the stored one.
 */
export type IntegrationIssue = { code: string; field: string | null; message_ar: string; message_en: string; status?: number };
export class IntegrationError extends Error {
  issue: IntegrationIssue;
  constructor(issue: IntegrationIssue) { super(issue.message_en); this.name = 'IntegrationError'; this.issue = issue; }
}
const fail = (code: string, field: string | null, ar: string, en: string, status = 400): never => { throw new IntegrationError({ code, field, message_ar: ar, message_en: en, status }); };

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export const AUTH_TYPES = ['none', 'bearer', 'basic', 'apikey'] as const;
export const BODY_TYPES = ['none', 'json', 'text', 'form'] as const;
export const MASK = '••••••••';
const text = (value: unknown) => String(value ?? '').trim();
export type KeyValue = { key: string; value: string; enabled: boolean; description: string };

/** Rows of key/value pairs stored as JSON text; anything malformed becomes an empty list. */
export function parsePairs(value: unknown): KeyValue[] {
  let list: unknown = value;
  if (typeof value === 'string') { try { list = JSON.parse(value); } catch { list = []; } }
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is Row => !!item && typeof item === 'object')
    .map(item => ({ key: String(item.key ?? '').slice(0, 200), value: String(item.value ?? '').slice(0, 4000), enabled: item.enabled !== false, description: String(item.description ?? '').slice(0, 500) }))
    .filter(pair => pair.key || pair.value).slice(0, 100);
}
const pairsJson = (value: unknown) => { const pairs = parsePairs(value); return pairs.length ? JSON.stringify(pairs) : null; };

/**
 * Only public http(s) hosts may be called: the workbench runs on the server, so loopback, private, link-local and
 * metadata addresses are refused (literal host check; a hostname that resolves privately is not caught here).
 */
export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { return fail('INVALID_URL', 'url', 'الرابط غير صالح', 'The URL is not valid'); }
  if (!['http:', 'https:'].includes(url.protocol)) fail('INVALID_URL', 'url', 'يُسمح بروابط http و https فقط', 'Only http and https URLs are allowed');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  const blockedV4 = v4 && (() => { const [a, b] = [Number(v4[1]), Number(v4[2])]; return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224; })();
  const blockedV6 = host.includes(':') && (host === '::1' || host === '::' || /^(fc|fd|fe80|::ffff:)/.test(host));
  if (blockedV4 || blockedV6 || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.') && !host.includes(':'))
    fail('BLOCKED_HOST', 'url', 'لا يمكن الاتصال بعناوين محلية أو داخلية', 'Calls to local or internal addresses are not allowed', 400);
  return url;
}

export function validateIntegration(input: Row, existingConfig: Row | null) {
  const name = text(input.name);
  if (!name) fail('REQUIRED_FIELD', 'name', 'اسم التكامل مطلوب', 'Integration name is required');
  if (name.length > 120) fail('TOO_LONG', 'name', 'الاسم طويل جدًا', 'Name is too long');
  const base_url = text(input.base_url).replace(/\/+$/, '');
  if (base_url) assertPublicUrl(base_url);
  const auth_type = text(input.auth_type) || 'none';
  if (!(AUTH_TYPES as readonly string[]).includes(auth_type)) fail('INVALID_AUTH', 'auth_type', 'نوع المصادقة غير صالح', 'Invalid authorization type');
  const incoming = (key: string) => { const value = String(input[key] ?? ''); return value === MASK ? undefined : value; };
  const prev = existingConfig ?? {};
  const keep = (key: string) => { const value = incoming(key); return value === undefined || (value === '' && prev[key]) ? String(prev[key] ?? '') : value; };
  const config: Row = {};
  if (auth_type === 'bearer') config.token = keep('auth_token');
  if (auth_type === 'basic') { config.username = text(input.auth_username); config.password = keep('auth_password'); }
  if (auth_type === 'apikey') { config.key = text(input.auth_key_name) || 'X-API-Key'; config.value = keep('auth_key_value'); config.in = text(input.auth_key_in) === 'query' ? 'query' : 'header'; }
  const description = text(input.description);
  if (description.length > 1000) fail('TOO_LONG', 'description', 'الوصف طويل جدًا', 'Description is too long');
  return { name, base_url, auth_type, auth_config: auth_type === 'none' ? null : JSON.stringify(config), default_headers: pairsJson(input.default_headers), variables: pairsJson(input.variables), description: description || null };
}

export function validateRequest(input: Row) {
  const name = text(input.name);
  if (!name) fail('REQUIRED_FIELD', 'name', 'اسم الطلب مطلوب', 'Request name is required');
  if (name.length > 160) fail('TOO_LONG', 'name', 'الاسم طويل جدًا', 'Name is too long');
  const method = text(input.method).toUpperCase() || 'GET';
  if (!(METHODS as readonly string[]).includes(method)) fail('INVALID_METHOD', 'method', 'نوع الطلب غير صالح', 'Invalid method');
  const path = text(input.path);
  if (path.length > 2000) fail('TOO_LONG', 'path', 'الرابط طويل جدًا', 'The URL is too long');
  const body_type = text(input.body_type) || 'none';
  if (!(BODY_TYPES as readonly string[]).includes(body_type)) fail('INVALID_BODY', 'body_type', 'نوع المحتوى غير صالح', 'Invalid body type');
  const body = String(input.body ?? '');
  if (body.length > 200_000) fail('TOO_LONG', 'body', 'المحتوى طويل جدًا', 'The body is too long');
  const description = text(input.description);
  if (description.length > 2000) fail('TOO_LONG', 'description', 'الوصف طويل جدًا', 'Description is too long');
  return { name, method, path, params: pairsJson(input.params), headers: pairsJson(input.headers), path_vars: pairsJson(input.path_vars), body_type, body: body || null, description: description || null };
}

type Db = Pick<TransactionDatabase, 'prepare'>;
const all = async (db: Db, sql: string, ...args: unknown[]) => ((await db.prepare(sql).bind(...args).all()).results ?? []) as Row[];
const INT_COLUMNS = 'id,name,base_url,auth_type,auth_config,default_headers,variables,description';
const REQ_COLUMNS = 'id,integration_id,name,method,path,params,headers,path_vars,description,body_type,body,sort_order';
const publicRequest = (row: Row) => ({ ...row, params: parsePairs(row.params), headers: parsePairs(row.headers), path_vars: parsePairs(row.path_vars), description: row.description ?? '' });

/** The integration as the UI sees it: secrets replaced by a mask, never sent back. */
function publicIntegration(row: Row) {
  let config: Row = {};
  try { config = row.auth_config ? JSON.parse(String(row.auth_config)) : {}; } catch { config = {}; }
  return {
    id: row.id, name: row.name, base_url: row.base_url, auth_type: row.auth_type, description: row.description ?? '',
    default_headers: parsePairs(row.default_headers), variables: parsePairs(row.variables),
    auth_token: config.token ? MASK : '', auth_username: config.username ?? '', auth_password: config.password ? MASK : '',
    auth_key_name: config.key ?? '', auth_key_value: config.value ? MASK : '', auth_key_in: config.in ?? 'header',
  };
}

export async function readIntegrations(db: Db) {
  const [integrations, requests] = await Promise.all([
    all(db, `SELECT ${INT_COLUMNS} FROM integrations ORDER BY name,id`),
    all(db, `SELECT ${REQ_COLUMNS} FROM integration_requests ORDER BY sort_order,id`),
  ]);
  return { integrations: integrations.map(publicIntegration), requests: requests.map(publicRequest) };
}

async function audit(db: Db, actorId: number | null, action: string, id: unknown, after: Row | null) {
  // Secrets never reach the audit trail.
  const safe = after ? Object.fromEntries(Object.entries(after).filter(([key]) => key !== 'auth_config')) : null;
  await db.prepare('INSERT INTO audit_logs (user_id,action,module,record_type,record_id,previous_value,new_value,created_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)')
    .bind(actorId, action, 'system_settings', 'integrations', String(id), null, safe ? JSON.stringify(safe) : null).run();
}

export async function saveIntegration(db: Db, input: Row, actorId: number | null) {
  const id = Number(input.id) || null;
  const before = id ? await db.prepare(`SELECT ${INT_COLUMNS} FROM integrations WHERE id=? FOR UPDATE`).bind(id).first<Row>() : null;
  if (id && !before) fail('NOT_FOUND', 'id', 'التكامل غير موجود', 'Integration not found', 404);
  let existing: Row | null = null;
  try { existing = before?.auth_config ? JSON.parse(String(before.auth_config)) : null; } catch { existing = null; }
  const values = validateIntegration(input, existing);
  const keys = Object.keys(values) as (keyof typeof values)[];
  const saved = id
    ? await db.prepare(`UPDATE integrations SET ${keys.map(key => `${key}=?`).join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING ${INT_COLUMNS}`).bind(...keys.map(key => values[key]), id).first<Row>()
    : await db.prepare(`INSERT INTO integrations (${keys.join(',')},created_at,updated_at) VALUES (${keys.map(() => '?').join(',')},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING ${INT_COLUMNS}`).bind(...keys.map(key => values[key])).first<Row>();
  await audit(db, actorId, id ? 'integration_updated' : 'integration_created', saved!.id, values);
  return publicIntegration(saved!);
}

export async function deleteIntegration(db: Db, idValue: unknown, actorId: number) {
  const id = Number(idValue);
  const before = id ? await db.prepare('SELECT id,name FROM integrations WHERE id=? FOR UPDATE').bind(id).first<Row>() : null;
  if (!before) fail('NOT_FOUND', 'id', 'التكامل غير موجود', 'Integration not found', 404);
  await db.prepare('DELETE FROM integrations WHERE id=?').bind(id).run();
  await audit(db, actorId, 'integration_deleted', id, before);
  return { id };
}

export async function saveRequest(db: Db, input: Row, actorId: number | null) {
  const id = Number(input.id) || null;
  const integrationId = Number(input.integration_id);
  if (!(await db.prepare('SELECT id FROM integrations WHERE id=?').bind(integrationId).first())) fail('NOT_FOUND', 'integration_id', 'التكامل غير موجود', 'Integration not found', 404);
  if (id && !(await db.prepare('SELECT id FROM integration_requests WHERE id=? FOR UPDATE').bind(id).first())) fail('NOT_FOUND', 'id', 'الطلب غير موجود', 'Request not found', 404);
  const values = validateRequest(input);
  const saved = id
    ? await db.prepare(`UPDATE integration_requests SET integration_id=?,name=?,method=?,path=?,params=?,headers=?,path_vars=?,description=?,body_type=?,body=?,updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING ${REQ_COLUMNS}`).bind(integrationId, values.name, values.method, values.path, values.params, values.headers, values.path_vars, values.description, values.body_type, values.body, id).first<Row>()
    : await db.prepare(`INSERT INTO integration_requests (integration_id,name,method,path,params,headers,path_vars,description,body_type,body,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,(SELECT COALESCE(MAX(sort_order),0)+1 FROM integration_requests WHERE integration_id=?),CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING ${REQ_COLUMNS}`).bind(integrationId, values.name, values.method, values.path, values.params, values.headers, values.path_vars, values.description, values.body_type, values.body, integrationId).first<Row>();
  await audit(db, actorId, id ? 'integration_request_updated' : 'integration_request_created', saved!.id, values);
  return publicRequest(saved!);
}

export async function deleteRequest(db: Db, idValue: unknown, actorId: number) {
  const id = Number(idValue);
  const before = id ? await db.prepare('SELECT id,name FROM integration_requests WHERE id=? FOR UPDATE').bind(id).first<Row>() : null;
  if (!before) fail('NOT_FOUND', 'id', 'الطلب غير موجود', 'Request not found', 404);
  await db.prepare('DELETE FROM integration_requests WHERE id=?').bind(id).run();
  await audit(db, actorId, 'integration_request_deleted', id, before);
  return { id };
}

const MAX_RESPONSE_BYTES = 2_000_000;
const TIMEOUT_MS = 20_000;

/** Sends one request on the server with the integration's auth applied; returns what Postman shows: status, time, size, headers, body. */
export async function sendRequest(db: Db, input: Row) {
  const integrationId = Number(input.integration_id) || null;
  const integration = integrationId ? await db.prepare(`SELECT ${INT_COLUMNS} FROM integrations WHERE id=?`).bind(integrationId).first<Row>() : null;
  const method = text(input.method).toUpperCase() || 'GET';
  if (!(METHODS as readonly string[]).includes(method)) fail('INVALID_METHOD', 'method', 'نوع الطلب غير صالح', 'Invalid method');
  // {{name}} variables of the integration, applied to the URL, params, headers and body; unknown names stay as typed.
  const variables = new Map(parsePairs(integration?.variables).filter(pair => pair.enabled && pair.key).map(pair => [pair.key, pair.value]));
  const subst = (value: string) => value.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (whole, name: string) => (variables.has(name) ? variables.get(name)! : whole));
  const rawPath = subst(text(input.path));
  if (!rawPath && !integration?.base_url) fail('REQUIRED_FIELD', 'path', 'أدخل رابط الطلب', 'Enter the request URL');
  const absolute = /^https?:\/\//i.test(rawPath);
  const target = absolute ? rawPath : `${String(integration?.base_url ?? '')}${rawPath && !rawPath.startsWith('/') && !rawPath.startsWith('?') ? '/' : ''}${rawPath}`;
  const url = assertPublicUrl(target);
  for (const pair of parsePairs(input.path_vars)) if (pair.key && subst(pair.value)) url.pathname = url.pathname.replace(new RegExp(`/:${pair.key.replace(/[.*+?^${}()|[\]\\]/g, '\\  for (const pair of parsePairs(input.params)) if (pair.enabled && pair.key) url.searchParams.append(pair.key, pair.value);')}(?=/|$)`), `/${encodeURIComponent(subst(pair.value))}`);
  for (const pair of parsePairs(input.params)) if (pair.enabled && pair.key) url.searchParams.append(subst(pair.key), subst(pair.value));
  const headers = new Headers();
  for (const pair of [...parsePairs(integration?.default_headers), ...parsePairs(input.headers)]) if (pair.enabled && pair.key) { try { headers.set(subst(pair.key), subst(pair.value)); } catch { fail('INVALID_HEADER', 'headers', `ترويسة غير صالحة: ${pair.key}`, `Invalid header: ${pair.key}`); } }
  let config: Row = {};
  try { config = integration?.auth_config ? JSON.parse(String(integration.auth_config)) : {}; } catch { config = {}; }
  if (integration?.auth_type === 'bearer' && config.token) headers.set('authorization', `Bearer ${config.token}`);
  if (integration?.auth_type === 'basic') headers.set('authorization', `Basic ${btoa(unescape(encodeURIComponent(`${config.username ?? ''}:${config.password ?? ''}`)))}`);
  if (integration?.auth_type === 'apikey' && config.value) { if (config.in === 'query') url.searchParams.set(String(config.key), String(config.value)); else headers.set(String(config.key), String(config.value)); }
  const bodyType = text(input.body_type) || 'none';
  let body: string | undefined;
  if (!['GET', 'HEAD'].includes(method) && bodyType !== 'none') {
    body = subst(String(input.body ?? ''));
    if (bodyType === 'json' && !headers.has('content-type')) headers.set('content-type', 'application/json');
    if (bodyType === 'text' && !headers.has('content-type')) headers.set('content-type', 'text/plain');
    if (bodyType === 'form') {
      const form = new URLSearchParams();
      for (const pair of parsePairs(input.body)) if (pair.enabled && pair.key) form.append(subst(pair.key), subst(pair.value));
      body = form.toString();
      if (!headers.has('content-type')) headers.set('content-type', 'application/x-www-form-urlencoded');
    }
  }
  const started = Date.now();
  try {
    // Redirects are not followed: a redirect could lead to an internal address the host check never saw.
    const response = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0, truncated = false;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { truncated = true; await reader.cancel(); break; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
    let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { ok: true, status: response.status, statusText: response.statusText, time: Date.now() - started, size, truncated, headers: [...response.headers.entries()], body: new TextDecoder().decode(bytes), url: url.toString() };
  } catch (error) {
    const timedOut = (error as Error)?.name === 'TimeoutError';
    return { ok: false, time: Date.now() - started, error_ar: timedOut ? 'انتهت مهلة الطلب (20 ثانية)' : 'تعذر الاتصال بالخادم', error_en: timedOut ? 'The request timed out (20 s)' : `Could not reach the server${(error as Error)?.message ? `: ${(error as Error).message}` : ''}`, url: url.toString() };
  }
}
