// Generate the final current-schema snapshot after authentic migration 0051.
// This does NOT run or invent SQL and does not connect to any database.
import fs from "node:fs";
import * as schema from "../db/schema.ts";
import {generateDrizzleJson, generateMigration} from "drizzle-kit/api";
const prior=JSON.parse(fs.readFileSync(new URL("../drizzle-postgres/meta/0046_snapshot.json",import.meta.url),"utf8"));
const current=generateDrizzleJson(schema,prior.id);
if(current.prevId!==prior.id) throw Error("Snapshot ancestry mismatch");
const follow=generateDrizzleJson(schema,current.id);
const delta=await generateMigration(current,follow);
if(delta.length) throw Error("Generated latest snapshot is stale: "+delta.slice(0,3).join(" "));
const tables=Object.keys(current.tables||{});
if(tables.length!==107) throw Error("Schema tables unexpectedly changed: "+tables.length);
console.log("HR_GENERATED_SNAPSHOT_TABLES="+tables.length);
console.log("HR_GENERATED_SNAPSHOT_PARENT="+current.prevId);
const raw=JSON.stringify(current);
for(let i=0;i<raw.length;i+=4000){
 console.log("HR_DRIZZLE_SNAPSHOT_PART="+String(i/4000).padStart(4,"0")+":"+raw.slice(i,i+4000));
}
