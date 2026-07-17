import fs from "node:fs";
import { EventEmitter } from "node:events";
import { nanoid } from "nanoid";
import { ticketsPath, ensureOuroDir } from "./paths.js";

// Lightweight file-backed store. A hackathon-scale ticket board doesn't need
// sqlite/postgres — a JSON file + an in-memory EventEmitter for the WS layer
// is plenty, and it means `ouro init` produces zero external dependencies.

export const STATUSES = ["inbox", "analyzed", "in_progress", "staging", "done", "cancelled"];

// Legacy status values from before the Analyze/Staging rename. Mapped forward on
// load so a tickets.json written by an older ouro doesn't strand cards in a
// column that no longer exists.
const STATUS_MIGRATION = { triaged: "analyzed", review: "staging" };

// A streaming agent emits events far faster than a board needs to persist.
// Writes are coalesced onto a trailing timer so a chatty run costs one write
// per tick instead of one per line; every mutation still broadcasts instantly
// over WS, so the UI is live regardless of when the file lands.
const PERSIST_DEBOUNCE_MS = 250;

// Per-ticket log ceiling. The terminal dock only ever renders a tail, and an
// unbounded array would grow tickets.json without limit across a long run.
const MAX_LOG_ENTRIES = 400;

class TicketStore extends EventEmitter {
  constructor() {
    super();
    this.tickets = [];
    this._persistTimer = null;
    this._load();
  }

  _load() {
    ensureOuroDir();
    if (fs.existsSync(ticketsPath())) {
      try {
        this.tickets = JSON.parse(fs.readFileSync(ticketsPath(), "utf-8"));
      } catch {
        this.tickets = [];
      }
    }

    // A ticket left mid-run by a killed dashboard process has no live child
    // to reattach to, so it would otherwise sit spinning forever. Reconcile
    // it to a terminal state at startup instead.
    let reconciled = 0;
    for (const ticket of this.tickets) {
      // Forward-migrate legacy status names (triaged → analyzed, review → staging).
      if (STATUS_MIGRATION[ticket.status]) {
        ticket.status = STATUS_MIGRATION[ticket.status];
        reconciled++;
      }
      if (ticket.status === "in_progress") {
        ticket.status = "cancelled";
        ticket.cancelReason = "Dashboard stopped while this run was in flight.";
        reconciled++;
      }
      // A read-only Analyze pass has no worktree to reconcile — it just leaves
      // the ticket where it was. But a stranded `analyzing` flag would keep the
      // card stuck on "Analyzing…" forever, so clear it.
      if (ticket.analyzing) {
        ticket.analyzing = false;
        reconciled++;
      }
    }
    // Write it back immediately. Reconciling only in memory leaves the file
    // claiming in_progress until some unrelated edit happens to flush it —
    // so anything reading tickets.json directly (or a crash before the next
    // write) would still see a run that hasn't existed since the last boot.
    if (reconciled > 0) this.flush();
  }

  _persist() {
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this.flush();
    }, PERSIST_DEBOUNCE_MS);
  }

  /** Write immediately. Called on shutdown so a pending tick isn't lost. */
  flush() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    try {
      fs.writeFileSync(ticketsPath(), JSON.stringify(this.tickets, null, 2));
    } catch {
      // A failed write shouldn't take the dashboard down — the in-memory
      // state is still authoritative for this process.
    }
  }

  list() {
    return this.tickets;
  }

  get(id) {
    return this.tickets.find((t) => t.id === id);
  }

  create({ title, body, source = "manual", agentId = null, mode = null, priority = null, summary = null }) {
    const ticket = {
      id: nanoid(8),
      title,
      body,
      source,
      status: "inbox", // inbox -> analyzed -> in_progress -> staging -> done | cancelled
      mode, // "agent" | "human" — null inherits the board's default
      agentId, // which .ouro/agents/<id>.md runs this ticket
      priority,
      summary,
      // Analyst findings — carried forward into plan/execute (Feature 1 findings
      // passthrough) and validated by the QA gate.
      filesLikelyAffected: [],
      acceptanceCriteria: [],
      analyzing: false, // transient: the read-only Analyze pass is in flight
      sessionId: null,
      log: [],
      worktree: null,
      branch: null, // ouro/<id>, created with the worktree
      baseBranch: null, // what HEAD was when the worktree was cut — the PR's target
      diff: null,
      plan: null,
      prUrl: null, // set once the ticket ships
      shipNote: null, // why it didn't ship, when it didn't
      awaitingApproval: false,
      cancelReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.tickets.unshift(ticket);
    this._persist();
    this.emit("change", { type: "created", ticket });
    return ticket;
  }

  update(id, patch) {
    const ticket = this.get(id);
    if (!ticket) return null;
    Object.assign(ticket, patch, { updatedAt: new Date().toISOString() });
    this._persist();
    this.emit("change", { type: "updated", ticket });
    return ticket;
  }

  appendLog(id, entry) {
    const ticket = this.get(id);
    if (!ticket) return null;

    const record = { ts: new Date().toISOString(), ...entry };
    ticket.log.push(record);
    if (ticket.log.length > MAX_LOG_ENTRIES) {
      ticket.log.splice(0, ticket.log.length - MAX_LOG_ENTRIES);
    }
    ticket.updatedAt = record.ts;
    this._persist();

    // Log traffic is the terminal dock's firehose. It ships the single new
    // entry rather than the whole ticket, so a long run doesn't re-send its
    // entire history down the socket on every line.
    this.emit("change", { type: "log", ticketId: id, entry: record });
    return ticket;
  }

  /**
   * Terminal transition for a run that was killed. Distinct from `update`
   * only in that it clears the mid-run fields a cancelled ticket shouldn't
   * keep showing (pending approval, half-written plan).
   */
  cancel(id, reason) {
    const ticket = this.get(id);
    if (!ticket) return null;
    return this.update(id, {
      status: "cancelled",
      awaitingApproval: false,
      analyzing: false,
      cancelReason: reason ?? "Cancelled from the dashboard.",
    });
  }

  /** Back to the board as a fresh analyzed ticket, keeping title/body/agent. */
  reopen(id) {
    const ticket = this.get(id);
    if (!ticket) return null;
    return this.update(id, {
      status: ticket.summary ? "analyzed" : "inbox",
      awaitingApproval: false,
      analyzing: false,
      cancelReason: null,
      diff: null,
      plan: null,
      sessionId: null,
      log: [],
    });
  }

  remove(id) {
    const index = this.tickets.findIndex((t) => t.id === id);
    if (index === -1) return false;
    this.tickets.splice(index, 1);
    this._persist();
    this.emit("change", { type: "deleted", ticketId: id });
    return true;
  }
}

// Singleton — one store per running `ouro dashboard` process.
export const store = new TicketStore();
