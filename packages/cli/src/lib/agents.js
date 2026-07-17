import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { agentsDir, ensureOuroDir } from "./paths.js";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";

// Agents are plain markdown on disk — `.ouro/agents/<id>.md` — so they're
// diffable, reviewable in a PR, and editable in your editor without ouro
// running. The dashboard is just one writer among several; every read goes
// back to the filesystem rather than an in-memory cache, so a file edited
// behind ouro's back shows up on the next request instead of being clobbered.

export const TOOL_UNIVERSE = ["Read", "Grep", "Glob", "Edit", "Write", "Bash", "WebFetch", "WebSearch"];

// Tools that can mutate the worktree or reach the network. Surfaced with a
// warning affordance in the UI so granting them is a deliberate act.
export const DANGER_TOOLS = new Set(["Edit", "Write", "Bash", "WebFetch", "WebSearch"]);

const DEFAULT_MODEL = "sonnet";
const DEFAULT_GLYPH = "◆";
const DEFAULT_TOOLS = ["Read", "Grep", "Glob", "Edit", "Write", "Bash"];

export const agentEvents = new EventEmitter();

/** `Senior Engineer` -> `senior-engineer`. Also the filename stem. */
export function slugify(name) {
  const slug = String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "agent";
}

function agentPath(id) {
  return path.join(agentsDir(), `${id}.md`);
}

/** Guards against `id` escaping .ouro/agents via `../` or an absolute path. */
function assertSafeId(id) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(id ?? ""))) {
    throw new Error(`Invalid agent id: ${id}`);
  }
}

function toAgent(id, text) {
  const { data, body } = parseFrontmatter(text);
  const tools = Array.isArray(data.tools)
    ? data.tools
    : typeof data.tools === "string" && data.tools.trim()
      ? data.tools.split(/[,\s]+/).filter(Boolean)
      : DEFAULT_TOOLS;

  return {
    id,
    name: data.name || id,
    glyph: data.glyph || DEFAULT_GLYPH,
    description: data.description || "",
    model: data.model || DEFAULT_MODEL,
    tools,
    systemPrompt: body,
  };
}

export function listAgents() {
  ensureOuroDir();
  let files = [];
  try {
    files = fs.readdirSync(agentsDir()).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }

  return files
    .map((file) => {
      const id = file.replace(/\.md$/, "");
      try {
        return toAgent(id, fs.readFileSync(path.join(agentsDir(), file), "utf-8"));
      } catch {
        return null; // an unreadable file shouldn't blank the whole list
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getAgent(id) {
  assertSafeId(id);
  try {
    return toAgent(id, fs.readFileSync(agentPath(id), "utf-8"));
  } catch {
    return null;
  }
}

/** Raw file text — backs the dashboard's "edit as .md" mode. */
export function getAgentRaw(id) {
  assertSafeId(id);
  try {
    return fs.readFileSync(agentPath(id), "utf-8");
  } catch {
    return null;
  }
}

function write(id, text) {
  ensureOuroDir();
  fs.writeFileSync(agentPath(id), text);
  const agent = getAgent(id);
  agentEvents.emit("change", { type: "agent", agent, id });
  return agent;
}

/** Writes hand-authored markdown through verbatim, after a parse sanity check. */
export function saveAgentRaw(id, text) {
  assertSafeId(id);
  parseFrontmatter(text); // throws only on truly broken input; keeps bad files out
  return write(id, text);
}

export function saveAgent(id, patch) {
  assertSafeId(id);
  const current = getAgent(id);
  if (!current) return null;

  const next = { ...current, ...patch };
  return write(
    id,
    stringifyFrontmatter(
      {
        name: next.name,
        glyph: next.glyph,
        description: next.description,
        model: next.model,
        tools: next.tools,
      },
      next.systemPrompt
    )
  );
}

export function createAgent({ name }) {
  ensureOuroDir();
  const base = slugify(name);

  // Never overwrite an existing agent — suffix until the name is free.
  let id = base;
  for (let i = 2; fs.existsSync(agentPath(id)); i++) id = `${base}-${i}`;

  return write(
    id,
    stringifyFrontmatter(
      {
        name: name || id,
        glyph: DEFAULT_GLYPH,
        description: "",
        model: DEFAULT_MODEL,
        tools: DEFAULT_TOOLS,
      },
      `You are ${name || id}. Describe how this agent should work here — this body is sent to the model as its system prompt.`
    )
  );
}

export function deleteAgent(id) {
  assertSafeId(id);
  try {
    fs.unlinkSync(agentPath(id));
    agentEvents.emit("change", { type: "agent-deleted", id });
    return true;
  } catch {
    return false;
  }
}

// Shipped defaults. Written only when `.ouro/agents/` has no files at all, so
// `ouro init` in an existing repo never resurrects an agent you deleted.
const SEEDS = [
  {
    id: "senior-engineer",
    data: {
      name: "Senior Engineer",
      glyph: "◆",
      description: "Ships production changes with minimal, well-tested diffs.",
      model: DEFAULT_MODEL,
      tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash"],
    },
    body: `You are a senior engineer working in an isolated git worktree.

Work to these standards:
- Read the surrounding code before you edit it. Match its idiom, naming, and comment density.
- Prefer the smallest diff that fully solves the ticket. No drive-by refactors.
- Never delete or weaken a test to make something pass.
- Run the relevant tests before you call the work done, and report what you ran.
- If the ticket is ambiguous, state the assumption you made in your final message rather than guessing silently.`,
  },
  {
    id: "bug-fixer",
    data: {
      name: "Bug Fixer",
      glyph: "▲",
      description: "Reproduces first, then fixes the root cause — not the symptom.",
      model: DEFAULT_MODEL,
      tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash"],
    },
    body: `You are a debugging specialist working in an isolated git worktree.

Method, in order:
1. Reproduce the bug and state the exact failing behaviour you observed.
2. Find the root cause. Trace it — do not pattern-match a plausible-looking fix.
3. Fix the cause, not the symptom. If the real fix is out of scope, say so explicitly.
4. Add or extend a test that fails before your change and passes after it.
5. Report the reproduction, the cause, and the fix separately in your final message.`,
  },
  {
    id: "reviewer",
    data: {
      name: "Reviewer",
      glyph: "○",
      description: "Read-only. Audits a diff for correctness and risk.",
      model: DEFAULT_MODEL,
      tools: ["Read", "Grep", "Glob"],
    },
    body: `You are a code reviewer. You have read-only tools — you cannot edit, and should not try.

Review for, in priority order:
1. Correctness bugs that would fail at runtime.
2. Missing or weakened test coverage.
3. Unnecessary complexity that a simpler construct would cover.

For each finding give: the file and line, what breaks, and the concrete input or state that triggers it. Skip anything you cannot substantiate — a speculative finding is worse than no finding.`,
  },
];

export function seedDefaultAgents() {
  ensureOuroDir();
  const existing = fs.existsSync(agentsDir()) ? fs.readdirSync(agentsDir()).filter((f) => f.endsWith(".md")) : [];
  if (existing.length > 0) return 0;

  for (const seed of SEEDS) {
    fs.writeFileSync(agentPath(seed.id), stringifyFrontmatter(seed.data, seed.body));
  }
  return SEEDS.length;
}

/** The agent a ticket runs as when it has no explicit assignment. */
export function defaultAgentId() {
  const all = listAgents();
  if (all.length === 0) return null;
  return (all.find((a) => a.id === "senior-engineer") ?? all[0]).id;
}
