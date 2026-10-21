/** Reads the XML Spreadsheet format produced by payrollExcel; rejects binary XLS/XLSX. */
export function readPayrollExcel(xml: string): Record<string,string>[] {
  const document=new DOMParser().parseFromString(xml,"application/xml");
  if(document.querySelector("parsererror")||document.documentElement.localName!=="Workbook") throw new Error("Choose an Excel XML template (.xls)");
  const worksheet=Array.from(document.documentElement.getElementsByTagName("Worksheet"))[0];
  const table=worksheet?.getElementsByTagName("Table")[0];
  if(!table) throw new Error("Excel worksheet is empty");
  const rowNodes=Array.from(table.children).filter(node=>node.localName==="Row");
  const cells=(node:Element)=>Array.from(node.children).filter(child=>child.localName==="Cell").map(cell=>{
    const data=Array.from(cell.children).find(child=>child.localName==="Data");
    return data?.textContent?.trim()||"";
  });
  const headers=cells(rowNodes[0]);
  if(!headers.length||new Set(headers).size!==headers.length) throw new Error("Excel template headers are invalid");
  return rowNodes.slice(1).map(node=>Object.fromEntries(cells(node).map((value,index)=>[headers[index],value]))).filter(row=>Object.values(row).some(Boolean));
}
