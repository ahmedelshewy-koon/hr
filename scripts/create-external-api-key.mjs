// Creates an API key for the external employees/departments API.
// Usage: node scripts/create-external-api-key.mjs <client-name>
// Give the key to the client once (it is not stored anywhere), and add the printed
// name:hash pair to EXTERNAL_API_KEYS on the server (comma-separated, one per client).
import { createHash, randomBytes } from "node:crypto";

const name = process.argv[2];
if (!name || !/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(name)) {
  console.error("Usage: node scripts/create-external-api-key.mjs <client-name>  (letters, digits, - or _)");
  process.exit(1);
}
const key = `hrx_${randomBytes(32).toString("base64url")}`;
const hash = createHash("sha256").update(key).digest("hex");
console.log(`API key for ${name} (shown once):\n  ${key}\n`);
console.log(`Add to EXTERNAL_API_KEYS:\n  ${name}:${hash}`);
