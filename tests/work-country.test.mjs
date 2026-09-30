import test from "node:test";
import assert from "node:assert/strict";
import { workCountry, workCountries, activeWorkCountries } from "../app/employees/work-country.ts";
import { COUNTRIES } from "../app/employees/countries.ts";
import fs from "node:fs";

test("stored country is the canonical work location", () => {
  assert.equal(workCountry({ work_location: "Egypt", country: "Saudi Arabia" }), "Saudi Arabia");
  assert.equal(workCountry({ work_location: "Riyadh, KSA", country: "Egypt" }), "Egypt");
  assert.equal(workCountry({ work_location: " السعودية " }), "Saudi Arabia");
});

test("every catalogue country resolves from code, English and Arabic and has a bundled flag", () => {
  assert.equal(COUNTRIES.length, 249);
  for (const country of COUNTRIES) {
    for (const location of [country.code, country.value, country.ar]) {
      assert.equal(workCountry({ work_location: location }), country.value);
    }
    assert.ok(fs.existsSync(new URL(`../public/flags/${country.code.toLowerCase()}.svg`, import.meta.url)));
  }
});

test("opening an Emirates branch adds one flag and filters by work location, not nationality", () => {
  const employees = [{ work_location: "Egypt" }, { work_location: "Saudi Arabia" }];
  assert.deepEqual(workCountries(employees), ["Egypt", "Saudi Arabia"]);
  const expanded = [...employees, { work_location: "الإمارات", country: "United Arab Emirates" }, { work_location: "AE" }];
  assert.deepEqual(workCountries(expanded), ["Egypt", "Saudi Arabia", "United Arab Emirates"]);
  assert.equal(expanded.filter(row => workCountry(row) === "United Arab Emirates").length, 2);
  assert.deepEqual(activeWorkCountries(["United Arab Emirates"], workCountries(employees)), []);
  assert.deepEqual(workCountries([]), []);
});

test("legacy and unspecified locations fall back to country without inventing a country", () => {
  assert.equal(workCountry({ work_location: "Head office", country: "Egypt" }), "Egypt");
  assert.equal(workCountry({ country: "KSA" }), "Saudi Arabia");
  assert.equal(workCountry({ work_location: "", country: "" }), null);
});

test("employee summary card counts every work country, largest first", async () => {
  const { workCountryCounts, countryName } = await import("../app/employees/work-country.ts");
  const employees = [
    { work_location: "Saudi Arabia" }, { work_location: "Egypt" }, { work_location: "Egypt", country: "Nigeria" },
    { work_location: "Nigeria", country: "Egypt" }, { country: "Nigeria" }, { work_location: "الإمارات" }, { work_location: "unknown place" },
  ];
  assert.deepEqual(workCountryCounts(employees).map(row => [row.country, row.count, row.code]), [["Egypt", 2, "EG"], ["Nigeria", 2, "NG"], ["Saudi Arabia", 1, "SA"], ["United Arab Emirates", 1, "AE"]]);
  assert.deepEqual(workCountryCounts([]), []);
  assert.equal(countryName("Nigeria", true), "نيجيريا");
  assert.equal(countryName("Nigeria", false), "Nigeria");
});
