import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import { ensureOuroDir, isInitialized, agentsDir, ouroDir, repoRoot } from "../lib/paths.js";
import { writeConfig } from "../lib/config.js";
import { seedDefaultAgents } from "../lib/agents.js";

// What inside .ouro/ is machine state vs. yours.
//
// agents/, context/ and config.json are meant to be committed — that's the
// whole point of agents-as-markdown and a shared context folder. Everything
// else is a secret (.env holds a bot token), a scratch checkout, or per-machine
// runtime noise.
//
// The pattern is ignore-everything-then-unignore-safe, never the reverse: a new
// runtime file added in a later version is ignored by default (fails safe)
// rather than silently tracked until someone remembers to add it. The trailing
// .env guards keep a token out even if an un-ignore above is ever loosened.
const GITIGNORE = `# .ouro/.gitignore
# ignore everything by default
/*
# un-ignore only what's safe to commit
!agents/
!context/
!config.json
!.gitignore
# hard guard: secrets stay out even if a rule above is loosened later
.env
context/**/*.env
`;

// Headers of a .ouro/.gitignore this tool has written — the current default-deny
// form and the pre-default-deny form it replaced. An install predating the safe
// pattern gets upgraded; a hand-authored file (neither header) is left alone.
const OURO_GITIGNORE_SIGNATURES = ["# .ouro/.gitignore", "# ouro runtime state"];

/**
 * Writes/updates `.ouro/.gitignore`. Returns "created", "upgraded", "current",
 * or "kept" (an existing file we didn't recognise as ours — never clobbered).
 */
function writeGitignore() {
  const file = path.join(ouroDir(), ".gitignore");
  if (fs.existsSync(file)) {
    const current = fs.readFileSync(file, "utf-8");
    if (current === GITIGNORE) return "current";
    const ouroManaged = OURO_GITIGNORE_SIGNATURES.some((sig) => current.includes(sig));
    if (!ouroManaged) return "kept";
    fs.writeFileSync(file, GITIGNORE);
    return "upgraded";
  }
  fs.writeFileSync(file, GITIGNORE);
  return "created";
}

/**
 * The nested .ouro/.gitignore only works if no *outer* rule already excludes
 * the directory — git won't re-include a path under a parent an ancestor
 * .gitignore (root, or a global core.excludesFile) has excluded. So a user who
 * added `.ouro` to their root .gitignore would get every agent/config silently
 * untracked with no error. We can't safely edit their root file, but we can
 * detect the shadow and tell them exactly which rule to remove.
 *
 * Best-effort: probes a path the nested file explicitly un-ignores. If git is
 * absent or this isn't a repo, `git check-ignore` throws and we stay quiet.
 */
function warnIfOuroShadowed() {
  // Decide ignored-ness with -q, NOT -v: `check-ignore -v` exits 0 whenever a
  // pattern *matched*, including our own `!config.json` negation, which would
  // false-fire on a perfectly healthy repo. Plain -q reflects the final state —
  // it exits non-zero (throws here) when the path is ultimately un-ignored.
  try {
    execFileSync("git", ["check-ignore", "-q", ".ouro/config.json"], { cwd: repoRoot(), stdio: "ignore" });
  } catch {
    return; // not ignored (the good case), or git / not-a-repo — stay quiet
  }

  // Confirmed ignored — the only way, given our nested `!config.json`, is an
  // outer blanket rule. Fetch it with -v purely for the message.
  let match = "";
  try {
    match = execFileSync("git", ["check-ignore", "-v", ".ouro/config.json"], {
      cwd: repoRoot(),
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    /* keep going — we know it's ignored, we just couldn't name the rule */
  }

  console.log("");
  console.log(chalk.yellow("⚠ Your repo's git config ignores .ouro/ before .ouro/.gitignore can act on it."));
  if (match) console.log(chalk.gray(`  Rule: ${match}`));
  console.log(chalk.gray("  Result: agents/, context/ and config.json won't be tracked — the point of committing them is lost."));
  console.log(chalk.gray("  Fix: remove the .ouro entry from that file. .ouro/.gitignore already keeps run/, logs/, .env and tickets.json out."));
}

function reportGitignore(result) {
  if (result === "created") {
    console.log(
      chalk.green("✔ Wrote .ouro/.gitignore") +
        chalk.gray(" — commits agents/, context/, config.json; ignores run/, logs/, worktrees/, .env, tickets.json")
    );
  } else if (result === "upgraded") {
    console.log(chalk.green("✔ Upgraded .ouro/.gitignore to the ignore-everything-then-unignore-safe pattern"));
  } else if (result === "kept") {
    console.log(
      chalk.yellow("• Left your custom .ouro/.gitignore untouched") +
        chalk.gray(" — make sure it ignores .env and the run/, logs/, worktrees/ dirs")
    );
  }
  // "current" — already up to date, nothing worth a line.
}

export async function initCommand(opts) {
  if (isInitialized()) {
    console.log(chalk.yellow("ouro is already initialized in this repo (.ouro/config.json exists)."));
    // Still top up agents and the gitignore — an install that predates either
    // feature has a config but neither, and would otherwise stay broken.
    const seeded = seedDefaultAgents();
    if (seeded) console.log(chalk.green(`✔ Added ${seeded} default agents in ${agentsDir()}`));
    reportGitignore(writeGitignore());
    warnIfOuroShadowed();
    return;
  }

  ensureOuroDir();
  const gitignoreResult = writeGitignore();

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
  reportGitignore(gitignoreResult);
  warnIfOuroShadowed();
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
