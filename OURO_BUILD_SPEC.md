# Ouro — Build Spec & Claude Code Prompt

This is the authoritative spec for the next batch of Ouro features. It is written
as **deltas on the current `AlexGaledo/Ouro-CLI` repo** (the one with
`ouro start/stop/status/logs`, agents-as-markdown, `autoShip`, the five-column
board, and the Senior Engineer / Bug Fixer / Reviewer agents). It is **not**
written against any earlier scaffold.

There are two parts:
- **Part 1 — Locked Decisions**: the reference. What was decided and why.
- **Part 2 — The Prompt for Claude Code**: paste this into Claude Code. It tells
  Claude Code to interview before building the risky parts, not one-shot everything.

---

## Part 1 — Locked Decisions

### Terminology changes
- **"triage" → "Analyze"** everywhere (the step, the column label, function/var names, prompts).
- **"Review" column → "Staging"**.
- Board columns become: **Inbox → Analyzed → In Progress → Staging → Shipped** (cancellable at any point, as today).

### Agents — one dedicated agent per pipeline stage
Current repo seeds: Senior Engineer, Bug Fixer, Reviewer. New model, per the
"each column its own agent" principle:

| Stage / Column | Agent | Job |
| --- | --- | --- |
| Analyze | **Analyst** *(new)* | Scope the ticket: summary, priority, files likely affected, and explicit acceptance criteria (definition of done). |
| In Progress | **Senior Engineer** / **Bug Fixer** *(existing)* | Implement the change **and write tests** for it. User picks one per ticket. |
| Staging | **Senior QA Engineer** *(new)* | Run tests, assess results + preview, decide ready-to-ship vs loop-back. |
| (code review, cross-cutting) | **Reviewer** *(existing)* | Reviews the code diff itself. |

> **INTERPRETATION TO CONFIRM:** This adds **two** new agents (Analyst + Senior QA
> Engineer), making 5 seeded total. If Alex only wants QA added (4 total) and wants
> the Analyze step to keep using a non-agent function, confirm before seeding Analyst.

### Feature 1 — Analyze → Plan session continuity (NEW, not in repo)
The Analyze step and the plan step currently would run as independent sessions,
re-exploring the codebase twice and discarding Analyze's findings. Fix: Analyze
returns its `session_id`; the plan step **resumes that session** (`--resume` /
`codex exec resume`) instead of starting cold. Fall back to a fresh call if the
ticket was never analyzed.

- **KNOWN RISK to verify live:** Analyze runs in the live repo (`process.cwd()`),
  but plan/execute run in the isolated worktree. Resuming a session while changing
  `cwd` between calls is unverified. Claude Code must test this on a real run and,
  if it breaks, fall back to passing Analyze's *findings* (summary + acceptance
  criteria) into a fresh plan prompt rather than resuming the session.

### Feature 2 — Reverse-engineer spec on init (NEW, not in repo)
`ouro init --spec`: if the repo has no `CLAUDE.md` / `AGENTS.md`, run a
**read-only** agent pass that explores the codebase and writes one. Best-effort,
never blocks init, skips cleanly if a spec file already exists or the pass fails.
- Honest caveat to document in output: a reverse-engineered spec describes what
  the code *currently does*, so it will faithfully document existing bugs as if
  intended. It's a starting point, not ground truth.

### Feature 3 — Artifacts system (NEW)
The agent's shared, per-run context payload. **One folder, one manifest, agent
chooses what to read.**

- **Folder: `.ouro/context/`**. Every run gets the folder path + a **manifest**
  injected into its prompt: the list of filenames, each with a one-line
  description (from file frontmatter or first line). The agent then reads only
  what it judges relevant via its normal Read tool — ouro guarantees
  *discoverability*, the agent controls *consumption* (prevents context bloat).
- **Injection is directory-level and manifest-only.** Do NOT dump file contents
  into the prompt. Inject: folder path + filenames + one-line descriptions.
