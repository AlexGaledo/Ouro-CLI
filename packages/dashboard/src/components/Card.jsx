import { useState } from "react";
import { useTickets } from "../store/tickets.js";
import { useAgents } from "../store/agents.js";
import Icon from "./Icon.jsx";
import CardExchange from "./CardExchange.jsx";

// A card shows only the controls its status can act on. The board's job is to
// tell you what needs *you* — an in-progress card offers Cancel and nothing
// else, a staging card offers Approve, and neither shows a Run button that
// would 409 if you pressed it.

function lastLine(ticket) {
  const entry = ticket.log?.[ticket.log.length - 1];
  if (!entry) return null;
  if (entry.type === "error") return `error: ${entry.text}`;
  if (entry.type === "cancelled") return entry.text;

  const event = entry.event ?? {};
  if (event.type === "raw" || event.type === "stderr") return (event.text ?? "").trim().slice(0, 70);

  const content = event.message?.content;
  if (Array.isArray(content)) {
    const tool = content.find((b) => b.type === "tool_use");
    if (tool) {
      const input = tool.input ?? {};
      const arg = input.file_path ?? input.path ?? input.command ?? "";
      return `${tool.name}${arg ? ` ${String(arg).slice(0, 40)}` : ""}`;
    }
    const text = content.find((b) => b.type === "text" && b.text?.trim());
    if (text) return text.text.trim().slice(0, 70);
  }
  return event.type ?? null;
}

