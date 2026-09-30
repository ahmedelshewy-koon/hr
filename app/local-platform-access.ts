/** Local development still requires a valid portal account and session. */
export function allowsLocalPortalLogin(hostname: string, mode: string | undefined) {
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  if (mode !== "development") return false;
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [first, second] = parts.map(Number);
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}
