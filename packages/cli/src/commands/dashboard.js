import chalk from "chalk";
import open from "open";
import { createServer } from "../server/index.js";
import { isInitialized } from "../lib/paths.js";
import { seedDefaultAgents } from "../lib/agents.js";
import { store } from "../lib/store.js";
import * as runs from "../lib/runs.js";
import { stopAllPreviews } from "../lib/preview.js";

export async function dashboardCommand(opts) {
  if (!isInitialized()) {
    console.log(chalk.yellow("This repo isn't initialized yet. Run ") + chalk.cyan("ouro init") + chalk.yellow(" first."));
    return;
  }

  // A repo initialized before agents existed has no .ouro/agents/, and a board
  // with no agent to run as is a dead board. Cheap to top up on every boot.
  seedDefaultAgents();

  const port = Number(opts.port) || 4747;
  const server = createServer();

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.log(chalk.red(`Port ${port} is already in use.`) + ` Try ${chalk.cyan(`ouro dashboard --port ${port + 1}`)}.`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(chalk.green("✔ ouro dashboard running at ") + chalk.cyan(url));
    if (opts.open !== false) open(url);
  });

  // Ctrl-C with a run in flight would otherwise orphan the child CLI process
  // and drop whatever the debounced store write hadn't flushed yet.
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    console.log(chalk.gray("\nShutting down — stopping agent runs…"));
    runs.cancelAll();
    stopAllPreviews();
    store.flush();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref(); // don't hang on a stuck socket
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
