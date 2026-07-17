import fs from "node:fs";
import path from "node:path";
import { contextDir } from "./paths.js";

// ouro-log.md — a human-readable run history. Not a git-log clone: the skimmable
// summary for people who don't want to read git history.
//
// One entry per run, appended at run end regardless of outcome (shipped, failed,
// no-change, cancelled — all recorded). Templated from ticket state ouro already
// holds — NOT an extra LLM call. It lives in .ouro/context/, so it's both a
// viewable log AND an auto-attached artifact (cross-ticket memory), and it's
// committed (see .ouro/.gitignore) as team memory that travels with the repo.
//
// Populated post-`ouro init` only — there is no retrace of prior git history.

const LOG_FILENAME = "ouro-log.md";

const HEADER = `# ouro run log

Skimmable run history — one line per run, newest at the bottom of each day.
Templated from ticket state (not an LLM call) and committed as team memory.
`;

function logPath() {
  return path.join(contextDir(), LOG_FILENAME);
}

export function logFilename() {
  return LOG_FILENAME;
}

function modeLabel(mode) {
  return mode === "agent" ? "agent loop" : "human-in-loop";
}

function prNumber(url) {
  const m = String(url || "").match(/\/pull\/(\d+)/);
  return m ? `#${m[1]}` : null;
}

// File count from the stored unified diff — one "diff --git" line per file. Kept
// here rather than re-shelling to git so the log never depends on the worktree
// still existing at write time.
function fileCount(diff) {
  if (!diff) return 0;
  return (diff.match(/^diff --git /gm) || []).length;
}

/**
 * Append one entry for a finished run. `outcome` is the short result phrase;
 * PR link and file count are derived from the ticket. Best-effort: a failure to
 * write the log (e.g. .ouro/context/ absent pre-init) never fails the run.
 */
export function appendRunLog(ticket, outcome, when = new Date()) {
  if (!ticket) return;
  try {
    const dateStr = when.toISOString().slice(0, 10); // YYYY-MM-DD
    const timeStr = when.toTimeString().slice(0, 5); // HH:MM (local)

    const bits = [outcome];
    const pr = prNumber(ticket.prUrl);
    if (pr) bits.push(`PR ${pr}`);
    const files = fileCount(ticket.diff);
    if (files) bits.push(`${files} file${files === 1 ? "" : "s"}`);

    const title = String(ticket.title ?? "").replace(/\s+/g, " ").trim() || "(untitled)";
    const entry = `- **${timeStr}** · [#${ticket.id}] ${title} · ${modeLabel(ticket.mode)}\n  → ${bits.join(" · ")}\n`;

    let existing;
    try {
      existing = fs.readFileSync(logPath(), "utf-8");
    } catch {
      existing = HEADER; // first write seeds the header
    }

    // A fresh date header only when today isn't already present.
    const needsDateHeader = !existing.includes(`\n## ${dateStr}\n`);
    fs.writeFileSync(logPath(), existing + (needsDateHeader ? `\n## ${dateStr}\n` : "") + entry);
  } catch {
    // Logging is memory, not control flow — never let it break a run.
  }
}

/** Raw markdown of the log, or "" if it doesn't exist yet. Backs the Logs tab. */
export function readRunLog() {
  try {
    return fs.readFileSync(logPath(), "utf-8");
  } catch {
    return "";
  }
}
