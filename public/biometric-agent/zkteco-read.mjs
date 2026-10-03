import Zkteco from "zkteco-js";
import { isIP } from "node:net";

const [ip, port, timezone] = process.argv.slice(2);
if (!isIP(ip) || !Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) throw new Error("Invalid device address");
new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
process.env.TZ = timezone;
const machine = new Zkteco(ip, Number(port), 15000, 5200, 8184);
try {
  await machine.createSocket();
  // ZK requests on one socket MUST be sequential.
  const info = await machine.getInfo();
  if (process.argv.includes("--probe")) {
    const counts = { users: Number(info.userCounts), punches: Number(info.logCounts) };
    if (!Object.values(counts).every(n => Number.isInteger(n) && n >= 0)) throw new Error("Invalid device counters");
    console.log("ZK_COUNTS:" + JSON.stringify(counts));
  } else {
  const deviceTime = await machine.getTime();
  const users = await machine.getUsers();
  const punches = await machine.getAttendances();
  if (users.err || punches.err || !Array.isArray(users.data) || !Array.isArray(punches.data)) throw new Error("Incomplete device response");
  if (users.data.length < Number(info.userCounts) || punches.data.length < Number(info.logCounts)) throw new Error("Incomplete device download");
  const validDate = value => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.getFullYear() < 2000 || date.getFullYear() > 2100) throw new Error("Invalid device timestamp");
    return date.toISOString();
  };
  // Strip passwords, card numbers and all biometric templates at the boundary.
  const snapshot = {
    deviceTime: validDate(deviceTime),
    users: users.data.map(u => ({ userId: String(u.userId), uid: Number(u.uid), name: String(u.name || "PIN " + u.userId), role: Number(u.role) || 0 })),
    punches: punches.data.map(p => ({ userId: String(p.user_id), serial: Number(p.sn) || 0, punchedAt: validDate(p.record_time), state: Number(p.state) || 0, verifyType: Number(p.type) || 0 })),
  };
  if (snapshot.users.some(u => !u.userId || u.userId === "undefined") || snapshot.punches.some(p => !p.userId || p.userId === "undefined")) throw new Error("Invalid device user ID");
  console.log("ZK_SNAPSHOT:" + JSON.stringify(snapshot));
  }
} catch {
  console.error("Read-only device download failed. Check network connectivity and the device communication key.");
  process.exitCode = 1;
} finally {
  try { await machine.disconnect(); } catch { /* socket may already be closed */ }
}
