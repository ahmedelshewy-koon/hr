import assert from "node:assert/strict";
import test from "node:test";
import {CERTIFICATE_ISSUER,EVALUATION_CRITERIA,parseEvaluation,overallScore,canApproveCertificate} from "../app/talent/learning-evaluation.ts";

const scores=value=>Object.fromEntries(EVALUATION_CRITERIA.map(item=>[item.key,value]));
test("evaluation requires five valid criteria and calculates the weighted result",()=>{
 assert.equal(CERTIFICATE_ISSUER.en,"Koon software solo");
 assert.equal(overallScore({knowledge:80,practical:90,assessment:70,attendance:100,participation:80}),84);
 assert.equal(parseEvaluation({scores:scores(60)}).passed,true);
 assert.equal(parseEvaluation({scores:scores(59)}).passed,false);
 assert.equal(overallScore({knowledge:90}),null);
 for(const bad of [undefined,"",101,-1,NaN,true,{}])assert.throws(()=>parseEvaluation({scores:{...scores(80),knowledge:bad}}));
});
test("certificate approvals require two distinct people and exclude the learner",()=>{
 const department={role:"department_manager",employeeId:20,nameEn:"Manager",nameAr:"Manager"};
 const hr={role:"hr_manager",employeeId:null,nameEn:"HR",nameAr:"HR"};
 const certificate={employeeId:10,approvals:[department,hr]};
 assert.equal(canApproveCertificate(department,{id:2,employeeId:20,roleName:"Department Manager"},certificate),true);
 assert.equal(canApproveCertificate(department,{id:3,employeeId:30,roleName:"HR Manager"},certificate),false);
 assert.equal(canApproveCertificate(hr,{id:1,employeeId:10,roleName:"HR Manager"},certificate),false);
 assert.equal(canApproveCertificate(hr,{id:3,employeeId:null,roleName:"Super Admin"},certificate),false);
 department.userId=2;department.approvedAt="2026-09-20T09:00:00Z";
 assert.equal(canApproveCertificate(hr,{id:2,employeeId:20,roleName:"HR Manager"},certificate),false);
 assert.equal(canApproveCertificate(hr,{id:22,employeeId:20,roleName:"HR Manager"},certificate),false);
 assert.equal(canApproveCertificate(hr,{id:3,employeeId:30,roleName:"HR Manager"},certificate),true);
});
