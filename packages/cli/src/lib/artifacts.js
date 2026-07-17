import fs from "node:fs";
import path from "node:path";
import { contextDir, repoRoot } from "./paths.js";

// The artifacts system — a shared, per-run context payload.
//
// One folder (.ouro/context/), one manifest. ouro guarantees *discoverability*:
// every run gets the folder path plus a manifest — the filenames, each with a
// one-line description — injected into its prompt. The agent controls
// *consumption*: it reads only what it judges relevant via its normal Read tool.
// We never dump file contents into the prompt. That's the whole point — it keeps
// context lean and lets self-describing filenames do the routing.
//
// Nothing is copied. Root convention files (CLAUDE.md / AGENTS.md) that the
// underlying CLIs already auto-read stay where they are; copying CLAUDE.md into
// the folder would just create two sources of truth that drift.

// Root convention files, referenced in place (never copied) and surfaced in the
// artifacts UI so "everything the agent can see" is one view.
const REFERENCED_FILENAMES = ["CLAUDE.md", "AGENTS.md", "CLAUDE.local.md"];

/**
 * A one-line description for a context file: its frontmatter `description:` if
 * present, else its first meaningful line (heading hashes stripped). Best-effort
 * and truncated — this is a manifest label, not the file.
 */
function describeFile(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }

  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    const m = fm[1].match(/^description:\s*(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "").slice(0, 140);
  }

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line === "---") continue;
    return line.replace(/^#+\s*/, "").slice(0, 140);
  }
  return "";
}

/** Files dropped in .ouro/context/, each with a one-line description. */
export function listContextFiles() {
  let names = [];
  try {
    names = fs.readdirSync(contextDir()).filter((f) => !f.startsWith("."));
  } catch {
    return []; // no context dir yet — nothing to advertise
  }

  return names
    .map((name) => {
      const full = path.join(contextDir(), name);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        return null;
      }
      if (!stat.isFile()) return null;
      return { name, description: describeFile(full), size: stat.size };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Root convention files that exist — referenced in place, not copied. */
export function listReferencedFiles() {
  return REFERENCED_FILENAMES.filter((name) => fs.existsSync(path.join(repoRoot(), name))).map((name) => ({
    name,
    path: name,
  }));
}

/**
 * The manifest string injected into a run's prompt. Manifest-only: folder path,
 * filenames, one-line descriptions — never file contents. Returns "" when the
 * folder is empty, so callers can concatenate unconditionally.
 */
export function contextManifest() {
  const files = listContextFiles();
  if (files.length === 0) return "";

  const lines = [
    "Shared context files live in .ouro/context/. They are listed here, NOT included — read any that look relevant with your Read tool:",
  ];
  for (const f of files) {
    lines.push(`- .ouro/context/${f.name}${f.description ? ` — ${f.description}` : ""}`);
  }
  return lines.join("\n");
}
