import fs from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

export function loadLocalEnvironment() {
  const file = fileURLToPath(new URL("../.dev.vars", import.meta.url));
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

export function databaseAdapter(client) {
  return {
    prepare(source) {
      let index = 0;
      const query = source.trim().replace(/\?/g, () => "$" + ++index);
      const prepared = values => ({
        bind(...bound) { return prepared(bound); },
        async first() { return (await client.unsafe(query, values))[0] ?? null; },
        async all() { return { results: await client.unsafe(query, values) }; },
        async run() { return { results: await client.unsafe(query, values) }; },
      });
      return prepared([]);
    },
    transaction(callback) {
      return client.begin ? client.begin(tx => callback(databaseAdapter(tx))) : client.savepoint(tx => callback(databaseAdapter(tx)));
    },
    close() { return client.end({ timeout: 5 }); },
    client,
  };
}

export function runtimeDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const local = /(?:localhost|127\.0\.0\.1|\[::1\])/.test(url);
  return databaseAdapter(postgres(url, { max: 4, prepare: false, connect_timeout: 10, idle_timeout: 20, ssl: local ? false : "require" }));
}
