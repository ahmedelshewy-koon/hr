import { env } from "cloudflare:workers";
import type { MailConfig } from "./mail.ts";

/** Reads MAIL_API_URL / MAIL_API_KEY / MAIL_FROM from the worker environment or, in Node, process.env. Null when mail is not configured. */
export function readMailConfig(): MailConfig | null {
  const worker = env as unknown as Record<string, string | undefined>;
  const node: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {};
  const url = worker.MAIL_API_URL || node.MAIL_API_URL, key = worker.MAIL_API_KEY || node.MAIL_API_KEY, from = worker.MAIL_FROM || node.MAIL_FROM;
  return url && key && from ? { url, key, from } : null;
}
