import express from "express";
import http from "node:http";
import { WebSocketServer } from "ws";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { store } from "../lib/store.js";
import { triage, runAgent, planTicket, executeTicket, getBackendName, setBackendName } from "../lib/agentBackend.js";
import { createTicketWorktree, diffWorktree } from "../lib/worktree.js";
import { readConfig, getDefaultMode, setDefaultMode, getAutoShip } from "../lib/config.js";
import { shipTicket } from "../lib/ship.js";
import * as runs from "../lib/runs.js";
import {
  listAgents,
  getAgent,
  getAgentRaw,
  saveAgent,
  saveAgentRaw,
  createAgent,
  deleteAgent,
  defaultAgentId,
  agentEvents,
  TOOL_UNIVERSE,
} from "../lib/agents.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Bundled inside the cli package itself (copied here at build time — see
// packages/cli's `prepublishOnly` script) so this works whether ouro is
// running from the monorepo, `npm link`, or a real `npm install` on
// someone else's machine. It must NOT depend on the dashboard package
// being present as a sibling folder, since that only exists in this repo.
const DASHBOARD_DIST = path.resolve(__dirname, "../../dashboard-dist");

export function createServer() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  // An attached WebSocketServer re-emits the http server's listen errors. With
  // no listener here, EADDRINUSE becomes an uncaught exception that kills the
  // process with a stack trace before dashboardCommand's `server.on("error")`
  // can print the readable "port already in use" message. Defer to that
  // handler for listen errors; surface anything else rather than swallow it.
  wss.on("error", (err) => {
    if (err.code === "EADDRINUSE" || err.code === "EACCES") return;
    console.error("[ws] server error:", err.message);
  });

  function broadcast(payload) {
    const msg = JSON.stringify(payload);
    wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(msg);
    });
  }

  store.on("change", broadcast);
  // Agent files are edited from the dashboard but also, deliberately, straight
  // on disk — both paths funnel through agentEvents so every connected client
  // repaints either way.
  agentEvents.on("change", broadcast);

  /** Resolves which agent .md drives a ticket: explicit assignment, else default. */
  function resolveAgent(ticket) {
    const id = ticket.agentId ?? defaultAgentId();
    return id ? getAgent(id) : null;
  }

  /** A ticket's own mode wins; otherwise the board-wide default from config. */
  function resolveMode(ticket) {
    return ticket.mode ?? getDefaultMode();
  }

  // --- tickets ---

  app.get("/api/tickets", (_req, res) => {
    res.json(store.list());
  });

  app.post("/api/tickets", (req, res) => {
    const { title, body, source, agentId, mode, priority, summary } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: "title is required" });
    res.json(store.create({ title: title.trim(), body: body ?? "", source, agentId, mode, priority, summary }));
  });

  app.post("/api/tickets/:id/triage", async (req, res) => {
    const ticket = store.get(req.params.id);
    if (!ticket) return res.status(404).json({ error: "not found" });

    res.json({ started: true });

    try {
      const result = await triage({
        prompt: `Analyze this ticket and summarize it, estimate priority, and list files likely affected.\nTitle: ${ticket.title}\nBody: ${ticket.body}`,
        cwd: process.cwd(),
      });
      store.update(ticket.id, {
        status: "triaged",
        summary: result.summary,
        priority: result.priority,
      });
    } catch (err) {
      store.appendLog(ticket.id, { type: "error", text: String(err) });
    }
  });

  app.post("/api/tickets/:id/mode", (req, res) => {
    const { mode } = req.body; // "agent" | "human" | null (inherit board default)
    if (mode !== null && mode !== "agent" && mode !== "human") {
      return res.status(400).json({ error: "mode must be 'agent', 'human', or null" });
    }
    const ticket = store.update(req.params.id, { mode });
    if (!ticket) return res.status(404).json({ error: "not found" });
    res.json(ticket);
  });

  app.post("/api/tickets/:id/agent", (req, res) => {
    const { agentId } = req.body;
    if (agentId && !getAgent(agentId)) return res.status(400).json({ error: `no such agent: ${agentId}` });
    const ticket = store.update(req.params.id, { agentId: agentId ?? null });
    if (!ticket) return res.status(404).json({ error: "not found" });
    res.json(ticket);
  });

  app.post("/api/tickets/:id/run", async (req, res) => {
    const ticket = store.get(req.params.id);
    if (!ticket) return res.status(404).json({ error: "not found" });
    if (runs.isRunning(ticket.id)) return res.status(409).json({ error: "already running" });

    const mode = resolveMode(ticket);
    const agent = resolveAgent(ticket);

    let signal;
    try {
      signal = runs.begin(ticket.id, mode);
    } catch (err) {
      return res.status(409).json({ error: String(err.message || err) });
    }

    res.json({ started: true, mode, agentId: agent?.id ?? null });
    store.update(ticket.id, { status: "in_progress", mode, agentId: agent?.id ?? ticket.agentId, cancelReason: null });

    const onEvent = (event) => store.appendLog(ticket.id, { type: "agent_event", event });

    try {
      const { dir: worktreeDir, branch, base } = await createTicketWorktree(ticket.id);
      store.update(ticket.id, { worktree: worktreeDir, branch, baseBranch: base });

      const prompt = `Ticket: ${ticket.title}\n\n${ticket.body}\n\nImplement this and run relevant tests.`;

      if (mode === "agent") {
        // Full autonomy, single call.
        const result = await runAgent({ prompt, cwd: worktreeDir, onEvent, signal, agent });
        if (result.aborted) return; // cancel route already marked it
        const diff = await diffWorktree(ticket.id).catch(() => null);
        store.update(ticket.id, { status: "review", diff, sessionId: result.sessionId, awaitingApproval: false });
        // Agent mode is the no-pauses path: an unpushed branch in a local
        // worktree isn't a finished ticket, so carry it through to a PR.
        if (getAutoShip()) await shipTicket(ticket.id);
      } else {
        // Human-in-the-loop: plan only, no writes yet. The card shows the
        // plan and waits for an explicit Approve before phase 2 runs.
        const result = await planTicket({ prompt, cwd: worktreeDir, onEvent, signal, agent });
        if (result.aborted) return;
        store.update(ticket.id, {
          status: "review",
          sessionId: result.sessionId,
          plan: result.lastMessage,
          awaitingApproval: true,
        });
      }
    } catch (err) {
      store.appendLog(ticket.id, { type: "error", text: String(err.message || err) });
      store.cancel(ticket.id, `Run failed: ${err.message || err}`);
    } finally {
      runs.end(ticket.id);
    }
  });

  app.post("/api/tickets/:id/approve", async (req, res) => {
    const ticket = store.get(req.params.id);
    if (!ticket) return res.status(404).json({ error: "not found" });
    if (!ticket.awaitingApproval) return res.status(409).json({ error: "ticket is not awaiting approval" });
    if (runs.isRunning(ticket.id)) return res.status(409).json({ error: "already running" });

    let signal;
    try {
      signal = runs.begin(ticket.id, "execute");
    } catch (err) {
      return res.status(409).json({ error: String(err.message || err) });
    }

    res.json({ started: true });
    store.update(ticket.id, { status: "in_progress", awaitingApproval: false });

    const onEvent = (event) => store.appendLog(ticket.id, { type: "agent_event", event });

    try {
      const result = await executeTicket({
        cwd: ticket.worktree,
        sessionId: ticket.sessionId,
        onEvent,
        signal,
        agent: resolveAgent(ticket),
      });
      if (result.aborted) return;
      const diff = await diffWorktree(ticket.id).catch(() => null);
      store.update(ticket.id, { status: "review", diff, sessionId: result.sessionId });
      // You already approved the plan — the PR is the point of that approval,
      // so don't stop one step short of it.
      if (getAutoShip()) await shipTicket(ticket.id);
    } catch (err) {
      store.appendLog(ticket.id, { type: "error", text: String(err.message || err) });
      store.cancel(ticket.id, `Execute failed: ${err.message || err}`);
    } finally {
      runs.end(ticket.id);
    }
  });

  // Manual ship — the button on a Review card, and the retry path when
  // autoShip is off or a push/PR failed the first time.
  app.post("/api/tickets/:id/ship", async (req, res) => {
    const ticket = store.get(req.params.id);
    if (!ticket) return res.status(404).json({ error: "not found" });
    if (!ticket.worktree) return res.status(409).json({ error: "this ticket has never run — nothing to ship" });
    if (runs.isRunning(ticket.id)) return res.status(409).json({ error: "still running" });

    const result = await shipTicket(ticket.id);
    if (!result.ok && result.error) return res.status(422).json(result);
    res.json(result);
  });

  app.post("/api/tickets/:id/cancel", (req, res) => {
    const ticket = store.get(req.params.id);
    if (!ticket) return res.status(404).json({ error: "not found" });

    // Cancelling a queued/awaiting ticket is just as valid as killing a live
    // run — there may be no child process to signal, and that's not an error.
    const killed = runs.cancel(ticket.id);
    const reason = req.body?.reason ?? (killed ? "Run cancelled from the dashboard." : "Cancelled from the dashboard.");
    store.appendLog(ticket.id, { type: "cancelled", text: reason });
    res.json(store.cancel(ticket.id, reason));
  });

  app.post("/api/tickets/:id/reopen", (req, res) => {
    const ticket = store.reopen(req.params.id);
    if (!ticket) return res.status(404).json({ error: "not found" });
    res.json(ticket);
  });

  app.delete("/api/tickets/:id", (req, res) => {
    runs.cancel(req.params.id); // don't leave an orphaned child behind
    if (!store.remove(req.params.id)) return res.status(404).json({ error: "not found" });
    res.json({ deleted: true });
  });

  app.get("/api/runs", (_req, res) => {
    res.json(runs.activeRuns());
  });

  // --- agents (backed by .ouro/agents/*.md) ---

  app.get("/api/agents", (_req, res) => {
    res.json({ agents: listAgents(), toolUniverse: TOOL_UNIVERSE, defaultAgentId: defaultAgentId() });
  });

  app.post("/api/agents", (req, res) => {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    res.json(createAgent({ name: name.trim() }));
  });

  app.get("/api/agents/:id", (req, res) => {
    const agent = getAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: "not found" });
    res.json({ ...agent, raw: getAgentRaw(req.params.id) });
  });

  app.patch("/api/agents/:id", (req, res) => {
    try {
      // `raw` replaces the whole file; anything else is a structured field
      // patch. The dashboard offers both, so the route accepts both.
      const agent = req.body.raw !== undefined
        ? saveAgentRaw(req.params.id, req.body.raw)
        : saveAgent(req.params.id, req.body);
      if (!agent) return res.status(404).json({ error: "not found" });
      res.json({ ...agent, raw: getAgentRaw(req.params.id) });
    } catch (err) {
      res.status(400).json({ error: String(err.message || err) });
    }
  });

  app.delete("/api/agents/:id", (req, res) => {
    if (!deleteAgent(req.params.id)) return res.status(404).json({ error: "not found" });
    res.json({ deleted: true });
  });

  // --- config (backend + default mode) ---

  app.get("/api/config", (_req, res) => {
    const config = readConfig();
    // `pid` is here so `ouro start` can tell *this* server apart from another
    // ouro already holding the port. Without it, a probe that gets a 200 only
    // proves someone is listening — not that the process we just spawned is
    // the one answering.
    res.json({ backend: getBackendName(), defaultMode: getDefaultMode(), autoShip: getAutoShip(), pid: process.pid, config });
  });

  app.post("/api/config/backend", (req, res) => {
    try {
      res.json({ backend: setBackendName(req.body.backend) });
    } catch (err) {
      res.status(400).json({ error: String(err.message || err) });
    }
  });

  app.post("/api/config/mode", (req, res) => {
    try {
      const mode = setDefaultMode(req.body.mode);
      broadcast({ type: "config", defaultMode: mode });
      res.json({ defaultMode: mode });
    } catch (err) {
      res.status(400).json({ error: String(err.message || err) });
    }
  });

  // --- static dashboard ---
  app.use(express.static(DASHBOARD_DIST));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(DASHBOARD_DIST, "index.html"));
  });

  return server;
}
