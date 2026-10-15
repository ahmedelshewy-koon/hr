import {normalizePayrollCountry} from "./country.ts";
type Row=Record<string,unknown>;

/** Explicit Payroll fields only. Company assignments never imply a Working Business Unit. */
export function normalizeEmployeePayrollChange(payload:Row,_before:Row,canEditBasic:boolean):Row {
  const updates:Row={};
  if((payload.salary!==undefined||payload.salaryCurrency!==undefined)&&!canEditBasic) throw new Error("Basic salary privilege required");
  if(payload.salary!==undefined){
    const salary=payload.salary===""||payload.salary===null?null:Number(payload.salary);
    if(salary!==null&&(!Number.isFinite(salary)||salary<0))throw new Error("Invalid salary");
    updates.salary=salary;
  }
  if(payload.salaryCurrency!==undefined){
    const currency=String(payload.salaryCurrency||"").trim().toUpperCase();
    if(!/^[A-Z]{3}$/.test(currency))throw new Error("Invalid salary currency");
    updates.salary_currency=currency;
  }
  if(payload.salaryCountry!==undefined){
    const raw=String(payload.salaryCountry||"").trim();
    const country=raw?normalizePayrollCountry(raw)??raw:raw;
    if(country&&!["Egypt","KSA"].includes(country))throw new Error("Invalid payroll country");
    updates.salary_country=country||null;
  }
  if(payload.workingBusinessUnitId!==undefined){
    const unit=payload.workingBusinessUnitId===""||payload.workingBusinessUnitId===null?null:Number(payload.workingBusinessUnitId);
    if(unit!==null&&(!Number.isInteger(unit)||unit<=0))throw new Error("Invalid Working Business Unit");
    updates.working_business_unit_id=unit;
  }
  return updates;
}
