type LocalizedRecord = { name_en?: unknown; name_ar?: unknown } | null | undefined;

export const JOB_TITLE_TRANSLATIONS = [
  { en:"Software Developer", ar:"مطور برامج" },
  { en:"Support and Sales Manager", ar:"مدير الدعم والمبيعات" },
  { en:"HR Manager", ar:"مدير إدارة الموارد البشرية" },
  { en:"Marketing Manager", ar:"مدير التسويق" },
  { en:"Smart Line Manager", ar:"مدير سمارت لين" },
  { en:"Technical Support", ar:"دعم فني" },
  { en:"Digital Marketing Specialist", ar:"أخصائي تسويق رقمي" },
  { en:"Data Analyst", ar:"محلل بيانات" },
  { en:"Sales Representative", ar:"مندوب مبيعات" },
  { en:"Office Services Employee", ar:"موظف خدمات مكتبية", aliases:["Office boy"] },
  { en:"IT Manager", ar:"مدير إدارة التكنولوجيا" },
  { en:"Social Media Specialist", ar:"أخصائي وسائل التواصل الاجتماعي" },
  { en:"Designer", ar:"مصمم" },
  { en:"Technology Director", ar:"مدير قطاع التكنولوجيا" },
  { en:"HR Specialist", ar:"أخصائي موارد بشرية", aliases:["HR"] },
  { en:"Senior Sales Representative", ar:"مندوب مبيعات أول", aliases:["Snr. sales representative"] },
  { en:"Data Entry", ar:"مدخل بيانات" },
  { en:"Contracts Specialist", ar:"أخصائي تعاقدات" },
  { en:"UI/UX Designer", ar:"مصمم واجهة وتجربة مستخدم", aliases:["UI/UX"] },
  { en:"Customer Support", ar:"دعم العملاء" },
  { en:"Asus Merchants Manager", ar:"مدير أسس للتجار" },
  { en:"Representative", ar:"مندوب" },
  { en:"Accountant", ar:"محاسب" },
  { en:"Chief Executive Officer", ar:"الرئيس التنفيذي" },
  { en:"Digital Marketing Manager", ar:"مدير التسويق الرقمي" },
  { en:"Accounting Manager", ar:"مدير الحسابات" },
  { en:"Sales and Projects Manager", ar:"مدير المبيعات والمشروعات" },
  { en:"Design Manager", ar:"مدير التصميم" },
  { en:"Sales Specialist", ar:"أخصائي مبيعات" },
] as const;

const jobTitleByName = new Map<string,{en:string;ar:string}>();
for (const item of JOB_TITLE_TRANSLATIONS) {
  jobTitleByName.set(item.en.trim().toLocaleLowerCase(),item);
  jobTitleByName.set(item.ar.trim().toLocaleLowerCase(),item);
  if ("aliases" in item) for (const alias of item.aliases) jobTitleByName.set(alias.trim().toLocaleLowerCase(),item);
}

export function localizedJobTitle(rtl:boolean,record:LocalizedRecord,fallback:LocalizedRecord=null){
  const nameEn=String(record?.name_en||fallback?.name_en||"").trim();
  const nameAr=String(record?.name_ar||fallback?.name_ar||"").trim();
  const known=jobTitleByName.get(nameEn.toLocaleLowerCase())||jobTitleByName.get(nameAr.toLocaleLowerCase());
  return (rtl?(known?.ar||nameAr):(known?.en||nameEn))||"—";
}

