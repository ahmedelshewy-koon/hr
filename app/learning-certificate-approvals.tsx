"use client";
import {useState} from "react";
import {createPortal} from "react-dom";
import {Award,CheckCircle2,Clock3,X} from "lucide-react";
import {canApproveCertificate} from "./talent/learning-evaluation";
import type {CertificateSnapshot} from "./talent/learning-evaluation";
import {useLearningDialog} from "./use-learning-dialog";
import "./learning-evaluation.css";

export function CertificateApprovals({certificate,rtl,actor,close,approve}:{certificate:CertificateSnapshot;rtl:boolean;actor:{id:number;employeeId:number|null;roleName:string};close:()=>void;approve:(role:string)=>Promise<void>}){
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const dialog=useLearningDialog(close,busy);
 const sign=async(role:string)=>{setBusy(true);setError("");try{await approve(role)}catch(reason){setError(reason instanceof Error?reason.message:String(reason))}finally{setBusy(false)}};
 return createPortal(<div className="learning-modal-layer" dir={rtl?"rtl":"ltr"} ref={dialog} tabIndex={-1}>
  <button className="learning-scrim" onClick={()=>!busy&&close()} aria-label={rtl?"إغلاق":"Close"}/>
  <section className="learning-modal compact" role="dialog" aria-modal="true" aria-labelledby="certificate-approval-title">
   <header><div><span>{certificate.issuer.en}</span><h2 id="certificate-approval-title">{rtl?"اعتمادات شهادة التدريب":"Certificate approvals"}</h2><p>{rtl?certificate.employee.nameAr:certificate.employee.nameEn} · {certificate.program.title}</p></div><button onClick={close} disabled={busy} aria-label={rtl?"إغلاق":"Close"}><X/></button></header>
   <div className="certificate-approvals-body"><div className="evaluation-outcome idle"><Award/><span>{rtl?"تم اجتياز التدريب. تصدر الشهادة بعد اعتماد مدير الإدارة والموارد البشرية من حسابين مختلفين، مع تسجيل اسم كل معتمد وتاريخ اعتماده.":"Training passed. The certificate is issued after department and HR approval by two different people, recording each approver and date."}</span></div>
    {certificate.approvals?.map(item=><article className="certificate-approval-row" key={item.role}>
     {item.approvedAt?<CheckCircle2 className="approved"/>:<Clock3/>}<div><b>{item.role==="hr_manager"?(rtl?"مدير الموارد البشرية":"HR Manager"):(rtl?"مدير الإدارة":"Department Manager")}</b><span>{rtl?item.nameAr:item.nameEn}</span><small>{item.approvedAt?new Date(item.approvedAt).toLocaleString(rtl?"ar-EG":"en-US"):(rtl?"بانتظار الاعتماد":"Awaiting approval")}</small></div>
     {canApproveCertificate(item,actor,certificate)&&<button className="primary" disabled={busy} onClick={()=>void sign(item.role)}>{busy?(rtl?"جارٍ الحفظ…":"Saving…"):(rtl?"اعتماد باسمي":"Approve in my name")}</button>}
    </article>)}
    {error&&<p className="learning-modal-error" role="alert">{error}</p>}
   </div><footer><button className="outline" disabled={busy} onClick={close}>{rtl?"إغلاق":"Close"}</button></footer>
  </section>
 </div>,document.body);
}
