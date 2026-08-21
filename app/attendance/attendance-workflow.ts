export const CORRECTION_TYPES=["forgot_check_in","forgot_check_out","wrong_check_in","wrong_check_out","late_justification","early_departure_justification","other"] as const;
export type CorrectionType=typeof CORRECTION_TYPES[number];
export type CorrectionDecision="approve"|"reject";

export function correctionFields(type:CorrectionType){
  if(type==="forgot_check_in"||type==="wrong_check_in")return ["actual_in"] as const;
  if(type==="forgot_check_out"||type==="wrong_check_out")return ["actual_out"] as const;
  return [] as const;
}

export function decideCorrectionTransition(input:{status:string;stage:string;decision:CorrectionDecision}){
  if(input.stage==="manager"&&input.status!=="pending_manager")throw new Error("This manager stage has already been processed");
  if(input.stage==="hr"&&input.status!=="pending_hr")throw new Error("This HR stage has already been processed");
  if(!["manager","hr"].includes(input.stage))throw new Error("This correction has already been finalized");
  if(input.decision==="reject")return {status:input.stage==="manager"?"rejected_manager":"rejected_hr",currentStage:"completed",apply:false};
  if(input.stage==="manager")return {status:"pending_hr",currentStage:"hr",apply:false};
  return {status:"resolved",currentStage:"completed",apply:true};
}
