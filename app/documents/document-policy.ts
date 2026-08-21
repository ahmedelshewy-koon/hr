export const SAFE_DOCUMENT_MIME_TYPES=["application/pdf","image/png","image/jpeg"] as const;
export const DEFAULT_MAX_DOCUMENT_BYTES=10*1024*1024;

export type DocumentState="valid"|"expiring_soon"|"expired"|"no_expiry"|"archived";
export function documentState(input:{expiryDate?:string|null;status?:string|null},today=new Date().toISOString().slice(0,10),thresholdDays=30):DocumentState{
  if(input.status==="archived")return "archived";if(!input.expiryDate)return "no_expiry";
  if(input.expiryDate<today)return "expired";
  const limit=new Date(`${today}T00:00:00Z`);limit.setUTCDate(limit.getUTCDate()+thresholdDays);
  return input.expiryDate<=limit.toISOString().slice(0,10)?"expiring_soon":"valid";
}

export function normalizeFilename(value:string){
  const source=value.replaceAll("\\","/").split("/").pop()?.normalize("NFKC")||"";
  const name=Array.from(source).filter(character=>{const code=character.charCodeAt(0);return code>=32&&code!==127;}).join("").replace(/\s+/g," ").trim()||"document";
  return name.slice(0,180);
}

export function extensionForMime(mime:string){return mime==="application/pdf"?"pdf":mime==="image/png"?"png":mime==="image/jpeg"?"jpg":"";}
export function filenameExtension(name:string){const match=name.toLowerCase().match(/\.([a-z0-9]+)$/);return match?.[1]||"";}

export function sniffDocumentMime(bytes:Uint8Array){
  if(bytes.length>=5&&String.fromCharCode(...bytes.slice(0,5))==="%PDF-")return "application/pdf";
  if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value))return "image/png";
  if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return "image/jpeg";
  return null;
}

export function validateDocumentFile(input:{bytes:Uint8Array;filename:string;declaredMime:string;allowedMimes?:string[];maxBytes?:number}){
  if(!input.bytes.length)throw new Error("Empty files are not allowed");
  const max=input.maxBytes??DEFAULT_MAX_DOCUMENT_BYTES;if(input.bytes.length>max)throw new Error(`File exceeds the ${Math.ceil(max/1024/1024)} MB limit`);
  const detected=sniffDocumentMime(input.bytes),allowed=input.allowedMimes??[...SAFE_DOCUMENT_MIME_TYPES];
  if(!detected||!allowed.includes(detected))throw new Error("Only PDF, PNG, and JPEG business documents are allowed");
  if(input.declaredMime&&input.declaredMime!==detected)throw new Error("File content does not match its declared type");
  const extension=filenameExtension(input.filename),validExtensions=detected==="image/jpeg"?["jpg","jpeg"]:[extensionForMime(detected)];
  if(!validExtensions.includes(extension))throw new Error("File extension does not match its content");
  return detected;
}

export function safeDocumentObjectKey(employeeId:number,category:string,mime:string){
  const categoryPart=category.toLowerCase().replace(/[^a-z0-9_-]/g,"-").slice(0,48)||"other";
  return `employee-documents/${employeeId}/${categoryPart}/${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}.${extensionForMime(mime)}`;
}

export function categoryApplies(category:{country?:string|null;employment_type?:string|null},employee:{country?:string|null;employment_type?:string|null}){
  return (!category.country||category.country===employee.country)&&(!category.employment_type||category.employment_type===employee.employment_type);
}
