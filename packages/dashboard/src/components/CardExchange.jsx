import { useEffect, useRef, useState } from "react";
import { useTickets } from "../store/tickets.js";
import { useAgents } from "../store/agents.js";
import { exchangeItems } from "../lib/exchange.js";
import Icon from "./Icon.jsx";

// The live agent-exchange popup, anchored on the card. A real-time view of the
// inter-agent discussion during a run — agent messages and tool calls / results,
// with thinking / reasoning filtered out. The filtering lives in lib/exchange.js
// (the per-backend normalizer); this component just renders the result and keeps
// itself pinned to the newest line as events stream in over the WS feed.
//
// QA's verdict rides along at the bottom once it's posted — same popup, so the
// human's approve/reject decision sits next to the reasons and questions that
// prompted it instead of floating on the card with no context.

export default function CardExchange({ ticket }) {
  const [open, setOpen] = useState(false);
  const backend = useTickets((s) => s.backend);
  const { qaApprove, qaReject } = useTickets();
  const agent = useAgents((s) => s.agents.find((a) => a.id === ticket.agentId));
  const bodyRef = useRef(null);

  const items = exchangeItems(ticket.log, backend);
  const showQa = ticket.awaitingQa && Boolean(ticket.qaVerdict);

  // Pin to the newest line as the run streams in, but only while open.
  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [open, items.length]);

  // Nothing streamed and no QA verdict waiting on a decision — nothing to show.
  if (items.length === 0 && !showQa) return null;

  const who = agent ? `${agent.glyph} ${agent.name}` : "Agent";

  return (
    <div className="exchange" onClick={(e) => e.stopPropagation()}>
      <button className="exchange-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="terminal" size={11} />
        {open ? "Hide exchange" : items.length > 0 ? `Exchange · ${items.length}` : "QA review"}
      </button>

      {open && (
        <div className="exchange-panel" ref={bodyRef}>
          {items.map((it, i) => {
            if (it.kind === "message") {
              return (
                <div className="exchange-msg" key={i}>
                  <span className="exchange-who">{who}</span>
                  <span className="exchange-text">{it.text}</span>
                </div>
              );
            }
            if (it.kind === "tool") {
              return (
                <div className="exchange-tool" key={i}>
                  <span className="exchange-arrow">▶</span>
                  <span className="exchange-tname">{it.name}</span>
                  {it.arg && <span className="exchange-targ">{it.arg}</span>}
                </div>
              );
            }
            if (it.kind === "result") {
              return (
                <div className="exchange-result" key={i}>
                  <span className="exchange-arrow">◂</span>
                  <span className="exchange-text">{it.text || "result"}</span>
                </div>
              );
            }
            return (
              <div className="exchange-err" key={i}>
                {it.text}
              </div>
            );
          })}

          {/* QA posts its findings as the last word in the exchange — the
              approve/reject decision lives right where the reasons are. */}
          {showQa && (
            <div className="exchange-qa">
              <div className="qa-head">
                <span className={`qa-badge ${ticket.qaVerdict.ready ? "ready" : "not-ready"}`}>
                  {ticket.qaVerdict.ready ? "Ready" : "Not ready"}
                </span>
                <span className="qa-summary">{ticket.qaVerdict.summary}</span>
              </div>

              {ticket.qaVerdict.reasons?.length > 0 && (
                <div className="qa-group">
                  <div className="qa-label">reasons</div>
                  <ul className="qa-list">
                    {ticket.qaVerdict.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {ticket.qaVerdict.visualMethod === "html" && (
                <div className="qa-note">reviewed via HTML — no screenshot</div>
              )}

              {ticket.qaVerdict.questions?.length > 0 && (
                <div className="qa-group">
                  <div className="qa-label">questions</div>
                  <ul className="qa-list">
                    {ticket.qaVerdict.questions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="card-actions qa-actions">
                <button className="btn sm run" onClick={() => qaApprove(ticket.id)}>
                  <Icon name="check" size={11} />
                  Approve &amp; ship
                </button>
                <button className="btn sm danger" onClick={() => qaReject(ticket.id)}>
                  <Icon name="x" size={11} />
                  Reject — another pass
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
