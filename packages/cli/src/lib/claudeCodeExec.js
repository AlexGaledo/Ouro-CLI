import { spawn } from "node:child_process";
import readline from "node:readline";

/**
 * NOTE, same caveat as codexExec.js: field names in Claude Code's
 * stream-json events (`type`, `subtype`, `session_id`, `result`) are based
 * on public docs, not verified against a live run in this environment.
 * Run `claude -p "say hello" --output-format stream-json --verbose` once and
 * diff against `parseLine()`/the close handler below before relying on this.
 */

const CLAUDE_BIN = process.env.OURO_CLAUDE_BIN || "claude";

const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"];
const DEFAULT_WRITE_TOOLS = ["Read", "Edit", "Write", "Bash", "Grep", "Glob"];
// QA inspects and can run commands (Bash) — to curl a preview, read rendered
// HTML — but never Write/Edit: it validates, it doesn't implement.
const QA_TOOLS = ["Read", "Grep", "Glob", "Bash"];

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return { type: "raw", text: line };
  }
}

/**
 * Turns an agent (from `.ouro/agents/*.md`) into CLI flags. `restrictTo`
 * intersects the agent's granted tools with what the phase permits, so a
 * plan phase stays read-only even if the agent is granted Write — the agent
 * file widens what's possible, never what a read-only phase allows.
 */
function agentFlags(agent, restrictTo) {
  if (!agent) {
    return restrictTo ? ["--allowedTools", restrictTo.join(",")] : [];
  }

  const granted = agent.tools?.length ? agent.tools : DEFAULT_WRITE_TOOLS;
  const allowed = restrictTo ? granted.filter((t) => restrictTo.includes(t)) : granted;

  const flags = [];
  if (allowed.length) flags.push("--allowedTools", allowed.join(","));
  if (agent.model) flags.push("--model", agent.model);
  // Append rather than replace: Claude Code's own system prompt carries the
  // tool contract, so blowing it away with --system-prompt breaks tool use.
  if (agent.systemPrompt?.trim()) flags.push("--append-system-prompt", agent.systemPrompt.trim());
  return flags;
}

