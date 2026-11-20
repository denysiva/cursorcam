/**
 * The client's single source of truth: preferences, the socket, the latest
 * view from the server, and the "what just happened" events the UI animates.
 *
 * The server is authoritative. This file never decides anything about the game;
 * it sends intents and compares each new view with the previous one to find out
 * what changed (a card was opened, an omen arrived, the turn passed…).
 */

import { useEffect, useState } from "./vendor/hooks.js";

// ── preferences (per browser) ──────────────────────────────────────────────

const params = new URLSearchParams(location.search);
/** `?as=2` gives a tab its own identity — handy for trying the game alone. */
const ns = params.get("as") ? `:${params.get("as")}` : "";
const key = (k) => `orakul${ns}:${k}`;

function read(k, fallback) {
  try {
    const v = localStorage.getItem(key(k));
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function write(k, v) {
  try {
    localStorage.setItem(key(k), JSON.stringify(v));
  } catch {
    /* private mode: the session simply won't be remembered */
  }
}

function makeToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

let token = read("token", null);
if (!token) {
  token = makeToken();
  write("token", token);
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export function makeRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}
export function cleanRoomCode(raw) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

// ── state ──────────────────────────────────────────────────────────────────

export const state = {
  room: cleanRoomCode(params.get("r")) || null,
  /** idle → connecting → open ⇄ lost; "bye" when the server said goodbye. */
  conn: "idle",
  bye: null,
  view: null,
  you: null,
  /** server clock minus ours, for the turn timer */
  offset: 0,
  profile: { name: read("name", ""), avatar: read("avatar", null) },
  sound: read("sound", true),
  music: read("music", false),
  haptics: read("haptics", true),
  toasts: [],
  /** cards opened a moment ago: index → timestamp (drives the flip animation) */
  fresh: {},
  /** bumped at the start of every round so the board deals itself in */
  dealId: 0,
  /** the banner currently announced over the board, if any */
  announce: null,
  /** the end-of-round screen appears a beat after the last card flips */
  overShown: false,
  sheet: null,
};

const listeners = new Set();
let scheduled = false;
export function notify() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    for (const fn of listeners) fn();
  });
}

/** Re-render the calling component whenever the store changes. */
export function useStore() {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => (n + 1) % 1e9);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return state;
}

// ── events (sound, particles and haptics hang off these) ───────────────────

const handlers = {};
export function on(name, fn) {
  (handlers[name] = handlers[name] || new Set()).add(fn);
  return () => handlers[name].delete(fn);
}
function emit(name, payload) {
  for (const fn of handlers[name] || []) {
    try {
      fn(payload);
    } catch (err) {
      console.error(err);
    }
  }
}

// ── small helpers the UI uses ──────────────────────────────────────────────

let toastId = 0;
export function toast(text, kind = "info") {
  const id = ++toastId;
  state.toasts = [...state.toasts.slice(-2), { id, text, kind }];
  notify();
  setTimeout(() => {
    state.toasts = state.toasts.filter((t) => t.id !== id);
    notify();
  }, 3200);
}

export function setPref(name, value) {
  state[name] = value;
  write(name, value);
  emit("pref", { name, value });
  notify();
}

export function setProfile(name, avatar) {
  state.profile = { name, avatar };
  write("name", name);
  write("avatar", avatar);
  if (state.conn === "open") act({ t: "profile", name, avatar });
  notify();
}

export function openSheet(name, data = null) {
  state.sheet = name ? { name, data } : null;
  notify();
}

export const me = () => state.view?.players.find((p) => p.id === state.you) || null;
export const isHost = () => Boolean(state.view) && state.view.hostId === state.you;
export const serverNow = () => Date.now() + state.offset;

// ── announcements: one banner at a time, in order ──────────────────────────

const queue = [];
let announcing = false;
function pump() {
  if (announcing) return;
  const next = queue.shift();
  if (!next) return;
  announcing = true;
  state.announce = next;
  notify();
  setTimeout(() => {
    state.announce = null;
    announcing = false;
    notify();
    setTimeout(pump, 120);
  }, next.ms);
}
function announce(item, delay = 0) {
  setTimeout(() => {
    queue.push({ id: Math.random(), ms: 1700, ...item });
    pump();
  }, delay);
}

// ── diffing two views into events ──────────────────────────────────────────

