import { spawn } from "node:child_process";
import { getStaging } from "./config.js";
import { askJson } from "./agentBackend.js";

// Staging checks. ouro runs the deterministic checks (test, lint, build) and the
// QA agent judges the result — so the commands have to be resolved and run here,
// not left to the agent's Bash tool (QA is read-only by design).
//
// Resolution order per check: config.staging.<kind>Command if set, else a cheap
// read-only agent inference from the repo. If nothing resolves, that check is
// reported as not-run — the QA gate treats a check with no command in the repo
// as N/A, never a failure, so a repo without a linter or build step still ships.

// One entry per deterministic check. `configKey` is the config.staging field
// that pins the command; `infer` is the read-only prompt used when it isn't set.
const CHECKS = [
  {
    kind: "test",
    configKey: "testCommand",
    infer:
      "Infer the single shell command that runs this project's automated tests, from its config (package.json scripts, Makefile, pyproject, etc.). " +
      'Respond with ONLY JSON: {"command": string|null}. Use null if the repo has no test setup. No prose, no fences.',
  },
  {
    kind: "lint",
    configKey: "lintCommand",
    infer:
      'Infer the single shell command that lints this project, from its config (a package.json "lint" script, eslint/ruff/flake8 config, etc.). ' +
      'Respond with ONLY JSON: {"command": string|null}. Use null if the repo has no linter. No prose, no fences.',
  },
  {
    kind: "build",
    configKey: "buildCommand",
    infer:
      'Infer the single shell command that builds or compiles this project, from its config (a package.json "build" script, tsc, a bundler config, etc.). ' +
      'Respond with ONLY JSON: {"command": string|null}. Use null if the repo has no build step. No prose, no fences.',
  },
];

/**
 * Resolve one check's command. Returns { command, source } where source is
 * "config" | "inferred" | "none".
 */
async function resolveCommand({ configKey, infer, cwd, signal }) {
  const configured = getStaging()[configKey];
  if (configured) return { command: String(configured), source: "config" };

  const inferred = await askJson({ prompt: infer, cwd, signal }).catch(() => null);
  const command = typeof inferred?.command === "string" ? inferred.command.trim() : "";
  return { command: command || null, source: command ? "inferred" : "none" };
}

/**
 * Run a shell command, capturing output. Bounded by a timeout so a hanging
 * check can't wedge the stage. Never rejects — a spawn error resolves as a
 * failed result the QA agent can read.
 */
export function runShell(command, { cwd, signal, timeoutMs = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    // shell:true so a full command string ("npm test", "pytest -q") runs as-is.
    // windowsHide: the shell child is cmd.exe on win32 — without it every check
    // run (and every QA loop-back retry) flashes a console window.
    const proc = spawn(command, { cwd, shell: true, signal, windowsHide: true });

    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
    }, timeoutMs);

    proc.stdout?.on("data", (d) => (stdout += d.toString()));
    proc.stderr?.on("data", (d) => (stderr += d.toString()));

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, passed: false, stdout, stderr: `${stderr}${err.message || err}` });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, passed: code === 0, stdout, stderr });
    });
  });
}

// Keep only the tail — the QA agent and the card need the verdict-relevant end
// of the output (failures, summary line), not a multi-thousand-line firehose.
function tail(text, lines = 40) {
  return String(text || "")
    .trim()
    .split("\n")
    .slice(-lines)
    .join("\n");
}

/**
 * Resolve + run one check. `ran: false` means no command resolved — the QA gate
 * reads that as N/A for this repo, never a failure.
 */
async function runOne(check, { cwd, signal }) {
  const { command, source } = await resolveCommand({ ...check, cwd, signal });
  if (!command) {
    return { kind: check.kind, ran: false, command: null, source, passed: null, output: `No ${check.kind} command resolved for this repo.` };
  }

  const res = await runShell(command, { cwd, signal });
  return {
    kind: check.kind,
    ran: true,
    command,
    source,
    passed: res.passed,
    code: res.code,
    output: tail(`${res.stdout}\n${res.stderr}`),
  };
}

/**
 * Run every deterministic check (test, lint, build), in order. Sequential so
 * build and test don't race on the same worktree. Returns { test, lint, build },
 * each a structured result for the card and the QA agent. Honors `signal` —
 * once aborted, remaining checks are skipped as not-run.
 */
export async function runChecks({ cwd, signal }) {
  const out = {};
  for (const check of CHECKS) {
    out[check.kind] = signal?.aborted
      ? { kind: check.kind, ran: false, command: null, source: "none", passed: null, output: "cancelled" }
      : await runOne(check, { cwd, signal });
  }
  return out;
}
