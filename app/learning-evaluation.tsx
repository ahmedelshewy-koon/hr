"use client";
import {useState} from "react";
import {createPortal} from "react-dom";
import {useLearningDialog} from "./use-learning-dialog";
import {Award,CheckCircle2,X,XCircle} from "lucide-react";
import "./learning-evaluation.css";
import {CERTIFICATE_ISSUER,EVALUATION_CRITERIA,PASS_MARK,gradeFor,gradeLabel,overallScore} from "./talent/learning-evaluation";
import type {Row} from "./ui-types";

// Quick ratings for a criterion; the number box next to them fine-tunes the exact score.
const RATINGS=[{score:50,en:"Weak",ar:"ضعيف"},{score:65,en:"Fair",ar:"مقبول"},{score:75,en:"Good",ar:"جيد"},{score:85,en:"Very Good",ar:"جيد جدًا"},{score:95,en:"Excellent",ar:"ممتاز"}];
const TONES=["var(--sana-danger)","var(--sana-warning)","var(--sana-mint)","var(--sana-teal-mid)","var(--sana-teal)"];
const toneFor=(score:number)=>score>=90?TONES[4]:score>=80?TONES[3]:score>=70?TONES[2]:score>=PASS_MARK?TONES[1]:TONES[0];

export type EvaluationSubmit={passed:boolean;evaluation:{scores:Record<string,number>;notes:string};certificateDetails:{durationHours:number;instructorName:string}};