export default function Card({ ticket, index }) {
  const {
    setMode,
    setAgent,
    analyzeTicket,
    runTicket,
    approveTicket,
    cancelTicket,
    reopenTicket,
    deleteTicket,
    shipTicket,
    select,
    selectedId,
  } = useTickets();
  const agents = useAgents((s) => s.agents);
  const defaultMode = useTickets((s) => s.defaultMode);
  const [shipping, setShipping] = useState(false);

  const selected = selectedId === ticket.id;
  const running = ticket.status === "in_progress";
  const analyzing = Boolean(ticket.analyzing);
  const mode = ticket.mode ?? defaultMode;
  const agent = agents.find((a) => a.id === ticket.agentId);
  const tail = running ? lastLine(ticket) : null;

  // Actions live inside the card, which is itself a click target for selection —
  // without this every button press would also toggle the selection underneath.
  const stop = (fn) => (e) => {
    e.stopPropagation();
    fn();
  };

  async function handleShip() {
    setShipping(true);
    // The result lands on the ticket (prUrl / shipNote) via the WS broadcast,
    // so there's nothing to do with it here but stop the spinner.
    await shipTicket(ticket.id).finally(() => setShipping(false));
  }

  return (
    <article
      className={`card ${selected ? "selected" : ""} ${running || analyzing ? "running" : ""}`}
      style={{ "--i": index }}
      onClick={() => select(ticket.id)}
    >
      <div className="card-title">{ticket.title}</div>
      {ticket.summary && <div className="card-summary">{ticket.summary}</div>}

      <div className="card-meta">
        {ticket.priority && (
          <span className={`badge priority-${ticket.priority}`}>
            {/* Text label as well as hue — priority can't be colour-only. */}
            {ticket.priority}
          </span>
        )}
        <span className="badge">{ticket.source}</span>
        {agent && (
          <span className="badge agent" title={`Runs as ${agent.name}`}>
            {agent.glyph} {agent.name}
          </span>
        )}
        <span className="badge mono">{ticket.id}</span>
      </div>

      {/* Analyst findings — the definition of done the run and QA gate answer to. */}
      {ticket.acceptanceCriteria?.length > 0 && (
        <details className="card-criteria" onClick={(e) => e.stopPropagation()}>
          <summary>{ticket.acceptanceCriteria.length} acceptance criteria</summary>
          <ul>
            {ticket.acceptanceCriteria.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </details>
      )}

      {analyzing && (
        <>
          <div className="log-tail">Analyzing…</div>
          <div className="card-actions">
            <button className="btn sm danger" onClick={stop(() => cancelTicket(ticket.id))}>
              <Icon name="stop" size={10} />
              Cancel
            </button>
          </div>
        </>
      )}

      {!analyzing && (ticket.status === "analyzed" || ticket.status === "inbox") && (
        <>
          {agents.length > 0 && (
            <div className="select-wrap" onClick={(e) => e.stopPropagation()}>
              <select
                className="select"
                style={{ height: 28, padding: "0 26px 0 9px", fontSize: 12 }}
                value={ticket.agentId ?? ""}
                onChange={(e) => setAgent(ticket.id, e.target.value || null)}
                aria-label={`Agent for ${ticket.title}`}
              >
                <option value="">Default agent</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.glyph} {a.name}
                  </option>
                ))}
              </select>
              <Icon name="chevronDown" size={12} className="chev" />
            </div>
          )}

          <div className="card-actions">
            <button
              className="btn sm"
              onClick={stop(() => setMode(ticket.id, mode === "agent" ? "human" : "agent"))}
              title={
                ticket.mode
                  ? `This ticket overrides the board default — click to switch to ${mode === "agent" ? "human-in-loop" : "agent loop"}`
                  : `Inherited from the board default (${defaultMode}) — click to override`
              }
            >
              {mode === "agent" ? "Agent loop" : "Human-in-loop"}
              {!ticket.mode && <span style={{ color: "var(--text-mute)" }}>·default</span>}
            </button>
            <button
              className="btn sm"
              onClick={stop(() => analyzeTicket(ticket.id))}
              title="Read-only Analyst pass — summary, priority, and acceptance criteria"
            >
              <Icon name="search" size={11} />
              {ticket.status === "analyzed" ? "Re-analyze" : "Analyze"}
            </button>
            <button className="btn sm run" onClick={stop(() => runTicket(ticket.id))}>
              <Icon name="play" size={11} />
              Run
            </button>
            <button
              className="btn sm ghost icon-only"
              onClick={stop(() => deleteTicket(ticket.id))}
              aria-label={`Delete ticket ${ticket.title}`}
              title="Delete ticket"
            >
              <Icon name="trash" size={12} />
            </button>
          </div>
        </>
      )}

      {running && (
        <>
          {tail && <div className="log-tail">{tail}</div>}
          <div className="card-actions">
            <button className="btn sm danger" onClick={stop(() => cancelTicket(ticket.id))}>
              <Icon name="stop" size={10} />
              Cancel run
            </button>
          </div>
        </>
      )}

      {ticket.status === "staging" && (
        <>
          {ticket.awaitingApproval && ticket.plan && <pre className="diff">{ticket.plan.slice(0, 600)}</pre>}
          {ticket.diff && <pre className="diff">{ticket.diff.slice(0, 600)}</pre>}
          {!ticket.diff && !ticket.plan && <div className="cancel-note">Run finished with no file changes.</div>}

          {/* Why it didn't ship — no remote, push rejected, gh missing. The
              work is committed regardless, so this is a retry prompt, not an
              error state. */}
          {ticket.shipNote && (
            <div className="cancel-note">
              <Icon name="alert" size={12} style={{ marginTop: 2 }} />
              <span>{ticket.shipNote}</span>
            </div>
          )}

          <div className="card-actions">
            {ticket.awaitingApproval && (
              <button className="btn sm run" onClick={stop(() => approveTicket(ticket.id))}>
                <Icon name="check" size={11} />
                Approve &amp; continue
              </button>
            )}
            {/* Only offer a PR once there's a run behind it. */}
            {!ticket.awaitingApproval && ticket.worktree && (
              <button className="btn sm run" onClick={stop(handleShip)} disabled={shipping}>
                <Icon name="gitBranch" size={11} />
                {shipping ? "Shipping…" : ticket.shipNote ? "Retry PR" : "Create PR"}
              </button>
            )}
            <button className="btn sm" onClick={stop(() => cancelTicket(ticket.id))}>
              <Icon name="x" size={11} />
              {ticket.awaitingApproval ? "Reject" : "Cancel"}
            </button>
          </div>
        </>
      )}

      {ticket.status === "done" && (
        <>
          {ticket.prUrl ? (
            <a
              className="pr-link"
              href={ticket.prUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              <Icon name="gitBranch" size={12} />
              <span className="label">{ticket.prUrl.replace(/^https:\/\/github\.com\//, "")}</span>
            </a>
          ) : (
            <div className="cancel-note">
              <Icon name="check" size={12} style={{ marginTop: 2 }} />
              <span>{ticket.shipNote ?? "Done."}</span>
            </div>
          )}
          {ticket.branch && (
            <div className="card-meta">
              <span className="badge mono">{ticket.branch}</span>
              {ticket.baseBranch && <span className="badge mono">→ {ticket.baseBranch}</span>}
            </div>
          )}
          <div className="card-actions">
            <button
              className="btn sm ghost icon-only"
              onClick={stop(() => deleteTicket(ticket.id))}
              aria-label={`Delete ticket ${ticket.title}`}
              title="Remove from the board (the PR and branch stay)"
            >
              <Icon name="trash" size={12} />
            </button>
          </div>
        </>
      )}

      {ticket.status === "cancelled" && (
        <>
          <div className="cancel-note">
            <Icon name="alert" size={12} style={{ marginTop: 2 }} />
            <span>{ticket.cancelReason ?? "Cancelled."}</span>
          </div>
          <div className="card-actions">
            <button className="btn sm" onClick={stop(() => reopenTicket(ticket.id))}>
              <Icon name="rotate" size={11} />
              Reopen
            </button>
            <button
              className="btn sm ghost icon-only"
              onClick={stop(() => deleteTicket(ticket.id))}
              aria-label={`Delete ticket ${ticket.title}`}
              title="Delete ticket"
            >
              <Icon name="trash" size={12} />
            </button>
          </div>
        </>
      )}

      {/* Live inter-agent exchange — messages + tool calls, reasoning filtered.
          Renders nothing until there's something to show. */}
      <CardExchange ticket={ticket} />
    </article>
  );
}
