import test from 'node:test';
import assert from 'node:assert/strict';
import { payrollAccess, assertUnlocked } from '../app/payroll/service.ts';

function db(answers) {return {prepare(sql){return {bind(){return this},async first(){return answers(sql)[0]??null},async all(){return {results:answers(sql)}}}}};}
const actor={id:2,roleName:'HR Manager'};

test('Payroll gate rejects HR users not listed as active HR managers',async()=>{
  await assert.rejects(()=>payrollAccess(db(()=>[]),actor),error=>error instanceof Response&&error.status===403);
});

test('HR manager scope is limited to region and linked working business units',async()=>{
  const fake=db(sql=>sql.includes('FROM hr_managers')?[{id:7,region:'KSA',admin_order:1}]:[{business_unit_id:3},{business_unit_id:9}]);
  const access=await payrollAccess(fake,actor);
  assert.equal(access.region,'KSA');
  assert.deepEqual(access.units,[3,9]);
  assert.equal(access.head,false);
});

test('locked month rejects writes before mutation',async()=>{
  await assert.rejects(()=>assertUnlocked(db(()=>[{locked:1}]),2026,10,'Egypt'),error=>error instanceof Response&&error.status===423);
});
