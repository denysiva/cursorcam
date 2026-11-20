/**
 * The room, driven through real WebSockets in the real Workers runtime: what a
 * phone actually experiences. The rules themselves are covered in
 * logic.test.ts; this file is about the wire — identity, privacy, fan-out.
 */

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Msg = any;

let roomSeq = 0;
const freshRoom = () => `TEST${Date.now().toString(36)}${roomSeq++}`.toUpperCase();

async function open(room: string) {
  const res = await SELF.fetch(`http://game.test/ws/${room}`, { headers: { Upgrade: "websocket" } });
  const ws = res.webSocket;
  if (!ws) throw new Error("no websocket");
  ws.accept();
  const inbox: Msg[] = [];
  const waiters: Array<() => void> = [];
  ws.addEventListener("message", (e) => {
    inbox.push(JSON.parse(e.data as string));
    for (const fn of waiters.splice(0)) fn();
  });
  const next = async (type: string, pred: (m: Msg) => boolean = () => true): Promise<Msg> => {
    for (let tries = 0; tries < 200; tries++) {
      const at = inbox.findIndex((m) => m.type === type && pred(m));
      if (at >= 0) return inbox.splice(at, 1)[0];
      await new Promise<void>((ok) => {
        waiters.push(ok);
        setTimeout(ok, 25);
      });
    }
    throw new Error(`timed out waiting for ${type}`);
  };
  return {
    ws,
    send: (m: Msg) => ws.send(JSON.stringify(m)),
    next,
    /** Drop everything received so far and wait for the next state. */
    state: async (pred?: (m: Msg) => boolean) => next("state", pred),
    clear: () => inbox.splice(0),
  };
}

async function join(room: string, token: string, name: string) {
  const c = await open(room);
  c.send({ type: "join", playerId: token, name, avatar: 1 });
  const first = await c.state();
  return { ...c, you: first.you as string, first };
}

describe("room", () => {
  it("refuses plain HTTP on the socket route", async () => {
    const res = await SELF.fetch("http://game.test/ws/ABCD");
    expect(res.status).toBe(426);
  });

  it("gives each browser a public id that is not its secret token", async () => {
    const room = freshRoom();
    const a = await join(room, "secret-token-of-anna", "Анна");
    expect(a.you).not.toContain("secret");
    expect(JSON.stringify(a.first)).not.toContain("secret-token-of-anna");
    expect(a.first.view.players[0].name).toBe("Анна");
    expect(a.first.view.hostId).toBe(a.you);
  });

  it("reclaims the same seat on reconnect and treats room codes case-insensitively", async () => {
    const room = freshRoom();
    const a = await join(room, "token-a", "Анна");
    const again = await join(room.toLowerCase(), "token-a", "Анна");
    expect(again.you).toBe(a.you);
    expect(again.first.view.players.length).toBe(1);
  });

  it("requires a join before anything else and rejects server-only actions", async () => {
    const room = freshRoom();
    const c = await open(room);
    c.send({ type: "action", action: { t: "start" } });
    expect((await c.next("error")).error).toBe("join first");
    c.send({ type: "action", action: { t: "_timeout" } });
    expect((await c.next("error")).error).toBe("unknown action");
    c.send({ type: "nonsense" });
    expect((await c.next("error")).error).toBe("unknown message type");
  });

  it("plays a turn end to end and never sends the key to a Seeker", async () => {
    const room = freshRoom();
    const host = await join(room, "t-host", "Ведучий");
    const s1 = await join(room, "t-s1", "Шукач");
    const m = await join(room, "t-m", "Місяць");
    const m1 = await join(room, "t-m1", "Шукачка");
    const act = (c: typeof host, action: Msg) => c.send({ type: "action", action });

    act(host, { t: "seat", team: "sun", role: "oracle" });
    act(s1, { t: "seat", team: "sun", role: "seeker" });
    act(m, { t: "seat", team: "moon", role: "oracle" });
    act(m1, { t: "seat", team: "moon", role: "seeker" });
    await host.state((x) => x.view.ready === null);

    // A client cannot smuggle its own clock or dice in.
    act(host, { t: "start", _now: 1, _rand: 1 });
    const started = await host.state((x) => x.view.phase === "play");
    const g = started.view.game;
    expect(g.key).toHaveLength(25);

    const seekerView = await s1.state((x) => x.view.phase === "play");
    expect(seekerView.view.game.key).toBeNull();
    expect(JSON.stringify(seekerView)).not.toContain('"ban"');

    const sunFirst = g.turn === "sun";
    const oracle = sunFirst ? host : m;
    const seeker = sunFirst ? s1 : m1;
    const rival = sunFirst ? m1 : s1;
    act(oracle, { t: "clue", word: "тест", n: 1 });
    await seeker.state((x) => x.view.game?.stage === "guess");

    const own = g.key.findIndex((k: string) => k === g.turn);
    act(rival, { t: "pick", i: own });
    expect((await rival.next("error")).error).toContain("не ваш хід");

    act(seeker, { t: "pick", i: own });
    const after = await rival.state((x) => x.view.game?.revealed[own] === g.turn);
    expect(after.view.game.left[g.turn]).toBe(g.total[g.turn] - 1);
    // Still no key for the rival Seeker: only what is face up.
    expect(after.view.game.key).toBeNull();
  });

  it("marks a player offline when their socket closes", async () => {
    const room = freshRoom();
    const a = await join(room, "t-a", "Анна");
    const b = await join(room, "t-b", "Борис");
    await a.state((x) => x.view.players.length === 2);
    b.ws.close(1000, "bye");
    const seen = await a.state((x) => x.view.players.some((p: Msg) => p.name === "Борис" && !p.online));
    expect(seen.view.players.find((p: Msg) => p.name === "Борис").online).toBe(false);
  });

  it("says goodbye to a kicked player", async () => {
    const room = freshRoom();
    const host = await join(room, "t-host", "Ведучий");
    const guest = await join(room, "t-guest", "Гість");
    await host.state((x) => x.view.players.length === 2);
    guest.send({ type: "action", action: { t: "kick", pid: host.you } });
    expect((await guest.next("error")).error).toContain("ведучий");
    host.send({ type: "action", action: { t: "kick", pid: guest.you } });
    expect((await guest.next("bye")).reason).toBe("kicked");
    const left = await host.state((x) => x.view.players.length === 1);
    expect(left.view.players[0].name).toBe("Ведучий");
  });

  it("relays reactions without storing them", async () => {
    const room = freshRoom();
    const a = await join(room, "t-a", "Анна");
    const b = await join(room, "t-b", "Борис");
    a.send({ type: "react", emoji: "🔥" });
    const got = await b.next("react");
    expect(got).toMatchObject({ emoji: "🔥", from: a.you });
    a.send({ type: "react", emoji: "<img>" });
    expect((await a.next("error")).error).toBe("unknown reaction");
  });
});
