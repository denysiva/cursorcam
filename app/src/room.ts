/**
 * `Room` — one game room, as a Durable Object.
 *
 * A room owns its players' WebSockets and the whole game state. One instance
 * per room code (`env.ROOMS.idFromName(code)`), so rooms never see each other,
 * and an idle room costs nothing (see HIBERNATION).
 *
 * This file is the TRUSTED half of the game. It speaks the wire protocol, owns
 * the sockets, the clock and the dice, and persists state. Every game decision
 * is made by `./logic.js` — pure functions — which this file feeds with:
 *
 *   * the player's PUBLIC id: a hash of the secret token their browser sent.
 *     Views list other players by public id, so knowing someone's id is not
 *     enough to rejoin as them (and read an Oracle's key);
 *   * `_now` and `_rand` on every action — time and randomness the rules may
 *     not produce themselves;
 *   * the server-only actions `_join`, `_presence` and `_timeout`.
 *
 * ── WIRE PROTOCOL ────────────────────────────────────────────────────────
 *   in:  {type:"join", playerId, name?, avatar?}
 *        {type:"action", action:{t, …}}
 *        {type:"react", emoji}
 *   out: {type:"state", you, now, view}       everything a client draws from
 *        {type:"error", error}                 a refused action, for a toast
 *        {type:"react", from, emoji}           a floating reaction
 *        {type:"bye", reason}                  kicked / left: do not reconnect
 *
 * ── HIBERNATION ─────────────────────────────────────────────────────────
 * Sockets are accepted with `ctx.acceptWebSocket`, so a quiet room is evicted
 * from memory while its connections STAY OPEN, and is revived by the next
 * message or alarm. Two consequences:
 *   * no game state in instance fields — everything lives in `ctx.storage`;
 *   * a connection's identity rides on the socket (`serializeAttachment`).
 */

import { DurableObject } from "cloudflare:workers";

import type { Env } from "./env";
import * as logic from "./logic.js";
import type { LogicState } from "./logic.js";
import { parseClientMessage } from "./protocol";

/** connId -> public player id. Persisted: the sockets outlive this object's memory. */
type Conns = Record<string, string>;

/** One outbound message. `to` is a connId, a list of them, or "*" for everyone. */
interface Out {
  to: string | string[];
  data: unknown;
}

/** Keepalive: the runtime answers these WITHOUT waking the room. */
const PING = "__ping";
const PONG = "__pong";

/** Slack added to a turn deadline so the alarm never fires a hair early. */
const ALARM_SLACK_MS = 60;
/** A player may send one reaction per this many ms. */
const REACT_GAP_MS = 350;

const CLOSE_BYE = 4001;

