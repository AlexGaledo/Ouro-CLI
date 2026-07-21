# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What ouro is

Ouro is a CLI that roots into an existing repo and gives it a kanban board plus coding agents. You file a ticket, an agent implements it in an isolated git worktree, a QA gate validates the running result, and it opens a PR. It drives the **Claude Code** or **Codex** CLI you're already logged into — there is no `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` and no direct API calls. Agents are spawned as headless subprocesses (`claude -p … --output-format stream-json`).

Published to npm as `@splinterzzz/ouro`; the binary is `ouro`.

## Critical: ouro operates on `process.cwd()`, not on this repo

`paths.js#repoRoot()` returns `process.cwd()`. Every `.ouro/` path, worktree, and ticket store is relative to **wherever `ouro` was invoked** — the target repo, not the ouro source tree. When developing ouro, run the `ouro` command from a *separate throwaway repo*; running it inside `ouro-cli` itself would make ouro manage its own source. The `.ouro/` directory at this repo root is this project's own dogfooding state, not fixtures.

## Commands

Run from the monorepo root.

```bash
npm install                 # workspaces: packages/cli + packages/dashboard
npm run bundle              # build dashboard + copy it into the CLI (see below)
npm run link:cli            # make `ouro` global (npm link the cli workspace)
npm run lint                # eslint . — correctness rules, not formatting
npm test                    # node --test packages/cli/test/*.test.js
node --test packages/cli/test/agents.test.js   # a single test file
```

There is no build step for the CLI itself (plain ESM, run directly). Tests use the Node built-in test runner (`node:test` + `node:assert/strict`) and cover only pure lib units (`slugify`, frontmatter parsing) — there is no server/integration harness.

### The bundle step is not optional

The CLI serves a **pre-built** dashboard from `packages/cli/dashboard-dist/`, and that directory is what gets published (`files: ["src", "dashboard-dist"]`). It is produced by:

```
npm run build:dashboard   # vite build -> packages/dashboard/dist
node scripts/bundle-dashboard.js   # copy dist -> packages/cli/dashboard-dist
```

`npm run bundle` does both. **Re-run it after any change under `packages/dashboard/`** or the served UI is stale. On publish, the cli workspace's `prepublishOnly` runs the same two steps.

### Dashboard dev loop (HMR)

`packages/dashboard/vite.config.js` proxies `/api` and `/ws` to `http://localhost:4747`. So:

1. Start the Express server on 4747 — `ouro dashboard` from a target repo (foreground).
2. `npm run dev:dashboard` — Vite HMR server, talks to that backend through the proxy.

This avoids re-bundling on every UI edit; bundle only when you're done.

## Architecture

Two workspaces:

- **`packages/cli`** — the `ouro` binary, an Express + WebSocket server, and all agent orchestration. Plain ESM, no transpile.
- **`packages/dashboard`** — a React 18 + Vite SPA (Zustand for state). Build-only artifact; the CLI serves it.

### CLI entry and commands

`src/index.js` is a commander program (`init`, `start`/`stop`/`restart`, `status`, `logs`, `dashboard`, `listen`, `upgrade`). `src/commands/*.js` implement them. `start` spawns the `dashboard` and `listen` services as **detached background processes** via `lib/daemon.js`; the foreground `dashboard`/`listen` commands are the same services run attached, for debugging.

`loadEnvFile()` runs before any command — the detached daemon can't inherit shell exports, so `.ouro/.env` is the source of truth for secrets (a real export still wins).

### The backend abstraction — the key seam

Every agent call goes through `lib/agentBackend.js`, which delegates to `lib/claudeCodeExec.js` or `lib/codexExec.js` based on `config.backend`. **Never import the exec modules directly** from routes — going through `agentBackend` is what makes the backend a one-line, next-call config switch. The two exec modules implement the same contract: `analyze`, `runAgent`, `planTicket`, `executeTicket`, `qaReview`, `generateSpec`, `askJson`.

Each exec module spawns the CLI, parses newline-delimited `stream-json` events, forwards them to `onEvent`, and threads an `AbortSignal` straight into `spawn()` so cancellation SIGTERMs the child. **Claude Code is verified against live runs; Codex is not** — several `stream-json` field-name assumptions are documented as unverified in code comments (`claudeCodeExec.js`, `codexExec.js`, `dashboard/src/lib/exchange.js`). Preserve those caveats.

Read-only vs. write phases are enforced by `--allowedTools`, not a sandbox. `agentFlags(agent, restrictTo)` **intersects** the agent's granted tools with what the phase permits, so Analyze/Plan/QA stay read-only (`Read/Grep/Glob`) even if the agent file grants `Write`. The agent file can widen what's possible, never widen past a read-only phase. `tools: ["*"]` means fully unrestricted — only honored outside a read-only phase.

