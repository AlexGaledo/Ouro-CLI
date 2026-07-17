// Telegram's Bot API, only as far as ouro needs it to answer one question:
// "is this token real?"
//
// Plain fetch rather than node-telegram-bot-api: the dashboard process has no
// business holding a polling client (that's what `ouro listen` is), and one
// getMe call doesn't justify instantiating a bot that would start a connection
// pool and a retry loop the moment it's constructed.

// @BotFather issues `<bot id>:<35-char secret>`. Checking the shape before a
// network call turns the usual paste mistakes — the bot's @name, a half-copied
// token, the whole BotFather message — into a specific error, rather than a
// round trip that comes back as an unexplained "Unauthorized".
const SHAPE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;

export function looksLikeToken(token) {
  return SHAPE.test(String(token ?? "").trim());
}

/**
 * `123456789:…QsT4` — enough to recognise which token is set, useless to
 * anyone who reads it. The bot id half is public (it's in the token's own
 * structure and every getMe response); only the secret half is masked.
 */
export function maskToken(token) {
  const value = String(token ?? "").trim();
  if (!value) return null;
  const [id] = value.split(":");
  return value.includes(":") ? `${id}:…${value.slice(-4)}` : `…${value.slice(-4)}`;
}

/**
 * Asks Telegram who this token belongs to. Returns `{ ok: true, bot }` or
 * `{ ok: false, error }` — never throws, and never echoes the token back in an
 * error string, since these land in an HTTP response and a browser console.
 */
export async function verifyBotToken(token) {
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    // Offline, DNS, proxy, or Telegram blocked by the network — decidedly not
    // "your token is wrong", and saying so would send someone to @BotFather
    // for a token that was fine all along.
    return { ok: false, error: `Couldn't reach Telegram (${err.name === "TimeoutError" ? "timed out" : err.message}).` };
  }

  const body = await res.json().catch(() => ({}));

  if (!res.ok || !body.ok) {
    const why = body.description ?? `Telegram responded ${res.status}`;
    return { ok: false, error: res.status === 401 ? "Telegram rejected this token — get a fresh one from @BotFather." : why };
  }

  return {
    ok: true,
    bot: { id: body.result.id, username: body.result.username, name: body.result.first_name },
  };
}