/** The public id the rules know a browser by: a short hash of its secret token. */
async function publicId(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(`orakul:${token}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let hex = "";
  for (const b of digest.slice(0, 8)) hex += b.toString(16).padStart(2, "0");
  return hex;
}

function dice(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
}

export class Room extends DurableObject<Env> {
  /** Reaction throttle. In memory on purpose: losing it on eviction is harmless. */
  private lastReact = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Registered on every construction (cheap, idempotent) rather than on first
    // connect, so a room revived from hibernation keeps answering pings.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  // ── persistence ────────────────────────────────────────────────────────

  private async load(): Promise<{ state: LogicState; conns: Conns }> {
    const [state, conns] = await Promise.all([
      this.ctx.storage.get<LogicState>("state"),
      this.ctx.storage.get<Conns>("conns"),
    ]);
    return { state: state ?? logic.setup(), conns: conns ?? {} };
  }

  /** Persist, then point the alarm at the current turn deadline (if any). */
  private async save(state: LogicState, conns: Conns): Promise<void> {
    await this.ctx.storage.put({ state, conns });
    const endsAt = state.game?.endsAt ?? null;
    if (typeof endsAt === "number") await this.ctx.storage.setAlarm(endsAt + ALARM_SLACK_MS);
    else await this.ctx.storage.deleteAlarm();
  }

  // ── sockets ────────────────────────────────────────────────────────────

  private connIdOf(ws: WebSocket): string | undefined {
    const att = ws.deserializeAttachment() as { connId?: string } | null;
    return att?.connId;
  }

  private sockets(): Map<string, WebSocket> {
    const byId = new Map<string, WebSocket>();
    for (const s of this.ctx.getWebSockets()) {
      const id = this.connIdOf(s);
      if (id) byId.set(id, s);
    }
    return byId;
  }

  private send(msgs: Out[]): void {
    if (!msgs.length) return;
    const byId = this.sockets();
    for (const m of msgs) {
      const data = JSON.stringify(m.data);
      const ids = m.to === "*" ? [...byId.keys()] : Array.isArray(m.to) ? m.to : [m.to];
      for (const id of ids) {
        try {
          byId.get(id)?.send(data);
        } catch {
          /* socket closed mid-fan-out; its close handler will clean up */
        }
      }
    }
  }

  /**
   * Bring `conns` and the players' online flags in line with the sockets that
   * are really open. Storage can lag behind reality (a socket that died while
   * the room slept never ran its close handler), so this runs before every
   * broadcast rather than trusting the last write.
   */
  private reconcile(state: LogicState, conns: Conns): LogicState {
    const live = this.sockets();
    for (const connId of Object.keys(conns)) {
      if (!live.has(connId)) delete conns[connId];
    }
    const on = new Set(Object.values(conns));
    const stale = Object.values(state.players).some((p) => p.online !== on.has(p.id));
    if (!stale) return state;
    return logic.applyAction(state, "", { t: "_presence", on: [...on], _now: Date.now(), _rand: dice() });
  }

  /** Everyone's view of the room. Each player gets only `viewFor(state, them)`. */
  private broadcast(state: LogicState, conns: Conns): Out[] {
    const now = Date.now();
    const views = new Map<string, unknown>();
    return Object.entries(conns).map(([connId, pid]) => {
      if (!views.has(pid)) views.set(pid, logic.viewFor(state, pid));
      return { to: connId, data: { type: "state", you: pid, now, view: views.get(pid) } };
    });
  }

  // ── connection lifecycle ───────────────────────────────────────────────

  /**
   * The only entry point: a WebSocket upgrade routed here by the Worker
   * (`/ws/<room>`).
   */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }
    const pair = new WebSocketPair();
    const server = pair[1];
    // Hibernatable accept (NOT server.accept()): the room may be evicted while
    // this socket stays open.
    this.ctx.acceptWebSocket(server);
    const connId = crypto.randomUUID().slice(0, 12);
    // The connId must survive eviction — the socket carries it.
    server.serializeAttachment({ connId });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const connId = this.connIdOf(ws);
    if (!connId) return;
    try {
      await this.onMessage(connId, raw);
    } catch (err) {
      // A throw here is almost always a bug in the rules. Tell that one client
      // instead of killing the room for everybody.
      console.error("room message failed:", err instanceof Error ? err.stack : String(err));
      try {
        ws.send(JSON.stringify({ type: "error", error: "Помилка сервера" }));
      } catch {
        /* socket already gone */
      }
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const connId = this.connIdOf(ws);
    if (!connId) return;
    this.lastReact.delete(connId);
    const { state, conns } = await this.load();
    if (conns[connId] === undefined) return;
    delete conns[connId];
    // The closing socket may still be listed as open; drop it by hand.
    const on = new Set(Object.values(conns));
    const next = logic.applyAction(state, "", {
      t: "_presence",
      on: [...on],
      _now: Date.now(),
      _rand: dice(),
    });
    await this.save(next, conns);
    this.send(this.broadcast(next, conns));
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  /** The turn timer ran out (see `save`): let the rules end the turn. */
  override async alarm(): Promise<void> {
    try {
      const { state, conns } = await this.load();
      const action = { t: "_timeout", _now: Date.now(), _rand: dice() };
      if (!logic.validateAction(state, "", action).ok) {
        // Fired early or the deadline moved: `save` re-arms it correctly.
        await this.save(state, conns);
        return;
      }
      const next = this.reconcile(logic.applyAction(state, "", action), conns);
      await this.save(next, conns);
      this.send(this.broadcast(next, conns));
    } catch (err) {
      console.error("room alarm failed:", err instanceof Error ? err.stack : String(err));
    }
  }

  // ── messages ───────────────────────────────────────────────────────────

  private async onMessage(connId: string, raw: string | ArrayBuffer): Promise<void> {
    // Untrusted frame: validated before anything reads it (see ./protocol).
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) return this.send([{ to: connId, data: { type: "error", error: parsed.error } }]);
    const msg = parsed.msg;

    if (msg.type === "react") {
      const now = Date.now();
      if (now - (this.lastReact.get(connId) ?? 0) < REACT_GAP_MS) return;
      this.lastReact.set(connId, now);
      const conns = (await this.ctx.storage.get<Conns>("conns")) ?? {};
      const from = conns[connId];
      if (!from) return;
      return this.send([{ to: "*", data: { type: "react", from, emoji: msg.emoji } }]);
    }

    const { state, conns } = await this.load();

    if (msg.type === "join") {
      const pid = await publicId(msg.playerId);
      const action = {
        t: "_join",
        name: msg.name,
        avatar: msg.avatar,
        _now: Date.now(),
        _rand: dice(),
      };
      const verdict = logic.validateAction(state, pid, action);
      if (!verdict.ok) {
        return this.send([{ to: connId, data: { type: "bye", reason: verdict.error ?? "full" } }]);
      }
      conns[connId] = pid;
      const next = this.reconcile(logic.applyAction(state, pid, action), conns);
      await this.save(next, conns);
      return this.send(this.broadcast(next, conns));
    }

    // msg.type === "action"
    const pid = conns[connId];
    if (!pid) return this.send([{ to: connId, data: { type: "error", error: "join first" } }]);

    // The clock and the dice are the server's: whatever the client put in these
    // fields is overwritten.
    const action = { ...msg.action, _now: Date.now(), _rand: dice() };
    const verdict = logic.validateAction(state, pid, action);
    if (!verdict.ok) {
      return this.send([{ to: connId, data: { type: "error", error: verdict.error ?? "Дія неможлива" } }]);
    }
    let next = logic.applyAction(state, pid, action);

    // Someone was removed from the room: say goodbye and hang up on them.
    const gone = action.t === "kick" ? String(msg.action.pid) : action.t === "leave" ? pid : null;
    if (gone) {
      const sockets = this.sockets();
      for (const [id, owner] of Object.entries(conns)) {
        if (owner !== gone) continue;
        delete conns[id];
        const ws = sockets.get(id);
        try {
          ws?.send(JSON.stringify({ type: "bye", reason: action.t === "kick" ? "kicked" : "left" }));
          ws?.close(CLOSE_BYE, "bye");
        } catch {
          /* already gone */
        }
      }
    }

    next = this.reconcile(next, conns);
    await this.save(next, conns);
    this.send(this.broadcast(next, conns));
  }
}
