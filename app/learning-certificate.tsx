"use client";
import {useEffect,useState} from "react";
import {createPortal} from "react-dom";
import {Printer,X} from "lucide-react";
import {useLearningDialog} from "./use-learning-dialog";
import "./learning-certificate.css";
import {gradeLabel} from "./talent/learning-evaluation";
import type {CertificateSignatory,CertificateSnapshot} from "./talent/learning-evaluation";

// The sheet is designed at A4 landscape (96dpi) and scaled down to fit the window; printing drops the scale.
const SHEET_WIDTH=1123,SHEET_HEIGHT=794;
const fit=()=>Math.max(.1,Math.min(1,(window.innerWidth-32)/SHEET_WIDTH,(window.innerHeight-(window.innerWidth<640?200:132))/SHEET_HEIGHT));

const TEXT={
 en:{lang:"en-US",kicker:"Learning & Development",title:"Certificate of Completion",certify:"This is to certify that",completed:"has successfully completed the training program",duration:"Program Duration",period:"Training Period",completion:"Completion Date",result:"Final Result",number:"Certificate No.",issued:"Date of Issue",validUntil:"Valid Until",approved:"Approved by the management of",seal:"APPROVED",passed:"Passed",employeeId:"Employee ID",roles:{instructor:"Instructor",department_manager:"Department Manager",hr_manager:"HR Manager"},hr:"Human Resources",note:"Issued electronically by Human Resources. The certificate number can be verified with HR."},
 ar:{lang:"ar-EG",kicker:"التعلم والتطوير",title:"شهادة إتمام برنامج تدريبي",certify:"تشهد الشركة بأن",completed:"قد أتمّ بنجاح البرنامج التدريبي",duration:"مدة البرنامج",period:"فترة التدريب",completion:"تاريخ الإتمام",result:"النتيجة النهائية",number:"رقم الشهادة",issued:"تاريخ الإصدار",validUntil:"سارية حتى",approved:"معتمدة من إدارة",seal:"معتمد",passed:"اجتاز",employeeId:"الرقم الوظيفي",roles:{instructor:"المدرّب",department_manager:"مدير الإدارة",hr_manager:"مدير الموارد البشرية"},hr:"الموارد البشرية",note:"صدرت إلكترونيًا عن الموارد البشرية، ويمكن التحقق من رقم الشهادة لدى الموارد البشرية."},
};
type Lang=keyof typeof TEXT;

const dayCount=(start:string,end:string)=>Math.round((Date.parse(`${end}T00:00:00Z`)-Date.parse(`${start}T00:00:00Z`))/86400000)+1;
const arabicDays=(count:number)=>count===1?"يوم واحد":count===2?"يومان":count<=10?`${count} أيام`:`${count} يومًا`;