### Ticket lifecycle (orchestrated in `src/server/index.js`)

Statuses: `inbox → analyzed → in_progress → staging → done | cancelled` (`store.js#STATUSES`). Legacy names are forward-migrated on load. The orchestration lives in `createServer()` as three factored functions plus a chainer:

- **`runAnalyze`** — read-only Analyst pass at the repo root. Produces `summary`, `priority`, `filesLikelyAffected`, and **`acceptanceCriteria`** — the contract everything downstream is judged against.
- **`runImplementation`** — cuts the worktree, then either runs the agent straight into Staging (agent mode) or plans and waits for approval (human mode).
- **`enterStaging`** — the QA gate. Runs deterministic checks (`lib/staging.js`: test/lint/build), stands up a preview (`lib/preview.js`), lets the read-only Senior QA Engineer judge the running result, and applies the gate. Agent mode: ready→ship, not-ready→loop back into the *same worktree* with QA feedback, escalate to a human after `maxQaAttempts`. Human mode: post the verdict and wait for `qa/approve`/`qa/reject`.
- **`autoPipeline`** — agent-mode tickets chain `runAnalyze → runImplementation` on creation with no HTTP hop.

**Two modes** (`resolveMode`: ticket's own mode wins, else board default):
- `human` — plan (read-only) → wait for Approve → `executeTicket` resumes the same session with write tools (`--resume <sessionId>`). Note Claude Code can't `--resume` across the cwd change from Analyze (repo root) to run (worktree), so analysis findings travel as **prompt content** (`buildImplementationPrompt`), not a resumed session.
- `agent` — full autonomy, one call, `--permission-mode bypassPermissions`.

Untrusted input: ticket title/body originate from Telegram intake and are wrapped in `<<<TICKET … TICKET;` markers in prompts. This is why the QA agent is denied `Bash` — a prompt-injected ticket must not reach command execution through the validator.

### State and runtime

- **`lib/store.js`** — `TicketStore` (EventEmitter), a single JSON file (`.ouro/tickets.json`), one instance per dashboard process. Writes are **debounced** (250ms); every mutation broadcasts over WS immediately, so the UI is live regardless of when the file lands. On boot it **reconciles** stranded state: `in_progress → cancelled` (no live child to reattach), clears `analyzing` flags and dead preview URLs. It's deliberately a JSON file, not sqlite — keep it that way.
- **`lib/runs.js`** — in-flight run registry keyed by ticket id, one run per ticket, each with an `AbortController`. Cancellation is real (SIGTERM to the CLI child), not a flag.
- **`lib/worktree.js`** — every run gets its own `git worktree` on a throwaway `ouro/<id>` branch under `.ouro/worktrees/`. **The working branch is never touched.** Captures the base branch at cut time (HEAD may move by ship time). Uses `simple-git`.
- **`lib/ship.js`** — commit → push → open PR with `gh`. Every failure path keeps the commit and leaves the ticket in Staging with a reason.
- **`lib/daemon.js`** — pid-file + detached-spawn supervision (no pm2/systemd). Heavy Windows-specific handling: `tasklist` to cross-check recycled PIDs, `taskkill /T /F` to kill the whole agent process tree, `windowsHide` to suppress console flashes. Touch carefully cross-platform.
- **`lib/agents.js`** — agents are `.ouro/agents/<id>.md` (YAML frontmatter + body → system prompt), read from disk on every request so an editor edit isn't clobbered. `agentEvents` broadcasts changes to the UI whether the edit came from the dashboard or the filesystem.

### Dashboard

React SPA, Zustand stores in `src/store/`. `src/lib/exchange.js` is a **filter** over the already-parsed `stream-json` events on `ticket.log` — it decides what belongs in the inter-agent exchange view (messages + tool calls/results, reasoning dropped), per-backend. It captures nothing itself.

## Conventions

- **ESM only** (`"type": "module"`), Node ≥ 20, no TypeScript.
- ESLint is **correctness-focused, not style** — there is no Prettier. Don't add formatting rules; comments in `eslint.config.js` explain the deliberate rule choices (e.g. `ignoreRestSiblings` because `const { x, ...rest } = obj` to strip a key is an idiom here).
- **`.ouro/config.json` writes merge, they don't replace** (`lib/config.js`). A hand-added key survives a dashboard toggle. When patching a nested object (e.g. `telegram`), shallow-merge by hand — `writeConfig` only replaces top-level keys.
- The codebase carries dense "why" comments on the non-obvious decisions. Match that density and keep the existing caveats (unverified backends, Windows PID quirks, reconciliation-on-boot) rather than deleting them.
