import { env } from "cloudflare:workers";

/**
 * The canonical public origin of this deployment (server-side only), e.g. APP_ORIGIN=https://hr.example.com.
 * Returns null when it is unset or not a valid http(s) URL, so callers fall back to the request's own origin.
 */
export function appOrigin(): string | null {
  const workerValue = (env as unknown as Record<string, unknown>).APP_ORIGIN;
  const nodeValue = typeof process !== "undefined" ? process.env.APP_ORIGIN : undefined;
  const value = String(workerValue || nodeValue || "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** Session cookies get `Secure` when the request itself or the configured public origin is HTTPS (TLS may end at the proxy). */
export function isSecureRequest(request: Request) {
  return new URL(request.url).protocol === "https:" || appOrigin()?.startsWith("https://") === true;
}
