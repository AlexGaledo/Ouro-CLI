import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createTicketWorktree, diffWorktree } from "../src/lib/worktree.js";

// worktree.js resolves every path from process.cwd(), so these tests build a
// throwaway git repo in a tmp dir and chdir into it, restoring cwd after.

function git(cwd, ...args) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ouro-wt-"));
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.email", "t@t.t");
  git(dir, "config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "file.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-m", "init");
  fs.mkdirSync(path.join(dir, ".ouro", "worktrees"), { recursive: true });
  return dir;
}

// The regression: an agent that COMMITS its work inside the worktree leaves a
// clean working tree, so a HEAD-relative diff showed nothing and QA bounced the
// change back through the loop. diffWorktree must diff against the fork point.
test("diffWorktree sees changes the agent committed in the worktree", async () => {
  const cwd = process.cwd();
  const repo = makeRepo();
  try {
    process.chdir(repo);
    const { dir, base } = await createTicketWorktree("abc12345");

    fs.writeFileSync(path.join(dir, "file.txt"), "one\ntwo\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-m", "agent change");

    const diff = await diffWorktree("abc12345", base);
    assert.ok(diff, "a committed change should still produce a diff");
    assert.match(diff, /\+two/);
  } finally {
    process.chdir(cwd);
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// The untracked edge: a run whose only output is a brand-new file the agent
// never `git add`ed. `git diff` alone never lists it — it must be folded in.
test("diffWorktree sees a brand-new untracked file", async () => {
  const cwd = process.cwd();
  const repo = makeRepo();
  try {
    process.chdir(repo);
    const { dir, base } = await createTicketWorktree("newfile1");

    fs.writeFileSync(path.join(dir, "tsconfig.json"), '{"strict": true}\n');

    const diff = await diffWorktree("newfile1", base);
    assert.ok(diff, "a new untracked file should produce a diff");
    assert.match(diff, /new file/);
    assert.match(diff, /tsconfig\.json/);
    assert.match(diff, /\+\{"strict": true\}/);
  } finally {
    process.chdir(cwd);
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// The original happy path — uncommitted edits — must keep working too.
test("diffWorktree sees uncommitted changes in the worktree", async () => {
  const cwd = process.cwd();
  const repo = makeRepo();
  try {
    process.chdir(repo);
    const { dir, base } = await createTicketWorktree("def67890");

    fs.writeFileSync(path.join(dir, "file.txt"), "one\nthree\n");

    const diff = await diffWorktree("def67890", base);
    assert.ok(diff, "an uncommitted change should produce a diff");
    assert.match(diff, /\+three/);
  } finally {
    process.chdir(cwd);
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
