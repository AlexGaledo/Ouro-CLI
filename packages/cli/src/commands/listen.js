import chalk from "chalk";
import TelegramBot from "node-telegram-bot-api";
import { isInitialized } from "../lib/paths.js";
import { telegramTokenVar } from "../lib/config.js";
import * as intake from "../lib/intake.js";

// Runs as a separate process from `ouro dashboard` by design — it only talks
// to the dashboard over its local HTTP API (POST /api/tickets), so the
// dashboard's in-memory store/WS broadcast stays the single source of truth
// and this process can be restarted independently without losing state.
//
// The bot is a customer-facing intake agent, not a webhook: it interviews the
// reporter (lib/intake.js), shows them the drafted ticket, and only posts to
// the board once they confirm. Nothing reaches the dashboard un-clarified.

const HELP = [
  "I'm the ouro intake agent. Tell me what's broken or what you need built,",
  "and I'll ask a couple of questions before writing it up as a ticket.",
  "",
  "/new — start over",
  "/cancel — drop the current conversation",
].join("\n");

export async function listenCommand() {
  if (!isInitialized()) {
    console.log(chalk.yellow("Run ") + chalk.cyan("ouro init") + chalk.yellow(" first."));
    return;
  }

  const { name: tokenVar, error: tokenVarError } = telegramTokenVar();
  if (tokenVarError) for (const line of tokenVarError.split("\n")) console.error(chalk.yellow(line));

  const token = process.env[tokenVar];
  const dashboardUrl = process.env.OURO_DASHBOARD_URL || "http://localhost:4747";

  if (!token) {
    console.log(
      chalk.red(`Missing ${tokenVar}. `) +
        "Paste your token into the dashboard's Settings screen, or set the env var in .ouro/.env, then re-run."
    );
    return;
  }

  // Validate the token before polling. A bad token doesn't crash
  // node-telegram-bot-api — it retries 401 forever, so the process looks
  // perfectly healthy to `ouro status` while silently receiving nothing. For a
  // service meant to run unattended for days that's the worst failure mode
  // available, so we fail loudly at startup instead.
  const bot = new TelegramBot(token, { polling: false });
  let me;
  try {
    me = await bot.getMe();
  } catch (err) {
    console.error(chalk.red("Telegram rejected the bot token: ") + err.message);
    console.error(chalk.gray(`Check ${tokenVar} in .ouro/.env — get a fresh one from @BotFather.`));
    process.exit(1);
  }

  await bot.startPolling();
  console.log(
    chalk.green(`✔ ouro intake agent listening as @${me.username}.`) + ` Tickets post to ${dashboardUrl}`
  );

  const send = (chatId, text, opts) => bot.sendMessage(chatId, text, opts).catch((err) => {
    console.error(chalk.red("[telegram] send failed:"), err.message);
  });

  async function createTicket(chatId, draft) {
    const res = await fetch(`${dashboardUrl}/api/tickets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: draft.title,
        body: draft.body,
        summary: draft.summary,
        priority: draft.priority,
        source: "telegram",
      }),
    });
    if (!res.ok) throw new Error(`dashboard responded ${res.status}`);
    return res.json();
  }

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();
    if (!text) return;

    console.log(chalk.gray(`[telegram] ${text}`));

    if (text === "/start" || text === "/help") {
      intake.reset(chatId);
      return send(chatId, HELP);
    }

    if (text === "/new" || text === "/cancel") {
      const had = intake.hasSession(chatId);
      intake.reset(chatId);
      return send(chatId, had ? "Dropped that. What do you need?" : "Nothing in progress. What do you need?");
    }

    // A pending draft means the last thing we sent was "create this ticket?",
    // so this message is the answer — not a new interview turn.
    const pending = intake.getDraft(chatId);
    if (pending) {
      const answer = text.toLowerCase().replace(/[.!]$/, "");

      if (intake.AFFIRMATIVE.has(answer)) {
        try {
          const ticket = await createTicket(chatId, pending);
          intake.reset(chatId);
          return send(chatId, `Ticket created — ${ticket.title} (#${ticket.id}). It's on the board now.`);
        } catch (err) {
          console.error(chalk.red("Failed to reach dashboard:"), err.message);
          return send(chatId, "Couldn't reach the ouro dashboard — is it running? Say 'yes' to retry.");
        }
      }

      if (intake.NEGATIVE.has(answer)) {
        intake.reset(chatId);
        return send(chatId, "Dropped it. Tell me what you'd like instead.");
      }

      // Anything else is a correction ("no, it's only on mobile") — feed it
      // back into the interview rather than treating it as yes/no.
      intake.reset(chatId);
    }

    try {
      bot.sendChatAction(chatId, "typing").catch(() => {});
      const result = await intake.next(chatId, text);

      if (result.action === "ask") {
        return send(chatId, result.question);
      }

      const preamble = result.draft.degraded
        ? "I couldn't reach the model to interview you properly, so here's the raw version:"
        : "Here's what I've got:";

      return send(chatId, `${preamble}\n\n${intake.renderDraft(result.draft)}\n\nCreate this ticket? (yes / no)`, {
        parse_mode: "Markdown",
      });
    } catch (err) {
      console.error(chalk.red("[intake] failed:"), err.message);
      return send(chatId, "Something went wrong on my side. Try again, or /new to start over.");
    }
  });

  // A token revoked while we're running lands here, not at startup. 401/404
  // never recovers by retrying, so exiting is the honest move — it makes
  // `ouro status` show the service as down instead of spinning on a hot loop
  // that will never receive a message.
  bot.on("polling_error", (err) => {
    const fatal = /\b(401|404)\b/.test(err.message ?? "");
    if (fatal) {
      console.error(chalk.red("[telegram] token rejected mid-run: ") + err.message);
      console.error(chalk.gray("Stopping — fix the token in .ouro/.env, then: ouro restart"));
      process.exit(1);
    }
    // Transient (network drop, Telegram 5xx): the library retries on its own.
    console.error(chalk.yellow("[telegram] polling error:"), err.message);
  });
}