let overTimer = null;
function digest(prev, next) {
  const pg = prev?.game;
  const ng = next.game;

  if (prev) {
    const known = new Set(prev.players.map((p) => p.id));
    if (next.players.some((p) => !known.has(p.id))) emit("join");
  }

  if (!ng) {
    state.overShown = false;
    return;
  }

  const newRound = !pg || prev.round !== next.round;
  if (newRound) {
    state.fresh = {};
    state.overShown = next.phase === "over";
    if (prev && next.phase === "play") {
      state.dealId += 1;
      emit("deal", { count: ng.words.length });
      announce({ kind: "round", round: next.round, team: ng.first, ms: 2000 }, 250);
    }
    return;
  }

  let opened = null;
  ng.revealed.forEach((type, i) => {
    if (type && !pg.revealed[i]) {
      opened = { i, type, team: pg.turn, word: ng.words[i] };
      state.fresh[i] = Date.now();
      emit("reveal", opened);
    }
  });

  if (next.phase === "over" && prev.phase !== "over") {
    clearTimeout(overTimer);
    emit("over", { winner: ng.winner, reason: ng.reason, delay: opened ? 1500 : 0 });
    overTimer = setTimeout(
      () => {
        state.overShown = true;
        notify();
      },
      opened ? 2100 : 300,
    );
    return;
  }
  if (next.phase !== "play") return;

  if (ng.stage === "guess" && ng.clue && (pg.stage !== "guess" || pg.turnNo !== ng.turnNo)) {
    emit("clue", ng.clue);
    announce({ kind: "clue", team: ng.turn, word: ng.clue.word, n: ng.clue.n, ms: 2300 });
  }
  if (ng.turn !== pg.turn) {
    emit("turn", { team: ng.turn });
    const last = ng.log[ng.log.length - 1];
    announce({ kind: "turn", team: ng.turn, why: last?.k === "timeout" ? "timeout" : null, ms: 1500 }, opened ? 1100 : 0);
  }
}

// ── the socket ─────────────────────────────────────────────────────────────

const PING = "__ping";
const PONG = "__pong";
let socket = null;
let retry = 0;
let retryTimer = null;

function send(msg) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

export function act(action) {
  send({ type: "action", action });
}
export function react(emoji) {
  send({ type: "react", emoji });
}

function join() {
  send({ type: "join", playerId: token, name: state.profile.name, avatar: state.profile.avatar });
}

export function connect() {
  if (!state.room) return;
  clearTimeout(retryTimer);
  if (socket && socket.readyState <= WebSocket.OPEN) return;
  if (state.conn !== "lost") state.conn = "connecting";
  notify();

  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/ws/${encodeURIComponent(state.room)}`);
  socket = ws;

  ws.addEventListener("open", () => {
    retry = 0;
    join();
  });

  ws.addEventListener("message", (event) => {
    if (event.data === PONG) return;
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === "state") {
      const prev = state.view;
      state.offset = msg.now - Date.now();
      state.you = msg.you;
      state.view = msg.view;
      state.conn = "open";
      digest(prev, msg.view);
      notify();
    } else if (msg.type === "error") {
      if (msg.error === "join first") join();
      else {
        toast(msg.error, "error");
        emit("error");
      }
    } else if (msg.type === "react") {
      emit("react", msg);
    } else if (msg.type === "bye") {
      state.bye = msg.reason;
      state.conn = "bye";
      state.view = null;
      notify();
    }
  });

  ws.addEventListener("close", () => {
    if (socket !== ws) return;
    socket = null;
    if (state.conn === "bye" || !state.room) return;
    state.conn = "lost";
    notify();
    retry = Math.min(retry + 1, 6);
    retryTimer = setTimeout(connect, Math.min(400 * 2 ** (retry - 1), 8000));
  });
}

export function leaveRoom({ tellServer = true } = {}) {
  if (tellServer) act({ t: "leave" });
  const ws = socket;
  socket = null;
  clearTimeout(retryTimer);
  setTimeout(() => ws?.close(), 150);
  state.room = null;
  state.view = null;
  state.conn = "idle";
  state.bye = null;
  state.sheet = null;
  state.overShown = false;
  history.replaceState(null, "", location.pathname + (ns ? `?as=${params.get("as")}` : ""));
  notify();
}

export function enterRoom(code) {
  state.room = cleanRoomCode(code);
  state.bye = null;
  const q = new URLSearchParams();
  q.set("r", state.room);
  if (params.get("as")) q.set("as", params.get("as"));
  history.replaceState(null, "", `${location.pathname}?${q}`);
  notify();
}

export function roomLink() {
  return `${location.origin}/?r=${state.room}`;
}

// Keep the socket warm through idle periods (the server auto-answers these).
setInterval(() => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(PING);
}, 25_000);

// A phone that was locked comes back with a dead socket: reconnect at once.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !state.room || state.conn === "bye") return;
  if (!socket || socket.readyState > WebSocket.OPEN) {
    retry = 0;
    connect();
  }
});
window.addEventListener("online", () => {
  if (state.room && state.conn === "lost") connect();
});

// A window for tests and curious developers.
window.__orakul = state;
