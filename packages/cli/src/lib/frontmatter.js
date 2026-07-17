// Minimal YAML-frontmatter parser/serializer.
//
// Deliberately not gray-matter: agent files are authored by ouro itself and
// only ever carry scalars and flat string lists, so a ~60-line reader beats a
// dependency here. It handles exactly what `.ouro/agents/*.md` can contain:
//
//   ---
//   name: Senior Engineer
//   tools: [Read, Edit, Write]     # inline list
//   aliases:                        # or block list
//     - se
//   ---
//   <body — the agent's system prompt>
//
// Anything richer (nested maps, multi-line scalars, anchors) is out of scope
// and parses as a plain string rather than throwing, so a hand-edited file can
// never take the dashboard down.

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function stripQuotes(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function coerce(value) {
  const raw = value.trim();
  if (raw === "") return "";
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null" || raw === "~") return null;
  // Inline list: [a, b, c]
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((item) => stripQuotes(item)).filter(Boolean);
  }
  // Unquoted numbers only — a quoted "42" stays a string on purpose.
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return stripQuotes(raw);
}

/**
 * Splits a markdown file into `{ data, body }`. A file with no frontmatter
 * fence is treated as all-body, so a bare prompt file still loads.
 */
export function parseFrontmatter(text) {
  const source = String(text ?? "");
  const match = source.match(FENCE);
  if (!match) return { data: {}, body: source.trim() };

  const data = {};
  const lines = match[1].split(/\r?\n/);
  let blockKey = null; // set while consuming a `key:` followed by `- item` lines

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const blockItem = line.match(/^\s*-\s+(.*)$/);
    if (blockItem && blockKey) {
      data[blockKey].push(stripQuotes(blockItem[1]));
      continue;
    }

    const pair = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!pair) continue;

    const [, key, rest] = pair;
    if (rest.trim() === "") {
      // `key:` with nothing after it opens a block list; if no `- item` lines
      // follow, it collapses to an empty array, which is the sane reading.
      blockKey = key;
      data[key] = [];
    } else {
      blockKey = null;
      data[key] = coerce(rest);
    }
  }

  return { data, body: source.slice(match[0].length).trim() };
}

function serializeValue(value) {
  if (Array.isArray(value)) return `[${value.join(", ")}]`;
  if (value === null || value === undefined) return "";
  // Numbers and booleans must stay bare — quoting them would round-trip back
  // as strings, and a `maxTurns` that reads as "40" instead of 40 fails the
  // Number.isFinite check in agents.js and silently drops the value.
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  const str = String(value);
  // Quote only when a bare scalar would re-parse as something other than the
  // string it is: a leading YAML sigil, or an embedded `: ` that would look
  // like a nested key.
  if (str === "" || /^[[\]{}#&*!|>'"%@`-]/.test(str) || /^-?\d+(\.\d+)?$/.test(str) || str.includes(": ")) {
    return JSON.stringify(str);
  }
  return str;
}

/** Inverse of parseFrontmatter — key order follows the object's own order. */
export function stringifyFrontmatter(data, body) {
  const lines = Object.entries(data)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${serializeValue(value)}`);
  return `---\n${lines.join("\n")}\n---\n\n${String(body ?? "").trim()}\n`;
}
