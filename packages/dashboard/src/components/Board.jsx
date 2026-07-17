import { useTickets } from "../store/tickets.js";
import Card from "./Card.jsx";

// The flow ends at a PR, so Shipped is a column rather than a footnote on
// Staging — a ticket whose branch is pushed and whose PR is open is done with
// this board, and shouldn't sit in the same pile as work still awaiting you.
//
// Cancelled tickets still don't get a column of their own: a permanent
// graveyard would eat a fifth of the board to show work nobody is doing. They
// fold into Staging, which is where you'd decide to reopen or delete them.

// Dots climb the violet ladder left to right, so the board reads as a
// brightness gradient: unclaimed grey → queued dim → LIVE → needs a human →
// shipped. Only In Progress sits at the top of the ladder, and it's the only
// dot that ever moves (see .column-header .dot.live).
const COLUMNS = [
  { key: "inbox", label: "Inbox", statuses: ["inbox"], dot: "var(--text-mute)" },
  { key: "analyzed", label: "Analyzed", statuses: ["analyzed"], dot: "var(--chrome)" },
  { key: "in_progress", label: "In Progress", statuses: ["in_progress"], dot: "var(--run)", live: true },
  { key: "staging", label: "Staging", statuses: ["staging", "cancelled"], dot: "var(--brand)" },
  { key: "done", label: "Shipped", statuses: ["done"], dot: "var(--brand)" },
];

const EMPTY_COPY = {
  inbox: "Nothing new. Message the Telegram bot to file one.",
  analyzed: "Nothing analyzed yet.",
  in_progress: "No agent is running.",
  staging: "Nothing waiting on you.",
  done: "No PRs opened yet.",
};

export default function Board() {
  const tickets = useTickets((s) => s.tickets);

  return (
    <div className="board wg-scroll">
      {COLUMNS.map((col) => {
        const items = tickets.filter((t) => col.statuses.includes(t.status));
        return (
          <section className="column" key={col.key} aria-label={col.label}>
            <div className="column-header">
              {/* Lit only when something is genuinely running — a glowing dot
                  over an empty column would be the one lie this palette exists
                  to prevent. */}
              <span
                className={`dot ${col.live && items.length > 0 ? "live" : ""}`}
                style={{ background: col.dot }}
                aria-hidden="true"
              />
              <span>{col.label}</span>
              <span className="count mono">{items.length}</span>
            </div>
            <div className="column-body wg-scroll">
              {items.map((ticket, i) => (
                <Card key={ticket.id} ticket={ticket} index={i} />
              ))}
              {items.length === 0 && <div className="empty">{EMPTY_COPY[col.key]}</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
