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
