import { useState } from "react";
import { useTickets } from "../store/tickets.js";
import { useUI } from "../store/ui.js";
import Segmented from "./Segmented.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import Icon from "./Icon.jsx";

// One row: [ Mode ] [ Backend ] [ + New ticket ].
//
// Mode used to live per-card, which meant setting it once per ticket forever
// even though it's really a standing preference about how *you* work. It's the
// board-wide default now (persisted to .ouro/config.json), and a card can still
// override itself. Backend sits beside it because both answer "how will the
// next run execute" — grouping them next to the action they affect makes the
// header read as one decision rather than three unrelated widgets.

const MODES = [
  { value: "human", label: "Human-in-loop", title: "Plan first, write only after you approve" },
  { value: "agent", label: "Agent loop", title: "Full autonomy — the agent writes without pausing" },
];

const BACKENDS = [
  { value: "claude-code", label: "Claude Code", title: "Run on your Claude Code subscription" },
  { value: "codex", label: "Codex", title: "Run on your Codex / ChatGPT subscription" },
];

// Flipping the board default silently would be a footgun: "agent" grants every
// new ticket full autonomy, so the switch is confirm-then-commit. Keyed by the
// mode you're switching *to*. "agent" carries the warning-toned copy and a
// danger button; "human" is the lighter, no-stakes direction.
const MODE_SWITCH_COPY = {
  agent: {
    title: "Switch to Agent loop?",
    message:
      "New agent-loop tickets run end-to-end with no dashboard stops — analyze, implement, QA review, then open a PR on their own. The only human touchpoints are the Telegram interview and reviewing the PR on GitHub.",
    confirmLabel: "Switch to Agent loop",
    tone: "danger",
  },
  human: {
    title: "Switch to Human-in-loop?",
    message:
      "New tickets will wait for you — a plan you approve before any code is written, and a QA verdict you approve before anything ships.",
    confirmLabel: "Switch to Human-in-loop",
    tone: "default",
  },
};

const TITLES = {
  board: { h1: "Board", sub: "Tickets flow Inbox → Analyzed → In Progress → Staging → Shipped" },
  agents: { h1: "Agents", sub: "Markdown-configured — edit here or in .ouro/agents/" },
  artifacts: { h1: "Artifacts", sub: "Everything an agent sees as context — referenced in place, never copied" },
  logs: { h1: "Logs", sub: "One line per run — skimmable history from .ouro/context/ouro-log.md" },
  settings: { h1: "Settings", sub: "Credentials for the services that feed the board" },
};

export default function Topbar({ onNewTicket }) {
  const backend = useTickets((s) => s.backend);
  const setBackend = useTickets((s) => s.setBackend);
  const defaultMode = useTickets((s) => s.defaultMode);
  const setDefaultMode = useTickets((s) => s.setDefaultMode);
  const view = useUI((s) => s.view);

  const title = TITLES[view] ?? TITLES.board;

  // The mode the user is *proposing* to switch to, held pending confirmation.
  // Kept separate from defaultMode so the pill stays on the committed mode until
  // they confirm — the segmented control must not jump ahead of the decision.
  const [pendingMode, setPendingMode] = useState(null);

  // onChange no longer applies the switch; it only opens the gate. Ignore a
  // click on the mode that's already active (e.g. re-selecting the current one)
  // so we never pop a dialog that would change nothing.
  const requestModeSwitch = (next) => {
    if (next !== defaultMode) setPendingMode(next);
  };

  return (
    <header className="topbar">
      <div>
        <h1>{title.h1}</h1>
        <div className="sub">{title.sub}</div>
      </div>

      <div className="topbar-right">
        <span className="control-label">Mode</span>
        {/* Mode used to paint itself green on "Agent loop", which put a live-run
            colour on a standing preference. Mode is chrome; it isn't running. */}
        <Segmented
          ariaLabel="Default run mode for new tickets"
          value={defaultMode}
          options={MODES}
          onChange={requestModeSwitch}
        />

        {backend && (
          <>
            <span className="control-label">Backend</span>
            <Segmented ariaLabel="Agent backend" value={backend} options={BACKENDS} onChange={setBackend} />
          </>
        )}

        <button className="btn primary" onClick={onNewTicket}>
          <Icon name="plus" size={14} />
          New ticket
        </button>
      </div>

      {/* Rendered only while a switch is pending. Confirm commits it to the
          store (which persists to config); cancel discards it and the pill
          never moved. */}
      {pendingMode && (
        <ConfirmDialog
          {...MODE_SWITCH_COPY[pendingMode]}
          onConfirm={() => {
            setDefaultMode(pendingMode);
            setPendingMode(null);
          }}
          onCancel={() => setPendingMode(null)}
        />
      )}
    </header>
  );
}
