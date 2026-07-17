import { store } from "./store.js";
import { commitWorktree, pushTicketBranch, hasRemote, branchFor, worktreePath, worktreeChanges } from "./worktree.js";
import { hasGh, createPullRequest } from "./github.js";

// Turning a finished run into a reviewable PR.
//
// Before this, a run ended in the Staging column with a diff living in a local
// worktree on an unpushed branch — real work in a place nobody else could see.
// Shipping is the step that makes it a thing a human can actually review.
//
// Each stage logs to the ticket, so the terminal dock narrates the push and PR
// the same way it narrates the agent's tool calls. Every failure mode leaves
// the ticket in `staging` with the work intact: committing and pushing are
// worth keeping even when the PR itself can't be opened.

function commitMessage(ticket) {
  const subject = ticket.title.length > 68 ? `${ticket.title.slice(0, 67)}…` : ticket.title;
  const body = [ticket.summary, ticket.body].filter(Boolean).join("\n\n");
  return `${subject}\n\n${body}\n\nTicket: ${ticket.id} (ouro)`.trim();
}

function prBody(ticket) {
  const lines = [];
  if (ticket.summary) lines.push(ticket.summary, "");
  if (ticket.body) lines.push(ticket.body, "");
  lines.push("---", "");
  lines.push(`Filed via ouro · ticket \`${ticket.id}\` · source: ${ticket.source}`);
  if (ticket.agentId) lines.push(`Implemented by the \`${ticket.agentId}\` agent.`);
  lines.push("", "🤖 Generated with [Claude Code](https://claude.com/claude-code)");
  return lines.join("\n");
}

/**
 * Commit → push → open PR. Returns a result object rather than throwing; the
 * caller (a route, or the end of a run) reports it.
 */
export async function shipTicket(ticketId) {
  const ticket = store.get(ticketId);
  if (!ticket) return { ok: false, error: "not found" };

  const log = (text, type = "ship") => store.appendLog(ticketId, { type, text });

  // 1. Is there anything to ship?
  let changed;
  try {
    changed = await worktreeChanges(ticketId);
  } catch (err) {
    log(`No worktree to ship from: ${err.message || err}`, "error");
    return { ok: false, error: "no worktree" };
  }

  if (changed.length === 0 && !ticket.diff) {
    log("Nothing to ship — the agent changed no files.");
    store.update(ticketId, { status: "done", shipNote: "No file changes — nothing to open a PR for." });
    return { ok: true, empty: true };
  }

  // 2. Commit.
  let commit;
  try {
    commit = await commitWorktree(ticketId, commitMessage(ticket));
    if (commit.committed) log(`✓ committed ${commit.files.length} file(s) on ${branchFor(ticketId)}`);
    else log("Already committed — nothing new to add.");
  } catch (err) {
    log(`Commit failed: ${err.message || err}`, "error");
    return { ok: false, error: `commit failed: ${err.message || err}` };
  }

  // 3. Push. Without a remote there's nothing to open a PR against, but the
  //    commit above still stands — the branch is there locally.
  if (!(await hasRemote())) {
    const note = "No git remote — committed locally, but there's nowhere to push or open a PR.";
    log(note, "warn");
    store.update(ticketId, { shipNote: note });
    return { ok: false, error: "no remote", committed: true };
  }

  try {
    await pushTicketBranch(ticketId);
    log(`✓ pushed ${branchFor(ticketId)} to origin`);
  } catch (err) {
    const msg = String(err.message || err).split("\n").slice(0, 3).join(" ");
    log(`Push failed: ${msg}`, "error");
    store.update(ticketId, { shipNote: `Push failed: ${msg}` });
    return { ok: false, error: `push failed: ${msg}`, committed: true };
  }

  // 4. PR.
  if (!(await hasGh())) {
    const note = "Branch pushed, but the GitHub CLI (gh) isn't installed — open the PR yourself.";
    log(note, "warn");
    store.update(ticketId, { status: "done", shipNote: note });
    return { ok: false, error: "gh missing", pushed: true };
  }

  const result = await createPullRequest({
    cwd: worktreePath(ticketId),
    base: ticket.baseBranch ?? undefined,
    head: branchFor(ticketId),
    title: ticket.title,
    body: prBody(ticket),
  });

  if (result.error) {
    const msg = result.error.split("\n").slice(0, 3).join(" ");
    log(`PR failed: ${msg}`, "error");
    store.update(ticketId, { shipNote: `Branch pushed, but gh couldn't open the PR: ${msg}` });
    return { ok: false, error: `pr failed: ${msg}`, pushed: true };
  }

  log(`✓ ${result.existed ? "PR already open" : "opened PR"} · ${result.url}`, "ship-done");
  store.update(ticketId, { status: "done", prUrl: result.url, shipNote: null });
  return { ok: true, url: result.url };
}
