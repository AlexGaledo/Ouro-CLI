import { useEffect, useState } from "react";
import { useAgents } from "../store/agents.js";
import Icon from "./Icon.jsx";
import Segmented from "./Segmented.jsx";

// Agent config, backed 1:1 by `.ouro/agents/<id>.md`.
//
// Two editors over the same file: a structured form for the common path, and a
// raw markdown editor for everything the form doesn't model. The raw view is
// the honest one — it's what's actually on disk — so it isn't hidden behind an
// "advanced" disclosure, just a tab.

const MODEL_OPTIONS = ["opus", "sonnet", "haiku"];

// Anything that can write to the worktree or reach the network. Mirrors
// DANGER_TOOLS in packages/cli/src/lib/agents.js — granting these is a
// deliberate act, so they're marked rather than blended in.
const DANGER = new Set(["Edit", "Write", "Bash", "WebFetch", "WebSearch"]);

const VIEWS = [
  { value: "form", label: "Fields" },
  { value: "raw", label: "Raw .md" },
];

export default function AgentsScreen() {
  const { agents, toolUniverse, selectedId, select, create, loading, error } = useAgents();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  const selected = agents.find((a) => a.id === selectedId) ?? agents[0] ?? null;

  async function handleCreate() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      await create(name);
      setNewName("");
    } catch (err) {
      setCreateError(String(err.message || err));
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <div className="agent-detail"><div className="empty">Loading agents…</div></div>;

  return (
    <>
      {error && (
        <div className="banner bad">
          <Icon name="alert" size={13} />
          Couldn't load agents ({error}).
        </div>
      )}

      <div className="agents">
        <div className="agents-list wg-scroll">
          <div className="agents-list-head">
            <span>Agents</span>
            <button className="btn sm" onClick={handleCreate} disabled={!newName.trim() || creating}>
              {creating ? "Creating…" : "+ New"}
            </button>
          </div>

          <input
            className="input"
            style={{ height: 30, fontSize: 12.5 }}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="New agent name…"
            aria-label="New agent name"
          />
          {createError && <div className="error-text">{createError}</div>}

          {agents.map((a, i) => (
            <button
              key={a.id}
              className={`agent-row ${selected?.id === a.id ? "selected" : ""}`}
              style={{ "--i": i }}
              onClick={() => select(a.id)}
            >
              <div className="agent-row-top">
                <span className="glyph" aria-hidden="true">{a.glyph}</span>
                <span className="name">{a.name}</span>
              </div>
              {a.description && <div className="desc">{a.description}</div>}
              <div className="foot">
                <span>{a.model}</span>
                <span>{a.tools.length} tools</span>
              </div>
            </button>
          ))}

          {agents.length === 0 && <div className="empty">No agents yet — create one above.</div>}
        </div>

        <div className="agent-detail wg-scroll">
          {selected ? (
            // Keyed by id so switching agents remounts the editor and its local
            // draft state re-seeds from the new file — no reset effect needed.
            <AgentDetail key={selected.id} agent={selected} toolUniverse={toolUniverse} />
          ) : (
            <div className="empty">Select an agent, or create one.</div>
          )}
        </div>
      </div>
    </>
  );
}

