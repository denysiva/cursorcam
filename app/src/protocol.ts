/**
 * The client→server wire boundary.
 *
 * Every frame here arrives from a browser we do not control, so nothing about it
 * may be assumed: TypeScript types are erased at runtime, and a `JSON.parse`
 * result typed as a message is a lie until it has been checked.
 * `parseClientMessage` is the one place that turns an untrusted frame into a
 * value the room may act on.
 *
 *   {type:"join", playerId, name?, avatar?}   introduce yourself (required first)
 *   {type:"action", action:{t, …}}             anything the rules understand
 *   {type:"react", emoji}                      a floating reaction, never stored
 */

/** A frame larger than this is refused unread (a custom word list fits). */
const MAX_FRAME_BYTES = 48 * 1024;
/** The secret a browser identifies itself with; hashed before the rules see it. */
const MAX_PLAYER_ID = 64;
/** Actions are persisted into room storage, so they are bounded. */
const MAX_ACTION_BYTES = 40 * 1024;

export const REACTIONS = ["🔥", "😂", "😱", "👏", "🤯", "💀", "❤️", "🤡"] as const;

export type ClientMessage =
  | { type: "join"; playerId: string; name: string; avatar: number | null }
  | { type: "action"; action: Record<string, unknown> & { t: string } }
  | { type: "react"; emoji: string };

export type ParseResult = { ok: true; msg: ClientMessage } | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseClientMessage(raw: string | ArrayBuffer): ParseResult {
  if (typeof raw !== "string") return { ok: false, error: "expected a text frame" };
  // Compare bytes, not UTF-16 units: Cyrillic is two bytes a letter.
  if (new TextEncoder().encode(raw).byteLength > MAX_FRAME_BYTES) {
    return { ok: false, error: "Повідомлення завелике" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "invalid json" };
  }
  if (!isRecord(parsed)) return { ok: false, error: "expected a json object" };

  switch (parsed.type) {
    case "join": {
      const rawId = parsed.playerId;
      if (typeof rawId !== "string" && typeof rawId !== "number") {
        return { ok: false, error: "playerId required" };
      }
      const playerId = String(rawId).slice(0, MAX_PLAYER_ID);
      if (!playerId) return { ok: false, error: "playerId required" };
      const name = typeof parsed.name === "string" ? parsed.name.slice(0, 64) : "";
      const avatar = Number.isInteger(parsed.avatar) ? (parsed.avatar as number) : null;
      return { ok: true, msg: { type: "join", playerId, name, avatar } };
    }
    case "action": {
      const action = parsed.action;
      if (!isRecord(action) || typeof action.t !== "string") {
        return { ok: false, error: "action required" };
      }
      // Underscore-prefixed actions are the server's own; a client never sends one.
      if (action.t.startsWith("_")) return { ok: false, error: "unknown action" };
      let size: number;
      try {
        size = new TextEncoder().encode(JSON.stringify(action)).byteLength;
      } catch {
        return { ok: false, error: "action is not serializable" };
      }
      if (size > MAX_ACTION_BYTES) return { ok: false, error: "Забагато даних" };
      return { ok: true, msg: { type: "action", action: action as Record<string, unknown> & { t: string } } };
    }
    case "react": {
      const emoji = parsed.emoji;
      if (typeof emoji !== "string" || !(REACTIONS as readonly string[]).includes(emoji)) {
        return { ok: false, error: "unknown reaction" };
      }
      return { ok: true, msg: { type: "react", emoji } };
    }
    default:
      return { ok: false, error: "unknown message type" };
  }
}
