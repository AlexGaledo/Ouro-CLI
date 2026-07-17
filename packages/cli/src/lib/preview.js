import { spawn } from "node:child_process";
import net from "node:net";
import { getStaging } from "./config.js";
import { askJson } from "./agentBackend.js";

// Staging preview servers — launch, track, and stop the local deployment a
// ticket is reviewed against. Tracked per-ticket so it can be torn down when the
// ticket ships, loops back, or is cancelled.
//
// Everything here is best-effort: if no command resolves, or it won't start, or
// the port never opens, the stage proceeds tests-only. A preview problem must
// NEVER fail the stage (spec).

const previews = new Map(); // ticketId -> { proc, url, command, port }

/**
 * Resolve how to start the preview: config.staging.previewCommand + previewPort
 * if set, else a cheap read-only agent inference. Returns { command, port,
 * source } with source "config" | "inferred" | "none".
 */
export async function resolvePreview({ cwd, signal }) {
  const s = getStaging();
  if (s.previewCommand && s.previewPort) {
    return { command: String(s.previewCommand), port: Number(s.previewPort), source: "config" };
  }

  const inferred = await askJson({
    prompt:
      "Infer how to start this project's local preview / dev server and the port it listens on, from its config (package.json scripts, framework config). " +
      'Respond with ONLY JSON: {"command": string|null, "port": number|null}. Use null if there is no runnable preview. No prose, no fences.',
    cwd,
    signal,
  }).catch(() => null);

  const command = typeof inferred?.command === "string" ? inferred.command.trim() : "";
  if (!command) return { command: null, port: s.previewPort ? Number(s.previewPort) : null, source: "none" };
  const port = Number.isInteger(inferred?.port) ? inferred.port : s.previewPort ? Number(s.previewPort) : null;
  return { command, port, source: "inferred" };
}

// Kill the whole process tree. A `shell:true` child on Windows is cmd.exe with
// the real server underneath it — proc.kill() would leave the grandchild (and
// the port) alive, so use taskkill /T there.
function killTree(proc) {
  if (!proc?.pid) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      proc.kill("SIGTERM");
    }
  } catch {
    /* already gone */
  }
}

// Best-effort wait until something accepts a TCP connection on the port.
function waitForPort(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const sock = net.connect({ host: "127.0.0.1", port }, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on("error", () => {
        sock.destroy();
        if (Date.now() > deadline) resolve(false);
        else setTimeout(attempt, 400);
      });
    };
    attempt();
  });
}

/**
 * Start (or restart) the preview for a ticket. Returns a status object; never
 * throws. `started:false` means nothing resolved — the card shows "no preview"
 * and the stage goes on.
 */
export async function startPreview(ticketId, { cwd, signal } = {}) {
  stopPreview(ticketId); // never two for one ticket

  const { command, port, source } = await resolvePreview({ cwd, signal });
  if (!command) return { started: false, reason: "no preview command resolved", source };

  let proc;
  try {
    proc = spawn(command, { cwd, shell: true });
  } catch (err) {
    return { started: false, reason: `spawn failed: ${err.message || err}`, source };
  }
  proc.on("error", () => {}); // a preview that fails to launch must not crash the stage
  proc.stdout?.on("data", () => {});
  proc.stderr?.on("data", () => {});

  const url = port ? `http://localhost:${port}` : null;
  previews.set(ticketId, { proc, url, command, port });

  const reachable = port ? await waitForPort(port) : false;
  return { started: true, url, command, port, source, reachable };
}

export function stopPreview(ticketId) {
  const p = previews.get(ticketId);
  if (!p) return false;
  killTree(p.proc);
  previews.delete(ticketId);
  return true;
}

export function previewInfo(ticketId) {
  const p = previews.get(ticketId);
  return p ? { url: p.url, command: p.command, port: p.port } : null;
}

/** Tear down every preview — used when the dashboard process shuts down. */
export function stopAllPreviews() {
  for (const id of [...previews.keys()]) stopPreview(id);
}
