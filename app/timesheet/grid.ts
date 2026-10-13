import type { Row } from "../ui-types";

export const TIMESHEET_SORT_FIELDS = ["work_date","employee_name","department_name","status","late_minutes","early_leave_minutes","overtime_minutes","deduction_amount"] as const;
export type TimesheetSortField = typeof TIMESHEET_SORT_FIELDS[number];
export type GridOptions = {search?:string;first?:string;second?:string;descending?:boolean};

export function filterSortTimesheetRows(rows:Row[],options:GridOptions):Row[] {
  const needle=(options.search||"").trim().toLocaleLowerCase();
  const filtered=needle?rows.filter(row=>["work_date","employee_name","employee_name_ar","employee_code","department_name","department_name_ar","status"].some(key=>String(row[key]??"").toLocaleLowerCase().includes(needle))):rows;
  const first=TIMESHEET_SORT_FIELDS.find(key=>key===options.first);
  const second=TIMESHEET_SORT_FIELDS.find(key=>key===options.second&&key!==first);
  if(!first)return [...filtered];
  const compare=(a:Row,b:Row,key:TimesheetSortField)=>{
    if(["late_minutes","early_leave_minutes","overtime_minutes","deduction_amount"].includes(key))return (Number(a[key])||0)-(Number(b[key])||0);
    return String(a[key]??"").localeCompare(String(b[key]??""),"en",{numeric:true});
  };
  return [...filtered].sort((a,b)=>(options.descending?-1:1)*(compare(a,b,first)||(second?compare(a,b,second):0)||((Number(a.id)||0)-(Number(b.id)||0))));
}
