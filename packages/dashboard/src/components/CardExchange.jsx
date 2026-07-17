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

export default function CardExchange({ ticket }) {
  const [open, setOpen] = useState(false);
  const backend = useTickets((s) => s.backend);
  const agent = useAgents((s) => s.agents.find((a) => a.id === ticket.agentId));
  const bodyRef = useRef(null);

  const items = exchangeItems(ticket.log, backend);

  // Pin to the newest line as the run streams in, but only while open.
  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [open, items.length]);

  if (items.length === 0) return null;

  const who = agent ? `${agent.glyph} ${agent.name}` : "Agent";

  return (
    <div className="exchange" onClick={(e) => e.stopPropagation()}>
      <button className="exchange-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="terminal" size={11} />
        {open ? "Hide exchange" : `Exchange · ${items.length}`}
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
        </div>
      )}
    </div>
  );
}
