import chalk from "chalk";
import { SERVICES, stopService } from "../lib/daemon.js";

// Stops the listener first, then the dashboard: the bot posts tickets to the
// dashboard's API, so killing the dashboard first would leave the bot briefly
// answering people with "couldn't reach the ouro dashboard".
const ORDER = ["listen", "dashboard"];

export async function stopCommand() {
  const results = [];
  for (const name of ORDER) {
    results.push(await stopService(name));
  }

  for (const r of results) {
    if (r.stopped) {
      console.log(chalk.green("✔ stopped ") + chalk.gray(`${r.name} (pid ${r.pid})${r.forced ? " — forced" : ""}`));
    } else if (r.reason === "not running") {
      console.log(chalk.gray(`• ${r.name} wasn't running`));
    } else {
      console.log(chalk.yellow(`! ${r.name}: ${r.reason}`));
    }
  }

  const stuck = results.filter((r) => !r.stopped && r.reason === "refused to die");
  if (stuck.length) {
    console.log("");
    console.log(chalk.red("Some processes wouldn't stop. Kill them by pid manually:"));
    for (const r of stuck) console.log(chalk.gray(`  ${r.name}: pid ${r.pid}`));
    process.exitCode = 1;
    return;
  }

  if (results.every((r) => r.reason === "not running")) return;
  console.log("");
  console.log(chalk.gray("ouro is stopped. Any in-flight agent runs were killed with it."));
}

export { SERVICES };
