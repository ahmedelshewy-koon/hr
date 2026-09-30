"use client";
import {useEffect,useRef} from "react";

export function useLearningDialog(close:()=>void, busy=false){
 const ref=useRef<HTMLDivElement>(null);
 const actions=useRef({close,busy});
 useEffect(()=>{actions.current={close,busy}},[close,busy]);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;
  const overflow=document.body.style.overflow;
  document.body.style.overflow="hidden";
  const controls=()=>Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')??[]).filter(element=>element.getClientRects().length>0);
  (controls()[0]??ref.current)?.focus();
  const key=(event:KeyboardEvent)=>{
   if(event.key==="Escape"){event.preventDefault();if(!actions.current.busy)actions.current.close()}
   if(event.key!=="Tab")return;
   const items=controls(),first=items[0],last=items.at(-1);
   if(!first){event.preventDefault();ref.current?.focus();return}
   if(event.shiftKey&&(document.activeElement===first||!ref.current?.contains(document.activeElement))){event.preventDefault();last?.focus()}
   else if(!event.shiftKey&&(document.activeElement===last||!ref.current?.contains(document.activeElement))){event.preventDefault();first.focus()}
  };
  document.addEventListener("keydown",key);
  return()=>{document.removeEventListener("keydown",key);document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus()};
 },[]);
 return ref;
}
