// One-off: fill employees.work_phone / personal_phone from the vCard export. Dry run by default; --apply writes (fills EMPTY fields only) + audit_logs.
import postgres from "file:///D:/HR/node_modules/postgres/src/index.js";

const apply = process.argv.includes("--apply");
// [legacy code or code, work email, work phone, personal phone]
const rows = [
  ["EMP1767255602887", "abanoub@koon.sa", "01022233277", "01029009237"],
  ["EMP1777963843386", "abdelrahman@koon.sa", "010400504843", "01009606605"],
  ["EMP1767255747751", "abdelrazik@koon.sa", "01022233166", "01156827483"],
  ["EMP1767255763570", "abdelaziz@asuscard.sa", null, "+966540910405"],
  ["EMP1767255737371", "abdulhamed@asuscard.sa", "01040400914", "01507974455"],
  ["EMP1777905530845", "adel@koon.sa", "01000136805", "01279792507"],
  ["EMP1784465493038", "media.buyer@koonagency.com", null, "01226235547"],
  ["EMP1767255626255", "ahmed.elshewy@koon.sa", "01040400916", "01026061270"],
  ["EMP1767255774947", "amr@koon.sa", "01000136686", "01013622100"],
  ["EMP1767255645581", "aya.hakem@asuscard.sa", null, "01553282965"],
  ["EMP1777964028898", "diaa@koon.sa", "01040050485", "01120027490"],
  ["EMP1774854557687", null, null, "01128931483"],
  ["EMP1767687066235", "fady.mounir@koon.sa", "01000085946", "01226800676"],
  ["EMP1767255685944", "jood@koonagency.com", null, "+966550677076"],
  ["EMP1783414422107", "maan@koon.sa", null, "01024941663"],
  ["EMP1767255793641", "maged@koon.sa", "01000085894", "01112115553"],
  ["EMP1767255839413", "mai.samir@asuscard.sa", "01070300449", "01280446680"],
  ["EMP1777986401322", "mwada.hussien@asuscard.sa", null, "01032762391"],
  ["EMP1767255848818", "maimona@koonagency.com", null, "+966544738938"],
  ["EMP1781513344462", "mireille@koon.sa", null, "01032966026"],
  ["EMP1767255801825", "mohamed.saad@asuscard.sa", "01099918852", "01011817373"],
  ["EMP1772689551215", null, "01000136689", null],
  ["EMP1767255830092", "mostafa.mahmoud@asuscard.sa", "01099918744", "01228379921"],
  ["EMP1767255857814", "najd@asuscard.sa", null, "+966550068197"],
  ["E001", "nawaf@asuscard.sa", "01000085949", null],
  ["EMP1768909284137", "osama.ibrahim@koonagency.com", "01099918778", "01023483668"],
  ["EMP1767255705453", "rahaf@asuscard.sa", null, "+966548619042"],
  ["EMP1767255696641", "rana@asuscard.sa", "01099918893", "01501093031"],
  ["EMP17675256340670", "sally.shalaby@asuscard.sa", "01099918772", "01025791803"],
  ["EMP1779025936228", "tabark.amjad@koon.sa", null, "+96279714613 1".replace(" ", "")],
  ["EMP1789639858348", "hr@asuscard.sa", null, "0551005484"],
];

const sql = postgres("postgresql://koon_hr_admin@127.0.0.1:5545/koon_hr", { connection: apply ? {} : { default_transaction_read_only: "on" } });
const report = { matched: 0, filled: 0, same: 0, conflicts: [], unmatched: [] };
await sql.begin(async tx => {
  for (const [code, email, work, personal] of rows) {
    const found = await tx`SELECT id,employee_code,name_en,work_email,work_phone,personal_phone FROM employees WHERE employment_status<>'deleted' AND (legacy_employee_code=${code} OR employee_code=${code} OR (${email}::text IS NOT NULL AND lower(work_email)=lower(${email}::text)))`;
    if (found.length !== 1) { report.unmatched.push(`${code} ${email} -> ${found.length} matches`); continue; }
    const e = found[0]; report.matched++;
    const set = {};
    for (const [col, value] of [["work_phone", work], ["personal_phone", personal]]) {
      if (!value) continue;
      if (!e[col]) set[col] = value;
      else if (String(e[col]).replace(/\s/g, "") === value) report.same++;
      else report.conflicts.push(`${e.employee_code} ${e.name_en} ${col}: has "${e[col]}" vs file "${value}"`);
    }
    if (!Object.keys(set).length) continue;
    report.filled += Object.keys(set).length;
    console.log(e.employee_code, e.name_en, JSON.stringify(set));
    if (apply) {
      await tx`UPDATE employees SET ${tx(set)}, updated_at=CURRENT_TIMESTAMP WHERE id=${e.id}`;
      await tx`INSERT INTO audit_logs (action,module,record_type,record_id,previous_value,new_value,created_at) VALUES ('fill_phones_from_vcard','employees','employee',${String(e.id)},${JSON.stringify({ work_phone: e.work_phone, personal_phone: e.personal_phone })},${JSON.stringify(set)},CURRENT_TIMESTAMP)`;
    }
  }
});
console.log(apply ? "APPLIED" : "DRY RUN", JSON.stringify(report, null, 1));
await sql.end();