const ARABIC_DISPLAY_VALUES:Record<string,string>={
  active:"نشط",archived:"مؤرشف",assigned:"مُسند",available:"متاح",cancelled:"ملغي",completed:"مكتمل",draft:"مسودة",failed:"غير ناجح",in_progress:"قيد التنفيذ",open:"مفتوح",overdue:"متأخر",pending:"قيد الانتظار",scheduled:"مجدول",sent:"مُرسل",accepted:"مقبول",
  annual:"سنوي",monthly:"شهري",quarterly:"ربع سنوي",semiannual:"نصف سنوي",one_time:"لمرة واحدة",
  onboarding:"تهيئة موظف جديد",offboarding:"إنهاء خدمة",internal:"داخلي",external:"خارجي",online:"عبر الإنترنت",enrolled:"مسجل",
  applied:"تم التقديم",screening:"الفرز",shortlisted:"القائمة المختصرة",interview:"المقابلة",hr_interview:"مقابلة الموارد البشرية",technical_interview:"المقابلة الفنية",management_interview:"مقابلة الإدارة",final_review:"المراجعة النهائية",final_interview:"المقابلة النهائية",offer:"العرض الوظيفي",hired:"تم التعيين",rejected:"مرفوض",withdrawn:"منسحب",on_hold:"معلّق مؤقتًا",paused:"متوقف مؤقتًا",closed:"مغلق",
  strong_match:"تطابق قوي",good_match:"تطابق جيد",requires_review:"يتطلب مراجعة",weak_match:"تطابق ضعيف",confirmed:"مؤكد",inferred:"مستنتج",not_found:"غير موجود",needs_verification:"يحتاج إلى تحقق",outdated:"قديم ويحتاج إعادة تحليل",
  strong_hire:"يوصى بشدة بالتعيين",hire:"يوصى بالتعيين",mixed:"مختلط / يحتاج مراجعة",no_hire:"لا يوصى بالتعيين",awaiting_feedback:"بانتظار التقييم",submitted:"تم الإرسال",approved:"معتمد",declined:"مرفوض",expired:"منتهي الصلاحية",
  work_experience:"الخبرة العملية",technical_skills:"المهارات الفنية",domain_experience:"خبرة المجال",education:"التعليم",certifications:"الشهادات",language:"اللغة",location:"الموقع",availability:"التوفر",required:"إلزامي",preferred:"مفضل",informational:"معلوماتي",important:"مهم",knockout:"إلزامي للمراجعة",
  behavioral:"سلوكي",situational:"موقفي",leadership:"قيادة",communication:"تواصل",culture_fit:"ملاءمة الفريق",role_specific:"خاص بالدور",verification:"تحقق",in_person:"حضوري",video:"مرئي",phone:"هاتفي",company:"على مستوى الشركة",department:"القسم",job_family:"العائلة الوظيفية",job:"الوظيفة",
  percentage:"نسبة مئوية",number:"رقم",rating:"تقييم",yes_no:"نعم أو لا",
  good:"جيدة",excellent:"ممتازة",fair:"مقبولة",poor:"ضعيفة",structured:"منظمة",proceed:"استمرار",
  laptop:"حاسوب محمول",mobile:"هاتف محمول",sim:"شريحة اتصال",monitor:"شاشة",keyboard:"لوحة مفاتيح",mouse:"ماوس",access_card:"بطاقة دخول",headset:"سماعة رأس",other:"أخرى",
  biometric:"جهاز البصمة",manual:"إدخال يدوي",web:"المنصة",system:"النظام",import:"استيراد",
  present:"حاضر",late:"متأخر",remote:"عن بُعد",office:"المكتب",leave:"إجازة",absent:"غائب",holiday:"عطلة",needs_review:"يحتاج مراجعة",non_working_day:"يوم راحة",biometric_punch:"بصمة",
  manager:"مدير",hr:"الموارد البشرية",team_lead:"قائد فريق",specialist:"أخصائي",staff:"موظف",
  full_time:"دوام كامل",part_time:"دوام جزئي",contract:"عقد محدد المدة",fixed:"دوام ثابت",shift:"ورديات",
  egypt:"مصر","saudi arabia":"السعودية",both:"كلا البلدين",
  employee:"موظف","department manager":"مدير القسم","hr manager":"مدير الموارد البشرية","super admin":"مدير النظام",
  "human resources":"إدارة الموارد البشرية",technology:"التكنولوجيا",marketing:"التسويق",sales:"المبيعات",finance:"المالية",operations:"العمليات",
  sar:"ريال سعودي",egp:"جنيه مصري",usd:"دولار أمريكي",
};

/** Keeps runtime/API values from leaking English into the Arabic interface. */
export function localizedDisplayValue(value:unknown,rtl:boolean,fallback="غير محدد"){
  const text=String(value??"").trim();
  if(!text)return "—";
  if(!rtl)return text.replaceAll("_"," ");
  const key=text.toLocaleLowerCase().replaceAll("-","_").replaceAll(" ","_");
  const direct=ARABIC_DISPLAY_VALUES[key]||ARABIC_DISPLAY_VALUES[text.toLocaleLowerCase()];
  if(direct)return direct;
  if(!/[A-Za-z]/.test(text))return text;
  return fallback;
}
