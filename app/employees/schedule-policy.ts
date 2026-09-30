const minutesOfDay=(value:unknown)=>{
  const match=/^(\d{2}):(\d{2})/.exec(String(value??"").trim());
  if(!match)return null;
  const hours=Number(match[1]),minutes=Number(match[2]);
  return hours>23||minutes>59?null:hours*60+minutes;
};

export function scheduledDailyMinutes(checkIn:unknown,checkOut:unknown){
  const start=minutesOfDay(checkIn),end=minutesOfDay(checkOut);
  if(start===null||end===null||start===end)return null;
  return end>start?end-start:end+1440-start;
}
