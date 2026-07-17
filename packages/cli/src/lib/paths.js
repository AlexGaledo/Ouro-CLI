import path from "node:path";
import fs from "node:fs";

// ouro always operates relative to the repo it was invoked in (process.cwd()),
// mirroring how git/npm root-detect. Keeps the "installed in your repo" promise literal.
export function repoRoot() {
  return process.cwd();
}

export function ouroDir() {
  return path.join(repoRoot(), ".ouro");
}

export function configPath() {
  return path.join(ouroDir(), "config.json");
}

export function ticketsPath() {
  return path.join(ouroDir(), "tickets.json");
}

export function worktreesDir() {
  return path.join(ouroDir(), "worktrees");
}

// Agents are markdown files rather than rows in tickets.json so they can be
// edited in an editor and reviewed in a diff. See lib/agents.js.
export function agentsDir() {
  return path.join(ouroDir(), "agents");
}

// Daemon bookkeeping: one pid file and one log per background service.
// See lib/daemon.js.
export function runDir() {
  return path.join(ouroDir(), "run");
}

export function logsDir() {
  return path.join(ouroDir(), "logs");
}

// Secrets for the background services. The daemon outlives the shell that
// started it, so it can't rely on that shell's exported env — this is what a
// rebooted machine reads OURO_TELEGRAM_BOT_TOKEN back out of. Gitignored.
export function envPath() {
  return path.join(ouroDir(), ".env");
}

export function ensureOuroDir() {
  for (const dir of [ouroDir(), worktreesDir(), agentsDir(), runDir(), logsDir()]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

export function isInitialized() {
  return fs.existsSync(configPath());
}
