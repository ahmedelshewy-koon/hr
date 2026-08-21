import { env } from "cloudflare:workers";
import type { PostgresDatabase } from "../db/postgres";

const COOKIE_NAME = "koon_portal_session";
const DEFAULT_SESSION_SECONDS = 60 * 60 * 8;
const PASSWORD_ITERATIONS = 210_000;

export type PortalSession = { userId: number; email: string; sessionVersion: number; exp: number };

function runtimeValue(key: "KOON_LOGIN_EMAIL" | "KOON_LOGIN_PASSWORD_HASH" | "KOON_AUTH_SECRET") {
  const workerValue = (env as unknown as Record<string, unknown>)[key];
  const nodeValue = typeof process !== "undefined" ? process.env[key] : undefined;
  const value = String(workerValue || nodeValue || "").trim();
  if (!value) throw new Error(`${key} is not configured`);
  return value;
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function hmac(value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(runtimeValue("KOON_AUTH_SECRET")), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

export function portalLoginEmail() { return runtimeValue("KOON_LOGIN_EMAIL").toLowerCase(); }

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name:"PBKDF2", hash:"SHA-256", salt, iterations:PASSWORD_ITERATIONS }, passwordKey, 256);
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, encodedHash: string) {
  try {
    const [scheme, iterationsValue, saltValue, expectedValue] = encodedHash.split("$");
    const iterations = Number(iterationsValue);
    if (scheme !== "pbkdf2-sha256" || !Number.isInteger(iterations) || iterations < 100_000 || !saltValue || !expectedValue) return false;
    const passwordKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name:"PBKDF2", hash:"SHA-256", salt:fromBase64Url(saltValue), iterations }, passwordKey, 256);
    return equalBytes(new Uint8Array(bits), fromBase64Url(expectedValue));
  } catch { return false; }
}

export async function verifyBootstrapPassword(password: string) { return verifyPassword(password, runtimeValue("KOON_LOGIN_PASSWORD_HASH")); }

export async function createPortalSession(user: { id:number; email:string; session_version?:number },sessionSeconds=DEFAULT_SESSION_SECONDS) {
  const safeSeconds=Math.min(86400,Math.max(900,Math.floor(sessionSeconds)));
  const session:PortalSession = { userId:user.id, email:user.email.toLowerCase(), sessionVersion:Number(user.session_version)||1, exp:Math.floor(Date.now() / 1000) + safeSeconds };
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(session)));
  const signature = toBase64Url(await hmac(payload));
  return `${payload}.${signature}`;
}

export async function readPortalSession(request: Request):Promise<PortalSession|null> {
  try {
    const cookie = request.headers.get("cookie")?.split(";").map(part=>part.trim()).find(part=>part.startsWith(`${COOKIE_NAME}=`));
    const token = cookie?.slice(COOKIE_NAME.length + 1);
    if (!token) return null;
    const [payload, signature] = token.split(".");
    if (!payload || !signature || !equalBytes(await hmac(payload), fromBase64Url(signature))) return null;
    const session = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as PortalSession;
    if (!Number.isInteger(session.userId) || !session.email || !Number.isInteger(session.sessionVersion) || !Number.isFinite(session.exp) || session.exp <= Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch { return null; }
}

export async function requirePortalSession(request: Request, d1?: PostgresDatabase) {
  const session = await readPortalSession(request);
  if (!session) throw new Response("Portal login required", { status:401 });
  if (d1) {
    const user = await d1.prepare("SELECT id,email,status,session_version FROM users WHERE id=?").bind(session.userId).first<{id:number;email:string;status:string;session_version:number}>();
    if (!user || user.status !== "active" || Number(user.session_version) !== session.sessionVersion || user.email.toLowerCase() !== session.email) throw new Response("Portal login required", { status:401 });
  }
  return session;
}

export async function ensureAuthSchema(d1: PostgresDatabase) {
  await d1.prepare("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT").run();
  await d1.prepare("ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1").run();
  await d1.prepare("ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0").run();
  await d1.prepare("ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ").run();
  await d1.prepare("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ").run();
}

export function portalSessionCookie(token: string, secure = true,sessionSeconds=DEFAULT_SESSION_SECONDS) { const safeSeconds=Math.min(86400,Math.max(900,Math.floor(sessionSeconds)));return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${safeSeconds}${secure ? "; Secure" : ""}`; }
export function clearPortalSessionCookie(secure = true) { return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`; }