function Seal({label,name}:{label:string;name:string}){
 const points=Array.from({length:72},(_,index)=>{const angle=index*Math.PI/36,radius=index%2?90:97;return `${(100+radius*Math.sin(angle)).toFixed(2)},${(100-radius*Math.cos(angle)).toFixed(2)}`}).join(" ");
 return <svg className="cert-seal" viewBox="0 0 200 250" aria-hidden="true"><defs><linearGradient id="cert-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e6c46a"/><stop offset=".5" stopColor="#b98a2a"/><stop offset="1" stopColor="#8c6416"/></linearGradient><linearGradient id="cert-navy" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#12408a"/><stop offset="1" stopColor="#081d3f"/></linearGradient></defs><path d="M62 170 40 240l32-14 14 24 20-72z" fill="#0b2a55"/><path d="M138 170 160 240l-32-14-14 24-20-72z" fill="#155ae7"/><polygon points={points} fill="url(#cert-gold)"/><circle cx="100" cy="100" r="80" fill="none" stroke="#fff" strokeOpacity=".75" strokeWidth="1.5"/><circle cx="100" cy="100" r="74" fill="url(#cert-navy)"/><circle cx="100" cy="100" r="44" fill="none" stroke="#e6c46a" strokeOpacity=".55" strokeWidth="1"/><path id="cert-ring" d="M100 100m-58 0a58 58 0 1 1 116 0a58 58 0 1 1-116 0" fill="none"/><text fill="#f0d68a" fontSize="10.5" fontWeight="700" letterSpacing="1.5"><textPath href="#cert-ring" textLength="350" lengthAdjust="spacing">{`${name.toUpperCase()} • CERTIFIED • `}</textPath></text><path d="M79 92l14 14 28-31" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/><text x="100" y="127" textAnchor="middle" fill="#f0d68a" fontSize="11" fontWeight="700" letterSpacing="2">{label}</text></svg>}

function Corner({position}:{position:string}){return <svg className={`cert-corner ${position}`} viewBox="0 0 130 130" aria-hidden="true">{[24,38,52,66,80].map((radius,index)=><path key={radius} d={`M0 ${radius}A${radius} ${radius} 0 0 0 ${radius} 0`} fill="none" stroke="#0b2a55" strokeOpacity={.75-index*.12} strokeWidth={index%2?.8:1.4}/>)}<path d="M0 12A12 12 0 0 0 12 0V0H0z" fill="#b98a2a"/></svg>}

function Mark(){return <svg className="cert-mark" viewBox="0 0 56 56" aria-hidden="true"><rect width="56" height="56" rx="13" fill="#0b2a55"/><path d="M19 14v28M40 14 24 28l17 14" fill="none" stroke="#fff" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round"/><circle cx="42" cy="14" r="4" fill="#3b82f6"/></svg>}

function Rosette(){return <svg className="cert-rosette" viewBox="-260 -260 520 520" aria-hidden="true">{Array.from({length:36},(_,index)=><ellipse key={index} rx="240" ry="86" transform={`rotate(${index*5})`} fill="none" stroke="#0b2a55" strokeWidth=".8"/>)}<circle r="250" fill="none" stroke="#0b2a55" strokeWidth="2"/></svg>}

export function LearningCertificate({rtl,certificate,close}:{rtl:boolean;certificate:CertificateSnapshot;close:()=>void}){
 const dialog=useLearningDialog(close);
 const [lang,setLang]=useState<Lang>(rtl?"ar":"en"),[scale,setScale]=useState(fit);
 const t=TEXT[lang],ar=lang==="ar",locale=t.lang;
 useEffect(()=>{const resize=()=>setScale(fit()),key=(event:KeyboardEvent)=>{if(event.key==="Escape")close()};window.addEventListener("resize",resize);window.addEventListener("keydown",key);return()=>{window.removeEventListener("resize",resize);window.removeEventListener("keydown",key)}},[close]);
 const pick=(en:string|null|undefined,arabic:string|null|undefined)=>(ar?arabic||en:en||arabic)||"";
 const number=(value:number)=>new Intl.NumberFormat(locale,{maximumFractionDigits:1}).format(value);
 const date=(value:string|null|undefined,month:"long"|"short"="long")=>value?new Intl.DateTimeFormat(locale,{day:"numeric",month,year:"numeric"}).format(new Date(`${value.slice(0,10)}T00:00:00`)):"—";
 const {employee,program,result}=certificate,issuer=pick(certificate.issuer.en,certificate.issuer.ar);
 const days=program.startDate&&program.endDate?dayCount(program.startDate,program.endDate):0;
 const duration=program.durationHours?(ar?`${number(program.durationHours)} ساعة`:`${number(program.durationHours)} ${program.durationHours===1?"Hour":"Hours"}`):days>0?(ar?arabicDays(days):`${days} ${days===1?"Day":"Days"}`):"—";
 const period=program.startDate&&program.endDate?(program.startDate===program.endDate?date(program.startDate,"short"):`${date(program.startDate,"short")} – ${date(program.endDate,"short")}`):date(program.startDate||program.endDate,"short");
 const score=result.overall==null?t.passed:`${new Intl.NumberFormat(locale,{style:"percent",maximumFractionDigits:1}).format(result.overall/100)}${result.grade?` · ${gradeLabel(result.grade,ar)}`:""}`;
 const signatories:CertificateSignatory[]=certificate.signatories;
 const learner=pick(employee.nameEn,employee.nameAr),jobTitle=pick(employee.jobTitleEn,employee.jobTitleAr);
 // Long names and program titles shrink to stay on the sheet instead of wrapping into the lines below.
 const nameSize=Math.max(22,Math.min(ar?40:44,Math.floor((ar?1300:1400)/Math.max(1,learner.length)))),programSize=program.title.length<=60?29:program.title.length<=100?24:20;
 const print=()=>{const previous=document.title;document.title=`${certificate.number} - ${learner}`;const restore=()=>{document.title=previous;window.removeEventListener("afterprint",restore)};window.addEventListener("afterprint",restore);window.print()};
 if(certificate.status==="pending")return null;
 return createPortal(<div className="certificate-portal" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t.title}>
  <button className="certificate-scrim" onClick={close} aria-label={rtl?"إغلاق":"Close"}/>
  <div className="certificate-window">
   <div className="certificate-toolbar" dir={rtl?"rtl":"ltr"}>
    <div><b>{rtl?"شهادة إتمام التدريب":"Training Certificate"}</b><span dir="ltr">{certificate.number}</span></div>
    <div className="certificate-lang" role="group" aria-label={rtl?"لغة الشهادة":"Certificate language"}><button className={lang==="en"?"active":""} onClick={()=>setLang("en")}>English</button><button className={lang==="ar"?"active":""} onClick={()=>setLang("ar")}>العربية</button></div>
    <div><button className="outline" onClick={close}><X size={16}/>{rtl?"إغلاق":"Close"}</button><button className="primary" onClick={print}><Printer size={16}/>{rtl?"طباعة أو حفظ PDF":"Print / Save PDF"}</button></div>
   </div>
   <div className="certificate-stage">
    <div className="certificate-scaler" style={{width:SHEET_WIDTH*scale,height:SHEET_HEIGHT*scale}}>
     <article className="certificate-sheet" dir={ar?"rtl":"ltr"} lang={ar?"ar":"en"} style={{transform:`scale(${scale})`}}>
      <div className="cert-frame"/><div className="cert-frame-inner"/>
      <Corner position="tl"/><Corner position="tr"/><Corner position="bl"/><Corner position="br"/>
      <Rosette/>
      <header className="cert-head"><Mark/><div><b dir="ltr">{issuer}</b><span>{t.kicker}</span></div></header>
      <h1 className="cert-title">{t.title}</h1>
      <div className="cert-divider"><i/></div>
      <p className="cert-lead cert-lead-1">{t.certify}</p>
      <h2 className="cert-name" style={{fontSize:nameSize}}>{learner}</h2>
      <p className="cert-meta">{t.employeeId}: <span dir="ltr">{employee.code}</span>{jobTitle?` · ${jobTitle}`:""}</p>
      <p className="cert-lead cert-lead-2">{t.completed}</p>
      <h3 className="cert-program" dir="auto" style={{fontSize:programSize}}>{program.title}</h3>
      <p className="cert-instructor">{t.roles.instructor}: {certificate.instructor?pick(certificate.instructor.nameEn,certificate.instructor.nameAr):"—"}</p>
      <dl className="cert-facts"><div><dt>{t.duration}</dt><dd>{duration}</dd></div><div><dt>{t.period}</dt><dd>{period}</dd></div><div><dt>{t.completion}</dt><dd>{date(program.completionDate)}</dd></div><div><dt>{t.result}</dt><dd>{score}</dd></div></dl>
      <div className="cert-signatures">{signatories.length?signatories.map(item=><div key={item.role}><i/><b>{pick(item.nameEn,item.nameAr)}</b><span>{t.roles[item.role]}</span>{item.approvedAt&&<small>{date(item.approvedAt,"short")}</small>}</div>):<div><i/><b>{t.hr}</b><span>{issuer}</span></div>}</div>
      <Seal label={t.seal} name={certificate.issuer.en}/>
      <footer className="cert-foot"><span>{t.number} <b dir="ltr">{certificate.number}</b></span><span>{t.issued} <b>{date(certificate.issuedAt)}</b></span>{certificate.expiry&&<span>{t.validUntil} <b>{date(certificate.expiry)}</b></span>}<p>{t.approved} {issuer}. {t.note}</p></footer>
     </article>
    </div>
   </div>
  </div>
 </div>,document.body)}
