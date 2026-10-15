type Row=Record<string,unknown>;
const escape=(value:unknown)=>String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
/** Excel 2003 XML keeps Arabic, currencies and full row counts without external dependencies. */
export function payrollExcel(rows:Row[],title:string) {
  const keys=[...new Set(rows.flatMap(row=>Object.keys(row)))].filter(key=>!key.toLowerCase().includes("api_key"));
  const cell=(value:unknown)=>`<Cell><Data ss:Type="String">${escape(value)}</Data></Cell>`;
  const header=`<Row>${keys.map(cell).join("")}</Row>`;
  const body=rows.map(row=>`<Row>${keys.map(key=>cell(row[key])).join("")}</Row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${escape(title.slice(0,31))}"><Table>${header}${body}</Table></Worksheet></Workbook>`;
}
