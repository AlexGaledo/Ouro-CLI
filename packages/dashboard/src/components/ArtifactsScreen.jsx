import { useEffect, useState } from "react";
import Icon from "./Icon.jsx";

// Everything an agent can see as context, in one view. Two sources, no copies:
// root convention files referenced in place (the backend auto-reads them), and
// the droppable .ouro/context/ folder whose manifest — names + one-line
// descriptions, not contents — is injected into every run.
//
// Fetches on mount, which is each time you open the tab (App renders only the
// active screen), so opening it is the refresh.

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ArtifactsScreen() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/artifacts")
      .then((r) => r.json())
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(String(e.message || e)));
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <div className="banner bad">
        <Icon name="alert" size={13} />
        Couldn't load artifacts ({error}).
      </div>
    );
  }
  if (!data) return <div className="empty">Loading context…</div>;

  const { files, referenced, contextDir } = data;

  return (
    <div className="artifacts wg-scroll">
      <p className="artifacts-intro">
        Everything an agent can see as context — referenced in place, never copied. Files are listed for discovery; the
        agent reads what it needs.
      </p>

      <section className="artifact-group">
        <div className="artifact-group-head">
          <Icon name="file" size={13} />
          <h2>Referenced in place</h2>
          <span className="count mono">{referenced.length}</span>
        </div>
        <p className="artifact-group-sub">
          Root convention files the backend auto-reads. Shown at their real path — not duplicated into ouro.
        </p>
        {referenced.length === 0 ? (
          <div className="empty">No CLAUDE.md / AGENTS.md at the repo root.</div>
        ) : (
          <ul className="artifact-list">
            {referenced.map((f) => (
              <li key={f.path} className="artifact-item">
                <span className="artifact-name mono">{f.path}</span>
                <span className="badge">auto-read</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="artifact-group">
        <div className="artifact-group-head">
          <Icon name="inbox" size={13} />
          <h2>{contextDir}/</h2>
          <span className="count mono">{files.length}</span>
        </div>
        <p className="artifact-group-sub">
          Droppable artifacts. Each run gets this list — names and descriptions, injected as a manifest — and reads
          contents on demand rather than having them dumped into the prompt.
        </p>
        {files.length === 0 ? (
          <div className="empty">Nothing yet. Drop files in {contextDir}/ — they'll be offered to every run.</div>
        ) : (
          <ul className="artifact-list">
            {files.map((f) => (
              <li key={f.name} className="artifact-item">
                <span className="artifact-name mono">{f.name}</span>
                {f.description && <span className="artifact-desc">{f.description}</span>}
                <span className="badge mono">{formatSize(f.size)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
