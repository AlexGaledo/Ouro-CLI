import { useTickets } from "../store/tickets.js";
import { useAgents } from "../store/agents.js";
import { useUI } from "../store/ui.js";
import Icon from "./Icon.jsx";
import Logo from "./Logo.jsx";

// Two expandable groups — Tickets and Agents — over a collapsible rail, plus a
// flat Settings link at the foot.
//
// The groups expand independently of the main view: you can keep an eye on the
// ticket list while editing an agent. Clicking a ticket selects it on the board
// (and switches back to the board view); clicking an agent opens it for editing.

const ACTIVE = new Set(["inbox", "analyzed", "in_progress", "staging"]);

function Group({ icon, label, count, open, onToggleOpen, onActivate, active, children, collapsed }) {
  return (
    <div className="nav-section">
      <button
        className={`nav-head ${active ? "active" : ""}`}
        onClick={() => {
          onActivate?.();
          // In rail mode the group can't be seen, so the click is purely
          // navigation — expanding would just fight the collapsed layout.
          if (!collapsed) onToggleOpen();
        }}
        aria-expanded={collapsed ? undefined : open}
        aria-label={collapsed ? label : undefined}
        title={collapsed ? label : undefined}
      >
        <Icon name={icon} size={15} />
        <span className="label">{label}</span>
        {count > 0 && <span className="nav-count">{count}</span>}
        <Icon name="chevronRight" size={13} className={`chev ${open ? "open" : ""}`} />
      </button>

      <div className={`nav-group ${open ? "open" : ""}`}>
        <div className="nav-group-inner">{children}</div>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const tickets = useTickets((s) => s.tickets);
  const selectedTicket = useTickets((s) => s.selectedId);
  const selectTicket = useTickets((s) => s.select);
  const connected = useTickets((s) => s.connected);

  const agents = useAgents((s) => s.agents);
  const selectedAgent = useAgents((s) => s.selectedId);
  const selectAgent = useAgents((s) => s.select);

  const { view, railCollapsed, ticketsOpen, agentsOpen } = useUI();
  const setUI = useUI((s) => s.set);
  const toggle = useUI((s) => s.toggle);

  // Sidebar is a navigator, not an archive — done/cancelled tickets stay on the
  // board but drop out of the list so it doesn't grow forever.
  const active = tickets.filter((t) => ACTIVE.has(t.status));

  return (
    <aside className={`sidebar ${railCollapsed ? "collapsed" : ""}`}>
      <div className="sidebar-head">
        <Logo size={19} className={`brand-logo ${connected ? "" : "offline"}`} />
        <span className="brand-mark">ouro</span>
        {/* The rail is 56px — logo, wordmark, dot and toggle can't all fit, so
            the dot drops out when collapsed and the mark itself goes red
            instead. The connection state is the one thing in this header that
            must survive rail mode; the wordmark isn't. */}
        <span
          className={`status-dot ${connected ? "live" : ""}`}
          role="status"
          aria-label={connected ? "Connected to the ouro server" : "Disconnected — reconnecting"}
          title={connected ? "connected" : "reconnecting…"}
        />
        <button
          className="rail-toggle"
          onClick={() => toggle("railCollapsed")}
          aria-label={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <Icon name={railCollapsed ? "chevronsRight" : "chevronsLeft"} size={15} />
        </button>
      </div>

      <div className="sidebar-body wg-scroll">
        <Group
          icon="inbox"
          label="Tickets"
          count={active.length}
          open={ticketsOpen}
          collapsed={railCollapsed}
          active={view === "board"}
          onActivate={() => setUI({ view: "board" })}
          onToggleOpen={() => toggle("ticketsOpen")}
        >
          {active.map((t) => (
            <button
              key={t.id}
              className={`nav-item ${selectedTicket === t.id ? "selected" : ""}`}
              onClick={() => {
                setUI({ view: "board" });
                selectTicket(t.id);
              }}
              title={t.title}
            >
              <span
                className={`status-dot ${t.status === "in_progress" ? "running" : ""}`}
                style={t.status === "in_progress" ? undefined : { background: "var(--border-strong)" }}
                aria-hidden="true"
              />
              <span className="label">{t.title}</span>
            </button>
          ))}
          {active.length === 0 && <div className="nav-empty">No open tickets.</div>}
        </Group>

        <Group
          icon="agents"
          label="Agents"
          count={agents.length}
          open={agentsOpen}
          collapsed={railCollapsed}
          active={view === "agents"}
          onActivate={() => setUI({ view: "agents" })}
          onToggleOpen={() => toggle("agentsOpen")}
        >
          {agents.map((a) => (
            <button
              key={a.id}
              className={`nav-item ${view === "agents" && selectedAgent === a.id ? "selected" : ""}`}
              onClick={() => {
                setUI({ view: "agents" });
                selectAgent(a.id);
              }}
              title={a.description || a.name}
            >
              <span className="glyph" aria-hidden="true">{a.glyph}</span>
              <span className="label">{a.name}</span>
            </button>
          ))}
          {agents.length === 0 && <div className="nav-empty">No agents in .ouro/agents/.</div>}
        </Group>

        {/* Flat, not Groups: they have nothing to list, and a chevron that
            opened an empty drawer would be a lie about there being more under
            it. Artifacts and Settings are single destinations. */}
        <div className="nav-section">
          <button
            className={`nav-head ${view === "artifacts" ? "active" : ""}`}
            onClick={() => setUI({ view: "artifacts" })}
            aria-label={railCollapsed ? "Artifacts" : undefined}
            title={railCollapsed ? "Artifacts" : undefined}
          >
            <Icon name="file" size={15} />
            <span className="label">Artifacts</span>
          </button>
        </div>

        <div className="nav-section">
          <button
            className={`nav-head ${view === "settings" ? "active" : ""}`}
            onClick={() => setUI({ view: "settings" })}
            aria-label={railCollapsed ? "Settings" : undefined}
            title={railCollapsed ? "Settings" : undefined}
          >
            <Icon name="settings" size={15} />
            <span className="label">Settings</span>
          </button>
        </div>
      </div>

      <div className="sidebar-foot">
        <Icon name="file" size={12} />
        <span>.ouro/agents/*.md</span>
      </div>
    </aside>
  );
}
