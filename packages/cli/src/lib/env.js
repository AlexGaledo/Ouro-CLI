import fs from "node:fs";
import { envPath, ensureOuroDir } from "./paths.js";

// `.ouro/.env` — secrets for the background services.
//
// `ouro start` detaches the daemon from the shell that launched it, so the
// daemon can't inherit a token you only exported in that shell: close the
// terminal, or reboot, and `ouro listen` comes back up with no token and dies.
// A file the daemon reads at startup is what makes 24/7 actually 24/7.
//
// Gitignored by `ouro init` (see .ouro/.gitignore) — it holds a bot token.

// Group 1 is the `export ` prefix, kept so a rewrite can put it back — this is
// somebody's hand-written file, not a generated one.
const LINE = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;

function unquote(value) {
  const v = value.trim();
  if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) {
    return v.slice(1, -1);
  }
  // An unquoted trailing `# comment` isn't part of the value.
  return v.split(" #")[0].trim();
}

export function parseEnv(text) {
  const out = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const match = line.match(LINE);
    if (match) out[match[2]] = unquote(match[3]);
  }
  return out;
}

/**
 * Loads `.ouro/.env` into process.env. A real shell export always wins — if
 * you deliberately set a token for one invocation, a stale file shouldn't
 * silently override it.
 */
export function loadEnvFile() {
  let text;
  try {
    text = fs.readFileSync(envPath(), "utf-8");
  } catch {
    return {}; // no file is the normal case, not an error
  }

  const vars = parseEnv(text);
  for (const [key, value] of Object.entries(vars)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return vars;
}

export function hasEnvFile() {
  return fs.existsSync(envPath());
}

/** What's actually in the file, without touching process.env. */
export function readEnvVars() {
  try {
    return parseEnv(fs.readFileSync(envPath(), "utf-8"));
  } catch {
    return {};
  }
}

const HEADER = [
  "# ouro secrets — read by the background services at startup.",
  "# Gitignored (.ouro/.gitignore). Written by the dashboard's Settings screen,",
  "# and safe to hand-edit: comments and unknown keys survive a save.",
  "",
];

// Bare words don't need quoting; anything with whitespace, a `#`, or a quote
// would come back wrong through unquote(), so it goes through JSON.
function serialize(value) {
  const v = String(value);
  return /^[A-Za-z0-9_\-.:/@+=]*$/.test(v) ? v : JSON.stringify(v);
}

/**
 * Merges vars into `.ouro/.env`. A `null` value deletes the key.
 *
 * Rewrites lines in place rather than regenerating the file, because this file
 * has two authors: the dashboard and a human with an editor. Comments, order,
 * `export ` prefixes and keys ouro knows nothing about all outlive a save.
 */
export function writeEnvVars(patch) {
  ensureOuroDir();

  let existing = null;
  try {
    existing = fs.readFileSync(envPath(), "utf-8");
  } catch {
    // No file yet — the header is what tells whoever opens it later what it is.
  }

  const pending = new Map(Object.entries(patch));
  const next = [];

  for (const line of existing === null ? HEADER : existing.split(/\r?\n/)) {
    const match = line.trim().startsWith("#") ? null : line.match(LINE);
    const key = match?.[2];
    if (!key || !pending.has(key)) {
      next.push(line);
      continue;
    }
    const value = pending.get(key);
    pending.delete(key);
    if (value !== null) next.push(`${match[1]}${key}=${serialize(value)}`);
  }

  for (const [key, value] of pending) {
    if (value !== null) next.push(`${key}=${serialize(value)}`);
  }

  while (next.length && !next.at(-1).trim()) next.pop(); // no growing tail of blanks

  // 0600 applies on create only, which is the case that matters: a token
  // shouldn't land world-readable in the first place.
  fs.writeFileSync(envPath(), next.join("\n") + "\n", { mode: 0o600 });

  // The file and this process's env have to move together: everything here
  // reads tokens from process.env, and a service spawned after this call
  // inherits it (see lib/daemon.js). Unlike loadEnvFile, an explicit save wins
  // over a shell export — you just told us what the token is.
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete process.env[key];
    else process.env[key] = String(value);
  }

  return readEnvVars();
}
