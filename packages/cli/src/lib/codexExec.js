import { spawn } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * NOTE on the JSONL event shape: `codex exec --json` emits one JSON object
 * per line to stdout. Field names below (`type`, `item.text`, `msg`, etc.)
 * are based on public docs/community usage as of build time, not a locked
 * spec — Codex's event schema has moved before. First thing to do when you
 * sit down: run `codex exec --json "say hello"` once and diff the real
 * output against the parsing in `parseLine()` below, then adjust. Don't
 * build the rest of the pipeline on top of an unverified assumption here.
 */

const CODEX_BIN = process.env.OURO_CODEX_BIN || "codex";

const ANALYZE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    priority: { type: "string", enum: ["low", "medium", "high"] },
    files_likely_affected: { type: "array", items: { type: "string" } },
    // Checkable definition-of-done items. Plan/execute implement against these
    // and the QA gate validates against them, so they must be concrete.
    acceptance_criteria: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "priority", "files_likely_affected", "acceptance_criteria"],
  additionalProperties: false,
};

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    // Non-JSON stderr-ish noise sometimes rides along on stdout depending on
    // version; surface it as a raw event instead of crashing the parser.
    return { type: "raw", text: line };
  }
}

/**
 * Codex takes the agent's system prompt as a config override rather than a
 * flag, and has no per-tool grant model — the sandbox mode governs writes.
 * So an agent's tool list is advisory on this backend; it's the Claude Code
 * path (--allowedTools) where it's enforced.
 */
function agentFlags(agent) {
  if (!agent) return [];
  const flags = [];
  if (agent.model) flags.push("--model", agent.model);
  if (agent.systemPrompt?.trim()) {
    flags.push("-c", `experimental_instructions=${JSON.stringify(agent.systemPrompt.trim())}`);
  }
  return flags;
}

/**
 * Runs `codex exec` and streams parsed JSONL events to `onEvent`.
 * Resolves with { code, sessionId, lastMessage } when the process exits.
 */
function runCodexExec(args, { cwd, onEvent, signal } = {}) {
  return new Promise((resolve, reject) => {
    // `signal` makes cancellation kill the child process. See lib/runs.js.
    // windowsHide: keep the per-run child from flashing an empty console window
    // on Windows — output is piped and parsed here, not shown in a console.
    const proc = spawn(CODEX_BIN, args, { cwd, env: process.env, signal, windowsHide: true });

    const rl = readline.createInterface({ input: proc.stdout });
    let sessionId = null;
    let lastMessage = null;

    rl.on("line", (line) => {
      if (!line.trim()) return;
      const event = parseLine(line);
      if (event.session_id) sessionId = event.session_id;
      if (event.type === "result" || event.subtype === "success") {
        lastMessage = event.result ?? event.text ?? lastMessage;
      }
      onEvent?.(event);
    });

    let stderrBuf = "";
    proc.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString();
      onEvent?.({ type: "stderr", text: chunk.toString() });
    });

    proc.on("error", (err) => {
      // Abort is an expected cancel, not a crash — resolve so the route can
      // mark the ticket cancelled instead of erroring.
      if (err.name === "AbortError" || signal?.aborted) {
        resolve({ code: null, sessionId, lastMessage, stderr: stderrBuf, aborted: true });
        return;
      }
      reject(err);
    });

    proc.on("close", (code) => {
      resolve({ code, sessionId, lastMessage, stderr: stderrBuf, aborted: Boolean(signal?.aborted) });
    });
  });
}