- **No copying, reference in place.** If root `CLAUDE.md` / `AGENTS.md` / spec
  files exist, they stay where they are (the CLIs auto-read root convention files
  already). The artifacts system adds `.ouro/context/` on top for *extra* files.
  Never copy CLAUDE.md into the folder — that creates two drifting sources of truth.
- Self-describing filenames matter (they do the routing): `ouro-log.md`,
  `spec-*.md`, etc.

### Feature 4 — Artifacts UI tab (NEW)
A dashboard tab that shows **everything the agent can see as context**:
- Referenced-in-place files (root `CLAUDE.md`, `AGENTS.md`, any spec) — listed
  with their real path, read from that location, not duplicated.
- `.ouro/context/` folder contents — the droppable extra artifacts.
- The `ouro-log.md` (it lives in `.ouro/context/`, so it appears here too).
One view. No copy, no sync logic.

### Feature 5 — `ouro-log.md` (NEW)
Human-readable run history. **Not a git-log clone** — the skimmable summary for
people who don't want to read git history.
- **Location:** `.ouro/context/ouro-log.md` (so it's both a viewable log AND an
  auto-attached artifact = cross-ticket memory).
- **One entry per run**, appended at **run end regardless of outcome** (shipped,
  failed, no-change, cancelled — all recorded).
- **Populated post-`ouro init` only.** Does NOT retrace/backfill prior git history.
- **Templated from ticket state ouro already holds** (ticket id, title, mode,
  outcome, PR link, files changed) — NOT an extra LLM call.
- Example entry shape:
  ```
  ## 2026-07-18
  - **14:32** · [#a3f2] Fix mobile login button alignment · agent loop
    → tests passed · PR #14 · 3 files · shipped
  - **15:01** · [#b8e1] Add rate limiting to /api/tickets · human-in-loop
    → tests failed · looped back to In Progress
  ```
- **Committed** (see Feature 8 gitignore rules) — shared team memory that travels
  with the repo.

### Feature 6 — Logs UI tab (NEW)
Separate dashboard tab rendering `ouro-log.md`, human-readable. Distinct from the
Artifacts tab (which lists it as a file); this one renders it as the log view.

### Feature 7 — Live agent-exchange popup on the card (NEW)
Real-time view of **inter-agent discussion** during a run.
- **Anchored on the kanban card** as a popup that updates in real time (over the
  existing WS feed).
- **Shows:** agent→agent messages (the "interview and answers" — e.g. QA
  questioning the engineer, Analyze→plan handoff) and tool calls / tool results.
- **Hides:** thinking / reasoning tokens.
- **Implementation note:** this is a **filter on the stream-json events already
  parsed**, not a new capture system. The event stream already contains
  everything. Add a per-backend "is this a thinking/reasoning event" check in the
  normalizer (Claude Code and Codex label reasoning differently) and drop those;
  render message + tool events.
- In **human-in-loop** mode, this same popup is where the QA agent posts its
  review questions and where the user answers + hits approve/reject (see Feature 9).

