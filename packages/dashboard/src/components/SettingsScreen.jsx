import { useEffect, useState } from "react";
import { useSettings } from "../store/settings.js";
import Icon from "./Icon.jsx";

// Telegram intake config — the bot token, pasteable.
//
// Getting the bot running used to be two terminal steps between "@BotFather
// gave me a token" and "the bot answers": append a line to .ouro/.env, then
// `ouro restart`. This screen does both, and adds the step neither could — it
// asks Telegram whether the token is real *before* writing it, so a bad paste
// fails here, in front of you, instead of inside a detached process whose only
// witness is a log file.
//
// The field is write-only. The server sends back a masked hint and never the
// token, so this component can't show you what's set — only replace it.

export default function SettingsScreen() {
  const { telegram, loading, error, hydrate, saveToken, testToken, clearToken } = useSettings();

  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(null); // "save" | "test" | "clear"
  const [status, setStatus] = useState(null); // { ok } | { error } | { restart }

  useEffect(() => {
    hydrate();
    // `ouro stop`, a revoked token, a crashed listener — all happen outside
    // this tab. A screen whose job is reporting service state shouldn't be
    // able to sit here showing a green dot for a process that died.
    const id = setInterval(hydrate, 5000);
    return () => clearInterval(id);
  }, [hydrate]);

  async function act(kind, fn) {
    setBusy(kind);
    setStatus(null);
    try {
      return await fn();
    } catch (err) {
      setStatus({ error: String(err.message || err) });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function handleSave() {
    const value = token.trim();
    if (!value) return;
    const data = await act("save", () => saveToken(value));
    if (!data) return;
    setToken(""); // it's saved; keeping it in a DOM node earns nothing
    setStatus(data.restart?.ok === false ? { restart: data.restart } : { ok: `Saved. Intake is live as @${data.bot?.username}.` });
  }

  async function handleTest() {
    const data = await act("test", () => testToken());
    if (data) setStatus({ ok: `Telegram knows this token as @${data.bot?.username}.` });
  }

  async function handleClear() {
    if (!confirm("Remove the bot token from .ouro/.env and stop Telegram intake?")) return;
    const data = await act("clear", () => clearToken());
    if (data) setStatus({ ok: "Token removed. Telegram intake is off." });
  }

  if (loading) return <div className="agent-detail"><div className="empty">Loading settings…</div></div>;

  return (
    <>
      {error && (
        <div className="banner bad">
          <Icon name="alert" size={13} />
          Couldn't load settings ({error}).
        </div>
      )}

      {/* A token pasted into config.json, which is committed by design. Saving
          a new one below won't undo that, so this says the whole fix rather
          than just "invalid config". */}
      {telegram?.configError && (
        <div className="banner bad settings-config-error">
          <Icon name="alert" size={13} />
          <span>{telegram.configError}</span>
        </div>
      )}

      <div className="agent-detail wg-scroll">
        <div className="agent-detail-inner">
          <div className="agent-head">
            <span className="glyph" aria-hidden="true"><Icon name="send" size={16} /></span>
            <h2>Telegram intake</h2>
            <span className="path">
              <Icon name="file" size={11} />
              .ouro/.env
            </span>
          </div>
          <div className="agent-sub">
            The bot that interviews whoever messages it and files the result on your board.
          </div>

          <StatusPanel telegram={telegram} />

          <div className="field">
            <label htmlFor="tg-token">Bot token</label>
            <div className="save-row" style={{ margin: 0 }}>
              <input
                id="tg-token"
                className="input mono"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
                placeholder={telegram?.configured ? "Paste a new token to replace the current one…" : "123456789:AAE…"}
                spellCheck={false}
                autoComplete="off"
              />
              <button className="btn primary" onClick={handleSave} disabled={!token.trim() || Boolean(busy)}>
                <Icon name="save" size={12} />
                {busy === "save" ? "Verifying…" : "Save & restart"}
              </button>
            </div>
            <div className="hint">
              Written to <code>.ouro/.env</code> as <code>{telegram?.tokenVar}</code> — gitignored, and read back on
              every boot, so the bot survives closing this terminal. Saving checks the token against Telegram, then
              restarts intake to pick it up.
            </div>
          </div>

          <div className="settings-actions">
            <button className="btn sm" onClick={handleTest} disabled={!telegram?.configured || Boolean(busy)}>
              <Icon name="rotate" size={12} />
              {busy === "test" ? "Checking…" : "Test connection"}
            </button>
            <button className="btn danger sm" onClick={handleClear} disabled={!telegram?.configured || Boolean(busy)}>
              <Icon name="trash" size={12} />
              {busy === "clear" ? "Removing…" : "Remove token"}
            </button>
          </div>

          {status?.error && <div className="error-text">{status.error}</div>}
          {status?.ok && <div className="ok-text">{status.ok}</div>}
          {status?.restart && (
            // Saved, verified, and still not running. Nothing above explains
            // that, so the listener's own last words go on screen rather than
            // in a log file you'd have to be told to go read.
            <div className="settings-failure">
              <div className="error-text" style={{ marginTop: 0 }}>
                Token saved, but the intake service didn't stay up. Its log says:
              </div>
              {status.restart.log?.length ? (
                status.restart.log.map((line, i) => (
                  <div key={i} className="log-tail">{line}</div>
                ))
              ) : (
                <div className="log-tail">(nothing — try: ouro logs listen)</div>
              )}
            </div>
          )}

          <div className="field" style={{ marginTop: 26 }}>
            <label>Getting a token</label>
            <ol className="settings-steps">
              <li>
                Message <a className="ext" href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> on
                Telegram and send <code>/newbot</code>.
              </li>
              <li>Pick a display name, then a username ending in <code>bot</code>.</li>
              <li>Copy the token it replies with and paste it above.</li>
              <li>Message your new bot — the ticket it writes lands on the board.</li>
            </ol>
          </div>
        </div>
      </div>
    </>
  );
}

function StatusPanel({ telegram }) {
  const running = Boolean(telegram?.listener?.running);
  const configured = Boolean(telegram?.configured);

  // Three states worth distinguishing, because each has a different fix: no
  // token (paste one), a token whose service isn't up (restart or read the
  // log), and running (nothing).
  const headline = !configured
    ? "Not configured"
    : running
      ? `Listening${telegram.bot?.username ? ` as @${telegram.bot.username}` : ""}`
      : "Token saved — intake is not running";

  const detail = !configured
    ? "Paste a bot token below to turn on Telegram intake."
    : running
      ? "Anyone who messages the bot gets interviewed, and their ticket lands on the board."
      : "Save the token again to restart it, or run ouro logs listen to see why it stopped.";

  return (
    <div className={`settings-status ${running ? "live" : ""}`}>
      {/* Red is the default dot, and it's right for a token that's set but not
          listening — that's broken and you should see it. It is not right for
          a feature nobody has turned on yet, which is what `idle` is for. */}
      <span
        className={`status-dot ${running ? "live" : configured ? "" : "idle"}`}
        aria-hidden="true"
      />
      <div>
        <div className="state">{headline}</div>
        <div className="detail">{detail}</div>
      </div>
      {configured && (
        <div className="meta">
          <div>{telegram.tokenHint}</div>
          {/* A token that only exists as a shell export is a bot that dies at
              the next reboot. That's worth saying out loud, not hiding behind
              a green dot that's telling the truth only until Tuesday. */}
          {!telegram.persisted && <div className="warn-note">shell export only — not in .env</div>}
          {running && telegram.listener.uptime && <div>up {telegram.listener.uptime}</div>}
        </div>
      )}
    </div>
  );
}
