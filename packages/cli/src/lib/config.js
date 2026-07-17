import fs from "node:fs";
import { configPath } from "./paths.js";

// `.ouro/config.json` is the one piece of state a human is expected to hand-edit,
// so reads are always fresh from disk and writes merge rather than replace —
// an unknown key someone added by hand survives a dashboard toggle.

const DEFAULTS = {
  version: 1,
  backend: "claude-code",
  defaultMode: "human", // safe default: plan first, write only after approval
  // Commit + push + open a PR automatically once a run finishes with changes.
  // On by default so a run ends somewhere a human can review it, rather than
  // as an unpushed branch in a local worktree. Set false to require the
  // explicit "Create PR" button instead — pushing is outward-facing, so this
  // is deliberately a knob and not a hardcode.
  autoShip: true,
  telegram: {
    botTokenEnvVar: "OURO_TELEGRAM_BOT_TOKEN",
    chatIdEnvVar: "OURO_TELEGRAM_CHAT_ID",
  },
};

export function readConfig() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configPath(), "utf-8")) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2));
  return next;
}

export const MODES = ["human", "agent"];

export function getDefaultMode() {
  const mode = readConfig().defaultMode;
  return MODES.includes(mode) ? mode : "human";
}

export function setDefaultMode(mode) {
  if (!MODES.includes(mode)) throw new Error(`Unknown mode: ${mode}`);
  writeConfig({ defaultMode: mode });
  return mode;
}

export function getAutoShip() {
  return readConfig().autoShip !== false;
}

export function setAutoShip(on) {
  writeConfig({ autoShip: Boolean(on) });
  return Boolean(on);
}
