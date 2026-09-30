export type BiometricPunch = { punched_at: string | Date; punch_type?: number };

export function localParts(value: string | Date, timezone = "Africa/Cairo") {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new Error("Invalid biometric timestamp");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(instant).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, seconds: `${parts.hour}:${parts.minute}:${parts.second}` };
}

/** The MB2000 currently records almost every punch with the same state. Use first/last
 * distinct punches, not the state flag, and leave a single punch without checkout.
 * Every later timestamp counts, even a second apart; exact timestamp duplicates
 * do not invent a checkout. Raw door events remain untouched. Overnight shifts
 * use the midpoint of the off-duty period as their work-date boundary. */
export function aggregateBiometricPunches(punches: BiometricPunch[], timezone: string, scheduledIn = "09:00", scheduledOut = "17:00") {
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const overnight = scheduledOut <= scheduledIn;
  const boundary = (minutes(scheduledIn) + minutes(scheduledOut)) / 2;
  const groups = new Map<string, { workDate: string; actualIn: string; actualOut: string | null; count: number; lastInstant: number }>();
  for (const punch of [...punches].sort((a, b) => new Date(a.punched_at).getTime() - new Date(b.punched_at).getTime())) {
    const local = localParts(punch.punched_at, timezone);
    let workDate = local.date;
    if (overnight && minutes(local.time) < boundary) workDate = new Date(new Date(`${workDate}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
    const instant = new Date(punch.punched_at).getTime();
    const group = groups.get(workDate);
    if (!group) groups.set(workDate, { workDate, actualIn: local.time, actualOut: null, count: 1, lastInstant: instant });
    else {
      if (instant > group.lastInstant) { group.actualOut = local.time; group.count++; }
      group.lastInstant = instant;
    }
  }
  return [...groups.values()].map(({ workDate, actualIn, actualOut, count }) => ({ workDate, actualIn, actualOut, count }));
}

export function uniqueFingerprintMatch(employees: { id: number; fingerprint_code: string | null }[], code: string) {
  const matches = employees.filter(employee => employee.fingerprint_code?.trim() === code.trim());
  return matches.length === 1 ? Number(matches[0].id) : null;
}
