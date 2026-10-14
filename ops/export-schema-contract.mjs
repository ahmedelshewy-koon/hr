// Emit an auditable schema contract from the actual Drizzle TypeScript schema.
// No database credentials, network requests, or production access.
import * as schema from "../db/schema.ts";
import { generateDrizzleJson } from "drizzle-kit/api";

const snapshot = generateDrizzleJson(schema, "00000000-0000-4000-8000-000000000000");
const tables = Object.values(snapshot.tables || {}).map((table) => ({
  name: table.name,
  schema: table.schema || "public",
  columns: Object.keys(table.columns || {}).sort()
})).sort((a,b)=>a.name.localeCompare(b.name));
if (tables.length < 20) throw Error("Unexpectedly few schema tables: "+tables.length);
const names = new Set(tables.map((x)=>x.name));
for (const required of ["employees","attendance_devices","attendance_ingest_sources","subscription_plans","integrations","integration_requests"]) {
  if (!names.has(required)) throw Error("Missing essential table in current schema: "+required);
}
console.log(JSON.stringify({schema_version:"hr-vps-contract-v1",tables},null,2));
