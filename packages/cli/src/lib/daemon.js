import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runDir, logsDir, repoRoot, ensureOuroDir } from "./paths.js";

// Background process supervision for `ouro start` / `ouro stop`.
//
// Deliberately not pm2/forever/systemd: ouro is a single-operator tool that
// roots into one repo, and a pid file plus a detached spawn is the whole job.
// Adding a process manager would mean a global daemon with its own state,
// which is exactly the thing ouro avoids everywhere else.
//
// The two services:
//   dashboard — Express + WS, holds ticket state, spawns agent CLIs
//   listen    — Telegram intake agent, talks to the dashboard over HTTP
// They're separate processes so restarting the bot can't drop board state,
// which is the same split the foreground commands already had.

export const SERVICES = ["dashboard", "listen"];

const CLI_ENTRY = fileURLToPath(new URL("../index.js", import.meta.url));

// A 24/7 process writes logs forever. Rotate one generation at start; two
// files bounded at 5MB is plenty to debug "why did the bot stop overnight",
// and beats either unbounded growth or a logrotate dependency.
const MAX_LOG_BYTES = 5 * 1024 * 1024;

function pidFile(name) {
  return path.join(runDir(), `${name}.json`);
}

export function logFile(name) {
  return path.join(logsDir(), `${name}.log`);
}

export function readRecord(name) {
  try {
    return JSON.parse(fs.readFileSync(pidFile(name), "utf-8"));
  } catch {
    return null;
  }
}

function writeRecord(name, record) {
  ensureOuroDir();
  fs.writeFileSync(pidFile(name), JSON.stringify(record, null, 2));
}

export function clearRecord(name) {
  fs.rmSync(pidFile(name), { force: true });
}

/** Merges fields into an existing record — e.g. the port, once it's confirmed. */
export function updateRecord(name, patch) {
  const current = readRecord(name);
  if (!current) return null;
  const next = { ...current, ...patch };
  writeRecord(name, next);
  return next;
}

/**
 * Signal 0 probes for existence without delivering anything. On win32 this is
 * unreliable on its own: PIDs recycle fast, and once our dead pid is reused by
 * an unrelated process owned by another user/session, `process.kill(pid, 0)`
 * throws EPERM (exists, just not ours) — indistinguishable from our own
 * still-alive service. That false positive pins a stale pid file forever
 * (`stop` reports "refused to die" against a ghost). Cross-check with
 * `tasklist` so a recycled pid isn't mistaken for our service.
 */
export function isAlive(pid) {
  if (!pid) return false;
  if (process.platform === "win32") {
    const result = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
      encoding: "utf-8",
    });
    const out = result.stdout || "";
    return out.includes(`"${pid}"`);
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists but is owned by someone else — still alive.
    return err.code === "EPERM";
  }
}

/**
 * A pid file whose process is gone is stale — from a reboot, or a crash. Clean
 * it up on read so `status` and `start` never trust a recycled pid.
 */
export function serviceStatus(name) {
  const record = readRecord(name);
  if (!record) return { name, running: false };

  if (!isAlive(record.pid)) {
    clearRecord(name);
    return { name, running: false, stale: true };
  }
  return { name, running: true, ...record };
}

export function statusAll() {
  return SERVICES.map(serviceStatus);
}

function rotate(file) {
  try {
    if (fs.statSync(file).size > MAX_LOG_BYTES) fs.renameSync(file, `${file}.1`);
  } catch {
    // No log yet, or a Windows lock — not worth failing a start over.
  }
}

/**
 * Spawns a service detached from this terminal.
 *
 * `detached: true` puts the child in its own process group (POSIX) / process
 * tree root (Windows), which is what lets it outlive the shell — and what
 * lets stopService kill its agent grandchildren later. stdout/stderr go to a
 * file rather than a pipe, because a pipe with no reader fills its buffer and
 * wedges the child once the parent exits.
 */
export function startService(name, args = []) {
  ensureOuroDir();
  const file = logFile(name);
  rotate(file);

  // Where this run's output starts. Logs are append-only across restarts, so
  // without this a failed start would tail yesterday's errors and send you
  // debugging a problem you already fixed.
  const logOffset = fs.existsSync(file) ? fs.statSync(file).size : 0;

  const fd = fs.openSync(file, "a");
  try {
    const child = spawn(process.execPath, [CLI_ENTRY, name, ...args], {
      cwd: repoRoot(),
      detached: true,
      windowsHide: true, // no flashing console window on Windows
      stdio: ["ignore", fd, fd],
      env: process.env,
    });
    child.unref(); // don't hold this CLI's event loop open

    const record = { pid: child.pid, startedAt: new Date().toISOString(), args, logOffset };
    writeRecord(name, record);
    return record;
  } finally {
    fs.closeSync(fd); // the child holds its own dup of the fd
  }
}

function killTree(pid) {
  if (process.platform === "win32") {
    // /T kills the whole tree. Without it, a running `claude` child is
    // orphaned and keeps burning subscription tokens with nothing watching it.
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  // Negative pid targets the process group — same reasoning as /T above.
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
}

function forceKillTree(pid) {
  if (process.platform === "win32") return; // taskkill /F was already forceful
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Stops a service and its children. Returns what actually happened so the
 * command can report honestly rather than always printing "stopped".
 */
export async function stopService(name, { timeoutMs = 5000 } = {}) {
  const record = readRecord(name);
  if (!record) return { name, stopped: false, reason: "not running" };

  if (!isAlive(record.pid)) {
    clearRecord(name);
    return { name, stopped: false, reason: "stale pid file (process already gone)" };
  }

  killTree(record.pid);

  // Give it a moment to go down cleanly; the dashboard flushes its store and
  // cancels in-flight runs on SIGTERM (POSIX). Windows has no real signals, so
  // taskkill /F is immediate — the store's debounced write and the
  // in_progress→cancelled reconciliation on next boot cover that gap.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(record.pid)) {
      clearRecord(name);
      return { name, stopped: true, pid: record.pid };
    }
    await sleep(100);
  }

  forceKillTree(record.pid);
  await sleep(200);

  const gone = !isAlive(record.pid);
  if (gone) clearRecord(name);
  return { name, stopped: gone, pid: record.pid, forced: true, ...(gone ? {} : { reason: "refused to die" }) };
}

/**
 * Last N lines of a service log. `fromOffset` limits it to output written
 * after a given byte position — pass a start record's `logOffset` to show only
 * the run that just failed, rather than the whole file's history.
 */
export function tailLog(name, lines = 20, fromOffset = 0) {
  try {
    let text = fs.readFileSync(logFile(name), "utf-8");
    if (fromOffset > 0) text = Buffer.from(text, "utf-8").subarray(fromOffset).toString("utf-8");
    return text.split(/\r?\n/).filter(Boolean).slice(-lines);
  } catch {
    return [];
  }
}

export function uptime(startedAt) {
  const ms = Date.now() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "?";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
