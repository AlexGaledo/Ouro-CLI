<!--
Sync Impact Report
==================
Version change: (template, unversioned) → 1.0.0
Bump rationale: Initial ratification. The file was an unfilled template; this is the
  first concrete constitution, so it starts at 1.0.0 (MAJOR baseline).

Modified principles: none (initial adoption). Five placeholder principle slots replaced with:
  I.   Isolation by Default
  II.  Separation of Duties
  III. Safe by Default, Autonomy Opt-In
  IV.  Never Lose Work
  V.   Vendor-Neutral, No API Key
  VI.  Zero-Config, Committed Config, Secret Hygiene  (added — 6th principle beyond template's 5)

Added sections:
  - Security & Trust Boundaries (Section 2)
  - Quality Gates & Development Workflow (Section 3)
  - Governance

Removed sections: none.

Templates requiring updates:
  ✅ .specify/templates/plan-template.md — "Constitution Check" gate is generic; no change needed.
  ✅ .specify/templates/spec-template.md — no constitution-specific sections; no change needed.
  ✅ .specify/templates/tasks-template.md — task categories align with principles; no change needed.
  ✅ README.md — source of derived principles; consistent, no change needed.

Follow-up TODOs: none. Ratification date set to adoption date (2026-07-21).
-->

# Ouro Constitution

## Core Principles

### I. Isolation by Default

Every agent run MUST execute in its own `git worktree` under `.ouro/worktrees/`, on a
throwaway `ouro/<ticket-id>` branch. The operator's working branch MUST NOT be touched by
any run. Cancelling a ticket MUST kill the running agent process, not merely flip a label.

**Rationale**: Agents run real tools with real write access. Isolation per ticket is the
only thing standing between a bad run and the operator's actual work — it MUST be structural,
never advisory.

### II. Separation of Duties

The agent that implements a change MUST NOT be the agent that decides whether it is done.
Roles are distinct: the **Analyst** (read-only) scopes a ticket into checkable acceptance
criteria; an implementer (**Senior Engineer** / **Bug Fixer**) builds against those criteria;
the **Senior QA Engineer** (read-only) validates the *running result* against them; the
**Reviewer** (read-only) audits the diff for correctness and risk, independent of the QA gate.
Acceptance criteria are the contract every downstream stage is held to and MUST ride into the
implementer's prompt verbatim.

**Rationale**: A single agent grading its own work has no adversary. Splitting scope, build,
and judgment is what makes a verdict mean something.

### III. Safe by Default, Autonomy Opt-In

Human-in-loop MUST be the default mode: plan → operator approves → execute. Nothing is written
until the operator approves. Full autonomy (Agent loop, `autoShip`) MUST be opt-in and MUST
require explicit confirmation before it takes effect. While an agent is planning, its tool
grants MUST be intersected with read-only tools, so an agent that can `Write` still cannot
write before approval.

**Rationale**: Autonomy is a choice the operator makes deliberately, not a default they trip
into. The safe path is the one that requires no thought; the powerful path requires a decision.

### IV. Never Lose Work

When a run produces changes, no failure path may discard them. If a remote is missing, the push
is rejected, or `gh` is absent, the commit MUST be kept locally, the ticket MUST rest in Staging,
and the reason MUST be surfaced. Recovering from an external failure (auth, remote, tooling) MUST
NOT require re-running the agent — a retry path (e.g. **Retry PR**) MUST exist. Failures degrade
gracefully and report why; they never fail silently.

**Rationale**: Compute and operator attention already spent producing a diff are expensive.
Losing that work to a fixable environment problem is never acceptable.

### V. Vendor-Neutral, No API Key

Ouro MUST drive a coding CLI the operator is already logged into rather than calling a hosted
API, and MUST NOT require `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or any equivalent. At least two
independent backends MUST remain supported so the tool is not tied to one vendor. Backend
selection MUST be switchable without a code change.

**Rationale**: Building on the subscription the operator already pays for keeps the barrier at
zero and keeps the project from being captured by a single provider's pricing or availability.

### VI. Zero-Config, Committed Config, Secret Hygiene

A fresh repo MUST run with no configuration: quality-gate and preview commands are inferred from
the repo, and a command that cannot be inferred is treated as N/A, not a failure. `.ouro/config.json`
MUST be committed, hand-editable, and merged (not replaced) on write, so an operator's manual key
survives a dashboard toggle. Secrets MUST live only in the gitignored `.ouro/.env`; a secret MUST
NEVER be written to `config.json` or any committed file. Runtime state (`run/`, `logs/`,
`worktrees/`, `tickets.json`) stays out of git.

**Rationale**: Zero-config earns adoption; committed, reviewable config keeps agent behaviour
auditable; and a committed file is a public file — a token there is a token in git history forever.

## Security & Trust Boundaries

- **Local-only, single-operator, no authentication.** Ouro has no auth layer by design. It MUST
  bind to localhost and MUST NOT be exposed to an untrusted network. Any feature implying
  multi-user access control is out of scope unless the constitution is amended.
- **Agents run real tools in a real worktree, not a sandbox.** Isolation is per-ticket via
  `git worktree` (Principle I), not a container. New or untrusted agent configs SHOULD be run
  Human-in-loop until their plans are trusted.
- **Backend tool grants.** On the Claude Code backend, an agent's declared `tools` MUST be
  enforced via `--allowedTools`. Where a backend has no per-tool grant model (e.g. Codex), the
  limitation MUST be documented rather than silently implied.
- **Secret handling** follows Principle VI: `.ouro/.env` only, never committed files.

## Quality Gates & Development Workflow

- **Deterministic checks before judgment.** Before the QA agent judges, Ouro MUST run **test**,
  **lint**, and **build** deterministically and hand the results to the (read-only) QA agent.
  Commands come from `.ouro/config.json` `staging.*` or are inferred; an absent command is N/A.
- **QA judges behaviour, not the diff.** The QA verdict MUST be based on the running result
  validated against acceptance criteria, distinct from the Reviewer's diff audit.
- **Bounded retries.** In Agent loop, a failing QA verdict re-runs the engineer in the same
  worktree with QA feedback, and MUST escalate to a human after `maxQaAttempts` (default 3)
  rather than looping forever.
- **Repo conventions.** Code MUST pass `npm run lint` (ESLint) and the `node --test` suite. An
  implementer MUST prefer the smallest diff that fully solves the ticket and MUST NOT delete a
  test to make a change pass.
- **Docs track behaviour.** User-facing behaviour changes MUST be reflected in `README.md` and
  the CLI reference in the same change.

## Governance

This constitution supersedes other practices where they conflict. Amendments MUST be made by
editing this file, MUST include a version bump per the policy below, and MUST propagate to any
dependent artifact (`.specify/templates/*`, `README.md`, command definitions) in the same change.

**Versioning policy** (semantic):

- **MAJOR**: a principle or governance rule is removed or redefined in a backward-incompatible way.
- **MINOR**: a new principle or section is added, or existing guidance is materially expanded.
- **PATCH**: clarifications, wording, or typo fixes that do not change meaning.

**Compliance**: Every PR and review MUST verify compliance with these principles. Any deviation
MUST be justified in the plan's Complexity Tracking (or equivalent) with the simpler alternative
named and the reason it was rejected. Unjustified complexity is a blocker, not a footnote.

**Version**: 1.0.0 | **Ratified**: 2026-07-21 | **Last Amended**: 2026-07-21
