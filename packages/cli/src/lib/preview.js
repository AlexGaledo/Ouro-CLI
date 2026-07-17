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

// Most dev servers (Next, Vite, CRA, ...) print the URL they actually bound
// once they're up — which can differ from the guessed port if it was taken
// (Next silently increments to the next free one). Sniffing stdout for that
// line is the only way to know the real port rather than trusting the guess.
const URL_IN_OUTPUT = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::(\d+))?/i;

function sniffUrl(proc, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (url) => {
      if (done) return;
      done = true;
      proc.stdout?.off("data", onData);
      resolve(url);
    };
    const onData = (chunk) => {
      const match = URL_IN_OUTPUT.exec(chunk.toString());
      if (match) finish(match[0].replace("0.0.0.0", "localhost"));
    };
    proc.stdout?.on("data", onData);
    setTimeout(() => finish(null), timeoutMs);
  });
}

/**
 * Start (or restart) the preview for a ticket. Returns a status object; never
 * throws. `started:false` means nothing resolved — the card shows "no preview"
 * and the stage goes on. `reachable:false` means it launched but never came up
 * (or came up on a port that never got confirmed) — callers must not surface
 * `url` to the UI in that case, it points at nothing trustworthy.
 */
export async function startPreview(ticketId, { cwd, signal } = {}) {
  stopPreview(ticketId); // never two for one ticket

  const { command, port: guessedPort, source } = await resolvePreview({ cwd, signal });
  if (!command) return { started: false, reason: "no preview command resolved", source };

  let proc;
  try {
    proc = spawn(command, { cwd, shell: true });
  } catch (err) {
    return { started: false, reason: `spawn failed: ${err.message || err}`, source };
  }
  proc.on("error", () => {}); // a preview that fails to launch must not crash the stage
  proc.stderr?.on("data", () => {});

  const timeoutMs = 15000;
  const [sniffed, portOpen] = await Promise.all([
    sniffUrl(proc, timeoutMs),
    guessedPort ? waitForPort(guessedPort, timeoutMs) : Promise.resolve(false),
  ]);
  // stdout gave us the real bound URL — trust it over the pre-spawn guess,
  // since that's the only way to catch Next.js et al. auto-incrementing off
  // an already-occupied port.
  const url = sniffed ?? (portOpen ? `http://localhost:${guessedPort}` : null);
  const port = sniffed ? Number(URL_IN_OUTPUT.exec(sniffed)?.[1] ?? guessedPort) : guessedPort;
  const reachable = Boolean(sniffed) || portOpen;

  previews.set(ticketId, { proc, url, command, port });
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
