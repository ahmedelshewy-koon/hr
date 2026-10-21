import test from "node:test";
import assert from "node:assert/strict";
import {selectRegionalManagers} from "../app/approvals/payroll-region.ts";

const managers=[
  {id:3,region:"KSA",admin_order:1,business_unit_ids:[8]},
  {id:1,region:"KSA",admin_order:0,business_unit_ids:[8]},
  {id:2,region:"Egypt",admin_order:0,business_unit_ids:[8]},
  {id:4,region:null,admin_order:0,business_unit_ids:[]},
];
test("KSA requests follow KSA HR level order for the Working Business Unit",()=>{
  assert.deepEqual(selectRegionalManagers(managers,"KSA",8).map(row=>row.id),[1,3]);
});
test("missing BU never guesses a company mapping and falls back to unscoped HR",()=>{
  assert.deepEqual(selectRegionalManagers(managers,"KSA",null).map(row=>row.id),[4]);
});
