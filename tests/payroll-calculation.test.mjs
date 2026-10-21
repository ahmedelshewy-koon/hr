import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePayroll, buildInvoices, evaluateFormula } from '../app/payroll/engine.ts';

const elements = [
  {id:1,code:'BASIC',name_en:'Basic',name_ar:'أساسي',element_type:'earning',calculation_type:'fixed',is_basic_salary_element:1},
  {id:2,code:'DELAY',name_en:'Delay',name_ar:'تأخير',element_type:'deduction',calculation_type:'delay_minutes',is_delay_minutes_element:1},
  {id:3,code:'ABSENCE',name_en:'Absence',name_ar:'غياب',element_type:'deduction',calculation_type:'absence_days',is_absence_element:1},
  {id:4,code:'BONUS',name_en:'Bonus',name_ar:'مكافأة',element_type:'earning',calculation_type:'fixed'},
];
const employee = {id:1,name_en:'A',start_date:'2026-10-19',employment_status:'active',salary:3000,salary_currency:'EGP',payroll_country:'Egypt',working_business_unit_id:1,cost_center_id:1,department_id:1};

test('joiner on the nineteenth receives 12/30 of basic; only posted deductions are read', () => {
  const result = calculatePayroll({year:2026,month:10,employees:[employee],elements,recurring:[{employee_id:1,element_id:4,amount:200,effective_from:'2026-01-01'}],variables:[{employee_id:1,element:'delay',amount:50,quantity:60}],eligibility:[]});
  assert.equal(result.people[0].basic,1200);
  assert.equal(result.people[0].gross,1400);
  assert.equal(result.people[0].deductions,50);
  assert.equal(result.people[0].net,1350);
  assert.equal(result.lines.find(line=>line.element_code==='ABSENCE'),undefined);
});

test('terminated before period excluded; termination on tenth prorates at 10/30', () => {
  const people=[{...employee,id:1,start_date:'2020-01-01',end_date:'2026-09-30',employment_status:'terminated'}, {...employee,id:2,start_date:'2020-01-01',end_date:'2026-10-10',employment_status:'terminated'}];
  const result=calculatePayroll({year:2026,month:10,employees:people,elements,recurring:[],variables:[],eligibility:[]});
  assert.deepEqual(result.people.map(p=>p.employee_id),[2]);
  assert.equal(result.people[0].basic,1000);
});

test('termination date takes precedence over contract end', () => {
  const departing={...employee,start_date:'2020-01-01',end_date:'2027-12-31',termination_date:'2026-10-10',employment_status:'terminated'};
  const result=calculatePayroll({year:2026,month:10,employees:[departing],elements,recurring:[],variables:[],eligibility:[]});
  assert.equal(result.people[0].basic,1000);
});

test('invoice groups by BU, account, cost center, department and preserves currency', () => {
  const calculated=calculatePayroll({year:2026,month:10,employees:[employee],elements,recurring:[],variables:[{employee_id:1,element:'delay',amount:50,quantity:60}],eligibility:[]});
  const invoices=buildInvoices(calculated.lines,[{...employee,business_unit_code:'BU1',cost_center_code:'CC1'}],elements.map(e=>({...e,element_account:'5000'})),[],2,'DRAFT','B1');
  assert.equal(invoices.invoices[0].businessUnitCode,'BU1');
  assert.equal(invoices.invoices[0].currency,'EGP');
  assert.equal(invoices.invoices[0].lines.reduce((sum,line)=>sum+line.amount,0),1150);
  assert.equal(invoices.totalsSAR,2300);
});

test('fixed, percentage and formula defaults calculate without overriding recurring amounts',()=>{
  const extras=[{id:5,code:'FIX',name_en:'Fixed',name_ar:'ثابت',element_type:'earning',calculation_type:'fixed',default_amount:100},
    {id:6,code:'PCT',name_en:'Percent',name_ar:'نسبة',element_type:'earning',calculation_type:'percentage',default_amount:10},
    {id:7,code:'FORM',name_en:'Formula',name_ar:'صيغة',element_type:'deduction',calculation_type:'formula',formula:'basic * 0.05 + days'}];
  const result=calculatePayroll({year:2026,month:10,employees:[employee],elements:[...elements,...extras],recurring:[{employee_id:1,element_id:5,amount:200,effective_from:'2026-01-01'}],variables:[],eligibility:[]});
  assert.equal(result.lines.find(line=>line.element_code==='FIX').amount,200);
  assert.equal(result.lines.find(line=>line.element_code==='PCT').amount,120);
  assert.equal(result.lines.find(line=>line.element_code==='FORM').amount,72);
});

test('formula rejects executable code and division by zero',()=>{
  assert.throws(()=>evaluateFormula('process.exit()', {basic:100,salary:100,days:30}),/Invalid/);
  assert.throws(()=>evaluateFormula('basic / 0', {basic:100,salary:100,days:30}),/Invalid/);
});

test('ERP preview uses run line posting dimensions captured during calculation',()=>{
  const result=calculatePayroll({year:2026,month:10,employees:[employee],elements,recurring:[],variables:[],eligibility:[]});
  const snapshot=result.lines.map(line=>({...line,business_unit_code:'OLD',cost_center_code:'CC1',department_code:'Finance',element_account:'5000',fallback_account:null}));
  const invoices=buildInvoices(snapshot,[{...employee,business_unit_code:'NEW',cost_center_code:'CC2',department_code:'Sales'}],elements.map(e=>({...e,element_account:'9999'})),[],2,'DRAFT','B');
  assert.equal(invoices.invoices[0].businessUnitCode,'OLD');
  assert.equal(invoices.invoices[0].lines[0].accountId,'5000');
  assert.equal(invoices.invoices[0].lines[0].costCenterCode,'CC1');
});
