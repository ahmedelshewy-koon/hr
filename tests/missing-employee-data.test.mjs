import assert from "node:assert/strict";
import test from "node:test";
import { missingEmployeeQuery, missingEmployeeRows, requiredEmployeeFields } from "../app/reports/missing-employee-data.ts";
import { excelWorkbook } from "../app/reports/excel-workbook.ts";

test("required completion checks omit optional personal, bank and location fields", () => {
  const keys = requiredEmployeeFields.map(field => field.key);
  for (const key of ["name_ar", "name_en", "work_email", "department_id", "job_title_id", "start_date", "end_date", "country", "company_id", "hr_user_id", "access_role", "leave_types"]) assert.ok(keys.includes(key), key);
  for (const key of ["passport_number", "birth_date", "bank_iban", "work_phone", "work_location", "manager_id"]) assert.ok(!keys.includes(key), key);
});

test("scope and filters are applied before selecting missing employees and limiting results", () => {
  const sql = missingEmployeeQuery(["e.id IN (?)", "e.company_id=?"]);
  assert.match(sql, /e\.id IN \(\?\) AND e\.company_id=\?/);
  assert.match(sql, /employment_status!='deleted'/);
  assert.match(sql, /CARDINALITY\(missing_keys\)>0[\s\S]*LIMIT 10001/);
  assert.match(sql, /NULLIF\(BTRIM\(e\.work_email\),''\) IS NULL/);
  assert.match(sql, /EXISTS \(SELECT 1 FROM users u JOIN roles/);
});

test("completion requires an active company and an eligible non-self HR responsible", () => {
  const company = requiredEmployeeFields.find(field => field.key === "company_id").missing;
  const hr = requiredEmployeeFields.find(field => field.key === "hr_user_id").missing;
  assert.match(company, /co.status='active'/);
  for (const condition of ["h.status='active'", "hu.status='active'", "hr.name IN ('HR Manager','Super Admin')", "hu.employee_id<>e.id", "he.employment_status IN ('active','probation','notice_period')"]) assert.ok(hr.includes(condition), condition);
});

test("missing rows expose only report columns with localized names", () => {
  const source = [{ employee_code: "001", name_en: "Jane", name_ar: "جين", company: null, work_location: "Cairo", missing_keys: ["company_id", "hr_user_id"], work_email: "private@example.com" }];
  assert.deepEqual(missingEmployeeRows(source, false), [{ employee_code: "001", employee_name: "Jane", company: "", work_location: "Cairo", missing_fields: "Company, HR responsible" }]);
  assert.equal(missingEmployeeRows(source, true)[0].missing_fields, "الشركة، مسؤول الموارد البشرية");
});

function zipEntries(bytes) {
  const result = {}, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true), nameLength = view.getUint16(offset + 26, true), extraLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    result[name] = new TextDecoder().decode(bytes.subarray(start, start + size));
    offset = start + size;
  }
  assert.equal(view.getUint32(offset, true), 0x02014b50);
  return result;
}

test("Excel export contains genuine OOXML and treats formulas and identifiers as text", () => {
  const files = zipEntries(excelWorkbook([{ key: "code", label: "Code" }], [{ code: "00123" }, { code: '=HYPERLINK("https://example.com")' }, { code: "الشركة & <name>\u0000" }], true));
  assert.ok(files["[Content_Types].xml"]);
  assert.match(files["xl/worksheets/sheet1.xml"], /rightToLeft="1"/);
  assert.match(files["xl/worksheets/sheet1.xml"], /t="inlineStr"/);
  assert.match(files["xl/worksheets/sheet1.xml"], /00123/);
  assert.match(files["xl/worksheets/sheet1.xml"], /=HYPERLINK/);
  assert.doesNotMatch(files["xl/worksheets/sheet1.xml"], /<f>/);
  assert.ok(!files["xl/worksheets/sheet1.xml"].includes("\u0000"));
  assert.match(files["xl/worksheets/sheet1.xml"], /الشركة &amp; &lt;name&gt;/);
});
