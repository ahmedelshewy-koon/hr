import { asResponse, orgError, type OrganizationErrorCode } from './org-errors.ts';

type Duplicate = [OrganizationErrorCode, string, string, string];
const DUPLICATES: Record<string, Duplicate> = {
  hr_rules_active_scope: ['HR_RULE_DUPLICATE', 'branch_id', 'توجد قاعدة نشطة لنفس النطاق', 'An active HR responsibility rule already exists for this scope'],
  positions_company_ceo: ['CEO_OCCUPIED', 'is_ceo', 'توجد وظيفة رئيس تنفيذي نشطة للشركة', 'This company already has an active CEO position'],
  idx_companies_name: ['REFERENCED_ENTITY_CONFLICT', 'name_en', 'اسم الشركة مستخدم بالفعل', 'Company name already exists'],
};
const DUPLICATE_CODE: Duplicate = ['REFERENCED_ENTITY_CONFLICT', 'code', 'الرمز مستخدم بالفعل؛ اختر رمزًا آخر', 'This code already exists; choose another code'];

/** Unique-constraint violations become structured bilingual 409s; the SQL error never reaches the client. */
export function organizationDuplicateError(error:unknown):Response|null{
  const seen=new Set<unknown>();
  let current=error;
  while(current&&typeof current==='object'&&!seen.has(current)){
    seen.add(current);
    const value=current as {code?:string;constraint_name?:string;constraint?:string;cause?:unknown};
    if(value.code==='23505'){
      const constraint=value.constraint_name||value.constraint||'';
      const match=DUPLICATES[constraint]||(['companies','branches','positions','job_grades','work_locations'].some(table=>constraint===`${table}_code_unique`)?DUPLICATE_CODE:null);
      if(!match)return null;
      const [code,field,ar,en]=match;
      return asResponse(orgError(code,field,ar,en,{status:409}),409);
    }
    current=value.cause;
  }
  return null;
}
