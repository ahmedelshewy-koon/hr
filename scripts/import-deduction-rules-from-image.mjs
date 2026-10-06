// User-approved reference import. No payroll records are changed.
// Run with --apply to commit; otherwise validate the complete import and roll back.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { readHrSettings, saveHrSetting, validateDeductionRule } from '../app/hr-settings/catalog.ts';

const source = JSON.parse(fs.readFileSync(new URL('./data/deduction-rules-2026-10-04.json', import.meta.url), 'utf8'));
const english = ['Absence without permission', 'Absence with permission', 'Late arrival 1-15 minutes', 'Late arrival 16-30 minutes', 'Grace', 'Late arrival over 60 minutes', 'Late arrival 31-60 minutes', 'Overtime'];
const records = source.rules.map((row, i) => validateDeductionRule({
  name_ar: row.name_ar, name_en: english[i],
  rule_type: { 'غياب': 'absence', 'تأخير': 'late_arrival', 'إضافي': 'overtime' }[row.type_ar],
  absence_notice: { 'بإشعار': 'with_notice', 'بدون إشعار': 'without_notice' }[row.notice_ar] ?? null,
  min_minutes: row.min_minutes, max_minutes: row.max_minutes,
  deduction_type: { 'نسبة مئوية': 'daily_wage_percent', 'مبلغ ثابت': 'fixed_amount', 'بالساعة': 'hourly' }[row.deduction_type_ar],
  value: row.value, overtime_multiplier: row.overtime_multiplier, status: row.active ? 'active' : 'inactive',
}));
assert.equal(records.length, 8);
const local = fs.existsSync('.dev.vars') ? fs.readFileSync('.dev.vars', 'utf8') : '';
const url = process.env.DATABASE_URL || local.match(/^DATABASE_URL\s*=\s*(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!url) throw new Error('DATABASE_URL is required');
const sql = postgres(url, { max: 1, connect_timeout: 10 });
const apply = process.argv.includes('--apply');
const rollback = new Error('REFERENCE_IMPORT_DRY_RUN');
let result;
function adapter(tx) {
  return { prepare(query) {
    let values = [];
    const execute = () => { let i = 0; return tx.unsafe(query.replace(/\?/g, () => `$${++i}`), values); };
    return {
      bind(...args) { values = args; return this; },
      async first() { return (await execute())[0] ?? null; },
      async all() { return { results: await execute() }; },
      async run() { return { results: await execute() }; },
    };
  } };
}
try {
  await sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(78241)`;
    const before = await tx`SELECT * FROM deduction_rules ORDER BY id`;
    if (apply) {
      fs.mkdirSync('outputs', { recursive: true });
      fs.writeFileSync(`outputs/deduction-rules-before-${Date.now()}.json`, JSON.stringify(before, null, 2));
    }
    const migration = fs.readFileSync(new URL('../drizzle-postgres/0037_deduction_rule_reference_fields.sql', import.meta.url), 'utf8');
    for (const statement of migration.split('--> statement-breakpoint').filter(part => part.trim())) await tx.unsafe(statement);
    const db = adapter(tx);
    let inserted = 0;
    for (const record of records) {
      const [existing] = await tx`SELECT * FROM deduction_rules WHERE name_ar=${record.name_ar}`;
      if (existing) {
        for (const key of Object.keys(record)) assert.deepEqual(existing[key], record[key], `Existing rule differs: ${record.name_ar}/${key}; no overwrite performed`);
      } else {
        // A null actor identifies a local data import instead of impersonating an app user.
        await saveHrSetting(db, 'deductionRules', record, null);
        inserted++;
      }
    }
    const saved = (await readHrSettings(db)).deductionRules;
    for (const record of records) {
      const matching = saved.filter(row => row.name_ar === record.name_ar);
      assert.equal(matching.length, 1, `Expected exactly one: ${record.name_ar}`);
      for (const key of Object.keys(record)) assert.deepEqual(matching[0][key], record[key], `${record.name_ar}/${key}`);
    }
    assert.equal(saved.length, before.length + inserted);
    result = { applied: apply, inserted, verified: records.length, total: saved.length };
    if (!apply) throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally { await sql.end({ timeout: 5 }); }
console.log(JSON.stringify(result));