### Feature 8 — Nested `.ouro/.gitignore` (NEW, safety-critical)
`ouro init` writes a `.gitignore` **inside `.ouro/`** (self-contained, doesn't
mutate the user's root gitignore). Use **ignore-all-then-unignore-safe**, never
the reverse:

```gitignore
# .ouro/.gitignore
# ignore everything by default
/*
# un-ignore only what's safe to commit
!agents/
!context/
!config.json
!.gitignore
# hard guard: secrets stay out even if a rule above is loosened later
.env
context/**/*.env
```

- Runtime state (`run/`, `logs/`, `worktrees/`, `tickets.json`, `.env`) stays ignored.
- `agents/`, `context/`, `config.json` are committed.
- The terminal `.env` guards are mandatory — they prevent a future careless edit
  from ever tracking the Telegram token.
- **The current repo gitignores the entire `.ouro/`. Do NOT simply un-ignore it
  wholesale — that risks committing `.env`.** Use the pattern above.

### Feature 9 — Staging stage (NEW, the big one)
When an In Progress run completes, the ticket moves to **Staging**, where the
**Senior QA Engineer** agent validates the running result before ship. The card
in Staging shows: test results + a preview (local deployment) link + visual
review (screenshot or HTML fallback).

**Tests:**
- Agents **write** tests during In Progress (Senior Engineer / Bug Fixer / QA).
- ouro **runs** them in Staging via a resolved command: **`config.testCommand`
  if set, else the agent-inferred command** (inferred from artifacts / CLAUDE.md).
- Results shown on the card.

**Preview (local deployment):**
- Resolve via **`config.previewCommand` + `config.previewPort` if set, else the
  agent infers and runs it.**
- If no command is resolvable → card shows "no preview configured" and the stage
  proceeds tests-only. **Never fail the stage just because preview couldn't start.**
- Preview URL is shown on the card as a clickable link.

**Visual review — screenshot-or-HTML fallback chain (Claude Code backend):**
1. If a screenshot skill/tool IS available to the backend → capture a screenshot
   of the preview, attach to the card.
2. If NO screenshot capability **and** the change touches UI → the QA agent reads
   the **rendered HTML and/or the diff of UI files** instead, and the card notes
   "reviewed via HTML, no screenshot available."
3. If NOT a UI change → skip visual review, tests-only.
- **UI-change detection is the agent's call from the diff** (files touched, e.g.
  `.jsx/.tsx/.css/.html`), not a config flag.
- **Full-agent-loop caveat (important):** in auto mode with no screenshot skill,
  the QA agent MUST fall back to analyzing the HTML — it cannot "see" and must not
  silently skip UI validation. HTML analysis is the required substitute.

**QA gate — outcomes:**
- **Agent-loop mode:** QA agent assesses tests + preview/visual, then decides:
  - **Ready** → proceed to ship / PR.
  - **Not ready** → **loop back to In Progress** for another engineer pass.
  - **Loop-stop guard:** if it fails QA a **second** time, **escalate to human
    regardless of mode** (don't loop forever — this is the "know when to stop"
    principle).
- **Human-in-loop mode:** QA agent does the same assessment, but instead of
  auto-deciding it **posts its findings + questions into the card popup (Feature 7)
  and requests approval**. User answers / approves / rejects there. Reject →
  loops back to In Progress.

### Feature 10 — Graphify stays OUT of ouro core
Do **not** add Graphify as an ouro dependency, install step, or init flag. It is
documented only as an **agent-md-level option**: a user who wants it installs it
themselves and references it in an agent's `tools:` or prompt body. Ouro core
stays dependency-free. (Rationale: ouro's pitch is one npm install, no extra
toolchain; a per-agent opt-in keeps that intact while still allowing it.)

### Cross-cutting design principles (from the alignment/context discussion)
Bake these into the relevant prompts:
- **Analyze must produce explicit acceptance criteria** (definition of done), not
  just a summary. Pass those criteria forward into plan/execute AND into the QA
  gate — QA validates against them. Vague goal in = ungameable success check out.
- **QA is an independent check.** It validates the *running result* against
  acceptance criteria, separate from Reviewer (which reads the diff). Two
  independent checks are harder to game than one pass grading itself.
- **The PR / human approval is the real terminal signal.** Keep it. Do not add
  auto-merge-if-tests-pass — that reintroduces reward-hacking.
- **Context discipline:** manifest-injection (not content-dumping) for artifacts;
  the QA gate and log entries are templated/compacted, not raw event dumps.

---

## Part 2 — The Prompt for Claude Code

> Paste everything below into Claude Code, in the Ouro-CLI repo.

---

You are working in the **Ouro-CLI** repo (loop-engineering CLI: repo-rooted kanban
+ agents on Claude Code / Codex subscriptions, no API key). I'm adding a batch of
features. The full spec is in `OURO_BUILD_SPEC.md` (Part 1) — read it first.

**Important working style for this task:**
- **Interview me before building the risky parts.** Do NOT one-shot the whole
  batch. For each ambiguous or environment-dependent piece flagged below, ask me,
  confirm, then build. I'd rather answer questions than unwind wrong guesses.
