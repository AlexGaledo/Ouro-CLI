// The agent-exchange normalizer — a FILTER over the stream-json events already
// parsed and stored on a ticket (ticket.log), broadcast live over the WS feed.
// It is not a new capture system; it just decides, per event, what belongs in
// the inter-agent exchange view: agent messages and tool calls / results, with
// thinking / reasoning tokens dropped.
//
// The per-backend reasoning check is the whole trick, and reasoning is labelled
// differently per backend:
//
//   Claude Code (VERIFIED against 2.1.212): reasoning is `thinking` /
//     `redacted_thinking` content-blocks INSIDE an `assistant` event — not a
//     top-level type. The top-level types are system (init + hook_started/
//     response/progress), assistant, user (tool_result), result, and
//     rate_limit_event. We keep assistant text + tool_use and user tool_result,
//     and drop everything else — the thinking blocks plus the system / rate-limit
//     / stderr bookkeeping that isn't inter-agent discussion.
//
//   Codex (UNVERIFIED here — codex isn't installed in this environment):
//     reasoning has historically ridden as its own item (item.type "reasoning" /
//     msg.type "agent_reasoning"). Matched defensively below; refine against a
//     real `codex exec --json` event stream.

const CLAUDE_REASONING_BLOCKS = new Set(["thinking", "redacted_thinking"]);

function toolArg(input = {}) {
  const arg = input.file_path ?? input.path ?? input.command ?? input.pattern ?? input.prompt ?? "";
  return String(arg).slice(0, 200);
}

function resultText(content) {
  if (typeof content === "string") return content.slice(0, 240);
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === "string" ? b : b?.text ?? ""))
      .join(" ")
      .trim()
      .slice(0, 240);
  }
  return "";
}

function fromClaude(ev, out) {
  if (ev.type === "assistant") {
    const content = ev.message?.content;
    if (!Array.isArray(content)) return;
    for (const b of content) {
      if (CLAUDE_REASONING_BLOCKS.has(b.type)) continue; // drop reasoning
      if (b.type === "text" && b.text?.trim()) out.push({ kind: "message", text: b.text.trim() });
      else if (b.type === "tool_use") out.push({ kind: "tool", name: b.name, arg: toolArg(b.input) });
    }
  } else if (ev.type === "user") {
    const content = ev.message?.content;
    if (!Array.isArray(content)) return;
    for (const b of content) {
      if (b.type === "tool_result") out.push({ kind: "result", text: resultText(b.content) });
    }
  }
  // system / result / rate_limit_event / stderr / raw → not exchange, dropped.
}

function fromCodex(ev, out) {
  const itemType = String(ev.item?.type ?? ev.msg?.type ?? ev.type ?? "");
  if (/reason/i.test(itemType)) return; // drop reasoning (best-effort, unverified)

  if (/command|tool|exec|shell/i.test(itemType)) {
    const arg = String(ev.item?.command ?? ev.item?.text ?? ev.msg?.command ?? "").slice(0, 200);
    out.push({ kind: "tool", name: itemType.replace(/^item\.?/, "") || "tool", arg });
    return;
  }
  const text = ev.item?.text ?? ev.msg?.text ?? ev.msg?.message ?? "";
  if (String(text).trim() && /message|assistant|agent|text/i.test(itemType)) {
    out.push({ kind: "message", text: String(text).trim() });
  }
}

/** Filters a ticket's log down to the renderable agent exchange. */
export function exchangeItems(log, backend) {
  const out = [];
  for (const entry of log ?? []) {
    if (entry.type === "error") {
      out.push({ kind: "error", text: entry.text, ts: entry.ts });
      continue;
    }
    if (entry.type !== "agent_event" || !entry.event) continue;
    const items = [];
    if (backend === "codex") fromCodex(entry.event, items);
    else fromClaude(entry.event, items);
    for (const it of items) out.push({ ...it, ts: entry.ts });
  }
  return out;
}