function parseJsonish(text) {
  const cleaned = String(text ?? "").replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall back to the outermost {...} in case prose leaked in around it.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Read-only JSON-in/JSON-out call — backs the Telegram intake interview. */
export async function askJson({ prompt, cwd, signal }) {
  const { lastMessage } = await runCodexExec(["exec", prompt, "--json", "--sandbox", "read-only"], { cwd, signal });
  return parseJsonish(lastMessage);
}

/**
 * Analyze: read-only, schema-constrained call. Cheap, safe, no repo writes.
 */
export async function analyze({ prompt, cwd, signal, agent, onEvent }) {
  // os.tmpdir(), not a hardcoded /tmp — this has to work on Windows too. The
  // pid suffix keeps concurrent analyses off one another's schema file.
  const schemaPath = path.join(os.tmpdir(), `ouro-analyze-schema-${process.pid}.json`);
  fs.writeFileSync(schemaPath, JSON.stringify(ANALYZE_SCHEMA));

  try {
    const { lastMessage } = await runCodexExec(
      ["exec", prompt, "--json", "--sandbox", "read-only", "--output-schema", schemaPath, ...agentFlags(agent)],
      { cwd, signal, onEvent }
    );

    return (
      parseJsonish(lastMessage) ?? {
        summary: lastMessage ?? "(no summary returned)",
        priority: "medium",
        files_likely_affected: [],
        acceptance_criteria: [],
      }
    );
  } finally {
    fs.rmSync(schemaPath, { force: true });
  }
}

/**
 * Agent mode: full autonomy within the worktree, workspace-write sandbox,
 * auto-approved. `onEvent` should be wired to the ticket's log + WS broadcast.
 */
export function runAgent({ prompt, cwd, onEvent, signal, agent }) {
  return runCodexExec(
    ["exec", prompt, "--json", "--sandbox", "workspace-write", "--full-auto", ...agentFlags(agent)],
    { cwd, onEvent, signal }
  );
}

/**
 * Staging QA gate on the Codex backend. Read-only sandbox — Codex has no
 * per-tool grant, so read-only is how "validate, don't modify" is enforced (the
 * tests were already run by ouro). Returns the parsed JSON verdict.
 */
export async function qaReview({ prompt, cwd, signal, onEvent, agent }) {
  const { lastMessage } = await runCodexExec(["exec", prompt, "--json", "--sandbox", "read-only", ...agentFlags(agent)], {
    cwd,
    signal,
    onEvent,
  });
  return parseJsonish(lastMessage);
}

/**
 * Read-only run that returns the raw final message. Backs `ouro init --spec` —
 * the agent explores under a read-only sandbox and ouro writes the file, so
 * "read-only" holds literally.
 */
export async function generateSpec({ prompt, cwd, signal, onEvent }) {
  const { lastMessage } = await runCodexExec(["exec", prompt, "--json", "--sandbox", "read-only"], {
    cwd,
    signal,
    onEvent,
  });
  return lastMessage;
}

/**
 * Human-in-the-loop, phase 1: plan only, read-only sandbox, no writes.
 * Non-interactive headless mode can't reliably pause mid-run for approval
 * (an unapproved action just fails the run rather than blocking on it), so
 * instead we do two full calls: plan (read-only) -> show on card -> approve
 * -> execute (write-enabled, resumed from the same session).
 */
export function planTicket({ prompt, cwd, onEvent, signal, agent }) {
  return runCodexExec(
    [
      "exec",
      `${prompt}\n\nDo not edit any files yet. First produce a short numbered plan of what you'd change and why.`,
      "--json",
      "--sandbox",
      "read-only",
      ...agentFlags(agent),
    ],
    { cwd, onEvent, signal }
  );
}

/**
 * Human-in-the-loop, phase 2: resume the planning session with a
 * write-enabled sandbox, after the person clicks Approve.
 */
export function executeTicket({ cwd, sessionId, onEvent, signal, agent }) {
  return runCodexExec(
    [
      "exec",
      "resume",
      sessionId ?? "--last",
      "Approved. Implement the plan now and run relevant tests.",
      "--json",
      "--sandbox",
      "workspace-write",
      "--full-auto",
      ...agentFlags(agent),
    ],
    { cwd, onEvent, signal }
  );
}
