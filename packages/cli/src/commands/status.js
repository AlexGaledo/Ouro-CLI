import chalk from "chalk";
import { statusAll, uptime, logFile } from "../lib/daemon.js";
import { readConfig } from "../lib/config.js";
import { hasEnvFile } from "../lib/env.js";

// `ouro status` — the only window into a process you can't see.
// Reports what's actually true, including the awkward cases: a dashboard whose
// pid is alive but whose port stopped answering, and a listener with no token.

async function probe(port) {
  try {
    const res = await fetch(`http://localhost:${port}/api/config`, { signal: AbortSignal.timeout(1500) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function statusCommand() {
  const services = statusAll();
  const dashboard = services.find((s) => s.name === "dashboard");
  const listen = services.find((s) => s.name === "listen");

  const health = dashboard?.running && dashboard.port ? await probe(dashboard.port) : null;

  console.log("");
  for (const svc of services) {
    if (!svc.running) {
      console.log(chalk.gray(`  ○ ${svc.name.padEnd(10)} stopped${svc.stale ? " (cleaned up a stale pid file)" : ""}`));
      continue;
    }
    const bits = [`pid ${svc.pid}`, `up ${uptime(svc.startedAt)}`];
    if (svc.port) bits.push(`port ${svc.port}`);
    console.log(chalk.green(`  ● ${svc.name.padEnd(10)} running `) + chalk.gray(bits.join(" · ")));
  }

  // A live pid whose port doesn't answer is the failure mode a pid check alone
  // would miss — the process is up but wedged. Worth calling out loudly.
  if (dashboard?.running && dashboard.port && !health) {
    console.log("");
    console.log(chalk.yellow(`  ! dashboard pid is alive but port ${dashboard.port} isn't answering.`));
    console.log(chalk.gray(`    Try: `) + chalk.cyan("ouro restart") + chalk.gray(`   Log: ${logFile("dashboard")}`));
  }

  // The port answers, but not from the process we're tracking — another ouro
  // owns it. Reporting its backend/mode as ours would be describing someone
  // else's server.
  if (health && dashboard?.running && health.pid && health.pid !== dashboard.pid) {
    console.log("");
    console.log(chalk.yellow(`  ! port ${dashboard.port} is served by a different ouro (pid ${health.pid}), not ours (pid ${dashboard.pid}).`));
    console.log(chalk.gray("    The details below describe that other instance."));
  }

  if (health) {
    console.log("");
    console.log(chalk.gray("  backend      ") + health.backend);
    console.log(chalk.gray("  default mode ") + health.defaultMode);
    console.log(chalk.gray("  url          ") + chalk.cyan(`http://localhost:${dashboard.port}`));
  }

  if (!listen?.running) {
    const tokenVar = readConfig().telegram?.botTokenEnvVar ?? "OURO_TELEGRAM_BOT_TOKEN";
    if (!process.env[tokenVar]) {
      console.log("");
      console.log(chalk.gray(`  Telegram intake is off — ${tokenVar} is not set`) + (hasEnvFile() ? chalk.gray(" (not in .ouro/.env either)") : ""));
    }
  }
  console.log("");
}
