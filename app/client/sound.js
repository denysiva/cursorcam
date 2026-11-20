/**
 * Sound and haptics.
 *
 * Recorded effects (public/sfx) are decoded once into Web Audio buffers; the
 * tiny interface blips (tap, tick, pop) are synthesised so they cost nothing to
 * load. Browsers only allow audio after a gesture, so everything starts on the
 * first tap anywhere.
 */

import { on, state } from "./store.js";

const FILES = ["flip", "good", "miss", "bot", "ban", "clue", "turn", "win"];
const GAIN = { flip: 0.5, good: 0.55, miss: 0.5, bot: 0.5, ban: 0.8, clue: 0.5, turn: 0.4, win: 0.7 };

let ctx = null;
let master = null;
const buffers = {};
let musicEl = null;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  for (const name of FILES) {
    fetch(`/sfx/${name}.mp3`)
      .then((r) => r.arrayBuffer())
      .then((data) => new Promise((ok, bad) => ctx.decodeAudioData(data, ok, bad)))
      .then((buf) => {
        buffers[name] = buf;
      })
      .catch(() => {});
  }
  return ctx;
}

let touched = false;
function unlock() {
  touched = true;
  const c = ensure();
  if (c && c.state === "suspended") c.resume();
  syncMusic();
}
for (const ev of ["pointerdown", "keydown", "touchend"]) {
  window.addEventListener(ev, unlock, { passive: true });
}

export function play(name, { delay = 0, rate = 1, gain = 1 } = {}) {
  if (!state.sound || !ctx || ctx.state !== "running") return;
  const buf = buffers[name];
  if (!buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = (GAIN[name] ?? 0.5) * gain;
  src.connect(g).connect(master);
  src.start(ctx.currentTime + delay);
}

/** A short synthesised tone: the interface's own little voice. */
function tone({ freq, to = freq, dur = 0.08, type = "sine", gain = 0.12, delay = 0 }) {
  if (!state.sound || !ctx || ctx.state !== "running") return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const ui = {
  tap: () => tone({ freq: 620, to: 880, dur: 0.05, type: "triangle", gain: 0.07 }),
  mark: () => tone({ freq: 440, to: 660, dur: 0.09, type: "sine", gain: 0.1 }),
  pop: () => {
    tone({ freq: 520, to: 780, dur: 0.07, gain: 0.08 });
    tone({ freq: 780, to: 1040, dur: 0.09, gain: 0.07, delay: 0.07 });
  },
  tick: () => tone({ freq: 1200, to: 900, dur: 0.035, type: "square", gain: 0.035 }),
  nope: () => tone({ freq: 220, to: 150, dur: 0.16, type: "sawtooth", gain: 0.06 }),
};

export function buzz(pattern) {
  // Browsers refuse to vibrate before the first tap, and say so loudly.
  if (!touched || !state.haptics || !navigator.vibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* not allowed here */
  }
}

// ── background music (off by default: twenty phones in one room is a lot) ──

function syncMusic() {
  if (state.music && state.sound) {
    if (!musicEl) {
      musicEl = new Audio("/sfx/music.mp3");
      musicEl.loop = true;
      musicEl.volume = 0.22;
    }
    musicEl.play().catch(() => {});
  } else if (musicEl) {
    musicEl.pause();
  }
}
on("pref", syncMusic);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") musicEl?.pause();
  else syncMusic();
});

// ── the game's events, voiced ──────────────────────────────────────────────

on("deal", ({ count }) => {
  for (let i = 0; i < Math.min(count, 12); i++) {
    play("flip", { delay: 0.25 + i * 0.07, rate: 0.9 + (i % 5) * 0.06, gain: 0.5 });
  }
});

on("reveal", ({ type, team }) => {
  play("flip");
  if (type === "ban") {
    play("ban", { delay: 0.32 });
    buzz([0, 60, 40, 60, 40, 380]);
  } else if (type === "bot") {
    play("bot", { delay: 0.3 });
    buzz(30);
  } else if (type === team) {
    play("good", { delay: 0.3 });
    buzz([0, 20, 40, 30]);
  } else {
    play("miss", { delay: 0.3 });
    buzz([0, 70, 50, 70]);
  }
});

on("clue", () => {
  play("clue");
  buzz(25);
});
on("turn", () => play("turn", { delay: 0.5 }));
on("over", ({ delay }) => play("win", { delay: delay / 1000 + 0.9 }));
on("join", () => ui.pop());
on("error", () => ui.nope());
