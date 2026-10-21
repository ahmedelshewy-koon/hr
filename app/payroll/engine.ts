/** Pure, deterministic payroll calculations shared by preview and run creation. */
type Row = Record<string, unknown>;
type Input = { year: number; month: number; employees: Row[]; elements: Row[]; recurring: Row[]; variables: Row[]; eligibility: Row[] };
export type PayrollLine = { employee_id: number; element_id: number | null; element_code: string; element_name_en: string; element_name_ar: string; element_type: string; amount: number; minutes: number; currency: string; business_unit_code?: string; cost_center_code?: string; department_code?: string; element_account?: string; fallback_account?: string; employee_code?: string };
export type PayrollPerson = { employee_id: number; currency: string; basic: number; gross: number; deductions: number; employer: number; net: number };
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const num = (value: unknown) => Number(value) || 0;
const str = (value: unknown) => String(value ?? "");
const left = new Set(["terminated", "resigned", "inactive", "archived", "ended", "left"]);
const endOfMonth = (year: number, month: number) => `${year}-${String(month).padStart(2,"0")}-${String(new Date(Date.UTC(year,month,0)).getUTCDate()).padStart(2,"0")}`;

export function basicDays(employee: Row, year: number, month: number): number {
  const first = `${year}-${String(month).padStart(2,"0")}-01`, last = endOfMonth(year, month);
  const start = str(employee.start_date).slice(0,10), end = str(employee.termination_date||employee.end_date).slice(0,10);
  if (start > last || (left.has(str(employee.employment_status)) && end && end < first)) return 0;
  const beginDay = start > first ? Math.min(30,Number(start.slice(8,10))) : 1;
  const finalDay = left.has(str(employee.employment_status)) && end && end < last ? Math.min(30,Number(end.slice(8,10))) : 30;
  return Math.max(0, finalDay - beginDay + 1);
}

function eligible(element: Row, employee: Row, rules: Row[]) {
  const matches = rules.filter(rule => num(rule.element_id) === num(element.id));
  return !matches.length || matches.some(rule => (!rule.job_title_id || num(rule.job_title_id) === num(employee.job_title_id)) && (!rule.department_id || num(rule.department_id) === num(employee.department_id)));
}

/** Formula grammar is arithmetic over basic, salary and days; no executable JavaScript. */
export function evaluateFormula(source: string, context: { basic: number; salary: number; days: number }) {
  const clean=source.replace(/\s+/g,"");
  const tokens=clean.match(/basic|salary|days|(?:\d+(?:\.\d+)?)|[()+*/-]/g)??[];
  if(!clean||tokens.join("")!==clean) throw new Error("Invalid payroll formula");
  let index=0;
  const factor=():number=>{
    const token=tokens[index++];
    if(token==="-") return -factor();
    if(token==="+") return factor();
    if(token==="(") { const value=expression();if(tokens[index++]!==")") throw new Error("Unclosed payroll formula");return value; }
    if(token==="basic"||token==="salary"||token==="days") return context[token];
    if(token&&/^\d/.test(token)) return Number(token);
    throw new Error("Invalid payroll formula");
  };
  const term=():number=>{let value=factor();while(tokens[index]==="*"||tokens[index]==="/"){const operator=tokens[index++],right=factor();value=operator==="*"?value*right:value/right;}return value;};
  const expression=():number=>{let value=term();while(tokens[index]==="+"||tokens[index]==="-"){const operator=tokens[index++],right=term();value=operator==="+"?value+right:value-right;}return value;};
  const result=expression();if(index!==tokens.length||!Number.isFinite(result)) throw new Error("Invalid payroll formula result");return result;
}

