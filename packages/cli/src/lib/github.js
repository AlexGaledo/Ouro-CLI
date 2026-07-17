import { spawn } from "node:child_process";

// Thin `gh` wrapper. Shelling out to the user's authenticated gh beats talking
// to the GitHub API directly: it means ouro never handles a GitHub token, and
// it inherits whatever auth, host, and enterprise config they already use.

const GH_BIN = process.env.OURO_GH_BIN || "gh";

function run(args, { cwd } = {}) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(GH_BIN, args, { cwd, env: process.env });
    } catch (err) {
      resolve({ code: -1, stdout: "", stderr: String(err.message || err) });
      return;
    }

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => (stdout += c));
    proc.stderr.on("data", (c) => (stderr += c));
    // ENOENT (gh not installed) lands here, not on close.
    proc.on("error", (err) => resolve({ code: -1, stdout, stderr: String(err.message || err) }));
    proc.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

export async function hasGh() {
  return (await run(["--version"])).code === 0;
}

export async function isAuthenticated() {
  return (await run(["auth", "status"])).code === 0;
}

/**
 * Opens a PR from an already-pushed branch. Returns `{ url }` on success, or
 * `{ error }` — never throws, because a failed PR must not lose the work that
 * was already committed and pushed.
 */
export async function createPullRequest({ cwd, base, head, title, body }) {
  const args = ["pr", "create", "--head", head, "--title", title, "--body", body];
  if (base) args.push("--base", base);

  const res = await run(args, { cwd });

  if (res.code === 0) {
    // gh prints the PR URL on stdout as its last line.
    const url = res.stdout.split(/\s+/).find((t) => t.startsWith("http"));
    return { url: url ?? res.stdout };
  }

  // A PR that already exists isn't a failure — surface the existing one.
  const combined = `${res.stderr}\n${res.stdout}`;
  const existing = combined.match(/https:\/\/\S*\/pull\/\d+/);
  if (existing) return { url: existing[0], existed: true };

  return { error: res.stderr || res.stdout || `gh exited ${res.code}` };
}
