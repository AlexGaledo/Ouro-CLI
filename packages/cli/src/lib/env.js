import fs from "node:fs";
import { envPath } from "./paths.js";

// `.ouro/.env` — secrets for the background services.
//
// `ouro start` detaches the daemon from the shell that launched it, so the
// daemon can't inherit a token you only exported in that shell: close the
// terminal, or reboot, and `ouro listen` comes back up with no token and dies.
// A file the daemon reads at startup is what makes 24/7 actually 24/7.
//
// Gitignored by `ouro init` (see .ouro/.gitignore) — it holds a bot token.

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;

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
    if (match) out[match[1]] = unquote(match[2]);
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
