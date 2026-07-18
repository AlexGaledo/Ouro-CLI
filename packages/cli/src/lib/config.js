import fs from "node:fs";
import { configPath } from "./paths.js";
import { maskToken } from "./telegram.js";

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
  // Ceiling on agent-loop QA loop-back re-runs (enterStaging) before the ticket
  // escalates to a human — a safety valve against a runaway loop that keeps
  // failing QA and re-running the (expensive) engineer forever.
  maxQaAttempts: 3,
  telegram: {
    botTokenEnvVar: "OURO_TELEGRAM_BOT_TOKEN",
    chatIdEnvVar: "OURO_TELEGRAM_CHAT_ID",
  },
  // Staging stage (Feature 9). All null by default: ouro resolves the test and
  // preview commands from the repo when these aren't set, so a fresh repo needs
  // zero config. Set them to pin exact commands. previewPort is where the
  // preview is expected to listen (used to build the clickable URL).
  staging: {
    testCommand: null,
    lintCommand: null,
    buildCommand: null,
    previewCommand: null,
    previewPort: null,
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

export const DEFAULT_TELEGRAM_TOKEN_VAR = "OURO_TELEGRAM_BOT_TOKEN";

const ENV_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The *name* of the env var holding the bot token — never the token itself.
 *
 * Returns `{ name, error? }`. The error case is a real one people hit: the key
 * reads like somewhere to put a token, so a token goes in it, and every caller
 * then looks up process.env["8123:AA…"], finds undefined, and reports
 * "8123:AA… is not set" — which blames the token for the config's mistake.
 * Worse, config.json is committed on purpose (that's the point of
 * agents-as-files), so a token parked here is a token headed for git history.
 */
export function telegramTokenVar() {
  const value = readConfig().telegram?.botTokenEnvVar;
  if (!value) return { name: DEFAULT_TELEGRAM_TOKEN_VAR };
  if (ENV_VAR_NAME.test(value)) return { name: value };

  // Newlines rather than one long string: this is printed to a terminal by two
  // commands and rendered in the dashboard, and none of them own a wrapper.
  return {
    name: DEFAULT_TELEGRAM_TOKEN_VAR,
    error: [
      `.ouro/config.json has telegram.botTokenEnvVar set to "${maskToken(value)}".`,
      `That field takes the NAME of the env var holding your token — "${DEFAULT_TELEGRAM_TOKEN_VAR}" — not the token itself.`,
      `config.json is committed on purpose, so treat that token as exposed: revoke it via @BotFather, set the field back`,
      `to "${DEFAULT_TELEGRAM_TOKEN_VAR}", and put the new token in .ouro/.env (gitignored) or the dashboard's Settings screen.`,
    ].join("\n"),
  };
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

export function getMaxQaAttempts() {
  const n = readConfig().maxQaAttempts;
  return Number.isInteger(n) && n >= 1 ? n : 3;
}

/** Staging config, each field null when unset (ouro then resolves it per-repo). */
export function getStaging() {
  const s = readConfig().staging ?? {};
  return {
    testCommand: s.testCommand ?? null,
    lintCommand: s.lintCommand ?? null,
    buildCommand: s.buildCommand ?? null,
    previewCommand: s.previewCommand ?? null,
    previewPort: s.previewPort ?? null,
  };
}

export function setAutoShip(on) {
  writeConfig({ autoShip: Boolean(on) });
  return Boolean(on);
}