function Ring({value,tone}:{value:number|null;tone:string}){
 const radius=42,circumference=2*Math.PI*radius,shown=value==null?0:Math.max(0,Math.min(100,value));
 return <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r={radius} fill="none" stroke="var(--sana-line)" strokeWidth="9"/><circle cx="50" cy="50" r={radius} fill="none" stroke={tone} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${circumference*shown/100} ${circumference}`} transform="rotate(-90 50 50)"/><line x1={50+radius*Math.sin(PASS_MARK*Math.PI/50)} y1={50-radius*Math.cos(PASS_MARK*Math.PI/50)} x2={50+(radius+8)*Math.sin(PASS_MARK*Math.PI/50)} y2={50-(radius+8)*Math.cos(PASS_MARK*Math.PI/50)} stroke="var(--sana-muted)" strokeWidth="2"/></svg>}

export function EvaluationModal({rtl,saving,row,error,close,submit}:{rtl:boolean;saving:boolean;row:Row;error?:string;close:()=>void;submit:(result:EvaluationSubmit)=>Promise<void>}){
 const [scores,setScores]=useState<Record<string,string>>({}),[notes,setNotes]=useState("");
 const [duration,setDuration]=useState(String(row.duration_hours??"")),[instructor,setInstructor]=useState(String(row.instructor_employee_name||row.instructor_name||""));
 const dialog=useLearningDialog(close,saving);
 const rated=EVALUATION_CRITERIA.filter(item=>scores[item.key]!==undefined&&scores[item.key]!=="").length,complete=rated===EVALUATION_CRITERIA.length;
 const overall=complete?overallScore(scores):null,passed=overall!==null&&overall>=PASS_MARK,tone=overall===null?"var(--sana-muted)":toneFor(overall);
 const set=(key:string,raw:string)=>{if(raw==="")return setScores(current=>({...current,[key]:""}));const value=Math.max(0,Math.min(100,Math.round(Number(raw)*10)/10));if(Number.isFinite(value))setScores(current=>({...current,[key]:String(value)}))};
 const name=rtl?(row.employee_name_ar||row.employee_name):row.employee_name,issuer=rtl?CERTIFICATE_ISSUER.ar:CERTIFICATE_ISSUER.en;
 return createPortal(<div className="learning-modal-layer" dir={rtl?"rtl":"ltr"} ref={dialog} tabIndex={-1}><button className="learning-scrim" onClick={()=>!saving&&close()} aria-label={rtl?"إغلاق":"Close"}/><form className="learning-modal evaluation-modal" role="dialog" aria-modal="true" aria-labelledby="evaluation-title" aria-busy={saving} onSubmit={event=>{event.preventDefault();if(overall===null||saving)return;void submit({passed,certificateDetails:{durationHours:Number(duration),instructorName:instructor.trim()},evaluation:{scores:Object.fromEntries(EVALUATION_CRITERIA.map(item=>[item.key,Number(scores[item.key])])),notes:notes.trim()}})}}>
  <header><div><span>{rtl?"تقييم التدريب":"TRAINING EVALUATION"}</span><h2 id="evaluation-title">{rtl?"تقييم واعتماد إتمام التدريب":"Evaluate & Approve Completion"}</h2><p>{name} · {row.course_title}</p></div><button type="button" onClick={close} disabled={saving} aria-label={rtl?"إغلاق":"Close"}><X/></button></header>
  <div className="evaluation-body">
   <section className="evaluation-criteria">{EVALUATION_CRITERIA.map(item=>{const raw=scores[item.key]??"",value=raw===""?null:Number(raw);return <fieldset key={item.key} className={value===null?"":"rated"}><legend><b>{rtl?item.ar:item.en}</b><em>{item.weight}%</em></legend><small>{rtl?item.hintAr:item.hintEn}</small><div className="evaluation-rate"><div className="evaluation-pills">{RATINGS.map(rating=><button type="button" key={rating.score} aria-pressed={value===rating.score} disabled={saving} className={value===rating.score?"on":""} onClick={()=>set(item.key,String(rating.score))}>{rtl?rating.ar:rating.en}</button>)}</div><label><input type="number" inputMode="decimal" min="0" max="100" step="0.1" required disabled={saving} placeholder="—" value={raw} onChange={event=>set(item.key,event.target.value)} aria-label={rtl?item.ar:item.en}/><span>/ 100</span></label></div>{value!==null&&<i className="evaluation-bar"><span style={{width:`${value}%`,background:toneFor(value)}}/></i>}</fieldset>})}</section>
   <aside className="evaluation-summary">
    <div className="evaluation-score"><div className="evaluation-ring"><Ring value={overall} tone={tone}/><div><b style={{color:tone}}>{overall===null?"—":overall}</b><small>%</small></div></div><div><small>{rtl?"النتيجة النهائية":"Overall result"}</small><strong style={{color:tone}}>{overall===null?(rtl?"بانتظار التقييم":"Awaiting ratings"):gradeLabel(gradeFor(overall).key,rtl)}</strong><em>{rtl?"الحد الأدنى للنجاح":"Pass mark"} <bdi>{new Intl.NumberFormat(rtl?"ar-EG":"en-US",{style:"percent"}).format(PASS_MARK/100)}</bdi></em></div></div>
    <p className="evaluation-progress">{rtl?`تم تقييم ${rated} من ${EVALUATION_CRITERIA.length} معايير`:`${rated} of ${EVALUATION_CRITERIA.length} criteria rated`}</p>
    <div className={`evaluation-outcome ${overall===null?"idle":passed?"pass":"fail"}`} aria-live="polite">{overall===null?<span>{rtl?"قيّم جميع المعايير لتظهر النتيجة.":"Rate every criterion to see the result."}</span>:passed?<><Award/><span>{rtl?`تصدر شهادة باسم ${issuer} بعد اعتماد مدير الإدارة والموارد البشرية، وتتضمن اسم المدرّب وبيانات التدريب.`:`A certificate from ${issuer} will be issued after department and HR approval. It includes the instructor and training details.`}</span></>:<><XCircle/><span>{rtl?"النتيجة أقل من حد النجاح، وسيُسجَّل التدريب كغير مجتاز دون إصدار شهادة.":"The result is below the pass mark. The training will be recorded as not passed and no certificate is issued."}</span></>}</div>
    <fieldset className="evaluation-certificate-details"><legend>{rtl?"بيانات الشهادة":"Certificate details"}</legend><label><span>{rtl?"اسم المدرّب":"Instructor name"}</span><input required={passed} maxLength={200} disabled={saving} value={instructor} onChange={event=>setInstructor(event.target.value)}/></label><label><span>{rtl?"مدة التدريب بالساعات":"Training duration (hours)"}</span><input required={passed} type="number" min="0.1" max="1000" step="0.1" disabled={saving} value={duration} onChange={event=>setDuration(event.target.value)}/></label></fieldset>
    <label className="evaluation-notes"><span>{rtl?"ملاحظات المقيّم (اختياري)":"Evaluator comments (optional)"}</span><textarea rows={4} maxLength={1000} disabled={saving} value={notes} onChange={event=>setNotes(event.target.value)}/></label>
   </aside>
  </div>
  {error&&<div className="evaluation-error" role="alert"><XCircle/>{error}</div>}
  <footer><button type="button" className="outline" onClick={close} disabled={saving}>{rtl?"إلغاء":"Cancel"}</button><button className={overall!==null&&!passed?"primary danger-primary":"primary"} disabled={saving||overall===null}>{overall!==null&&!passed?<><XCircle size={16}/>{rtl?"تسجيل كغير مجتاز":"Record as not passed"}</>:<><CheckCircle2 size={16}/>{rtl?"حفظ التقييم وطلب الاعتماد":"Save evaluation & request approvals"}</>}</button></footer>
 </form></div>,document.body)}
