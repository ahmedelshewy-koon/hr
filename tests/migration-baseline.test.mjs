import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as schema from "../db/schema.ts";

// Guards the drizzle-kit baseline. `drizzle-kit generate` diffs db/schema.ts against the NEWEST snapshot in
// drizzle-postgres/meta, never against the database. When SQL migrations are hand-written without a snapshot and
// without mirroring db/schema.ts, that baseline goes stale and the next `npm run db:generate` emits SQL that
// re-creates tables which already exist (this happened after 0017 and again after 0018-0023).
// These checks need no database.

const dir = new URL("../drizzle-postgres/", import.meta.url);
const readJson = (path) => JSON.parse(fs.readFileSync(new URL(path, dir), "utf8"));
const journal = readJson("meta/_journal.json");
const snapshotFiles = fs
  .readdirSync(new URL("meta/", dir))
  .filter((file) => /^\d{4}_snapshot\.json$/.test(file))
  .sort();
const newestSnapshotFile = snapshotFiles.at(-1);
const newestSnapshot = readJson(`meta/${newestSnapshotFile}`);

test("every journal entry has its SQL file and indexes are contiguous", () => {
  journal.entries.forEach((entry, position) => {
    assert.equal(entry.idx, position, `journal entry ${entry.tag} should have idx ${position}`);
    assert.ok(fs.existsSync(new URL(`${entry.tag}.sql`, dir)), `${entry.tag}.sql is listed in the journal but missing`);
  });
});

test("the newest snapshot belongs to the newest migration", () => {
  const newest = journal.entries.at(-1);
  assert.equal(
    newestSnapshotFile,
    `${String(newest.idx).padStart(4, "0")}_snapshot.json`,
    `Migration ${newest.tag} has no snapshot, so 'npm run db:generate' would diff against an older schema and emit SQL for objects that already exist. ` +
      "Generate migrations with 'npm run db:generate' (or 'npx drizzle-kit generate --custom --name=<name>' for data-only SQL) instead of writing journal entries by hand.",
  );
});

test("snapshots form a single unbroken chain", () => {
  const ids = new Set();
  const parents = new Map();
  for (const file of snapshotFiles) {
    const snapshot = readJson(`meta/${file}`);
    assert.ok(!ids.has(snapshot.id), `${file} repeats snapshot id ${snapshot.id}`);
    ids.add(snapshot.id);
    assert.ok(!parents.has(snapshot.prevId), `${file} and ${parents.get(snapshot.prevId)} both descend from ${snapshot.prevId}`);
    parents.set(snapshot.prevId, file);
  }
  const roots = snapshotFiles.filter((file) => !ids.has(readJson(`meta/${file}`).prevId));
  assert.equal(roots.length, 1, `expected exactly one root snapshot, found: ${roots.join(", ")}`);
});

test("db/schema.ts matches the newest snapshot, so 'npm run db:generate' has nothing to emit", async () => {
  const current = generateDrizzleJson(schema, newestSnapshot.id);
  const statements = await generateMigration(newestSnapshot, current);
  assert.deepEqual(
    statements,
    [],
    `db/schema.ts differs from ${newestSnapshotFile}. Run 'npm run db:generate' and commit the migration and snapshot it creates. ` +
      "If you wrote SQL by hand, mirror it in db/schema.ts first.\n" +
      statements.join("\n"),
  );
});
