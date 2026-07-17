import express from "express";
import http from "node:http";
import { WebSocketServer } from "ws";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { store } from "../lib/store.js";
import { analyze, runAgent, planTicket, executeTicket, getBackendName, setBackendName } from "../lib/agentBackend.js";
import { createTicketWorktree, diffWorktree } from "../lib/worktree.js";
import { readConfig, writeConfig, getDefaultMode, setDefaultMode, getAutoShip, telegramTokenVar } from "../lib/config.js";
import { readEnvVars, writeEnvVars } from "../lib/env.js";
import { looksLikeToken, maskToken, verifyBotToken } from "../lib/telegram.js";
import { startService, stopService, serviceStatus, isAlive, tailLog, uptime } from "../lib/daemon.js";
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Everything the Settings screen needs to describe Telegram intake, and
 * nothing it doesn't — the token itself never leaves this process. This API has
 * no auth, so a masked hint is the most a GET is allowed to give up.
 */
function telegramStatus() {
  const config = readConfig();
  const { name: tokenVar, error: configError } = telegramTokenVar();
  const token = process.env[tokenVar];
  const listen = serviceStatus("listen");

  return {
    tokenVar,
    // A hand-edited config.json that put a token where a var name goes. The
    // screen has to say so: the token is exposed, and nothing else here would
    // explain why intake is off.
    configError: configError ?? null,
    configured: Boolean(token),
    tokenHint: token ? maskToken(token) : null,
    // Only a token in `.ouro/.env` survives a reboot; a shell export dies with
    // the terminal that started the daemon. The UI has to be able to say which
    // of the two you have, or "configured" is a promise it can't keep.
    persisted: Boolean(readEnvVars()[tokenVar]),
    // Whoever the token last verified as. Stale if someone hand-edits .env —
    // "Test connection" is what re-grounds it.
    bot: config.telegram?.bot ?? null,
    listener: {
      running: Boolean(listen.running),
      pid: listen.running ? listen.pid : null,
      uptime: listen.running ? uptime(listen.startedAt) : null,
    },
  };
}

/**
 * Restarts the Telegram intake service so a token pasted into the dashboard
 * takes effect without a trip back to the terminal. `listen` reads its token
 * once at startup — there's nothing to hot-reload, so the restart *is* the
 * mechanism.
 *
 * The child goes through lib/daemon.js like any other, so it lands in the same
 * pid file `ouro status` reads and `ouro stop` kills. A listener started from
 * here is not a second, invisible kind of process.
 */
