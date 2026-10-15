"use client";
import { useEffect, useState } from "react";
import { PayrollWorkspace } from "./payroll-workspace";
export function PayrollRouteWorkspace({tab}:{tab:string}){
  const [rtl,setRtl]=useState(false),[message,setMessage]=useState("");
  useEffect(()=>setRtl(localStorage.getItem("hr-language")==="ar"),[]);
  return <><PayrollWorkspace rtl={rtl} initialTab={tab} notify={setMessage}/>{message&&<div role="status" className="pr-route-message">{message}</div>}</>;
}
