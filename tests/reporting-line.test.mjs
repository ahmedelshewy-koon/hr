import assert from 'node:assert/strict';
import test from 'node:test';
import { validateReportingManager, reportingOrder } from '../app/organization/reporting-line.ts';
const rows=[{id:1,manager_id:null},{id:2,manager_id:1},{id:3,manager_id:2},{id:4,manager_id:1}];
test('blocks self, indirect descendants, missing and inactive managers',()=>{
  assert.throws(()=>validateReportingManager(rows,2,2),/themselves/);
  assert.throws(()=>validateReportingManager(rows,1,3),/cycle/);
  assert.throws(()=>validateReportingManager(rows,2,99),/not found/);
  assert.throws(()=>validateReportingManager([{id:5,employment_status:'deleted'}],2,5),/not active/);
  assert.doesNotThrow(()=>validateReportingManager(rows,3,4));
  assert.doesNotThrow(()=>validateReportingManager(rows,3,null));
});
test('chart follows reporting lines and keeps disconnected employees visible',()=>{
  assert.deepEqual(reportingOrder([rows[3],rows[2],rows[1],rows[0]]).map(r=>r.id),[1,4,2,3]);
  assert.equal(reportingOrder([{id:1,manager_id:2},{id:2,manager_id:1}]).length,2);
});
