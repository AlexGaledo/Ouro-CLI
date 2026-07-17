import { useTickets } from "../store/tickets.js";
import { useUI } from "../store/ui.js";
import Segmented from "./Segmented.jsx";
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

const TITLES = {
  board: { h1: "Board", sub: "Tickets flow Inbox → Triaged → In Progress → Review" },
  agents: { h1: "Agents", sub: "Markdown-configured — edit here or in .ouro/agents/" },
};

export default function Topbar({ onNewTicket }) {
  const backend = useTickets((s) => s.backend);
  const setBackend = useTickets((s) => s.setBackend);
  const defaultMode = useTickets((s) => s.defaultMode);
  const setDefaultMode = useTickets((s) => s.setDefaultMode);
  const view = useUI((s) => s.view);

  const title = TITLES[view] ?? TITLES.board;

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
          onChange={setDefaultMode}
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
    </header>
  );
}
