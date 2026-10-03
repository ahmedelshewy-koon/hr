import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

registerHooks({
  resolve(specifier,context,next){
    if(specifier.startsWith('.')){
      const base=new URL(specifier,context.parentURL);
      for(const ext of ['','.ts','.tsx'])if(fs.existsSync(fileURLToPath(base)+ext)&&fs.statSync(fileURLToPath(base)+ext).isFile())return next(base.href+ext,context);
    }
    return next(specifier,context);
  },
  load(url,context,next){
    if(url.endsWith('.css'))return {format:'module',source:'export {};',shortCircuit:true};
    if(url.endsWith('.tsx'))return {format:'module',source:ts.transpileModule("import React from 'react';\n"+fs.readFileSync(fileURLToPath(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,shortCircuit:true};
    return next(url,context);
  },
});
const {OrganizationChart,QuickView,NeedsReviewPanel}=await import('../app/organization-chart.tsx');
const {computeChartDiagnostics}=await import('../app/organization/chart-model.ts');

const catalog={
  companies:[{id:6,name:'Asus Cards',status:'active'}],branches:[{id:2,name_en:'Riyadh',name_ar:'الرياض',status:'active'}],companyBranches:[{company_id:6,branch_id:2}],
  departments:[{id:2,company_id:6,organization_kind:'department',status:'active',name_en:'Sales',name_ar:'المبيعات'},{id:4,company_id:null,organization_kind:null,status:'active',name_en:'Koon Software',name_ar:'كون برمجة'}],
  branchScopes:[],positions:[{id:5,company_id:6,department_id:null,is_ceo:1,status:'active',name_en:'Chief Executive Officer',name_ar:'الرئيس التنفيذي'}],grades:[],workLocations:[],hrRules:[],
  jobTitles:[{id:40,department_id:2,status:'active',name_en:'Sales Rep',name_ar:'مندوب مبيعات'}],
};
const employees=[
  {id:1,employee_code:'E001',name_en:'Nawaf',name_ar:'نواف',employment_status:'active',company_id:6,branch_id:2,position_id:5},
  {id:2,employee_code:'E002',name_en:'Sales Lead',name_ar:'قائد المبيعات',employment_status:'active',company_id:6,branch_id:2,department_id:2,job_title_id:40,manager_id:1},
  {id:3,employee_code:'E003',name_en:'Legacy Person',name_ar:'موظف قديم',employment_status:'active',department_id:4,manager_id:1},
  {id:4,employee_code:'E004',name_en:'Former Boss',name_ar:'مدير سابق',employment_status:'terminated',company_id:6,branch_id:2,department_id:2},
  {id:5,employee_code:'E005',name_en:'Reports To Former',name_ar:'تابع للسابق',employment_status:'active',company_id:6,branch_id:2,department_id:2,job_title_id:40,manager_id:4},
  {id:6,employee_code:'E006',name_en:'Hidden Manager Report',name_ar:'تابع لمدير مخفي',employment_status:'active',company_id:6,branch_id:2,department_id:2,manager_id:77,manager_scope:'restricted'},
];
const props={rtl:false,employees,catalog,fullAccess:false,canEdit:false,openProfile(){},editProfile(){}};
const render=(Component,extra={})=>renderToStaticMarkup(React.createElement(Component,{...props,...extra}));

test('default view is the Reporting tree with read-only controls and no editing affordances',()=>{
  const html=render(OrganizationChart);
  assert.match(html,/class="reporting-roots"/);
  assert.doesNotMatch(html,/class="chart-toolbar"|role="combobox"|aria-label="View"|aria-label="Layout"/);
  for(const label of ['Organization','Company','Branch','Department','Status','Needs review','Employees in view'])assert.ok(html.includes(label),label);
  assert.doesNotMatch(html,/Expand all|Collapse all/);
  assert.doesNotMatch(html,/class="chart-readonly"/);
  assert.doesNotMatch(html,/draggable|onDrop|contenteditable/i);
  assert.doesNotMatch(html,/Change manager|Move to|Assign position|Save/);
  assert.equal((html.match(/<select/g)||[]).length,4,'only the four filters');
});

test('large reporting trees open every level by default',()=>{
  const rows=Array.from({length:305},(_,index)=>({id:index+1,name_en:`Employee ${index+1}`,employment_status:'active',company_id:6,...(index>0?{manager_id:index<4?index:1}:{})}));
  const html=render(OrganizationChart,{employees:rows});
  assert.match(html,/data-node-id="4"/);
  assert.doesNotMatch(html,/class="reporting-toggle" aria-expanded="false"/);
});

test('context node for a non-current manager is labelled and excluded from the employee count',()=>{
  const html=render(OrganizationChart);
  assert.match(html,/Reporting context/);
  assert.match(html,/Status: Terminated/);
  assert.match(html,/<b>5<\/b>Employees in view/,'5 current employees; the terminated context manager is not counted');
  assert.match(html,/<b>1<\/b>Reporting context \(not counted\)/);
});

test('restricted manager renders a placeholder and never its identity',()=>{
  const html=render(OrganizationChart);
  assert.match(html,/Reporting manager outside your access scope/);
  assert.doesNotMatch(html,/data-node-id="77"|#77|E077/);
});

test('cards show Position first and Job Title separately, plus compact warning badges',()=>{
  const html=render(OrganizationChart,{fullAccess:true});
  assert.match(html,/Nawaf<small class="reporting-ceo">CEO<\/small>/);
  assert.match(html,/reporting-title">Chief Executive Officer/);
  assert.match(html,/reporting-title">Sales Rep/);
  assert.match(html,/chart-badge warning">No company<\/span><span class="chart-badge warning">Legacy/);
  assert.match(html,/Legacy: Koon Software/);
  assert.match(html,/Manager inactive/);
});

test('Arabic renders RTL with Arabic labels and names',()=>{
  const html=render(OrganizationChart,{rtl:true});
  assert.match(html,/dir="rtl"/);
  for(const text of ['الهيكل التنظيمي','فلتر','يحتاج مراجعة','سياق التبعية','المدير المباشر خارج نطاق صلاحياتك','نواف','قديم: كون برمجة'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/الوحدات التنظيمية|ابحث بالاسم أو الرقم/);
});

const quick=(extra={})=>renderToStaticMarkup(React.createElement(QuickView,{rtl:false,catalog,employee:employees[1],pool:employees,fullAccess:true,issues:computeChartDiagnostics({employees,catalog,fullAccess:true}).get(2)??[],canEdit:false,close(){},openProfile(){},editProfile(){},showManager(){},reveal(){},...extra}));
test('Quick View shows identity, organization, reporting and diagnostics with permission-aware actions',()=>{
  const html=quick();
  for(const text of ['Sales Lead','E002','Active','Asus Cards','Riyadh','Sales','Sales Rep','Nawaf','Direct reports','Open Employee Profile','Show in chart'])assert.ok(html.includes(text),text);
  assert.match(html,/Position<\/dt><dd class="muted">Not assigned/);
  assert.match(html,/Position not assigned/);
  assert.doesNotMatch(html,/Edit Employee Profile/);
  assert.match(quick({canEdit:true}),/Edit Employee Profile/);
});
test('Quick View counts direct reports and hides a restricted manager',()=>{
  assert.match(quick({employee:employees[0]}),/Direct reports<\/dt><dd>2<\/dd>/);
  const html=quick({employee:employees[5],fullAccess:false});
  assert.match(html,/Outside your access scope/);
});
test('Arabic Quick View',()=>{
  const html=quick({rtl:true});
  for(const text of ['عرض سريع','الشركة','الفرع','الإدارة','الوظيفة','المسمى الوظيفي','المدير المباشر','فتح ملف الموظف'])assert.ok(html.includes(text),text);
});

test('chart source performs no writes and the API never tells a limited viewer who or what a hidden manager is',()=>{
  const chart=fs.readFileSync(new URL('../app/organization-chart.tsx',import.meta.url),'utf8')+fs.readFileSync(new URL('../app/organization/chart-model.ts',import.meta.url),'utf8');
  assert.doesNotMatch(chart,/fetch\(|hrApi|method:\s*['"]POST|draggable|onDrag/);
  const route=fs.readFileSync(new URL('../app/api/hr/route.ts',import.meta.url),'utf8');
  assert.match(route,/row\.manager_scope=!wholeCompany\?'restricted':/);
  assert.match(route,/row\.manager_name=null;row\.manager_name_ar=null;row\.org_manager_id=null;/);
  assert.match(route,/const wholeCompany=fullCompany&&!branchHrSql;/);
  assert.match(route,/employeeScope:wholeCompany\?'full':'limited'/);
});

test('Needs Review lists employee, problem, field, severity and an Open Employee Profile action per item',()=>{
  const diagnostics=computeChartDiagnostics({employees,catalog,fullAccess:true});
  const html=renderToStaticMarkup(React.createElement(NeedsReviewPanel,{rtl:false,catalog,diagnostics,pool:employees,matchIds:new Set([1,2,3,5,6]),openProfile(){},reveal(){}}));
  for(const text of ['Employee','Problem','Field','Severity','Action','Legacy Person','Company not assigned','Warning','Direct manager is not active'])assert.ok(html.includes(text),text);
  assert.match(html,/data-review-employee="3"/);
  assert.equal((html.match(/data-review-employee=/g)||[]).length,(html.match(/Open Employee Profile/g)||[]).length);
  assert.doesNotMatch(html,/data-review-employee="4"/,'non-matching (terminated) employees are not listed');
});
