import { create } from "zustand";

// Telegram credentials, from the browser's side.
//
// Write-only by design: the server answers with a masked hint and never the
// token, so there's nothing here to leak into a screenshot, a bug report, or
// the next person to walk past this monitor. That also means no optimistic
// updates — the server's response, after it has talked to Telegram and
// restarted the intake service, is the only thing that can say what's true.

export const useSettings = create((set) => ({
  telegram: null,
  loading: true,
  error: null,

  async hydrate() {
    try {
      const res = await fetch("/api/config/telegram");
      if (!res.ok) throw new Error(`GET /api/config/telegram → ${res.status}`);
      set({ telegram: await res.json(), loading: false, error: null });
    } catch (err) {
      set({ loading: false, error: String(err.message || err) });
    }
  },

  /** Validates with Telegram, writes `.ouro/.env`, restarts intake. Slow on purpose. */
  async saveToken(botToken) {
    const data = await send("/api/config/telegram", "POST", { botToken });
    set({ telegram: data, error: null });
    return data;
  },

  /** Re-checks the saved token — catches one revoked at @BotFather since. */
  async testToken() {
    const data = await send("/api/config/telegram/test", "POST");
    set({ telegram: data, error: null });
    return data;
  },

  async clearToken() {
    const data = await send("/api/config/telegram", "DELETE");
    set({ telegram: data, error: null });
    return data;
  },
}));

async function send(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  // The server's `error` is written for a human — a rejected token, an
  // unreachable Telegram — so it's the message worth surfacing, not the status.
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}
