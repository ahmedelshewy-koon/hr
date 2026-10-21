type Invoice = Record<string, unknown>;
export type ErpConfig = { invoiceUrl:string; invoiceMethod:string; batchUrl:string; batchMethod:string; apiKey:string };
const methods=new Set(["GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS"]);
export function validateErpConfig(config:ErpConfig) {
  for(const url of [config.invoiceUrl,config.batchUrl]) { const parsed=new URL(url); if(parsed.protocol!=="https:"&&!(["localhost","127.0.0.1"].includes(parsed.hostname)&&parsed.protocol==="http:")) throw new Error("ERP URLs must use HTTPS"); }
  if(!methods.has(config.invoiceMethod)||!methods.has(config.batchMethod)) throw new Error("Invalid ERP HTTP method");
  if(!config.apiKey) throw new Error("ERP API key is required");
}
export type InvoiceResult = {batchNumber:string;businessUnitCode:string;status:number;responseBody:string};
export async function postInvoices(config:ErpConfig,makeInvoices:(batchNumber:string)=>Invoice[],transport:typeof fetch=fetch,onResult?:(result:InvoiceResult)=>Promise<unknown>) {
  validateErpConfig(config);
  const headers={"content-type":"application/json","x-api-key":config.apiKey};
  const batchResponse=await transport(config.batchUrl,{method:config.batchMethod,headers});
  if(!batchResponse.ok) throw new Error(`Batch number request failed (${batchResponse.status})`);
  const batch=await batchResponse.json() as Record<string,unknown>;
  const batchNumber=String(batch.batchNumber??batch.batch_number??"");
  if(!batchNumber) throw new Error("Batch number response did not contain batchNumber");
  const invoices=makeInvoices(batchNumber);
  const results: {businessUnitCode:string;status:number}[]=[];
  for(const invoice of invoices) {
    const response=await transport(config.invoiceUrl,{method:config.invoiceMethod,headers,body:JSON.stringify(invoice)});
    const item={batchNumber,businessUnitCode:String(invoice.businessUnitCode),status:response.status,responseBody:(await response.text()).slice(0,4000)};
    if(onResult) await onResult(item);
    results.push({businessUnitCode:item.businessUnitCode,status:item.status});
    if(!response.ok) throw new Error(`AP invoice failed for ${String(invoice.businessUnitCode)} (${response.status}); ${results.length-1} invoice(s) may already have been accepted`);
  }
  return {batchNumber,apiUrl:config.invoiceUrl,results};
}