- Work in the existing architecture and conventions — match how the current
  agents-as-markdown, config-merge, WS-feed, and background-daemon code already
  work. Read the relevant existing files before changing them.
- Small, reviewable commits per feature. Tests where it makes sense.

**Build order (do them in this sequence, confirming as you go):**

1. **Terminology rename** — "triage" → "Analyze", "Review" column → "Staging".
   Columns: Inbox → Analyzed → In Progress → Staging → Shipped. Mechanical but
   touch prompts, labels, function/var names, and the board UI. Do this first so
   everything downstream uses the new names.

2. **Nested `.ouro/.gitignore`** (Feature 8) — safety-critical, do it early.
   Use the exact ignore-all-then-unignore-safe pattern in the spec, including the
   terminal `.env` guards. Confirm with me that this doesn't conflict with how the
   current root `.gitignore` handles `.ouro/`.

3. **Agents** (per spec table) — seed **Analyst** and **Senior QA Engineer** as
   new markdown agents. **CONFIRM WITH ME FIRST** whether I want both (5 total) or
   just QA (4 total) with Analyze staying a non-agent function.

4. **Analyze → plan session continuity** (Feature 1) — resume Analyze's session in
   the plan step. **This has a known risk:** Analyze runs in `process.cwd()`, plan
   runs in the worktree. **Test resuming across the cwd change on a real run.** If
   it breaks, fall back to passing Analyze's findings into a fresh plan prompt.
   Tell me which path worked.

5. **Artifacts system + UI tab** (Features 3, 4) — `.ouro/context/` folder,
   manifest-only injection (path + filenames + one-line descriptions, NOT
   contents), agent reads what it wants. UI tab lists in-place referenced files
   (root CLAUDE.md etc.) + folder contents. No copying.

6. **`ouro-log.md` + Logs UI tab** (Features 5, 6) — templated one-entry-per-run,
   appended at run end regardless of outcome, post-init only, no backfill, lives in
   `.ouro/context/`, committed. NOT an LLM call — template from ticket state.

7. **Live agent-exchange popup** (Feature 7) — card-anchored, real-time over the WS
   feed. Filter the already-parsed stream-json events: show message + tool events,
   drop thinking/reasoning. **Add a per-backend reasoning-event filter** — confirm
   with me you've correctly identified the reasoning event type for the Claude Code
   backend (test it against a real run's event stream and show me the event types
   you're dropping).

8. **`ouro init --spec`** (Feature 2) — read-only reverse-engineer of CLAUDE.md /
   AGENTS.md if missing. Best-effort, non-blocking, skip if exists.

9. **Staging stage** (Feature 9) — the big one, build last, in sub-steps:
   - Tests: agents write them in In Progress; ouro runs via `config.testCommand`
     else agent-inferred. **CONFIRM the config schema additions with me**
     (`testCommand`, `previewCommand`, `previewPort`) before writing them.
   - Preview: config-or-inferred, graceful skip if unresolvable, clickable URL on card.
   - Visual review fallback chain: screenshot-skill-if-available → else HTML
     analysis on UI changes → else tests-only. **Before building this, tell me what
     screenshot capability (if any) you can actually detect/use on the Claude Code
     backend** — this determines whether step 1 of the chain is even reachable, and
     I need to know the real answer, not an assumed one.
   - QA gate: agent-loop = QA decides ready/loopback, escalate to human on 2nd
     failure. Human-in-loop = QA posts findings+questions in the card popup and
     requests approval. Loop-back goes to In Progress.

**Do NOT:**
- Add Graphify as a dependency, install step, or init flag (Feature 10 — it's
  agent-md-level only).
- Add auto-merge-if-tests-pass. The PR / human approval stays the terminal signal.
- Dump artifact file contents into prompts — manifest/discovery only.
- Backfill the log from git history.

Start by reading `OURO_BUILD_SPEC.md` and the current repo structure, then come
back to me with: (a) your confirm-questions for steps 2, 3, 7, and 9, and (b) any
place where the spec conflicts with how the repo already works. Then we build.