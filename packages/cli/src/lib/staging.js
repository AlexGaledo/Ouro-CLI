import { spawn } from "node:child_process";
import { getStaging } from "./config.js";
import { askJson } from "./agentBackend.js";

// Staging test execution. ouro runs the tests (deterministic capture) and the
// QA agent judges the result — so the test command has to be resolved and run
// here, not left to the agent's Bash tool.
//
// Resolution order: config.staging.testCommand if set, else a cheap read-only
// agent inference from the repo (package.json scripts, CLAUDE.md, etc.). If
// nothing resolves, the stage proceeds tests-only-absent — never a hard failure.

/**
 * Resolve the test command. Returns { command, source } where source is
 * "config" | "inferred" | "none".
 */
export async function resolveTestCommand({ cwd, signal }) {
  const configured = getStaging().testCommand;
  if (configured) return { command: String(configured), source: "config" };

  const inferred = await askJson({
    prompt:
      "Infer the single shell command that runs this project's automated tests, from its config (package.json scripts, Makefile, pyproject, etc.). " +
      'Respond with ONLY JSON: {"command": string|null}. Use null if the repo has no test setup. No prose, no fences.',
    cwd,
    signal,
  }).catch(() => null);

  const command = typeof inferred?.command === "string" ? inferred.command.trim() : "";
  return { command: command || null, source: command ? "inferred" : "none" };
}

/**
 * Run a shell command, capturing output. Bounded by a timeout so a hanging
 * suite can't wedge the stage. Never rejects — a spawn error resolves as a
 * failed result the QA agent can read.
 */
export function runShell(command, { cwd, signal, timeoutMs = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    // shell:true so a full command string ("npm test", "pytest -q") runs as-is.
    const proc = spawn(command, { cwd, shell: true, signal });

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
 * Resolve + run the tests. Returns a structured result for the card and the QA
 * agent. `ran: false` means no command resolved — the stage goes on tests-only-
 * absent, never failing on the absence itself.
 */
export async function runTests({ cwd, signal }) {
  const { command, source } = await resolveTestCommand({ cwd, signal });
  if (!command) {
    return { ran: false, command: null, source, passed: null, output: "No test command resolved for this repo." };
  }

  const res = await runShell(command, { cwd, signal });
  return {
    ran: true,
    command,
    source,
    passed: res.passed,
    code: res.code,
    output: tail(`${res.stdout}\n${res.stderr}`),
  };
}