export function calculatePayroll({year,month,employees,elements,recurring,variables,eligibility}: Input) {
  const first = `${year}-${String(month).padStart(2,"0")}-01`, last = endOfMonth(year,month), periodKey = first.slice(0,7);
  const active = elements.filter(element => num(element.is_active ?? 1) === 1);
  const basic = active.find(element => num(element.is_basic_salary_element) === 1);
  const delay = active.find(element => num(element.is_delay_minutes_element) === 1);
  const absence = active.find(element => num(element.is_absence_element) === 1);
  if (!basic || !delay || !absence) throw new Error("Configure the unique basic salary, delay, and absence elements before calculating payroll");
  const lines: PayrollLine[] = [], people: PayrollPerson[] = [];
  for (const employee of employees) {
    const days = basicDays(employee,year,month); if (!days) continue;
    const employeeId = num(employee.id), currency = str(employee.salary_currency || "SAR");
    const own: PayrollLine[] = [];
    const add = (element: Row, amount: number, minutes = 0) => {
      if (!Number.isFinite(amount) || amount < 0) throw new Error(`Invalid amount for ${str(element.code)}`);
      if (!amount) return;
      own.push({employee_id:employeeId,element_id:num(element.id),element_code:str(element.code),element_name_en:str(element.name_en),element_name_ar:str(element.name_ar),element_type:str(element.element_type),amount:money(amount),minutes,currency});
    };
    const salary = num(employee.basic_salary ?? employee.salary),basicAmount=money(salary*days/30);
    add(basic,basicAmount);
    const assigned=new Set<number>();
    for (const entry of recurring) {
      if (num(entry.employee_id)!==employeeId || num(entry.is_active ?? 1)!==1 || str(entry.effective_from)>last || (entry.effective_to && str(entry.effective_to)<first)) continue;
      const element=active.find(item=>num(item.id)===num(entry.element_id));
      if (element && ![basic,delay,absence].includes(element) && eligible(element,employee,eligibility)) {add(element,num(entry.amount));assigned.add(num(element.id));}
    }
    for (const entry of variables) {
      if (num(entry.employee_id)!==employeeId || (entry.period_key && str(entry.period_key)!==periodKey)) continue;
      const element = entry.element_id ? active.find(item=>num(item.id)===num(entry.element_id)) :
        str(entry.element)==="delay" ? delay : str(entry.element)==="absence" ? absence : active.find(item=>str(item.code)===str(entry.element));
      if (element && element!==basic && eligible(element,employee,eligibility)) {add(element,num(entry.amount),num(entry.quantity));assigned.add(num(element.id));}
    }
    for(const element of active) {
      if([basic,delay,absence].includes(element)||assigned.has(num(element.id))||!eligible(element,employee,eligibility)) continue;
      const kind=str(element.calculation_type);let amount=0;
      if(kind==="fixed") amount=num(element.default_amount);
      else if(kind==="percentage") amount=basicAmount*num(element.default_amount)/100;
      else if(kind==="formula"&&element.formula) amount=evaluateFormula(str(element.formula),{basic:basicAmount,salary,days});
      add(element,amount);
    }
    const gross=money(own.filter(line=>line.element_type==="earning").reduce((sum,line)=>sum+line.amount,0));
    const deductions=money(own.filter(line=>line.element_type==="deduction").reduce((sum,line)=>sum+line.amount,0));
    const employer=money(own.filter(line=>line.element_type==="employer_contribution").reduce((sum,line)=>sum+line.amount,0));
    lines.push(...own); people.push({employee_id:employeeId,currency,basic:money(salary*days/30),gross,deductions,employer,net:money(gross-deductions)});
  }
  return {periodKey,lines,people};
}

/** ERP preview and sender consume the same body; warnings identify excluded employees. */
export function buildInvoices(lines: PayrollLine[], employees: Row[], elements: Row[], mappings: Row[], sarRate: number, status: string, batchNumber: string) {
  if (!Number.isFinite(sarRate) || sarRate<=0) throw new Error("SAR rate must be positive");
  const byEmployee=new Map(employees.map(row=>[num(row.id),row]));
  const warnings: string[] = [], grouped=new Map<string,{businessUnitCode:string;vendorCode:string;status:string;currency:string;exchangeRate:number;batchNumber:string;lines:{accountId:string;costCenterCode:string;department:string;itemCode:string;amount:number}[]}>();
  for (const line of lines) {
    const employee=byEmployee.get(line.employee_id); if (!employee) continue;
    const snapshot=Object.prototype.hasOwnProperty.call(line,"business_unit_code");
    const bu=str(snapshot?line.business_unit_code:employee.business_unit_code), cc=str(snapshot?line.cost_center_code:employee.cost_center_code);
    if (!bu || !cc) { const warning=`Employee ${str(line.employee_code || employee.employee_code || line.employee_id)} missing business unit or cost center`; if (!warnings.includes(warning)) warnings.push(warning); continue; }
    const element=elements.find(row=>num(row.id)===line.element_id);
    const mapping=mappings.find(row=>num(row.business_unit_id)===num(employee.working_business_unit_id) && num(row.cost_center_id)===num(employee.cost_center_id));
    const account=str(snapshot?(line.element_account||line.fallback_account):(element?.element_account || mapping?.payroll_dr_account || employee.debit_account));
    if (!account) warnings.push(`No GL account for ${line.element_code} / ${bu} / ${cc}`);
    const key=`${bu}|${line.currency}`, invoice=grouped.get(key) ?? {businessUnitCode:bu,vendorCode:"SAL001",status,currency:line.currency,exchangeRate:sarRate,batchNumber,lines:[]};
    const department=str(snapshot?line.department_code:(employee.department_code || employee.department_id));
    const existing=invoice.lines.find(item=>item.accountId===account && item.costCenterCode===cc && item.department===department);
    const amount=line.element_type==="deduction" ? -line.amount : line.element_type==="employer_contribution" ? 0 : line.amount;
    if (existing) existing.amount=money(existing.amount+amount);
    else invoice.lines.push({accountId:account,costCenterCode:cc,department,itemCode:"",amount});
    grouped.set(key,invoice);
  }
  const invoices=[...grouped.values()];
  return {invoices,warnings,totalsSAR:money(invoices.reduce((sum,invoice)=>sum+invoice.lines.reduce((sub,line)=>sub+line.amount,0)*invoice.exchangeRate,0))};
}
