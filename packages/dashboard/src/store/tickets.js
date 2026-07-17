import { create } from "zustand";
import { useAgents } from "./agents.js";

// Single socket, single store. The server is the source of truth for ticket
// state — every mutation here is fire-and-forget HTTP, and the resulting WS
// broadcast is what actually moves the UI. That keeps two browser tabs (and
// the Telegram intake agent) in agreement without any reconciliation logic.
//
// The one exception is the toggles: `backend` and `defaultMode` update
// optimistically, because a segmented control that lags 80ms behind the click
// feels broken in a way a kanban card does not.

const MAX_FEED = 600; // terminal dock keeps a tail, not the whole session

let socket = null;
let retry = null;
let backoff = 500;

function tone(entry) {
  if (entry.type === "error") return "bad";
  if (entry.type === "cancelled" || entry.type === "warn") return "warn";
  // Commit/push/PR progress — same stream as the agent's tool calls, so the
  // dock narrates the whole ticket rather than stopping at the last edit.
  if (entry.type === "ship-done") return "good";
  if (entry.type === "ship") return "run";

  const event = entry.event ?? {};
  if (event.type === "stderr") return "warn";
  if (event.type === "result") return event.is_error ? "bad" : "good";
  if (event.type === "raw") return "dim";
  // Bookkeeping chatter — real but not what you're watching for. Dimmed so the
  // tool calls stay the thing your eye lands on.
  if (event.type === "rate_limit_event") return "dim";
  if (event.type === "system" && event.subtype !== "init") return "dim";
  return "run";
}

/**
 * Collapses a backend event into one terminal line. Both CLIs emit shapes we
 * haven't pinned to a spec (see claudeCodeExec.js), so this reads defensively
 * and always yields *something* printable rather than risking a blank feed.
 */
function describe(entry) {
  if (entry.type === "error") return `error: ${entry.text}`;
  if (entry.type === "cancelled") return entry.text || "cancelled";
  // Ship stages carry their own prose — pass it through untouched.
  if (entry.type === "ship" || entry.type === "ship-done" || entry.type === "warn") return entry.text;

  const event = entry.event;
  if (!event) return JSON.stringify(entry).slice(0, 200);
  if (event.type === "raw" || event.type === "stderr") return (event.text ?? "").trim();

  // Only `init` is an actual session start. The other system subtypes
  // (hook_progress, thinking_tokens, …) fire constantly mid-run — labelling
  // them all "session started" made the dock read like it was looping.
  if (event.type === "system") {
    return event.subtype === "init"
      ? `session started · ${event.model ?? "ready"}`
      : `· ${event.subtype ?? "system"}`;
  }

  if (event.type === "rate_limit_event") return "· rate limit notice";

  if (event.type === "result") {
    const bits = [event.is_error ? "failed" : "done"];
    if (event.num_turns) bits.push(`${event.num_turns} turns`);
    if (event.duration_ms) bits.push(`${(event.duration_ms / 1000).toFixed(1)}s`);
    return `${event.is_error ? "✗" : "✓"} ${bits.join(" · ")}`;
  }

  // assistant/user turns: surface tool calls by name, else the text said.
  const content = event.message?.content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const block of content) {
      if (block.type === "tool_use") {
        const input = block.input ?? {};
        // File path first, then command/pattern — whichever is present, it's
        // the one bit that says *what* the call is doing.
        const arg = input.file_path ?? input.path ?? input.command ?? input.pattern ?? input.prompt ?? "";
        parts.push(`▶ ${block.name}${arg ? ` ${String(arg).slice(0, 90)}` : ""}`);
      } else if (block.type === "text" && block.text?.trim()) {
        parts.push(block.text.trim().slice(0, 160));
      } else if (block.type === "thinking") {
        parts.push("· thinking");
      } else if (block.type === "tool_result") {
        parts.push("◂ result");
      }
    }
    if (parts.length) return parts.join("  ");
  }

  if (event.item?.text) return `${event.type}: ${event.item.text.slice(0, 140)}`;
  // A bare type name is a poor line, but it's honest — better than dropping an
  // event we don't recognise and leaving a gap in the stream.
  return `· ${event.type ?? "event"}`;
}

let feedSeq = 0;

