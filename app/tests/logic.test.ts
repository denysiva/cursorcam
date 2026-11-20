/**
 * The rules, tested as the pure functions they are.
 *
 * Every test drives the same four entry points the room uses, with the clock
 * and the dice supplied by hand — exactly what `src/room.ts` does in production.
 */

import { describe, expect, it } from "vitest";

import * as logic from "../src/logic.js";

// The rules' state is opaque to TypeScript on purpose (see logic.d.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function world() {
  let state: Any = logic.setup();
  let now = 1_000_000;
  let dice = 12345;
  const send = (pid: string, action: Record<string, unknown>) => {
    now += 1000;
    dice = (dice * 1103515245 + 12345) >>> 0;
    const full = { ...action, _now: now, _rand: dice };
    const verdict = logic.validateAction(state, pid, full);
    if (verdict.ok) state = logic.applyAction(state, pid, full);
    return verdict;
  };
  return {
    send,
    get state(): Any {
      return state;
    },
    view: (pid: string): Any => logic.viewFor(state, pid),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** Six players: two Oracles, three Seekers, one spectator. `h` hosts. */
function seated() {
  const w = world();
  for (const id of ["h", "s1", "s2", "m", "m1", "x"]) w.send(id, { t: "_join", name: id.toUpperCase() });
  w.send("h", { t: "seat", team: "sun", role: "oracle" });
  w.send("s1", { t: "seat", team: "sun", role: "seeker" });
  w.send("s2", { t: "seat", team: "sun", role: "seeker" });
  w.send("m", { t: "seat", team: "moon", role: "oracle" });
  w.send("m1", { t: "seat", team: "moon", role: "seeker" });
  return w;
}

function started(patch: Record<string, unknown> = {}) {
  const w = seated();
  if (Object.keys(patch).length) expect(w.send("h", { t: "settings", patch }).ok).toBe(true);
  expect(w.send("h", { t: "start" }).ok).toBe(true);
  const g = w.state.game;
  const turn: "sun" | "moon" = g.turn;
  const oracle = turn === "sun" ? "h" : "m";
  const seeker = turn === "sun" ? "s1" : "m1";
  const cards = (type: string): number[] =>
    w.state.game.key
      .map((k: string, i: number) => (k === type && !w.state.game.revealed[i] ? i : -1))
      .filter((i: number) => i >= 0);
  return { w, turn, oracle, seeker, cards, other: turn === "sun" ? "moon" : "sun" };
}

describe("lobby", () => {
  it("makes the first player the host and refuses a start without full teams", () => {
    const w = world();
    w.send("a", { t: "_join", name: "Аня" });
    w.send("b", { t: "_join", name: "Борис" });
    expect(w.state.hostId).toBe("a");
    expect(w.send("a", { t: "start" }).ok).toBe(false);
    expect(w.send("b", { t: "settings", patch: { rows: 4 } }).ok).toBe(false);
  });

  it("allows one Oracle per team", () => {
    const w = seated();
    expect(w.send("x", { t: "seat", team: "sun", role: "oracle" }).ok).toBe(false);
    expect(w.send("x", { t: "seat", team: "sun", role: "seeker" }).ok).toBe(true);
  });

  it("refuses server-only actions that pretend to come from a player", () => {
    const w = seated();
    expect(w.send("x", { t: "_nonsense" }).ok).toBe(false);
  });

  it("cleans names and custom words", () => {
    const w = world();
    w.send("a", { t: "_join", name: "  Дуже   довге імʼя гравця  " });
    expect(w.state.players.a.name.length).toBeLessThanOrEqual(16);
    w.send("a", { t: "settings", patch: { custom: ["  шашлик ", "ШАШЛИК", "<b>", "нова пошта", ""], packs: ["custom"] } });
    expect(w.state.settings.custom).toEqual(["ШАШЛИК", "НОВА ПОШТА"]);
  });

  it("shuffles everyone into two teams with an Oracle each", () => {
    const w = seated();
    expect(w.send("h", { t: "shuffle" }).ok).toBe(true);
    const players: Any[] = Object.values(w.state.players);
    for (const team of ["sun", "moon"]) {
      const members = players.filter((p) => p.team === team);
      expect(members.length).toBe(3);
      expect(members.filter((p) => p.role === "oracle").length).toBe(1);
    }
  });
});

describe("a round", () => {
  it("deals the board with the right key for every size", () => {
    for (const [rows, first, second] of [
      [4, 7, 6],
      [5, 9, 8],
      [6, 11, 10],
    ] as const) {
      const { w } = started({ rows, bans: 2 });
      const g = w.state.game;
      expect(g.words.length).toBe(rows * 5);
      expect(new Set(g.words).size).toBe(rows * 5);
      const count = (t: string) => g.key.filter((k: string) => k === t).length;
      expect(count(g.first)).toBe(first);
      expect(count(g.first === "sun" ? "moon" : "sun")).toBe(second);
      expect(count("ban")).toBe(2);
    }
  });

  it("shows the key only to Oracles", () => {
    const { w } = started();
    expect(w.view("h").game.key).not.toBeNull();
    expect(w.view("m").game.key).not.toBeNull();
    for (const pid of ["s1", "s2", "m1", "x", "stranger"]) expect(w.view(pid).game.key).toBeNull();
    // Nothing else in a Seeker's view may give the key away either.
    expect(JSON.stringify(w.view("s1"))).not.toContain('"ban"');
  });

  it("takes an omen only from the Oracle whose turn it is, and vets it", () => {
    const { w, oracle, seeker, turn } = started();
    const rival = turn === "sun" ? "m" : "h";
    expect(w.send(seeker, { t: "clue", word: "небо", n: 2 }).ok).toBe(false);
    expect(w.send(rival, { t: "clue", word: "небо", n: 2 }).ok).toBe(false);
    expect(w.send(oracle, { t: "clue", word: w.state.game.words[0], n: 2 }).ok).toBe(false);
    expect(w.send(oracle, { t: "clue", word: "три слова тут", n: 2 }).ok).toBe(false);
    expect(w.send(oracle, { t: "clue", word: "небо", n: 12 }).ok).toBe(false);
    expect(w.send(oracle, { t: "clue", word: "<script>", n: 1 }).ok).toBe(false);
    expect(w.send(oracle, { t: "clue", word: "небо", n: 2 }).ok).toBe(true);
    expect(w.state.game.clue.word).toBe("НЕБО");
    expect(w.send(oracle, { t: "clue", word: "ще", n: 1 }).ok).toBe(false);
  });

  it("lets Seekers open number + 1 cards, then passes the turn", () => {
    const { w, oracle, seeker, cards, turn, other } = started();
    expect(w.send(seeker, { t: "pick", i: 0 }).ok).toBe(false);
    w.send(oracle, { t: "clue", word: "небо", n: 1 });
    expect(w.send(seeker, { t: "pass" }).ok).toBe(false);
    const own = cards(turn);
    expect(w.send(seeker, { t: "pick", i: own[0] }).ok).toBe(true);
    expect(w.state.game.turn).toBe(turn);
    expect(w.send(seeker, { t: "pick", i: own[0] }).ok).toBe(false);
    expect(w.send(seeker, { t: "pick", i: own[1] }).ok).toBe(true);
    expect(w.state.game.turn).toBe(other);
    expect(w.state.game.stage).toBe("clue");
  });

  it("ends the turn on a bot or a rival card, and credits the rival", () => {
    const { w, oracle, seeker, cards, other } = started();
    w.send(oracle, { t: "clue", word: "небо", n: 3 });
    const before = w.view(seeker).game.left[other];
    w.send(seeker, { t: "pick", i: cards(other)[0] });
    expect(w.state.game.turn).toBe(other);
    expect(w.view(seeker).game.left[other]).toBe(before - 1);
  });

  it("loses the round on a BAN card", () => {
    const { w, oracle, seeker, cards, other } = started();
    w.send(oracle, { t: "clue", word: "небо", n: 1 });
    w.send(seeker, { t: "pick", i: cards("ban")[0] });
    expect(w.state.phase).toBe("over");
    expect(w.state.game.winner).toBe(other);
    expect(w.state.game.reason).toBe("ban");
    expect(w.state.score[other]).toBe(1);
    expect(w.view("x").game.key).not.toBeNull();
    expect(w.view("x").game.awards.some((a: Any) => a.id === "ban")).toBe(true);
  });

  it("wins by opening every own card", () => {
    const { w, cards } = started();
    let guard = 0;
    while (w.state.phase === "play" && guard++ < 40) {
      const turn: string = w.state.game.turn;
      const oracle = turn === "sun" ? "h" : "m";
      const seeker = turn === "sun" ? "s1" : "m1";
      w.send(oracle, { t: "clue", word: `хід${guard}`, n: -1 });
      for (const i of cards(turn)) {
        if (w.state.phase !== "play" || w.state.game.turn !== turn) break;
        w.send(seeker, { t: "pick", i });
      }
    }
    expect(w.state.phase).toBe("over");
    expect(w.state.game.reason).toBe("cards");
    expect(w.state.game.winner).toBe(w.state.game.first);
  });

  it("opens a card by majority in vote mode", () => {
    const { w, oracle, cards, turn } = started({ pick: "vote" });
    const seekers = turn === "sun" ? ["s1", "s2"] : ["m1"];
    w.send(oracle, { t: "clue", word: "небо", n: 2 });
    expect(w.send(seekers[0]!, { t: "pick", i: 0 }).ok).toBe(false);
    const target = cards(turn)[0]!;
    for (const [n, pid] of seekers.entries()) {
      expect(w.state.game.revealed[target]).toBeNull();
      w.send(pid, { t: "mark", i: target });
      if (n < seekers.length - 1) expect(w.state.game.revealed[target]).toBeNull();
    }
    expect(w.state.game.revealed[target]).toBe(turn);
  });

  it("passes the turn when the timer runs out, and not before", () => {
    const { w, other } = started({ timer: 60 });
    expect(w.send("", { t: "_timeout" }).ok).toBe(false);
    w.advance(200_000);
    expect(w.send("", { t: "_timeout" }).ok).toBe(true);
    expect(w.state.game.turn).toBe(other);
    expect(typeof w.state.game.endsAt).toBe("number");
  });

  it("never lets someone who saw the key become a Seeker in that round", () => {
    const { w, oracle, turn } = started();
    expect(w.send(oracle, { t: "seat", team: turn, role: "seeker" }).ok).toBe(false);
    expect(w.send("x", { t: "seat", team: turn, role: "seeker" }).ok).toBe(true);
    expect(w.send("x", { t: "seat", team: turn === "sun" ? "moon" : "sun", role: "seeker" }).ok).toBe(false);
  });

  it("rotates Oracles for the next round and brings fresh words", () => {
    const { w, oracle, seeker, cards } = started();
    const firstWords: string[] = [...w.state.game.words];
    w.send(oracle, { t: "clue", word: "небо", n: 1 });
    w.send(seeker, { t: "pick", i: cards("ban")[0] });
    expect(w.send("s1", { t: "start", mode: "rotate" }).ok).toBe(false);
    expect(w.send("h", { t: "start", mode: "rotate" }).ok).toBe(true);
    expect(w.state.round).toBe(2);
    expect(w.state.players.h.role).toBe("seeker");
    expect(w.view("h").game.key).toBeNull();
    const repeats = w.state.game.words.filter((word: string) => firstWords.includes(word));
    expect(repeats.length).toBe(0);
  });

  it("keeps state JSON-serializable and never mutates its input", () => {
    const { w, oracle } = started();
    const before = JSON.stringify(w.state);
    const frozen = JSON.parse(before);
    logic.applyAction(frozen, oracle, { t: "clue", word: "небо", n: 2, _now: 5, _rand: 7 });
    expect(JSON.stringify(frozen)).toBe(before);
  });
});
