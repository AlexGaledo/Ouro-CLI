import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTickets } from "../store/tickets.js";
import { useUI, TERMINAL_MIN, TERMINAL_MAX } from "../store/ui.js";
import Icon from "./Icon.jsx";

// The "is anything actually happening" panel.
//
// A kanban card tells you a ticket is in progress; it can't tell you whether
// the agent is doing useful work or wedged on a prompt. This is the raw event
// stream from every run, so that question is answerable at a glance.
//
// Colour-coded per ticket: the hue is derived from the ticket id rather than
// assigned from a rotating palette, so a given ticket keeps its colour across
// reloads and between the dock and anywhere else we tag it.

function hueFor(ticketId) {
  let hash = 0;
  for (let i = 0; i < ticketId.length; i++) {
    hash = (hash * 31 + ticketId.charCodeAt(i)) >>> 0;
  }
  // Skips the 355–360 wrap into red, which reads as an error tag.
  return hash % 355;
}

function time(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "--:--:--" : d.toTimeString().slice(0, 8);
}

export default function Terminal() {
  const feed = useTickets((s) => s.feed);
  const tickets = useTickets((s) => s.tickets);
  const clearFeed = useTickets((s) => s.clearFeed);
  const selectedId = useTickets((s) => s.selectedId);
  const select = useTickets((s) => s.select);

  const { terminalOpen, terminalHeight, autoscroll } = useUI();
  const setUI = useUI((s) => s.set);
  const toggle = useUI((s) => s.toggle);
  const setTerminalHeight = useUI((s) => s.setTerminalHeight);

  const bodyRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [filterMine, setFilterMine] = useState(false);

  const running = tickets.filter((t) => t.status === "in_progress");
  const lines = filterMine && selectedId ? feed.filter((l) => l.ticketId === selectedId) : feed;

  // useLayoutEffect, not useEffect: scrolling after paint shows one frame of
  // the pre-scroll position, which reads as a jitter on a fast stream.
  useLayoutEffect(() => {
    if (!autoscroll || !terminalOpen) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, autoscroll, terminalOpen]);

  // Scrolling up is an implicit "stop following" — fighting the user's scroll
  // to yank them back to the bottom is the single worst thing a log view does.
  const onScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom !== autoscroll) setUI({ autoscroll: atBottom });
  }, [autoscroll, setUI]);

  // Drag-to-resize. Listeners go on window so the pointer can leave the 5px
  // handle mid-drag without the resize dying.
  useEffect(() => {
    if (!dragging) return;

    const onMove = (e) => {
      setTerminalHeight(window.innerHeight - e.clientY);
      e.preventDefault();
    };
    const onUp = () => setDragging(false);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    // Without this the drag selects text across the whole page.
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ns-resize";

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [dragging, setTerminalHeight]);

  return (
    <section className="terminal" style={{ height: terminalOpen ? terminalHeight : "auto" }} aria-label="Agent output">
      {terminalOpen && (
        <div
          className={`terminal-resize ${dragging ? "dragging" : ""}`}
          onPointerDown={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize terminal"
          tabIndex={0}
          onKeyDown={(e) => {
            // Keyboard-resizable — a pointer-only control isn't reachable.
            if (e.key === "ArrowUp") setTerminalHeight(Math.min(TERMINAL_MAX, terminalHeight + 24));
            if (e.key === "ArrowDown") setTerminalHeight(Math.max(TERMINAL_MIN, terminalHeight - 24));
          }}
        />
      )}

      <div className="terminal-head">
        <span className="terminal-title">
          <Icon name="terminal" size={13} />
          Terminal
        </span>

        {running.length > 0 && (
          <span className="running-pill" title={running.map((t) => t.title).join("\n")}>
            <span className="pulse" aria-hidden="true" />
            {running.length} running
          </span>
        )}

        <span className="spacer" />

        {selectedId && (
          <button
            className={`btn sm ${filterMine ? "" : "ghost"}`}
            onClick={() => setFilterMine((v) => !v)}
            title="Show only the selected ticket's output"
          >
            <Icon name="search" size={11} />
            {filterMine ? "Selected only" : "All tickets"}
          </button>
        )}

        <button
          className={`btn sm ${autoscroll ? "" : "ghost"}`}
          onClick={() => setUI({ autoscroll: !autoscroll })}
          aria-pressed={autoscroll}
          title="Follow new output as it arrives"
        >
          <Icon name="chevronDown" size={11} />
          Follow
        </button>

        <button className="btn sm ghost" onClick={clearFeed} title="Clear the view (agent logs are kept on disk)">
          Clear
        </button>

        <button
          className="btn sm ghost icon-only"
          onClick={() => toggle("terminalOpen")}
          aria-label={terminalOpen ? "Collapse terminal" : "Expand terminal"}
          aria-expanded={terminalOpen}
        >
          <Icon name={terminalOpen ? "chevronDown" : "chevronRight"} size={13} />
        </button>
      </div>

      {terminalOpen && (
        <div className="terminal-body wg-scroll" ref={bodyRef} onScroll={onScroll} aria-live="off">
          {lines.length === 0 ? (
            <div className="terminal-empty">
              No agent output yet. Pick a ticket and hit <span className="kbd">Run</span> — every tool call it makes
              streams here.
            </div>
          ) : (
            lines.map((line) => {
              const hue = hueFor(line.ticketId);
              return (
                <div key={line.id} className={`term-line tone-${line.tone}`}>
                  <span className="term-ts">{time(line.ts)}</span>
                  <span
                    className="term-tag"
                    style={{ color: `hsl(${hue} 62% 62%)` }}
                    onClick={() => select(line.ticketId)}
                    title="Select this ticket on the board"
                  >
                    [{line.ticketId}]
                  </span>
                  <span className="term-msg">{line.text}</span>
                </div>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}
