import { COUNTRIES } from "./countries";

type Option = { value: string; ar: string; en: string };

const nationalities: Option[] = [
  { value: "Egypt", ar: "مصري", en: "Egyptian" },
  { value: "Saudi", ar: "سعودي", en: "Saudi" },
  ...[
    ["Sudan", "سوداني", "Sudanese"], ["Jordan", "أردني", "Jordanian"],
    ["Syria", "سوري", "Syrian"], ["Lebanon", "لبناني", "Lebanese"],
    ["Palestine", "فلسطيني", "Palestinian"], ["Yemen", "يمني", "Yemeni"],
    ["Iraq", "عراقي", "Iraqi"], ["United Arab Emirates", "إماراتي", "Emirati"],
    ["Kuwait", "كويتي", "Kuwaiti"], ["Bahrain", "بحريني", "Bahraini"],
    ["Qatar", "قطري", "Qatari"], ["Oman", "عماني", "Omani"],
    ["Morocco", "مغربي", "Moroccan"], ["Algeria", "جزائري", "Algerian"],
    ["Tunisia", "تونسي", "Tunisian"], ["Libya", "ليبي", "Libyan"],
    ["India", "هندي", "Indian"], ["Pakistan", "باكستاني", "Pakistani"],
    ["Bangladesh", "بنغلاديشي", "Bangladeshi"], ["Nepal", "نيبالي", "Nepalese"],
    ["Philippines", "فلبيني", "Filipino"], ["Indonesia", "إندونيسي", "Indonesian"],
    ["Sri Lanka", "سريلانكي", "Sri Lankan"], ["Turkey", "تركي", "Turkish"],
    ["United Kingdom", "بريطاني", "British"], ["United States", "أمريكي", "American"],
    ["Other", "أخرى", "Other"],
  ].map(([value, ar, en]) => ({ value, ar, en })),
];

const religions: Option[] = [
  { value: "muslim", ar: "مسلم", en: "Muslim" },
  { value: "christian", ar: "مسيحي", en: "Christian" },
  { value: "jewish", ar: "يهودي", en: "Jewish" },
  { value: "hindu", ar: "هندوسي", en: "Hindu" },
  { value: "buddhist", ar: "بوذي", en: "Buddhist" },
  { value: "other", ar: "أخرى", en: "Other" },
  { value: "none", ar: "بلا ديانة", en: "No religion" },
  { value: "prefer_not_to_say", ar: "أفضل عدم الإفصاح", en: "Prefer not to say" },
];

const locations: Option[] = COUNTRIES.map(country => ({ value: country.value, ar: country.ar, en: country.value }));

export function EmployeeSelect({ field, value, rtl, existing = [], onChange }: {
  field: "nationality" | "religion" | "workLocation" | "country";
  value: string;
  rtl: boolean;
  existing?: string[];
  onChange: (value: string) => void;
}) {
  const options = [...(field === "nationality" ? nationalities : field === "religion" ? religions : locations)];
  // Retain legacy values exactly; opening an existing employee must not change them.
  for (const item of [...existing, value]) {
    if (item && !options.some(option => option.value === item)) options.push({ value: item, ar: item, en: item });
  }
  return <select value={value} onChange={event => onChange(event.target.value)}>
    <option value="">{rtl ? "غير محدد" : "Not specified"}</option>
    {options.map(option => <option key={option.value} value={option.value}>{rtl ? option.ar : option.en}</option>)}
  </select>;
}
