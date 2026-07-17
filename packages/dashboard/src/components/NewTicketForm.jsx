import { useEffect, useRef, useState } from "react";
import { useTickets } from "../store/tickets.js";
import { useAgents } from "../store/agents.js";
import Icon from "./Icon.jsx";

export default function NewTicketForm({ onClose }) {
  const createTicket = useTickets((s) => s.createTicket);
  const agents = useAgents((s) => s.agents);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [agentId, setAgentId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const titleRef = useRef(null);

  useEffect(() => {
    titleRef.current?.focus();
    // Escape has to close a modal — it's the one dismissal every user tries
    // before reaching for the mouse.
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e) {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await createTicket({ title: title.trim(), body: body.trim(), agentId: agentId || null });
      onClose();
    } catch (err) {
      setError(String(err.message || err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-ticket-title"
      >
        <h3 id="new-ticket-title">New ticket</h3>

        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="nt-title">Title</label>
          <input
            id="nt-title"
            ref={titleRef}
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Fix the misaligned login button on mobile"
          />
        </div>

        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="nt-body">Description</label>
          <textarea
            id="nt-body"
            className="textarea"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            placeholder="What's the observed behaviour, what did you expect, and how do you reproduce it?"
          />
        </div>

        {agents.length > 0 && (
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="nt-agent">Agent</label>
            <div className="select-wrap">
              <select id="nt-agent" className="select" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">Default agent</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.glyph} {a.name}
                  </option>
                ))}
              </select>
              <Icon name="chevronDown" size={13} className="chev" />
            </div>
          </div>
        )}

        {error && <div className="error-text">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!title.trim() || saving}>
            {saving ? "Creating…" : "Create ticket"}
          </button>
        </div>
      </form>
    </div>
  );
}
