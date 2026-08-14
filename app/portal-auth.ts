import { env } from "cloudflare:workers";

const COOKIE_NAME = "koon_portal_session";
const SESSION_SECONDS = 60 * 60 * 8;

type PortalSession = { email: string; exp: number };

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

export function portalLoginEmail() {
  return runtimeValue("KOON_LOGIN_EMAIL").toLowerCase();
}

export async function verifyPortalPassword(password: string) {
  const [scheme, iterationsValue, saltValue, expectedValue] = runtimeValue("KOON_LOGIN_PASSWORD_HASH").split("$");
  const iterations = Number(iterationsValue);
  if (scheme !== "pbkdf2-sha256" || !Number.isInteger(iterations) || iterations < 100_000 || !saltValue || !expectedValue) return false;
  const passwordKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name:"PBKDF2", hash:"SHA-256", salt:fromBase64Url(saltValue), iterations }, passwordKey, 256);
  return equalBytes(new Uint8Array(bits), fromBase64Url(expectedValue));
}

export async function createPortalSession(email: string) {
  const session:PortalSession = { email:email.toLowerCase(), exp:Math.floor(Date.now() / 1000) + SESSION_SECONDS };
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
    if (session.email !== portalLoginEmail() || !Number.isFinite(session.exp) || session.exp <= Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch { return null; }
}

export async function requirePortalSession(request: Request) {
  const session = await readPortalSession(request);
  if (!session) throw new Response("Portal login required", { status:401 });
  return session;
}

export function portalSessionCookie(token: string, secure = true) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure ? "; Secure" : ""}`;
}

export function clearPortalSessionCookie(secure = true) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}
