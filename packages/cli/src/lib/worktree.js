import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import simpleGit from "simple-git";
import { repoRoot, worktreesDir } from "./paths.js";

const execFileP = promisify(execFile);

/**
 * Every ticket that goes into agent mode gets its own git worktree on a
 * throwaway branch. This means a live demo can show a real diff being
 * generated without any risk to the actual working tree mid-presentation,
 * and "Apply" is just a merge instead of hoping the agent didn't wander.
 */

export function branchFor(ticketId) {
  return `ouro/${ticketId}`;
}

export function worktreePath(ticketId) {
  return path.join(worktreesDir(), ticketId);
}

/** The branch the repo is on right now — the base a ticket branches from. */
export async function currentBranch() {
  try {
    return (await simpleGit(repoRoot()).revparse(["--abbrev-ref", "HEAD"])).trim();
  } catch {
    return null;
  }
}

export async function createTicketWorktree(ticketId) {
  const git = simpleGit(repoRoot());
  const branch = branchFor(ticketId);
  const dir = worktreePath(ticketId);

  // Captured before the worktree exists: this is what the PR should target,
  // and by ship time HEAD may have moved on.
  const base = await currentBranch();

  if (fs.existsSync(dir)) return { dir, branch, base };

  await git.raw(["worktree", "add", dir, "-b", branch]);
  return { dir, branch, base };
}

/** The commit the worktree branch forked from `base`, or null if unresolvable. */
async function mergeBase(git, base) {
  try {
    return (await git.raw(["merge-base", base, "HEAD"])).trim() || null;
  } catch {
    return null;
  }
}

/**
 * A "new file" diff block for one untracked path, via `git diff --no-index`
 * against the null device. That command exits 1 when the files differ — which
 * is always, here — so the diff arrives on stdout as a non-zero-exit "error".
 */
async function noIndexDiff(cwd, file) {
  try {
    const { stdout } = await execFileP("git", ["diff", "--no-index", "--", "/dev/null", file], {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    if (err.code === 1 && err.stdout) return err.stdout;
    // Binary, unreadable, or a real git error — skip this one file rather than
    // fail the whole diff over it.
    return "";
  }
}

/**
 * The full diff a run produced, relative to where the branch forked from `base`
 * (the ticket's baseBranch) — so it captures what the agent COMMITTED, not just
 * what it left uncommitted. A Senior Engineer with Bash often runs `git commit`
 * itself; that leaves a clean working tree, so a HEAD-relative `git diff` shows
 * nothing and the real change looks lost — QA sees "no diff" and bounces the
 * ticket back through the loop, and ship calls it empty. Diffing against the
 * fork point makes committed and uncommitted work look identical here.
 */
export async function diffWorktree(ticketId, base) {
  const dir = worktreePath(ticketId);
  const git = simpleGit(dir);

  const forkPoint = base ? await mergeBase(git, base) : null;
  // forkPoint..working-tree: every commit on the branch plus staged and unstaged
  // edits, in one diff. Fallback (unknown base / no merge-base, e.g. a detached
  // HEAD at cut time): working tree + index vs HEAD.
  const tracked = forkPoint
    ? await git.diff([forkPoint])
    : (await Promise.all([git.diff(["--cached"]), git.diff()])).filter(Boolean).join("\n");

  // `git diff` never lists untracked, un-added files, so a run whose only output
  // is a brand-new file the agent didn't `git add` would still look empty. Fold
  // each one in as its own "new file" block. `not_added` already excludes
  // gitignored paths, so an agent that ran `npm install` doesn't drag
  // node_modules in here.
  const untracked = await Promise.all(
    (await git.status()).not_added.map((f) => noIndexDiff(dir, f))
  );

  return [tracked, ...untracked].filter(Boolean).join("\n") || null;
}

/** Files the agent touched, staged or not. Empty means it changed nothing. */
export async function worktreeChanges(ticketId) {
  const status = await simpleGit(worktreePath(ticketId)).status();
  return [...new Set([...status.files.map((f) => f.path), ...status.not_added])];
}

/**
 * Commits everything the agent produced. Agents aren't asked to commit — their
 * prompt is about the work, not the plumbing — so ouro does it, which also
 * keeps the commit message consistent regardless of which agent ran.
 */
export async function commitWorktree(ticketId, message) {
  const git = simpleGit(worktreePath(ticketId));
  const changed = await worktreeChanges(ticketId);
  if (changed.length === 0) return { committed: false, files: [] };

  await git.add(["-A"]);
  await git.commit(message);
  return { committed: true, files: changed };
}

export async function hasRemote() {
  try {
    return (await simpleGit(repoRoot()).getRemotes(false)).length > 0;
  } catch {
    return false;
  }
}

/** Pushes the ticket branch and sets upstream. Throws with git's own message. */
export async function pushTicketBranch(ticketId) {
  const git = simpleGit(worktreePath(ticketId));
  const branch = branchFor(ticketId);
  await git.push(["-u", "origin", branch]);
  return branch;
}

export async function removeTicketWorktree(ticketId) {
  const git = simpleGit(repoRoot());
  await git.raw(["worktree", "remove", worktreePath(ticketId), "--force"]).catch(() => {});
}