function AgentDetail({ agent, toolUniverse }) {
  const { save, remove, fetchRaw } = useAgents();
  const [view, setView] = useState("form");

  const [form, setForm] = useState(() => ({
    name: agent.name,
    glyph: agent.glyph,
    description: agent.description,
    model: agent.model,
    tools: [...agent.tools],
    systemPrompt: agent.systemPrompt,
  }));

  const [raw, setRaw] = useState(null);
  const [status, setStatus] = useState(null); // { ok } | { error }
  const [saving, setSaving] = useState(false);

  // The raw file is fetched lazily — the list endpoint returns parsed agents,
  // and pulling every file's text up front to satisfy a tab most people never
  // open would be waste.
  useEffect(() => {
    if (view !== "raw" || raw !== null) return;
    fetchRaw(agent.id)
      .then(setRaw)
      .catch((err) => setStatus({ error: String(err.message || err) }));
  }, [view, raw, agent.id, fetchRaw]);

  const models = MODEL_OPTIONS.includes(form.model) ? MODEL_OPTIONS : [form.model, ...MODEL_OPTIONS];
  const tools = [...new Set([...toolUniverse, ...form.tools])];

  function toggleTool(tool) {
    setForm((f) => ({
      ...f,
      tools: f.tools.includes(tool) ? f.tools.filter((t) => t !== tool) : [...f.tools, tool],
    }));
  }

  async function handleSave() {
    setSaving(true);
    setStatus(null);
    try {
      if (view === "raw") {
        await save(agent.id, { raw });
      } else {
        await save(agent.id, form);
        setRaw(null); // form save rewrote the file — drop the stale raw copy
      }
      setStatus({ ok: true });
      setTimeout(() => setStatus(null), 2400);
    } catch (err) {
      setStatus({ error: String(err.message || err) });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${agent.name}"? This removes .ouro/agents/${agent.id}.md from disk.`)) return;
    try {
      await remove(agent.id);
    } catch (err) {
      setStatus({ error: String(err.message || err) });
    }
  }

  return (
    <div className="agent-detail-inner">
      <div className="agent-head">
        <span className="glyph" aria-hidden="true">{agent.glyph}</span>
        <h2>{agent.name}</h2>
        <span className="path">
          <Icon name="file" size={11} />
          .ouro/agents/{agent.id}.md
        </span>
      </div>
      <div className="agent-sub">{agent.description || "No description."}</div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <Segmented value={view} options={VIEWS} onChange={setView} ariaLabel="Editor mode" />
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="btn danger sm" onClick={handleDelete}>
            <Icon name="trash" size={12} />
            Delete
          </button>
          <button className="btn primary sm" onClick={handleSave} disabled={saving || (view === "raw" && raw === null)}>
            <Icon name="save" size={12} />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {view === "raw" ? (
        <div className="field">
          <label htmlFor="raw-md">File contents</label>
          <textarea
            id="raw-md"
            className="textarea mono"
            style={{ minHeight: 420 }}
            value={raw ?? ""}
            onChange={(e) => setRaw(e.target.value)}
            spellCheck={false}
            placeholder="Loading…"
          />
          <div className="hint">
            YAML frontmatter (<code>name</code>, <code>glyph</code>, <code>description</code>, <code>model</code>,{" "}
            <code>tools</code>) then the body, which is sent to the model as its system prompt.
          </div>
        </div>
      ) : (
        <>
          <div className="field-row">
            <div className="field">
              <label htmlFor="a-name">Name</label>
              <input
                id="a-name"
                className="input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="a-glyph">Glyph</label>
              <input
                id="a-glyph"
                className="input mono"
                value={form.glyph}
                maxLength={2}
                onChange={(e) => setForm((f) => ({ ...f, glyph: e.target.value }))}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="a-desc">Description</label>
            <input
              id="a-desc"
              className="input"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="One line — shown on the card and in the sidebar."
            />
          </div>

          <div className="field">
            <label htmlFor="a-model">Model</label>
            <div className="select-wrap" style={{ maxWidth: 280 }}>
              <select
                id="a-model"
                className="select mono"
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
              >
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <Icon name="chevronDown" size={13} className="chev" />
            </div>
            <div className="hint">
              An alias (<code>opus</code>, <code>sonnet</code>, <code>haiku</code>) or a full model name.
            </div>
          </div>

          <div className="field">
            <label>
              Allowed tools · <span style={{ color: "var(--warn)" }}>⚠ can write or reach the network</span>
            </label>
            <div className="tools">
              {tools.map((t) => {
                const on = form.tools.includes(t);
                const danger = DANGER.has(t);
                return (
                  <button
                    key={t}
                    type="button"
                    className={`tool ${on ? "on" : ""} ${danger ? "danger" : ""}`}
                    onClick={() => toggleTool(t)}
                    aria-pressed={on}
                  >
                    {danger && "⚠"} {t}
                  </button>
                );
              })}
            </div>
            <div className="hint">
              Enforced on the Claude Code backend via <code>--allowedTools</code>. Codex has no per-tool grant — there
              the sandbox mode governs writes, so this list is advisory.
            </div>
          </div>

          <div className="field">
            <label htmlFor="a-prompt">System prompt</label>
            <textarea
              id="a-prompt"
              className="textarea"
              style={{ minHeight: 200 }}
              value={form.systemPrompt}
              onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
            />
            <div className="hint">The markdown body of the file. Appended to the backend's own system prompt.</div>
          </div>
        </>
      )}

      {status?.error && <div className="error-text">Couldn't save ({status.error}).</div>}
      {status?.ok && <div className="ok-text">Saved to .ouro/agents/{agent.id}.md</div>}
    </div>
  );
}
