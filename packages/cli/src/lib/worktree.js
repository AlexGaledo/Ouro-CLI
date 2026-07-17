import path from "node:path";
import fs from "node:fs";
import simpleGit from "simple-git";
import { repoRoot, worktreesDir } from "./paths.js";

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

export async function diffWorktree(ticketId) {
  const git = simpleGit(worktreePath(ticketId));
  // Include staged changes: an agent that ran `git add` would otherwise show
  // an empty diff and look like it did nothing.
  const [unstaged, staged] = await Promise.all([git.diff(), git.diff(["--cached"])]);
  return [staged, unstaged].filter(Boolean).join("\n") || null;
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
