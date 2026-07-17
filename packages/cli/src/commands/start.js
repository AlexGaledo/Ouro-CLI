import chalk from "chalk";
import { isInitialized } from "../lib/paths.js";
import { telegramTokenVar } from "../lib/config.js";
import { seedDefaultAgents } from "../lib/agents.js";
import { startService, serviceStatus, stopService, tailLog, isAlive, logFile, updateRecord } from "../lib/daemon.js";

// `ouro start` — both services, detached, surviving this terminal.
//
// The hard rule here: never print "started" for something that isn't up. A
// daemon you can't see is only trustworthy if its start command actually
// verifies, so the dashboard is probed over HTTP and the listener is checked
// for still being alive a beat later. A service that died gets its log tail
// printed inline rather than leaving you to go find it.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Waits for the dashboard we just spawned to answer on `port`.
 *
 * Checks the pid the server reports, not just that *something* replied: if
 * another ouro already owns the port, our child dies of EADDRINUSE while the
 * incumbent happily answers the probe — which would otherwise be reported as
 * a successful start against a process that no longer exists.
 */
async function waitForDashboard(port, pid, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/api/config`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.pid === pid) return { ok: true };
        // Someone else is on this port. Our child is doomed (or already dead).
        if (body.pid) return { ok: false, reason: "port-taken", byPid: body.pid };
      }
    } catch {
      // not up yet
    }

    // Died before binding — the log has the reason (usually the port).
    if (!isAlive(pid)) return { ok: false, reason: "exited" };
    await sleep(250);
  }
  return { ok: false, reason: "timeout" };
}

export async function startCommand(opts) {
  if (!isInitialized()) {
    console.log(chalk.yellow("This repo isn't initialized yet. Run ") + chalk.cyan("ouro init") + chalk.yellow(" first."));
    process.exitCode = 1;
    return;
  }

  seedDefaultAgents();

  const port = Number(opts.port) || 4747;
  const { name: tokenVar, error: tokenVarError } = telegramTokenVar();
  const wantListen = opts.listen !== false;

  // --- dashboard ---

  const existing = serviceStatus("dashboard");
  if (existing.running) {
    console.log(chalk.gray(`• dashboard already running (pid ${existing.pid}, port ${existing.port ?? "?"})`));
  } else {
    const record = startService("dashboard", ["--port", String(port), "--no-open"]);
    process.stdout.write(chalk.gray("• starting dashboard… "));

    const result = await waitForDashboard(port, record.pid);

    if (result.ok) {
      // Record the port so status/logs can report it without re-deriving it.
      updateRecord("dashboard", { port });
      console.log(chalk.green("ok"));
    } else {
      console.log(chalk.red("failed"));

      if (result.reason === "port-taken") {
        console.log(chalk.red(`  Port ${port} is already served by another ouro dashboard (pid ${result.byPid}).`));
        console.log(chalk.gray("  That one wasn't started by ") + chalk.cyan("ouro start") + chalk.gray(", so ouro stop won't manage it."));
        console.log(chalk.gray("  Either use it as-is, stop it yourself, or pick another port:"));
        console.log(chalk.cyan(`    ouro start --port ${port + 1}`));
      } else if (result.reason === "exited") {
        console.log(chalk.red("  The dashboard process exited during startup:"));
      } else {
        console.log(chalk.red(`  The dashboard didn't answer on port ${port} within 15s.`));
      }

      // Only this run's output — see startService's logOffset.
      for (const line of tailLog("dashboard", 12, record.logOffset)) console.log(chalk.gray("  │ " + line));
      // Don't leave a dead process's pid file behind for stop/status to trust.
      await stopService("dashboard");
      console.log(chalk.gray(`  Full log: ${logFile("dashboard")}`));
      process.exitCode = 1;
      return;
    }
  }

  // --- telegram listener ---

  let listenUp = false;

  // A token sitting in config.json is a token on its way into git, whether or
  // not the listener can start without it — so this is said every time, not
  // only on the path where the start fails.
  if (tokenVarError) {
    console.log(chalk.red("• Telegram config problem:"));
    for (const line of tokenVarError.split("\n")) console.log(chalk.yellow(`  ${line}`));
  }

  if (!wantListen) {
    console.log(chalk.gray("• listener skipped (--no-listen)"));
  } else if (!process.env[tokenVar]) {
    // Spawning it anyway would produce a process that exits instantly and a
    // "started" line that's a lie. Say what's missing and how to fix it.
    console.log(chalk.yellow(`• listener skipped — ${tokenVar} is not set.`));
    console.log(chalk.gray(`  Paste your @BotFather token into Settings at `) + chalk.cyan(`http://localhost:${port}`) + chalk.gray(` — it starts the bot for you.`));
    console.log(chalk.gray(`  Or, from here (the daemon can't read your shell's exports after you close it):`));
    console.log(chalk.cyan(`    echo '${tokenVar}=<token>' >> .ouro/.env`) + chalk.gray("   # gitignored"));
    console.log(chalk.gray(`  Then: `) + chalk.cyan("ouro restart"));
  } else {
    const existingListen = serviceStatus("listen");
    if (existingListen.running) {
      console.log(chalk.gray(`• listener already running (pid ${existingListen.pid})`));
      listenUp = true;
    } else {
      const record = startService("listen");
      process.stdout.write(chalk.gray("• starting Telegram intake agent… "));
      // No endpoint to probe. listen.js validates the token via getMe() and
      // exits non-zero if Telegram rejects it, so "still alive a beat later"
      // is a real signal rather than just "the process spawned".
      await sleep(3000);

      if (isAlive(record.pid)) {
        console.log(chalk.green("ok"));
        listenUp = true;
      } else {
        console.log(chalk.red("failed"));
        for (const line of tailLog("listen", 8, record.logOffset)) console.log(chalk.gray("  │ " + line));
        console.log(chalk.gray(`  Full log: ${logFile("listen")}`));
        await stopService("listen");
      }
    }
  }

  console.log("");
  // Say what's actually up. The dashboard is running by this point, but
  // claiming "ouro is running" flat out would paper over a dead listener.
  const headline = listenUp
    ? "ouro is running in the background."
    : "Dashboard is running in the background — Telegram intake is not.";
  console.log(chalk.green(headline) + chalk.gray(" Closing this terminal won't stop it."));
  console.log(chalk.gray("  dashboard  ") + chalk.cyan(`http://localhost:${port}`));
  console.log(chalk.gray("  status     ") + chalk.cyan("ouro status"));
  console.log(chalk.gray("  logs       ") + chalk.cyan("ouro logs -f"));
  console.log(chalk.gray("  stop       ") + chalk.cyan("ouro stop"));
}
