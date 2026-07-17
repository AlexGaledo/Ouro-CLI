import { useEffect, useState } from "react";
import Icon from "./Icon.jsx";

// Renders .ouro/context/ouro-log.md — the skimmable run history. Distinct from
// the Artifacts tab, which merely lists the file; this renders it as the log.
//
// The log's structure is deliberately simple (date headers, one entry + one
// outcome line each), so a tiny line-based renderer beats pulling in a markdown
// library that would ship dead weight to render four shapes.

function LogView({ text }) {
  const blocks = [];
  let key = 0;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (/^##\s+/.test(line)) {
      blocks.push(
        <h3 key={key++} className="log-date">
          {line.replace(/^##\s+/, "")}
        </h3>
      );
    } else if (/^#\s+/.test(line)) {
      // The file's own title — the tab header already says "Logs", so skip it.
    } else if (/^\s*→/.test(line)) {
      blocks.push(
        <div key={key++} className="log-outcome">
          {line.trim()}
        </div>
      );
    } else if (/^-\s+/.test(line)) {
      blocks.push(
        <div key={key++} className="log-head">
          {line.replace(/^-\s+/, "").replace(/\*\*/g, "")}
        </div>
      );
    } else if (line.trim()) {
      blocks.push(
        <p key={key++} className="log-note">
          {line.trim()}
        </p>
      );
    }
  }
  return <div className="log-view">{blocks}</div>;
}

export default function LogsScreen() {
  const [content, setContent] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/log")
      .then((r) => r.json())
      .then((d) => alive && setContent(d.content ?? ""))
      .catch((e) => alive && setError(String(e.message || e)));
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <div className="banner bad">
        <Icon name="alert" size={13} />
        Couldn't load the log ({error}).
      </div>
    );
  }
  if (content === null) return <div className="empty">Loading log…</div>;
  if (!content.trim()) {
    return (
      <div className="logs">
        <div className="empty">
          No runs logged yet. Every run appends a line to <span className="mono">.ouro/context/ouro-log.md</span> —
          shipped, failed, or cancelled.
        </div>
      </div>
    );
  }

  return (
    <div className="logs wg-scroll">
      <p className="logs-intro">
        One line per run, appended at run end regardless of outcome. Templated from ticket state — not an LLM call — and
        committed as team memory in <span className="mono">.ouro/context/ouro-log.md</span>.
      </p>
      <LogView text={content} />
    </div>
  );
}
