import { componentRuleName, hoursText, kindLabel, num } from "./labels.ts";
import { components, type SheetRow } from "./summary.ts";

/**
 * Deduction notification e-mails. Transport is an HTTPS mail API (Resend-compatible: POST {from,to,subject,html,text} with a
 * bearer key) so it runs on the worker as well as in Node. Configure MAIL_API_URL, MAIL_API_KEY and MAIL_FROM; with no
 * configuration nothing is sent and nothing is marked as sent.
 */
export type MailConfig = { url: string; key: string; from: string };
export type MailMessage = { to: string; subject: string; html: string; text: string };

const escapeHtml = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export async function sendMail(config: MailConfig, message: MailMessage): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(config.url, {
      method: "POST", signal: AbortSignal.timeout(15000), headers: { "content-type": "application/json", authorization: `Bearer ${config.key}` },
      body: JSON.stringify({ from: config.from, to: [message.to], subject: message.subject, html: message.html, text: message.text }),
    });
    if (!response.ok) return { ok: false, error: `Mail service answered ${response.status}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Mail service unreachable" };
  }
}

const money = (value: number) => new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

/** One e-mail per employee, in Arabic and English: every deducted day with its minutes, the rule applied and the amount. */
export function deductionMessage(input: { name: string; nameAr: string; to: string; periodFrom: string; periodTo: string; rows: SheetRow[] }): MailMessage {
  const lines = input.rows.flatMap(row => {
    const parts = components(row);
    return (parts.length ? parts : [{ kind: "", ruleEn: "", ruleAr: "", minutes: 0, amount: num(row.deduction_amount) }]).map(part => ({
      date: String(row.work_date), kind: part.kind ?? "", minutes: part.kind === "absence" ? 0 : num(part.minutes) || num(row.late_minutes), ruleEn: componentRuleName(part, false), ruleAr: componentRuleName(part, true), amount: num(part.amount),
    }));
  });
  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  const subject = `Deduction notice · إشعار خصم — ${input.periodFrom} → ${input.periodTo}`;
  const rowsHtml = lines.map(line => `<tr><td>${escapeHtml(line.date)}</td><td>${escapeHtml(kindLabel(line.kind, false))} / ${escapeHtml(kindLabel(line.kind, true))}</td><td>${line.minutes ? escapeHtml(hoursText(line.minutes, false)) : "—"}</td><td>${escapeHtml(line.ruleEn || line.ruleAr || "—")}</td><td style="text-align:end">${money(line.amount)}</td></tr>`).join("");
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px"><p>Dear ${escapeHtml(input.name)},</p><p>The following attendance deductions were recorded for the period ${escapeHtml(input.periodFrom)} to ${escapeHtml(input.periodTo)}:</p>`
    + `<table cellpadding="6" style="border-collapse:collapse;width:100%" border="1"><thead><tr><th>Date</th><th>Type</th><th>Time</th><th>Rule</th><th>Amount</th></tr></thead><tbody>${rowsHtml}</tbody><tfoot><tr><td colspan="4"><b>Total</b></td><td style="text-align:end"><b>${money(total)}</b></td></tr></tfoot></table>`
    + `<p dir="rtl" style="text-align:right">عزيزي ${escapeHtml(input.nameAr || input.name)}، سُجّلت عليك الخصومات الموضحة أعلاه للفترة من ${escapeHtml(input.periodFrom)} إلى ${escapeHtml(input.periodTo)}. الإجمالي: ${money(total)}.</p>`
    + `<p>Please contact HR if you believe a record is wrong. · يرجى التواصل مع الموارد البشرية عند وجود أي اعتراض.</p></div>`;
  const text = [`Dear ${input.name},`, `Attendance deductions for ${input.periodFrom} to ${input.periodTo}:`, ...lines.map(line => `${line.date}  ${kindLabel(line.kind, false)}  ${line.minutes ? hoursText(line.minutes, false) : "-"}  ${line.ruleEn}  ${money(line.amount)}`), `Total: ${money(total)}`].join("\n");
  return { to: input.to, subject, html, text };
}
