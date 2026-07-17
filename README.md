<div align="center">

<img src="assets/Ouro_banner.jpeg" alt="Ouro" width="840">

**Loop engineering for the repo you already have.**

Ouro roots into your repo and gives you a kanban board, a Telegram intake agent,
and coding agents that finish the loop — ticket in, pull request out.
It runs on the **Claude Code** or **Codex** subscription you're already paying
for. No API key.

<br>

[![License: MIT](https://img.shields.io/badge/License-MIT-8b5cf6?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-8b5cf6?style=flat-square)](https://nodejs.org)
[![Backends](https://img.shields.io/badge/backends-Claude%20Code%20%7C%20Codex-8b5cf6?style=flat-square)](#status-of-the-two-backends)
[![No API key](https://img.shields.io/badge/API%20key-not%20required-c4b5fd?style=flat-square)](#why-ouro)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-c4b5fd?style=flat-square)](#contributing)

</div>

---

## Contents

- [Why ouro](#why-ouro)
- [Quickstart](#quickstart)
- [The board](#the-board)
- [How it works](#how-it-works)
- [A run ends in a PR](#a-run-ends-in-a-pr)
- [Running it 24/7](#running-it-247)
- [Agents are markdown](#agents-are-markdown)
- [Telegram is an intake agent, not a webhook](#telegram-is-an-intake-agent-not-a-webhook)
- [CLI reference](#cli-reference)
- [Configuration](#configuration)
- [Status of the two backends](#status-of-the-two-backends)
- [Known gaps](#known-gaps)
- [Demo script](#demo-script)
- [Contributing](#contributing)
- [License](#license)

---

## Why ouro

Most agent tooling wants an `ANTHROPIC_API_KEY` and bills you a second time for
tokens you already pay a subscription for. Ouro drives the **Claude Code** and
**Codex** CLIs in headless mode instead, so it runs on the plan you already
have — and because it talks to two CLIs rather than one API, it isn't locked to
a single vendor. Toggle between them live, from the dashboard header.

What you get:

- **A board that runs things.** Not a tracker you update by hand — pressing
  **Run** on a card spawns a real agent in a real worktree.
- **Runs that end in a PR.** A branch nobody can see isn't finished work.
- **Agents that are files.** `.ouro/agents/*.md` — edit in the dashboard or in
  vim, review them in a diff like anything else.
- **Intake that interviews.** The Telegram bot asks the reporter what actually
  broke before it files anything.
- **Isolation by default.** Every run happens in its own `git worktree` on a
  throwaway branch. Never your live branch.
- **Single-operator, local-first.** One Node process. No auth, no cloud, no
  telemetry.

## Quickstart

**Requirements:** Node ≥ 20, `git`, and one of:

- [`claude`](https://claude.com/claude-code) installed and logged in (default), or
- [`codex`](https://developers.openai.com/codex/cli) installed and logged in (`codex login`, ChatGPT sign-in)

Optionally [`gh`](https://cli.github.com) to open PRs for you.

```bash
git clone https://github.com/SPlinterRed/ouro-v2
cd ouro-v2

npm install
npm run bundle                      # build dashboard + copy into the CLI package
npm link --workspace=packages/cli   # makes `ouro` available globally
```

Then, **in the repo you want to loop-engineer**:

```bash
ouro init        # writes .ouro/config.json + agents/*.md
ouro start       # dashboard + intake agent, detached
```

That's it — <http://localhost:4747> is your board. File a ticket, pick an agent,
hit **Run**, and watch tool calls stream into the terminal dock as it works.

> **Telegram intake is optional.** To enable it, get a bot token from
> [@BotFather](https://t.me/BotFather) and drop it in `.ouro/.env` *before*
> `ouro start`:
>
> ```bash
> echo 'OURO_TELEGRAM_BOT_TOKEN=<token>' >> .ouro/.env
> ```
>
> Secrets go in `.ouro/.env` (gitignored), **not** your shell profile — a
> detached daemon can't inherit exports from a terminal you've closed.

## The board

Tickets flow **Inbox → Triaged → In Progress → Review → Shipped**, and can be
**cancelled** at any point — cancelling SIGTERMs the live CLI child process, it
doesn't just flip a flag.

![The ouro board — five columns, a live agent run, and the terminal dock streaming its tool calls](docs/board.png)

The dashboard is dark-only and spends colour on exactly one thing. Everything
structural is violet; the **one bright, breathing element on the board is a live
agent run**, so a glance tells you whether anything is actually happening. Red
and amber survive only for failure and priority, because those have to shout
across a room. There is no green.

Each ticket runs in one of two modes, set board-wide from the header and
overridable per card:

- **Agent loop** — full autonomy, writes without pausing.
- **Human-in-the-loop** — plans read-only first, waits for **Approve**, then
  resumes the same session with write tools enabled.

Every agent run happens in its own `git worktree` under `.ouro/worktrees/`, on a
throwaway `ouro/<ticket-id>` branch — never on your live branch.

## How it works

One Node process, no separate frontend/backend deploy:

```
ouro dashboard
  └─ Express + WebSocket server (packages/cli)
       └─ serves the pre-built dashboard (packages/dashboard, Vite+React)
       └─ REST API + live WS push for ticket, agent, and run state
       └─ spawns the backend CLI per ticket, in an isolated git worktree
```

```
packages/
  cli/          the ouro command, the server, and the backend adapters
    src/lib/    claudeCodeExec.js / codexExec.js, worktree.js, ship.js, …
    src/server/ REST + WebSocket
  dashboard/    Vite + React board, built and copied into cli/dashboard-dist
```

A ticket's whole life is a file (`.ouro/tickets.json`) plus a child process.
There's no database: a hackathon-scale board doesn't need one, and it means
`ouro init` pulls in zero external services.

## A run ends in a PR

When a run finishes with changes, ouro commits them on `ouro/<ticket-id>`,
pushes the branch, and opens a PR with `gh` — the ticket lands in **Shipped**
with the PR link on the card. A finished run that stops at an unpushed branch in
a local worktree isn't finished; it's work nobody can see.

Every stage narrates itself into the terminal dock alongside the agent's tool
calls, and every failure keeps the work:

| What's missing | What happens |
| --- | --- |
| No git remote | Commits locally, stays in Review, says so |
| Push rejected | Commit kept, stays in Review with git's message |
| `gh` not installed | Branch pushed, you open the PR yourself |
| Agent changed nothing | No PR — marked done, nothing to review |

Failed ships stay in Review with a **Retry PR** button, so a fixed remote or a
fresh `gh auth login` doesn't mean re-running the agent.

Pushing is outward-facing, so it's a knob rather than a hardcode — set
`"autoShip": false` in `.ouro/config.json` to require the explicit **Create PR**
button instead. The PR targets whatever branch HEAD was on when the worktree was
cut, captured then rather than guessed at ship time.

## Running it 24/7

```bash
ouro start      # dashboard + intake agent, detached — survives closing the terminal
ouro status     # what's up, for how long, on which port
ouro logs -f    # follow both services
ouro stop       # stops both, and kills any agent runs they own
ouro restart
```

`start` verifies rather than asserts: it polls the dashboard's API and checks the
pid answering is the one it just spawned (another ouro on the port would
otherwise answer the probe and make a dead child look healthy), and it confirms
the intake agent survived its token check. Anything that didn't come up prints
that run's log tail inline instead of claiming success.

`stop` kills the whole process tree — a plain kill would orphan a running
`claude` child to burn subscription tokens with nothing watching it. A ticket
left mid-run is reconciled to `cancelled` on the next start, since its process is
gone and can't be reattached.

Logs live in `.ouro/logs/`, rotating at 5MB. `.ouro/.gitignore` keeps runtime
state (`run/`, `logs/`, `worktrees/`, `.env`, `tickets.json`) out of your repo
while leaving `agents/*.md` and `config.json` tracked — those are the point.

## Agents are markdown

Agents live in `.ouro/agents/*.md` — YAML frontmatter plus a body that becomes
the system prompt. Edit them in the dashboard (structured fields or raw `.md`) or
in your editor; the dashboard hot-reloads either way, and they diff in a PR like
any other file.

![The agents screen — structured fields on the right, backed 1:1 by a markdown file on disk](docs/agents.png)

```markdown
---
name: Senior Engineer
glyph: ◆
description: Ships production changes with minimal, well-tested diffs.
model: sonnet
tools: [Read, Grep, Glob, Edit, Write, Bash]
---

You are a senior engineer working in an isolated git worktree.
Prefer the smallest diff that fully solves the ticket. Never delete a test...
```

`ouro init` seeds three: **Senior Engineer**, **Bug Fixer**, **Reviewer**. Assign
one per ticket from the card or the new-ticket form.

`tools` is enforced on the Claude Code backend via `--allowedTools`. Codex has no
per-tool grant model — there the sandbox mode governs writes, so the list is
advisory. A read-only phase (triage, plan) intersects the agent's grants with
read-only tools, so an agent granted `Write` still can't write while planning.

## Telegram is an intake agent, not a webhook

`ouro listen` runs a customer-facing agent. It interviews the reporter — what's
the observed behaviour, expected, repro, impact — drafts a ticket, shows it to
them, and only posts to the board once they confirm. A raw one-liner never lands
on the board un-clarified.

```
them: the login button is broken
bot:  What happens when you click it — nothing, an error, or does it spin?
them: on mobile safari it sits half off the right edge, tapping does nothing
bot:  Just the login screen, or other pages too? Does desktop look right?
them: only safari on iphone. chrome desktop is fine.
bot:  Here's what I've got: [drafted ticket] — Create this ticket? (yes / no)
```

Caps at 4 questions, then drafts from whatever it has. `/new` restarts, `/cancel`
drops it. If the model is unreachable it still files the raw transcript rather
than stranding the reporter.

## CLI reference

| Command | What it does |
| --- | --- |
| `ouro init [--backend claude-code\|codex]` | Configure the current repo — writes `.ouro/config.json` and seeds `agents/*.md` |
| `ouro start [-p <port>] [--no-listen]` | Start dashboard + intake in the background |
| `ouro stop` | Stop both, and kill any agent runs they own |
| `ouro restart [-p <port>] [--no-listen]` | Stop, then start |
| `ouro status` | What's running, for how long, on which port |
| `ouro logs [dashboard\|listen] [-f] [-n <n>]` | Show/follow background service logs |
| `ouro dashboard [-p <port>] [--no-open]` | Run the dashboard in the foreground |
| `ouro listen` | Run the Telegram intake agent in the foreground |

`ouro dashboard` and `ouro listen` run either service in the foreground, which is
what you want when debugging one that won't stay up.

## Configuration

`.ouro/config.json` is the one piece of state you're expected to hand-edit.
Reads are always fresh from disk and writes merge rather than replace, so a key
you add by hand survives a dashboard toggle.

```jsonc
{
  "version": 1,
  // "claude-code" | "codex" — also switchable live from the dashboard header
  "backend": "claude-code",
  // "human" = plan, wait for Approve, then write. "agent" = full autonomy.
  "defaultMode": "human",
  // Commit + push + open a PR automatically when a run finishes with changes.
  // false requires the explicit "Create PR" button instead.
  "autoShip": true,
  "telegram": {
    "botTokenEnvVar": "OURO_TELEGRAM_BOT_TOKEN",
    "chatIdEnvVar": "OURO_TELEGRAM_CHAT_ID"
  }
}
```

Switching backend from the header rewrites this file and takes effect on the next
run — no restart. Equivalent to:

```bash
curl -X POST localhost:4747/api/config/backend \
  -H 'Content-Type: application/json' -d '{"backend":"codex"}'
```

Secrets live in `.ouro/.env` (gitignored), read by the detached daemon at start:

| Variable | Purpose |
| --- | --- |
| `OURO_TELEGRAM_BOT_TOKEN` | Bot token from [@BotFather](https://t.me/BotFather). Required for `ouro listen`. |
| `OURO_TELEGRAM_CHAT_ID` | Optional. Restricts intake to one chat. |

## Status of the two backends

- **Claude Code — verified against a live run** (CLI 2.1.212). The event shapes
  parsed in `src/lib/claudeCodeExec.js` (`system`/`assistant`/`user`/`result`,
  `message.content[].tool_use`, `session_id`) match real `--output-format
  stream-json --verbose` output, and a full ticket → worktree → streamed tool
  calls → diff → review round-trip works.
- **Codex — still unverified.** `src/lib/codexExec.js` parses fields (`type`,
  `item.text`, `session_id`) from docs, not a confirmed live schema. Run
  `codex exec --json "say hello"` once and diff the real output against
  `parseLine()` before trusting the Codex toggle.

## Known gaps

Kept honest and up to date. These are the things that would bite you.

- The human-in-the-loop flow is a two-phase **plan → approve → execute** call,
  not a live mid-run pause — headless mode in both CLIs fails an unapproved
  action rather than blocking on it, so a single call can't pause cleanly.
- No auth/multi-user — this is single-operator, local-only by design.
- **`gh pr create` against a real GitHub remote is unverified.** Commit, push,
  and every failure path are exercised; opening an actual PR has only been
  tested against a local bare remote, where `gh` correctly refuses. The first
  real run is the one that proves it.
- `ouro stop` only manages what `ouro start` started. A dashboard launched by
  hand (`ouro dashboard`) has no pid file — `start` will spot it holding the
  port and tell you, but won't adopt or kill it.
- `.ouro/worktrees/` isn't cleaned up automatically, and shipping doesn't prune
  the worktree either — the branch is pushed, but the local checkout stays.
  `removeTicketWorktree` in `src/lib/worktree.js` exists and nothing calls it.
- Human-in-the-loop resume assumes `ticket.worktree` is still the right cwd for
  the resumed session — true as long as the process hasn't restarted between
  run and approve.
- A ticket left `in_progress` by a killed dashboard is reconciled to
  `cancelled` at startup — the child process is gone and can't be reattached.
- `maxTurns` is deliberately absent: Claude Code 2.1.212 has no `--max-turns`
  flag, and a UI control that silently does nothing is worse than none.

## Demo script

1. `ouro start` — then close the terminal. It's still running.
2. Telegram: "the login button is broken." Watch the bot *interview* you instead
   of filing it — then confirm the draft.
3. Card appears in Inbox with a real summary and priority.
4. Pick an agent on the card, leave the header on **Agent loop**, hit **Run** —
   watch live tool calls stream into the terminal dock as it edits files in an
   isolated worktree, then commit, push, and open a PR. Click through to it.
5. Start a second, longer ticket and hit **Cancel run** — the child process dies
   mid-flight and the card lands in cancelled with a reason.
6. Switch to **Human-in-loop**, run a third → card pauses with a plan, click
   **Approve & continue** → it resumes, finishes, and ships.
7. Open **Agents**, edit `senior-engineer.md` in the raw view, save — then
   `cat .ouro/agents/senior-engineer.md` to show it's just a file.
8. Close with: "runs entirely on the subscription I'm already paying for — zero
   API key, and it's not locked to one vendor's CLI."

## Contributing

Issues and PRs welcome. Two things worth knowing before you start:

```bash
npm run dev:dashboard   # Vite dev server, proxies /api + /ws to localhost:4747
ouro dashboard          # run the real server alongside it, in another terminal
npm run bundle          # rebuild + copy dist into the CLI before testing `ouro` itself
```

- **The dashboard is served pre-built.** If you change `packages/dashboard` and
  test via the `ouro` command rather than the Vite dev server, run
  `npm run bundle` first or you'll be looking at a stale bundle.
- **The design system is documented in `packages/dashboard/src/index.css`.** It
  has one rule worth respecting: brightness is the signal, and a live agent run
  is the only thing allowed at the top of the ladder. If you're reaching for a
  new colour, read the header comment first.

If you get `gh pr create` working against a real GitHub remote, please say so in
an issue — it's the one path in [Known gaps](#known-gaps) that only a real run
can close.

## License

[MIT](LICENSE) © 2026 Alex Galedo