export const useTickets = create((set, get) => ({
  tickets: [],
  connected: false,
  backend: null,
  defaultMode: "human",
  feed: [], // flattened, cross-ticket event stream for the terminal dock
  selectedId: null,

  select(id) {
    set((s) => ({ selectedId: s.selectedId === id ? null : id }));
  },

  async hydrate() {
    const res = await fetch("/api/tickets");
    const tickets = await res.json();

    // Seed the terminal from history so a reload doesn't show a blank dock.
    const feed = tickets
      .flatMap((t) => (t.log ?? []).map((entry) => ({ ...toLine(t.id, entry), id: ++feedSeq })))
      .sort((a, b) => a.ts.localeCompare(b.ts))
      .slice(-MAX_FEED);

    set({ tickets, feed });
  },

  async hydrateConfig() {
    const res = await fetch("/api/config");
    const { backend, defaultMode } = await res.json();
    set({ backend, defaultMode: defaultMode ?? "human" });
  },

  async setBackend(backend) {
    const previous = get().backend;
    set({ backend }); // optimistic — the toggle must feel instant
    try {
      const res = await fetch("/api/config/backend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backend }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      set({ backend: data.backend ?? backend });
    } catch {
      set({ backend: previous }); // roll back rather than lie about the state
    }
  },

  async setDefaultMode(mode) {
    const previous = get().defaultMode;
    set({ defaultMode: mode });
    try {
      const res = await fetch("/api/config/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch {
      set({ defaultMode: previous });
    }
  },

  connectSocket() {
    if (socket && socket.readyState <= 1) return;

    const proto = location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${proto}://${location.host}/ws`);

    socket.onopen = () => {
      backoff = 500;
      set({ connected: true });
      // A dropped socket means missed broadcasts; refetch rather than trust
      // whatever partial state survived the gap.
      get().hydrate();
      get().hydrateConfig();
    };

    socket.onclose = () => {
      set({ connected: false });
      // Capped exponential backoff — `ouro dashboard` restarts are routine and
      // the tab should just come back on its own.
      clearTimeout(retry);
      retry = setTimeout(() => get().connectSocket(), backoff);
      backoff = Math.min(backoff * 2, 8000);
    };

    socket.onerror = () => socket?.close();

    socket.onmessage = (msg) => {
      let payload;
      try {
        payload = JSON.parse(msg.data);
      } catch {
        return;
      }
      get().applyEvent(payload);
    };
  },

  applyEvent(payload) {
    // Log traffic is the firehose: it carries one entry, not the whole ticket,
    // so it appends to the feed and to that ticket's log in place.
    if (payload.type === "log") {
      const line = { ...toLine(payload.ticketId, payload.entry), id: ++feedSeq };
      set((state) => ({
        feed: [...state.feed, line].slice(-MAX_FEED),
        tickets: state.tickets.map((t) =>
          t.id === payload.ticketId ? { ...t, log: [...(t.log ?? []), payload.entry].slice(-400) } : t
        ),
      }));
      return;
    }

    if (payload.type === "deleted") {
      set((state) => ({
        tickets: state.tickets.filter((t) => t.id !== payload.ticketId),
        selectedId: state.selectedId === payload.ticketId ? null : state.selectedId,
      }));
      return;
    }

    if (payload.type === "config") {
      set({ defaultMode: payload.defaultMode });
      return;
    }

    // Agent .md files change from two directions — this UI, and someone editing
    // the file in their editor. The server broadcasts both down this socket, so
    // refetching here is what makes an external edit repaint the sidebar live.
    if (payload.type === "agent" || payload.type === "agent-deleted") {
      useAgents.getState().hydrate();
      return;
    }

    const ticket = payload.ticket;
    if (!ticket) return;

    set((state) => {
      const exists = state.tickets.some((t) => t.id === ticket.id);
      return {
        tickets: exists
          ? state.tickets.map((t) => (t.id === ticket.id ? ticket : t))
          : [ticket, ...state.tickets],
      };
    });
  },

  clearFeed() {
    set({ feed: [] });
  },

  async setMode(id, mode) {
    await post(`/api/tickets/${id}/mode`, { mode });
  },

  async setAgent(id, agentId) {
    await post(`/api/tickets/${id}/agent`, { agentId });
  },

  async analyzeTicket(id) {
    await post(`/api/tickets/${id}/analyze`);
  },

  async runTicket(id) {
    await post(`/api/tickets/${id}/run`);
  },

  async approveTicket(id) {
    await post(`/api/tickets/${id}/approve`);
  },

  async cancelTicket(id) {
    await post(`/api/tickets/${id}/cancel`);
  },

  async reopenTicket(id) {
    await post(`/api/tickets/${id}/reopen`);
  },

  // QA gate — once QA posts a verdict the ticket waits on a human to ship it
  // or send it back for another pass (see qaVerdict / awaitingQa on the ticket).
  async qaApprove(id) {
    await post(`/api/tickets/${id}/qa/approve`);
  },

  async qaReject(id) {
    await post(`/api/tickets/${id}/qa/reject`);
  },

  /** Commit → push → PR. Resolves to the server's result so the card can
   *  surface a failure instead of silently doing nothing. */
  async shipTicket(id) {
    const res = await post(`/api/tickets/${id}/ship`);
    return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  },

  async deleteTicket(id) {
    await fetch(`/api/tickets/${id}`, { method: "DELETE" });
  },

  async createTicket(payload) {
    const res = await post("/api/tickets", { source: "manual", ...payload });
    return res?.json();
  },
}));

function toLine(ticketId, entry) {
  return {
    ticketId,
    ts: entry.ts ?? new Date().toISOString(),
    tone: tone(entry),
    text: describe(entry),
  };
}

function post(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
