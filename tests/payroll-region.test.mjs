import test from "node:test";
import assert from "node:assert/strict";
import {payrollRegionChain,selectRegionalManagers} from "../app/approvals/payroll-region.ts";

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

function fakeDb({tableExists=true,configured=true}={}){
  return {prepare(sql){
    const statement={
      bind(){return statement;},
      async first(){
        if(sql.includes("to_regclass"))return {ready:tableExists};
        if(sql.includes("EXISTS(SELECT 1 FROM hr_managers"))return {configured};
        return {id:7,country:"Saudi Arabia",salary_country:"Saudi Arabia",working_business_unit_id:8};
      },
      async all(){return {results:[{id:1,region:"KSA",admin_order:0,user_id:41,name_en:"KSA HR",name_ar:"موارد",business_unit_ids:[8]}]};},
    };
    return statement;
  }};
}
test("before migration 0053 requests keep the legacy routing",async()=>{
  assert.equal(await payrollRegionChain(fakeDb({tableExists:false}),7),null);
});
test("with no HR managers assigned yet requests keep the legacy routing",async()=>{
  assert.equal(await payrollRegionChain(fakeDb({configured:false}),7),null);
});
test("once HR managers are assigned requests route to the regional managers",async()=>{
  assert.deepEqual((await payrollRegionChain(fakeDb(),7))?.map(step=>step.userId),[41]);
});