function runClaude(args, { cwd, onEvent, signal } = {}) {
  return new Promise((resolve, reject) => {
    // `signal` wires cancellation straight to the child: aborting SIGTERMs the
    // CLI rather than leaving it running detached. See lib/runs.js.
    const proc = spawn(CLAUDE_BIN, args, { cwd, env: process.env, signal });

    const rl = readline.createInterface({ input: proc.stdout });
    let sessionId = null;
    let lastMessage = null;

    rl.on("line", (line) => {
      if (!line.trim()) return;
      const event = parseLine(line);
      if (event.session_id) sessionId = event.session_id;
      if (event.type === "result") {
        lastMessage = event.result ?? lastMessage;
      }
      onEvent?.(event);
    });

    let stderrBuf = "";
    proc.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString();
      onEvent?.({ type: "stderr", text: chunk.toString() });
    });

    proc.on("error", (err) => {
      // An abort surfaces here as ABORT_ERR — that's an expected cancel, not a
      // crash, so it resolves rather than rejecting into the route's catch.
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

/** Strips ``` fences a model sometimes wraps JSON in, then parses. */
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

/**
 * One-shot, read-only, JSON-in/JSON-out call. Backs the Telegram intake
 * interview (lib/intake.js), which needs a cheap turn-by-turn decision and no
 * repo writes. Returns null when the model didn't produce parseable JSON, so
 * callers decide the fallback rather than getting a half-object.
 */
export async function askJson({ prompt, cwd, signal }) {
  const { lastMessage } = await runClaude(
    ["-p", prompt, "--output-format", "stream-json", "--verbose", "--allowedTools", READ_ONLY_TOOLS.join(",")],
    { cwd, signal }
  );
  return parseJsonish(lastMessage);
}

/**
 * Analyze: a read-only agent pass (the Analyst agent) that scopes the ticket.
 * Read-only-ness comes from restricting --allowedTools — Claude Code has no
 * sandbox flag like Codex. The agent's tools are intersected with the read-only
 * set, so even a mis-granted Write can't take effect here. Streams events to
 * `onEvent` so the analysis is visible on the card like any other run, and
 * returns structured findings — crucially the acceptance criteria that plan/
 * execute and the QA gate are both held to.
 */
export async function analyze({ prompt, cwd, signal, agent, onEvent }) {
  const { lastMessage } = await runClaude(
    [
      "-p",
      `${prompt}\n\nRespond with ONLY a JSON object: {"summary": string, "priority": "low"|"medium"|"high", "files_likely_affected": string[], "acceptance_criteria": string[]}. Each acceptance_criteria item is a concrete, checkable definition-of-done statement a test or reviewer could mark pass/fail. No prose, no markdown fences.`,
      "--output-format",
      "stream-json",
      "--verbose",
      ...agentFlags(agent, READ_ONLY_TOOLS),
      ...(agent ? [] : ["--allowedTools", READ_ONLY_TOOLS.join(",")]),
    ],
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
}

/**
 * Agent mode: full autonomy, write tools allowed, no interactive approval.
 * Tools/model/system prompt come from the ticket's assigned agent .md.
 */
export function runAgent({ prompt, cwd, onEvent, signal, agent }) {
  return runClaude(
    [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      ...agentFlags(agent, null),
      ...(agent ? [] : ["--allowedTools", DEFAULT_WRITE_TOOLS.join(",")]),
      "--permission-mode",
      "bypassPermissions",
    ],
    { cwd, onEvent, signal }
  );
}

/**
 * Staging QA gate: the Senior QA Engineer agent validates the running result.
 * It gets inspect + Bash tools (curl the preview, read rendered HTML) but is
 * denied Write/Edit by the QA_TOOLS intersection, so it can't quietly patch the
 * work it's judging. Returns the parsed JSON verdict (null if unparseable).
 */
export async function qaReview({ prompt, cwd, signal, onEvent, agent }) {
  const { lastMessage } = await runClaude(
    [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      ...agentFlags(agent, QA_TOOLS),
      ...(agent ? [] : ["--allowedTools", QA_TOOLS.join(",")]),
      "--permission-mode",
      "bypassPermissions",
    ],
    { cwd, signal, onEvent }
  );
  return parseJsonish(lastMessage);
}

/**
 * Read-only run that returns the raw final message. Backs `ouro init --spec`
 * (reverse-engineering a CLAUDE.md): the agent explores but never writes — ouro
 * writes the file from what comes back, so "read-only" stays literally true.
 */
export async function generateSpec({ prompt, cwd, signal, onEvent }) {
  const { lastMessage } = await runClaude(
    ["-p", prompt, "--output-format", "stream-json", "--verbose", "--allowedTools", READ_ONLY_TOOLS.join(",")],
    { cwd, signal, onEvent }
  );
  return lastMessage;
}

/**
 * Human-in-the-loop, phase 1: plan only, read-only tools, no edits. Returns
 * the session_id so the UI can resume it once the person approves.
 */
export function planTicket({ prompt, cwd, onEvent, signal, agent }) {
  return runClaude(
    [
      "-p",
      `${prompt}\n\nDo NOT edit any files yet. First produce a short numbered plan of what you'd change and why.`,
      "--output-format",
      "stream-json",
      "--verbose",
      ...agentFlags(agent, READ_ONLY_TOOLS),
      ...(agent ? [] : ["--allowedTools", READ_ONLY_TOOLS.join(",")]),
    ],
    { cwd, onEvent, signal }
  );
}

/**
 * Human-in-the-loop, phase 2: resume the planning session with write tools
 * enabled, after the person clicks Approve.
 */
export function executeTicket({ cwd, sessionId, onEvent, signal, agent }) {
  return runClaude(
    [
      "--resume",
      sessionId,
      "-p",
      "Approved. Implement the plan now and run relevant tests.",
      "--output-format",
      "stream-json",
      "--verbose",
      ...agentFlags(agent, null),
      ...(agent ? [] : ["--allowedTools", DEFAULT_WRITE_TOOLS.join(",")]),
      "--permission-mode",
      "acceptEdits",
    ],
    { cwd, onEvent, signal }
  );
}
