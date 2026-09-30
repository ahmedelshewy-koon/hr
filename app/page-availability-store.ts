import type { PostgresDatabase } from "../db/postgres";

export async function readPageAvailability(db: PostgresDatabase): Promise<Record<string, boolean>> {
  const row = await db.prepare("SELECT value_json FROM system_settings WHERE setting_key='page_availability'").first<{ value_json: string }>();
  const values: unknown = JSON.parse(row?.value_json || "{}");
  return values && typeof values === "object" && !Array.isArray(values) ? values as Record<string, boolean> : {};
}
