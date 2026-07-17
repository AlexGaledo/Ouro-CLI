import fs from "node:fs";
import { configPath } from "./paths.js";
import * as codex from "./codexExec.js";
import * as claudeCode from "./claudeCodeExec.js";

const BACKENDS = {
  codex,
  "claude-code": claudeCode,
};

export function getBackendName() {
  try {
    const config = JSON.parse(fs.readFileSync(configPath(), "utf-8"));
    return BACKENDS[config.backend] ? config.backend : "claude-code";
  } catch {
    return "claude-code";
  }
}

export function setBackendName(name) {
  if (!BACKENDS[name]) throw new Error(`Unknown backend: ${name}`);
  const config = JSON.parse(fs.readFileSync(configPath(), "utf-8"));
  config.backend = name;
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
  return name;
}

function backend() {
  return BACKENDS[getBackendName()];
}

// Unified interface — every route calls through here instead of importing
// codexExec/claudeCodeExec directly, so switching backends is a one-line
// config change picked up on the next call.
export const analyze = (args) => backend().analyze(args);
// Read-only exploration returning raw markdown. Backs `ouro init --spec`.
export const generateSpec = (args) => backend().generateSpec(args);
export const runAgent = (args) => backend().runAgent(args);
export const planTicket = (args) => backend().planTicket(args);
export const executeTicket = (args) => backend().executeTicket(args);
// Read-only, JSON-in/JSON-out. Backs the Telegram intake interview, which
// needs a cheap per-turn decision rather than a full agent run.
export const askJson = (args) => backend().askJson(args);
