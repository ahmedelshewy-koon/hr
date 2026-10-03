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
const {OrganizationAssignmentFields,AssignmentReview}=await import('../app/organization-assignment-fields.tsx');
const catalog={companies:[{id:7,name:'KOON Agency',status:'active'}],branches:[],companyBranches:[],departments:[{id:5,name_en:'Koon Agency legacy',name_ar:'وكالة كون',status:'active',company_id:null}],branchScopes:[],positions:[],grades:[],workLocations:[],hrRules:[],jobTitles:[]};
const props={rtl:false,form:{companyId:7,departmentId:5,managerId:987},catalog,employees:[],hrResponsibles:[],onChange(){}};
test('profile renders all assignment controls, unresolved setup and retained missing records',()=>{
  const html=renderToStaticMarkup(React.createElement(OrganizationAssignmentFields,props));
  for(const label of ['Company','Branch','Department','Section (optional)','Position','Job title','Direct manager','HR responsible','Automatic: no HR set for this company and branch'])assert.ok(html.includes(label),label);
  assert.doesNotMatch(html,/>Work location</);
  assert.doesNotMatch(html,/Resolved HR Responsible \(derived — read only\)/);
  assert.match(html,/retained — needs review/);assert.match(html,/Unavailable record #987/);
  assert.equal((html.match(/<select/g)||[]).length,8);assert.equal((html.match(/type="date"/g)||[]).length,0);
});
test('review shows before and after labels for clears without other personal data',()=>{
  const html=renderToStaticMarkup(React.createElement(AssignmentReview,{...props,before:{company_id:7,department_id:5},form:{companyId:7,departmentId:'',salary:9999}}));
  assert.match(html,/Before/);assert.match(html,/After/);assert.match(html,/Koon Agency legacy/);assert.match(html,/Not assigned/);assert.doesNotMatch(html,/9999/);
});
test('Arabic profile keeps bilingual controls and retained values',()=>{
  const html=renderToStaticMarkup(React.createElement(OrganizationAssignmentFields,{...props,rtl:true}));
  assert.doesNotMatch(html,/تاريخ سريان التعيين/);assert.doesNotMatch(html,/مسؤول الموارد البشرية الفعلي \(مشتق — للعرض فقط\)/);assert.match(html,/قيمة محفوظة/);
});

const {ImpactReviewPanel}=await import('../app/settings/organization/impact-review.tsx');
const {TeamTransferDialog}=await import('../app/organization-team-transfer.tsx');
const legacyCatalog={companies:[{id:5,name_en:'KOON Software',name_ar:'كون',status:'active'}],branches:[{id:3,name_en:'Cairo',name_ar:'القاهرة',status:'active'}],companyBranches:[{company_id:5,branch_id:3}],
  departments:[{id:1,name_en:'Software Development',status:'active',company_id:5,organization_kind:'department',branch_scope:'all'},{id:4,name_en:'Koon Software',name_ar:'كون سوفتوير',status:'active',company_id:null}],branchScopes:[],positions:[],grades:[],workLocations:[],hrRules:[],
  jobTitles:[{id:14,name_en:'Technology Director',name_ar:'مدير قطاع التكنولوجيا',department_id:4,status:'active'},{id:1,name_en:'Software Developer',department_id:1,status:'active'}]};
const legacyRow={id:19,company_id:null,department_id:4,job_title_id:14,manager_id:null,employment_status:'active'};
test('legacy employee: retained values stay visible with Needs review, the reason (legacy binding) and valid replacements',()=>{
  const html=renderToStaticMarkup(React.createElement(OrganizationAssignmentFields,{rtl:false,form:{companyId:'',departmentId:'4',jobTitleId:'14',employeeId:19},before:legacyRow,catalog:legacyCatalog,employees:[],hrResponsibles:[],onChange(){}}));
  assert.match(html,/Needs review/);assert.match(html,/Technology Director/);assert.match(html,/Koon Software/);
  assert.match(html,/Legacy binding: Koon Software \(#4\)/);
  assert.match(html,/Legacy unit without a company/);
  const arabic=renderToStaticMarkup(React.createElement(OrganizationAssignmentFields,{rtl:true,form:{departmentId:'4',jobTitleId:'14',employeeId:19},before:legacyRow,catalog:legacyCatalog,employees:[],hrResponsibles:[],onChange(){}}));
  assert.match(arabic,/يحتاج مراجعة/);assert.match(arabic,/ارتباط قديم/);
});
test('replaced values stop showing the saved-value warning (the final draft is judged instead)',()=>{
  const html=renderToStaticMarkup(React.createElement(OrganizationAssignmentFields,{rtl:false,form:{companyId:'5',branchId:'3',departmentId:'1',jobTitleId:'1',employeeId:19},before:legacyRow,catalog:legacyCatalog,employees:[],hrResponsibles:[],onChange(){}}));
  assert.doesNotMatch(html,/legacy binding/);
});
test('impact panel lists blocking entities by name and mismatch counts',()=>{
  const preview={ok:false,confirmationToken:null,impact:{employees:{total:3,current:2,historical:1},mismatch:{created:[{id:1}],resolved:[],remaining:[]},legacy:[{id:1}]},
    blocking:[{code:'ACTIVE_DEPENDENTS',message_ar:'مستخدم',message_en:'Cannot deactivate: in use (8 active employee(s))',details:{employees:[{id:1,name_en:'Maged Shawky'}]}}],warnings:[]};
  const html=renderToStaticMarkup(React.createElement(ImpactReviewPanel,{rtl:false,preview}));
  assert.match(html,/Cannot save/);assert.match(html,/8 active employee/);assert.match(html,/Maged Shawky/);assert.match(html,/Mismatches created/);assert.match(html,/In legacy units/);
});
test('team transfer dialog lists the subtree, preserves reporting lines and previews before confirming',()=>{
  const employees=[{id:19,name_en:'Maged',manager_id:null,employment_status:'active'},{id:2,name_en:'Abdelrahman',manager_id:19,employment_status:'active',department_id:1,job_title_id:1},{id:3,name_en:'Nested',manager_id:2,employment_status:'active'}];
  const html=renderToStaticMarkup(React.createElement(TeamTransferDialog,{rtl:false,root:employees[0],rootDraft:{companyId:'5',branchId:'3'},catalog:legacyCatalog,employees,onClose(){},onDone(){}}));
  assert.match(html,/Abdelrahman/);assert.match(html,/Nested/);assert.match(html,/Reporting lines \(direct managers\) are preserved/);assert.match(html,/Preview transfer/);assert.doesNotMatch(html,/Confirm team transfer/);
});
