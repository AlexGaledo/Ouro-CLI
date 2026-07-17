import { askJson } from "./agentBackend.js";

// The Telegram intake agent.
//
// A raw message is not a ticket. "the login button is broken" has no repro, no
// platform, no severity — triaging it produces a confident-looking card built
// on nothing. So the bot behaves like a support agent instead of a webhook: it
// interviews the reporter until it can write a ticket an engineer could
// actually action, confirms the draft, and only then posts to the dashboard.
//
// State is per-chat and in memory. `ouro listen` is a restartable side process
// by design (see commands/listen.js) — losing a half-finished interview on
// restart is the right trade for not owning a database.

const MAX_QUESTIONS = 4; // hard stop; past this we draft from what we have
const MAX_TRANSCRIPT = 24; // messages retained per chat

const sessions = new Map(); // chatId -> { messages, questionCount, draft }

function session(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, { messages: [], questionCount: 0, draft: null });
  }
  return sessions.get(chatId);
}

export function reset(chatId) {
  sessions.delete(chatId);
}

export function hasSession(chatId) {
  return sessions.has(chatId);
}

function record(state, role, text) {
  state.messages.push({ role, text });
  if (state.messages.length > MAX_TRANSCRIPT) {
    state.messages.splice(0, state.messages.length - MAX_TRANSCRIPT);
  }
}

function transcript(state) {
  return state.messages.map((m) => `${m.role === "user" ? "Reporter" : "You"}: ${m.text}`).join("\n");
}

const SYSTEM = `You are the intake agent for an engineering team. You are talking to someone over Telegram who wants something fixed or built. You are NOT the engineer — your only job is to understand the request well enough that an engineer could pick it up cold.

A good ticket answers: what is the observed behaviour, what was expected, where does it happen (page/screen/command/platform), how do you reproduce it, and how badly does it hurt. A feature request answers: what outcome does the user want, for whom, and what does done look like.

Ask about what is MISSING and would actually change the work. Never ask something the reporter already told you. Never ask for information an engineer could find faster by reading the code. One question at a time, short and specific — this is a chat, not a form.

When you could write a ticket an engineer would not have to come back and ask about, stop asking and draft it. Vague-but-small is fine to draft; vague-and-large is not.`;

const DECISION_CONTRACT = `Reply with ONLY a JSON object, no prose and no markdown fences, in exactly one of these two shapes:

{"action": "ask", "question": "<one short clarifying question>"}

{"action": "draft", "title": "<imperative, <=70 chars>", "body": "<the full ticket: observed, expected, repro steps, environment, impact — as much as the reporter gave you>", "summary": "<one sentence>", "priority": "low"|"medium"|"high"}`;

/**
 * Decides the next move for a chat: ask another question, or draft the ticket.
 * Falls back to drafting from the transcript if the model returns unparseable
 * output — a reporter should never get stuck in an interview that can't end.
 */
export async function next(chatId, userText, { cwd = process.cwd() } = {}) {
  const state = session(chatId);
  record(state, "user", userText);

  const forceDraft = state.questionCount >= MAX_QUESTIONS;

  const prompt = `${SYSTEM}

Conversation so far:
${transcript(state)}

${
  forceDraft
    ? `You have already asked ${state.questionCount} questions — the limit. Draft the ticket now from what you have, and note explicitly in the body whatever is still unknown.`
    : `You have asked ${state.questionCount} of a maximum ${MAX_QUESTIONS} questions.`
}

${DECISION_CONTRACT}`;

  // A model that's unreachable, unparseable, or off-contract must not strand
  // the reporter mid-interview — fall back to drafting the raw transcript, and
  // flag it so the bot can say the ticket wasn't properly interviewed.
  let decision = null;
  try {
    decision = await askJson({ prompt, cwd });
  } catch {
    return draftFallback(state);
  }

  if (!decision || (decision.action !== "ask" && decision.action !== "draft")) {
    return draftFallback(state);
  }

  if (decision.action === "ask" && !forceDraft) {
    const question = String(decision.question ?? "").trim();
    if (!question) return draftFallback(state);
    state.questionCount += 1;
    record(state, "agent", question);
    return { action: "ask", question };
  }

  const draft = {
    title: String(decision.title ?? "").trim().slice(0, 80) || firstLine(state),
    body: String(decision.body ?? "").trim() || transcript(state),
    summary: String(decision.summary ?? "").trim() || null,
    priority: ["low", "medium", "high"].includes(decision.priority) ? decision.priority : "medium",
  };
  state.draft = draft;
  return { action: "draft", draft };
}

function firstLine(state) {
  const first = state.messages.find((m) => m.role === "user");
  return (first?.text ?? "Untitled ticket").slice(0, 80);
}

function draftFallback(state) {
  const draft = {
    title: firstLine(state),
    body: transcript(state),
    summary: null,
    priority: "medium",
    degraded: true, // the caller tells the reporter this one wasn't interviewed
  };
  state.draft = draft;
  return { action: "draft", draft };
}

export function getDraft(chatId) {
  return sessions.get(chatId)?.draft ?? null;
}

/** Human-readable preview of a draft, for the confirm step. */
export function renderDraft(draft) {
  const lines = [`*${escapeMarkdown(draft.title)}*`, "", escapeMarkdown(draft.body)];
  if (draft.priority) lines.push("", `Priority: ${draft.priority}`);
  return lines.join("\n");
}

// Telegram's legacy Markdown parser throws on unbalanced control characters,
// which arbitrary model output and pasted code will absolutely contain.
function escapeMarkdown(text) {
  return String(text ?? "").replace(/([_*[\]`])/g, "\\$1");
}

export const AFFIRMATIVE = new Set(["y", "yes", "yeah", "yep", "ok", "okay", "sure", "do it", "go", "create", "confirm", "ship it"]);
export const NEGATIVE = new Set(["n", "no", "nope", "cancel", "stop", "abort", "nevermind", "never mind"]);
