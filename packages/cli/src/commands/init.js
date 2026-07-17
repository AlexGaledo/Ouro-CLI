import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { ensureOuroDir, isInitialized, agentsDir, ouroDir } from "../lib/paths.js";
import { writeConfig } from "../lib/config.js";
import { seedDefaultAgents } from "../lib/agents.js";

// What inside .ouro/ is machine state vs. yours.
//
// agents/*.md and config.json are meant to be committed — that's the whole
// point of agents-as-markdown. Everything here is either a secret (.env holds
// a bot token), a scratch checkout, or per-machine runtime noise.
const GITIGNORE = `# ouro runtime state — not yours to commit.
# agents/*.md and config.json are deliberately NOT ignored: they're the
# reviewable config this tool exists to give you.
.env
run/
logs/
worktrees/
tickets.json
`;

function writeGitignore() {
  const file = path.join(ouroDir(), ".gitignore");
  if (fs.existsSync(file)) return false;
  fs.writeFileSync(file, GITIGNORE);
  return true;
}

export async function initCommand(opts) {
  if (isInitialized()) {
    console.log(chalk.yellow("ouro is already initialized in this repo (.ouro/config.json exists)."));
    // Still top up agents and the gitignore — an install that predates either
    // feature has a config but neither, and would otherwise stay broken.
    const seeded = seedDefaultAgents();
    if (seeded) console.log(chalk.green(`✔ Added ${seeded} default agents in ${agentsDir()}`));
    if (writeGitignore()) console.log(chalk.green("✔ Added .ouro/.gitignore"));
    return;
  }

  ensureOuroDir();
  writeGitignore();

  const backend = opts?.backend === "codex" ? "codex" : "claude-code";

  writeConfig({
    version: 1,
    backend, // "claude-code" | "codex" — switchable anytime from the dashboard header
    telegram: {
      botTokenEnvVar: "OURO_TELEGRAM_BOT_TOKEN",
      chatIdEnvVar: "OURO_TELEGRAM_CHAT_ID",
    },
    defaultMode: "human", // "agent" | "human" — safe default is human-in-the-loop
  });

  const seeded = seedDefaultAgents();

  console.log(chalk.green("✔ ouro initialized.") + ` Created .ouro/config.json (backend: ${backend})`);
  console.log(chalk.green(`✔ Seeded ${seeded} agents`) + ` in .ouro/agents/ — plain markdown, edit them in your editor.`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Run " + chalk.cyan("ouro start") + " — dashboard + intake agent, in the background.");
  console.log(
    "  2. For Telegram intake, paste your @BotFather token into the dashboard's " +
      chalk.cyan("Settings") +
      " screen."
  );
  console.log(
    chalk.gray("     It's checked against Telegram, written to ") +
      chalk.cyan(".ouro/.env") +
      chalk.gray(" (gitignored), and the bot starts.")
  );
  console.log(chalk.gray("     Prefer the terminal? ") + chalk.cyan("echo 'OURO_TELEGRAM_BOT_TOKEN=<token>' >> .ouro/.env") + chalk.gray(" then ") + chalk.cyan("ouro restart"));
  console.log("  3. Check on them anytime with " + chalk.cyan("ouro status") + " or " + chalk.cyan("ouro logs -f") + ".");
}
