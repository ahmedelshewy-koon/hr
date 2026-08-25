export const CONTRACT_EXPIRY_WARNING_DAYS=30;

export function defaultContractEndDate(startDate:unknown){
  const value=String(startDate??"").trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return "";
  const date=new Date(`${value}T12:00:00Z`);
  if(Number.isNaN(date.getTime()))return "";
  date.setUTCFullYear(date.getUTCFullYear()+1);
  date.setUTCDate(date.getUTCDate()-1);
  return date.toISOString().slice(0,10);
}

export function resolvedContractEndDate(startDate:unknown,endDate:unknown){
  return String(endDate??"").trim()||defaultContractEndDate(startDate);
}
