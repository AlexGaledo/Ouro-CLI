import fs from "node:fs";
import chalk from "chalk";
import { SERVICES, logFile, tailLog } from "../lib/daemon.js";

// `ouro logs [service] [-f]` — a background service's stdout has to land
// somewhere reachable, or the daemon is a black box.

const COLORS = { dashboard: chalk.cyan, listen: chalk.magenta };

function print(name, line, tagged) {
  const color = COLORS[name] ?? chalk.gray;
  console.log(tagged ? color(`[${name}] `) + line : line);
}

export async function logsCommand(service, opts) {
  const names = service ? [service] : SERVICES;

  for (const name of names) {
    if (!SERVICES.includes(name)) {
      console.log(chalk.red(`Unknown service "${name}".`) + chalk.gray(` Try: ${SERVICES.join(", ")}`));
      process.exitCode = 1;
      return;
    }
  }

  const tagged = names.length > 1;
  const count = Number(opts.lines) || 40;

  for (const name of names) {
    const lines = tailLog(name, count);
    if (lines.length === 0) {
      print(name, chalk.gray("(no output yet)"), tagged);
      continue;
    }
    for (const line of lines) print(name, line, tagged);
  }

  if (!opts.follow) return;

  console.log(chalk.gray(`\n— following ${names.join(", ")}; Ctrl-C to stop —\n`));

  // Poll by size rather than fs.watch: watch is unreliable across platforms
  // for append-only writes (and on Windows can miss them entirely), and a
  // 400ms poll on a log file costs nothing.
  const offsets = new Map(
    names.map((name) => {
      try {
        return [name, fs.statSync(logFile(name)).size];
      } catch {
        return [name, 0];
      }
    })
  );

  // Runs until the process is interrupted — see the note below.
  setInterval(() => {
    for (const name of names) {
      const file = logFile(name);
      let size;
      try {
        size = fs.statSync(file).size;
      } catch {
        continue; // not created yet
      }

      const from = offsets.get(name) ?? 0;
      // Shrank — the log rotated. Start from the top of the new file.
      if (size < from) {
        offsets.set(name, 0);
        continue;
      }
      if (size === from) continue;

      const fd = fs.openSync(file, "r");
      try {
        const buf = Buffer.alloc(size - from);
        fs.readSync(fd, buf, 0, buf.length, from);
        for (const line of buf.toString("utf-8").split(/\r?\n/).filter(Boolean)) print(name, line, tagged);
      } finally {
        fs.closeSync(fd);
      }
      offsets.set(name, size);
    }
  }, 400);

  // Follow until interrupted. No SIGINT handler on purpose: registering one
  // *overrides* Node's default "die on Ctrl-C", so a handler that only clears
  // a timer can leave the process alive and unkillable by Ctrl-C. Letting the
  // default stand is both simpler and the behaviour every tail tool has.
  await new Promise(() => {});
}
