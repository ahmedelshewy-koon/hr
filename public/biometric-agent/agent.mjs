// HR biometric office connector.
// Runs on one computer inside the office network, reads ZKTeco devices over the LAN and sends the
// records to the hosted HR app over HTTPS. It opens no inbound port and has no database access:
// the device list (IP/port) comes from the HR app, so devices are added and changed there.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const VERSION = "1.0.0";
const HEARTBEAT_SECONDS = 120;
const LOG_DAYS = 14;
const here = path.dirname(fileURLToPath(import.meta.url));
const readScript = path.join(here, "zkteco-read.mjs");
const logDirectory = path.join(here, "logs");
const execute = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function loadConfig() {
  const file = path.join(here, "agent.config.json");
  const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const serverUrl = String(process.env.HR_SERVER_URL || saved.serverUrl || "").trim().replace(/\/+$/, "");
  const token = String(process.env.HR_AGENT_TOKEN || saved.token || "").trim();
  const url = new URL(serverUrl);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("serverUrl must start with https://");
  if (!token.startsWith("hrag_")) throw new Error("Connector token is missing from agent.config.json");
  return { endpoint: serverUrl + "/api/biometric-agent", token };
}

let lastPrune = "";
function log(message) {
  const line = new Date().toISOString() + " " + message;
  console.log(line);
  try {
    fs.mkdirSync(logDirectory, { recursive: true });
    fs.appendFileSync(path.join(logDirectory, "agent-" + line.slice(0, 10) + ".log"), line + "\n");
    if (lastPrune !== line.slice(0, 10)) {
      lastPrune = line.slice(0, 10);
      const cutoff = Date.now() - LOG_DAYS * 86400000;
      for (const name of fs.readdirSync(logDirectory)) if (fs.statSync(path.join(logDirectory, name)).mtimeMs < cutoff) fs.rmSync(path.join(logDirectory, name));
    }
  } catch { /* logging must never stop the connector */ }
}

/** Logs a device's message only when it changes, so a device that stays offline does not flood the log. */
const lastMessage = new Map();
function logOnce(key, message) {
  if (lastMessage.get(key) === message) return;
  lastMessage.set(key, message);
  log(message);
}

class ServerError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function call(config, body, timeoutMs = 30000) {
  let response;
  try {
    response = await fetch(config.endpoint, { method: "POST", headers: { authorization: "Bearer " + config.token, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new ServerError("Cannot reach the HR server (" + (error?.cause?.code || error?.name || "network error") + ")", 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ServerError(String(data.error || "HTTP " + response.status), response.status);
  return data;
}

// The device driver runs in a child process with a hard timeout so a stalled socket cannot hang the connector.
async function readDevice(device, probe) {
  const args = [readScript, device.ipAddress, String(device.port), device.timezone];
  if (probe) args.push("--probe");
  const { stdout } = await execute(process.execPath, args, { timeout: probe ? 30000 : 120000, maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: { ...process.env, TZ: device.timezone } });
  const marker = probe ? "ZK_COUNTS:" : "ZK_SNAPSHOT:";
  const line = stdout.split(/\r?\n/).find(value => value.startsWith(marker));
  if (!line) throw new Error(probe ? "Device counter check failed" : "Device download did not return a complete snapshot");
  return JSON.parse(line.slice(marker.length));
}

// Never forward driver output: it can contain device user passwords.
const deviceFailure = error => error?.killed ? "Device did not answer in time; check the IP address, port and network" : error?.code !== undefined ? "Device connection failed; check the IP address, port and that the computer is on the device network" : error instanceof Error ? error.message.slice(0, 300) : "Device connection failed";

const reported = new Map();
async function reportStatus(config, device, online, error) {
  const state = online ? "online" : "offline:" + error;
  const previous = reported.get(device.id);
  if (previous && previous.state === state && Date.now() - previous.at < HEARTBEAT_SECONDS * 1000) return;
  await call(config, { action: "status", deviceId: device.id, online, error });
  reported.set(device.id, { state, at: Date.now() });
}

async function serviceDevice(config, device) {
  const label = device.name + " (" + device.ipAddress + ":" + device.port + ")";
  let syncId = null;
  try {
    let needSync = Boolean(device.queuedSyncId) || !device.synced;
    if (!needSync) {
      let counts;
      try { counts = await readDevice(device, true); } catch (error) {
        const message = deviceFailure(error);
        logOnce(device.id, label + ": " + message);
        await reportStatus(config, device, false, message);
        return;
      }
      await reportStatus(config, device, true);
      needSync = counts.users !== device.userCount || counts.punches !== device.logCount;
      if (!needSync) { logOnce(device.id, label + ": connected"); return; }
    }
    ({ syncId } = await call(config, { action: "start", deviceId: device.id, trigger: device.synced ? "data_changed" : "initial" }));
    let snapshot;
    try { snapshot = await readDevice(device, false); } catch (error) { throw new Error(deviceFailure(error)); }
    const result = await call(config, { action: "snapshot", deviceId: device.id, syncId, snapshot }, 15 * 60 * 1000);
    reported.set(device.id, { state: "online", at: Date.now() });
    lastMessage.delete(device.id);
    log(label + ": " + result.imported + " new punches, " + result.unmatched + " unlinked device users");
  } catch (error) {
    if (error instanceof ServerError && (error.status === 409 || error.status === 401 || error.status === 0)) throw error;
    const message = error instanceof Error ? error.message.slice(0, 300) : "Biometric synchronization failed";
    logOnce(device.id, label + ": " + message);
    reported.delete(device.id);
    await call(config, { action: "fail", deviceId: device.id, syncId, error: message }).catch(() => {});
  }
}

async function run() {
  const config = loadConfig();
  log("HR biometric connector " + VERSION + " started; server " + new URL(config.endpoint).origin);
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; });
  while (!stopping) {
    let wait = 15;
    try {
      const state = await call(config, { action: "poll", version: VERSION });
      wait = Number(state.pollSeconds) || 15;
      if (!state.devices.length) logOnce("devices", "No devices are assigned to this connector yet. Add one in the HR app: Attendance > Biometric device.");
      else lastMessage.delete("devices");
      for (const device of state.devices) {
        try { await serviceDevice(config, device); } catch (error) {
          if (error.status === 409) continue; // another sync for this device is already running
          throw error;
        }
      }
      lastMessage.delete("server");
    } catch (error) {
      const unauthorized = error instanceof ServerError && error.status === 401;
      logOnce("server", unauthorized ? "The HR app rejected this connector's token. Create a new token in the HR app and run the install command again." : String(error?.message || error));
      wait = unauthorized ? 300 : 60;
    }
    if (!stopping) await sleep(wait * 1000);
  }
}

run().catch(error => { log("Connector could not start: " + (error instanceof Error ? error.message : String(error))); process.exitCode = 1; });