async function restartListener() {
  await stopService("listen");
  const record = startService("listen");

  // listen.js validates the token with getMe() and exits non-zero if Telegram
  // rejects it, so "still alive a beat later" is a real signal — the same check
  // `ouro start` makes. Skip it and we'd report "running" for a process that
  // died half a second after we spawned it.
  await sleep(3000);
  if (isAlive(record.pid)) return { ok: true, pid: record.pid };
  return { ok: false, log: tailLog("listen", 8, record.logOffset) };
}

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

  /**
   * The prompt handed to a plan/execute run. When the ticket has been analyzed,
   * its findings ride along (Feature 1 findings passthrough) so the engineer
   * starts from the analysis rather than re-scoping cold. This is the fallback
   * for session continuity: Claude Code can't --resume across the cwd change
   * between Analyze (repo root) and the run (worktree), so the findings travel
   * as prompt content instead of a resumed session. Acceptance criteria go in
   * verbatim — they're the contract the QA gate later validates against.
   */
  function buildImplementationPrompt(ticket) {
    const parts = [`Ticket: ${ticket.title}`, "", ticket.body || ""];
    if (ticket.summary) parts.push("", `Analysis summary: ${ticket.summary}`);
    if (ticket.filesLikelyAffected?.length) {
      parts.push("", `Files likely affected (from analysis): ${ticket.filesLikelyAffected.join(", ")}`);
    }
    if (ticket.acceptanceCriteria?.length) {
      parts.push("", "Acceptance criteria — your change must satisfy every item:");
      ticket.acceptanceCriteria.forEach((c, i) => parts.push(`${i + 1}. ${c}`));
    }
    parts.push(
      "",
      ticket.acceptanceCriteria?.length
        ? "Implement this and run relevant tests. Make sure every acceptance criterion above is met."
        : "Implement this and run relevant tests."
    );
    return parts.join("\n");
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

  app.post("/api/tickets/:id/analyze", async (req, res) => {
    const ticket = store.get(req.params.id);
    if (!ticket) return res.status(404).json({ error: "not found" });
    if (runs.isRunning(ticket.id)) return res.status(409).json({ error: "already running" });

    let signal;
    try {
      signal = runs.begin(ticket.id, "analyze");
    } catch (err) {
      return res.status(409).json({ error: String(err.message || err) });
    }

    res.json({ started: true });
    // Analyze is read-only and leaves the ticket where it is; a transient flag
    // drives the card's "Analyzing…" state without faking a worktree run.
    store.update(ticket.id, { analyzing: true });

    const onEvent = (event) => store.appendLog(ticket.id, { type: "agent_event", event });

    try {
      // Always the Analyst agent for this step, regardless of the ticket's
      // implementation agent. If it's been deleted, analyze runs agent-less.
      const analyst = getAgent("analyst");
      const result = await analyze({
        prompt: `Analyze this ticket: scope it, judge priority, name the files likely to change, and write explicit acceptance criteria.\nTitle: ${ticket.title}\nBody: ${ticket.body}`,
        cwd: process.cwd(),
        signal,
        onEvent,
        agent: analyst,
      });
      if (signal.aborted) return; // cancelled mid-analysis — /cancel already reconciled it
      store.update(ticket.id, {
        status: "analyzed",
        analyzing: false,
        summary: result.summary,
        priority: result.priority,
        filesLikelyAffected: Array.isArray(result.files_likely_affected) ? result.files_likely_affected : [],
        acceptanceCriteria: Array.isArray(result.acceptance_criteria) ? result.acceptance_criteria : [],
      });
    } catch (err) {
      store.update(ticket.id, { analyzing: false });
      store.appendLog(ticket.id, { type: "error", text: String(err.message || err) });
    } finally {
      runs.end(ticket.id);
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

      const prompt = buildImplementationPrompt(ticket);

      if (mode === "agent") {
        // Full autonomy, single call.
        const result = await runAgent({ prompt, cwd: worktreeDir, onEvent, signal, agent });
        if (result.aborted) return; // cancel route already marked it
        const diff = await diffWorktree(ticket.id).catch(() => null);
        store.update(ticket.id, { status: "staging", diff, sessionId: result.sessionId, awaitingApproval: false });
        // Agent mode is the no-pauses path: an unpushed branch in a local
        // worktree isn't a finished ticket, so carry it through to a PR.
        if (getAutoShip()) await shipTicket(ticket.id);
      } else {
        // Human-in-the-loop: plan only, no writes yet. The card shows the
        // plan and waits for an explicit Approve before phase 2 runs.
        const result = await planTicket({ prompt, cwd: worktreeDir, onEvent, signal, agent });
        if (result.aborted) return;
        store.update(ticket.id, {
          status: "staging",
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
      store.update(ticket.id, { status: "staging", diff, sessionId: result.sessionId });
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

  // Manual ship — the button on a Staging card, and the retry path when
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

  // --- telegram credentials ---
  //
  // Pasting a token here does what the README used to ask you to do by hand:
  // write `.ouro/.env`, then `ouro restart`. Both steps are the same ones the
  // CLI takes (lib/env.js, lib/daemon.js), so a token saved from the dashboard
  // and one echoed into the file are indistinguishable afterwards — this screen
  // is a front end for that file, not a second place credentials can live.

  app.get("/api/config/telegram", (_req, res) => {
    res.json(telegramStatus());
  });

  app.post("/api/config/telegram", async (req, res) => {
    const token = String(req.body?.botToken ?? "").trim();
    if (!token) return res.status(400).json({ error: "botToken is required" });
    if (!looksLikeToken(token)) {
      return res.status(400).json({
        error: "That doesn't look like a bot token. @BotFather issues them as 123456789:AA… — a bot id, a colon, then a 35-character secret.",
      });
    }

    // Verify before writing. A token that only fails later fails inside a
    // detached background process, where the evidence is a log file nobody is
    // tailing — so the round trip to Telegram happens while someone is still
    // looking at the screen that caused it.
    const check = await verifyBotToken(token);
    if (!check.ok) return res.status(422).json({ error: check.error });

    const { name: tokenVar } = telegramTokenVar();
    writeEnvVars({ [tokenVar]: token });
    // Shallow-merge by hand: writeConfig replaces top-level keys, so patching
    // `telegram` with a bare { bot } would drop botTokenEnvVar with it.
    writeConfig({ telegram: { ...readConfig().telegram, bot: check.bot } });

    const restart = await restartListener();
    res.json({ ...telegramStatus(), restart });
  });

  app.post("/api/config/telegram/test", async (_req, res) => {
    const { name: tokenVar } = telegramTokenVar();
    const token = process.env[tokenVar];
    if (!token) return res.status(409).json({ error: `${tokenVar} isn't set — save a token first.` });

    const check = await verifyBotToken(token);
    if (!check.ok) return res.status(422).json({ error: check.error });

    writeConfig({ telegram: { ...readConfig().telegram, bot: check.bot } });
    res.json({ ...telegramStatus(), verified: true });
  });

  app.delete("/api/config/telegram", async (_req, res) => {
    // Stop first: the listener holds the old token in memory, so leaving it up
    // would mean a bot still answering strangers with a credential the
    // dashboard now says is gone.
    await stopService("listen");
    writeEnvVars({ [telegramTokenVar().name]: null });
    const { bot, ...telegram } = readConfig().telegram ?? {};
    writeConfig({ telegram });
    res.json(telegramStatus());
  });

  // --- static dashboard ---
  app.use(express.static(DASHBOARD_DIST));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(DASHBOARD_DIST, "index.html"));
  });

  return server;
}
