#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { loadEnvFile } from "./lib/env.js";
import { initCommand } from "./commands/init.js";
import { dashboardCommand } from "./commands/dashboard.js";
import { listenCommand } from "./commands/listen.js";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";
import { statusCommand } from "./commands/status.js";
import { logsCommand } from "./commands/logs.js";

// Before any command reads a token: the detached daemon has no shell to
// inherit exports from, so `.ouro/.env` is what survives a closed terminal or
// a reboot. A real export still wins over the file. See lib/env.js.
loadEnvFile();

const program = new Command();

program
  .name("ouro")
  .description(
    "Loop engineering CLI — roots into your repo, gives you a kanban board\n" +
      "and agents that run on your existing Claude Code / Codex subscription.\n" +
      "No API key required."
  )
  .version("0.1.0");

program
  .command("init")
  .description("Configure the current repo for ouro (creates .ouro/ config + ticket store)")
  .option("--backend <backend>", "claude-code | codex", "claude-code")
  .option("--spec", "if no CLAUDE.md / AGENTS.md exists, reverse-engineer one (read-only, best-effort)")
  .action(initCommand);

program
  .command("start")
  .description("Start the dashboard + Telegram intake agent in the background (survives closing the terminal)")
  .option("-p, --port <port>", "port to run the dashboard server on", "4747")
  .option("--no-listen", "start only the dashboard, without the Telegram intake agent")
  .action(startCommand);

program.command("stop").description("Stop the background services and any agent runs they own").action(stopCommand);

program
  .command("restart")
  .description("Stop, then start, the background services")
  .option("-p, --port <port>", "port to run the dashboard server on", "4747")
  .option("--no-listen", "start only the dashboard, without the Telegram intake agent")
  .action(async (opts) => {
    await stopCommand();
    console.log("");
    await startCommand(opts);
  });

program.command("status").description("Show what's running in the background").action(statusCommand);

program
  .command("logs [service]")
  .description("Show background service logs (dashboard | listen)")
  .option("-f, --follow", "keep printing new output as it arrives")
  .option("-n, --lines <n>", "how many lines of history to show", "40")
  .action(logsCommand);

// The two foreground commands `start` supervises. Run them directly to watch a
// service in this terminal — useful when debugging one that won't stay up.
program
  .command("dashboard")
  .description("Run the dashboard in the foreground (see also: ouro start)")
  .option("-p, --port <port>", "port to run the dashboard server on", "4747")
  .option("--no-open", "don't auto-open the browser")
  .action(dashboardCommand);

program
  .command("listen")
  .description("Run the Telegram intake agent in the foreground (see also: ouro start)")
  .action(listenCommand);

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red("ouro: fatal error"), err);
  process.exit(1);
});
