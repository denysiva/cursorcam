/**
 * Two canvases behind and in front of the interface.
 *
 *   #sky — the beach the game is played on: glints of sunlight on the sea and
 *          a few lazy bubbles drifting up. The scene itself (sky, sea, sand,
 *          clouds, palms and the turn tint) is plain CSS.
 *   #fx  — bursts of sparks when a card opens, and the confetti of a win.
 *
 * Both stop drawing when there is nothing to draw or the tab is hidden, and
 * both stand still for people who asked for reduced motion.
 */

import { on, state } from "./store.js";

const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const DPR = Math.min(window.devicePixelRatio || 1, 2);

const COLORS = {
  sun: ["#ffe45c", "#ffc21a", "#fff6b8", "#e08a00"],
  moon: ["#c7793a", "#8a4a1c", "#fff3d6", "#e9b98a"],
  bot: ["#f5e6c4", "#d8c59c", "#fffaf0"],
  ban: ["#ff4d5e", "#ff8f9a", "#1b2a49", "#0d1730", "#ffffff"],
  gold: ["#ffe45c", "#ff4d5e", "#19c7ce", "#ffffff", "#ff8a5c", "#7be06a", "#1fa2ff"],
};

function fit(canvas) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.round(w * DPR);
  canvas.height = Math.round(h * DPR);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  return { w, h };
}

// ── the sea ────────────────────────────────────────────────────────────────

// The sea band of the CSS scene, as fractions of the screen height.
const SEA_TOP = 0.435;
const SEA_BOTTOM = 0.74;

function startSky() {
  const canvas = document.getElementById("sky");
  if (!canvas) return;
  const g = canvas.getContext("2d");
  let size = fit(canvas);
  let glints = [];
  let bubbles = [];

  function bubble(anywhere) {
    return {
      x: Math.random() * size.w,
      y: anywhere ? Math.random() * size.h : size.h + 12,
      r: 3 + Math.random() * 6,
      rise: 7 + Math.random() * 11,
      sway: 6 + Math.random() * 12,
      phase: Math.random() * Math.PI * 2,
    };
  }
  function seed() {
    const top = size.h * SEA_TOP;
    const band = size.h * (SEA_BOTTOM - SEA_TOP);
    glints = Array.from({ length: Math.round(Math.min(44, 14 + size.w / 14)) }, () => {
      const depth = Math.random(); // 0 at the horizon, 1 at the shore
      return {
        x: Math.random() * size.w,
        y: top + depth * band,
        len: 4 + depth * 15,
        thick: 1.2 + depth * 1.6,
        phase: Math.random() * Math.PI * 2,
        speed: 0.7 + Math.random() * 1.3,
        drift: (2 + depth * 7) * (Math.random() < 0.5 ? -1 : 1),
        star: Math.random() < 0.14,
      };
    });
    bubbles = Array.from({ length: Math.round(Math.min(9, 4 + size.w / 180)) }, () => bubble(true));
  }
  seed();

  function draw(t, dt) {
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.clearRect(0, 0, size.w, size.h);
    const sec = t / 1000;
    g.strokeStyle = "#ffffff";
    g.fillStyle = "#ffffff";
    g.lineCap = "round";
    for (const s of glints) {
      s.x += (s.drift * dt) / 1000;
      if (s.x < -20) s.x = size.w + 20;
      else if (s.x > size.w + 20) s.x = -20;
      const wave = Math.sin(s.phase + sec * s.speed);
      if (wave <= 0) continue;
      g.globalAlpha = wave * wave * 0.85;
      g.lineWidth = s.thick;
      g.beginPath();
      g.moveTo(s.x - (s.len * wave) / 2, s.y);
      g.lineTo(s.x + (s.len * wave) / 2, s.y);
      if (s.star) {
        g.moveTo(s.x, s.y - s.len * 0.3 * wave);
        g.lineTo(s.x, s.y + s.len * 0.3 * wave);
      }
      g.stroke();
    }
    g.lineWidth = 1.4;
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i];
      b.y -= (b.rise * dt) / 1000;
      if (b.y < -14) bubbles[i] = bubble(false);
      const x = b.x + Math.sin(b.phase + sec * 0.6) * b.sway;
      g.globalAlpha = 0.5;
      g.beginPath();
      g.arc(x, b.y, b.r, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 0.16;
      g.fill();
      g.globalAlpha = 0.8;
      g.beginPath();
      g.arc(x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.22, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  window.addEventListener("resize", () => {
    size = fit(canvas);
    seed();
    if (calm) draw(900, 0);
  });
  if (calm) {
    draw(900, 0);
    return;
  }

  // About thirty frames a second is plenty for water, and nothing at all runs
  // while the tab is hidden.
  let last = 0;
  let raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = now - last;
    if (dt < 30) return;
    last = now;
    draw(now, Math.min(dt, 80));
  }
  function wake() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (document.visibilityState === "visible") {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }
  document.addEventListener("visibilitychange", wake);
  wake();
}

// ── sparks and confetti ────────────────────────────────────────────────────

let fxCanvas = null;
let fx = null;
let fxSize = { w: 0, h: 0 };
let parts = [];
let running = false;

function fxFrame(now) {
  if (!fx) return;
  const dt = Math.min(now - (fxFrame.last || now), 50) / 1000;
  fxFrame.last = now;
  fx.setTransform(DPR, 0, 0, DPR, 0, 0);
  fx.clearRect(0, 0, fxSize.w, fxSize.h);
  parts = parts.filter((p) => p.life < p.ttl);
  for (const p of parts) {
    p.life += dt;
    p.vy += p.g * dt;
    p.vx *= 1 - p.drag * dt;
    p.vy *= 1 - p.drag * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;
    const k = Math.max(0, 1 - p.life / p.ttl);
    fx.globalAlpha = Math.min(1, k * 1.6);
    fx.fillStyle = p.color;
    fx.save();
    fx.translate(p.x, p.y);
    fx.rotate(p.rot);
    if (p.shape === "rect") {
      const flip = Math.cos(p.life * p.wob);
      fx.fillRect(-p.size / 2, (-p.size * 0.3 * flip) / 1, p.size, p.size * 0.6 * flip);
    } else if (p.shape === "star") {
      const s = p.size * (0.4 + 0.6 * k);
      fx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        fx.lineTo(Math.cos(a) * s, Math.sin(a) * s);
        fx.lineTo(Math.cos(a + Math.PI / 4) * s * 0.28, Math.sin(a + Math.PI / 4) * s * 0.28);
      }
      fx.closePath();
      fx.fill();
      // A thin navy outline keeps pale sparks visible on white cards.
      fx.lineWidth = 1;
      fx.strokeStyle = "rgba(18,50,74,0.55)";
      fx.stroke();
    } else {
      fx.beginPath();
      fx.arc(0, 0, p.size * k, 0, Math.PI * 2);
      fx.fill();
    }
    fx.restore();
  }
  fx.globalAlpha = 1;
  if (parts.length) requestAnimationFrame(fxFrame);
  else {
    running = false;
    fxFrame.last = 0;
    fx.clearRect(0, 0, fxSize.w, fxSize.h);
  }
}

function kick() {
  if (running || !fx) return;
  running = true;
  requestAnimationFrame(fxFrame);
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function burst(x, y, palette, count = 26, power = 1) {
  if (calm || !fx) return;
  const colors = COLORS[palette] || COLORS.gold;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = (90 + Math.random() * 260) * power;
    parts.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - 60,
      g: 420,
      drag: 1.8,
      life: 0,
      ttl: 0.55 + Math.random() * 0.6,
      size: 2 + Math.random() * 4.5,
      rot: Math.random() * 6,
      spin: (Math.random() - 0.5) * 8,
      wob: 0,
      color: pick(colors),
      shape: Math.random() < 0.45 ? "star" : "dot",
    });
  }
  kick();
}

export function confetti(palette, waves = 4) {
  if (calm || !fx) return;
  const colors = [...(COLORS[palette] || COLORS.gold), ...COLORS.gold];
  for (let w = 0; w < waves; w++) {
    setTimeout(() => {
      for (let i = 0; i < 46; i++) {
        const fromLeft = i % 2 === 0;
        parts.push({
          x: fromLeft ? -10 : fxSize.w + 10,
          y: fxSize.h * (0.25 + Math.random() * 0.3),
          vx: (fromLeft ? 1 : -1) * (180 + Math.random() * 420),
          vy: -(260 + Math.random() * 420),
          g: 620,
          drag: 0.7,
          life: 0,
          ttl: 2 + Math.random() * 1.4,
          size: 6 + Math.random() * 7,
          rot: Math.random() * 6,
          spin: (Math.random() - 0.5) * 10,
          wob: 6 + Math.random() * 10,
          color: pick(colors),
          shape: Math.random() < 0.75 ? "rect" : "star",
        });
      }
      kick();
    }, w * 380);
  }
}

function centerOf(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function shake(kind) {
  if (calm) return;
  const app = document.getElementById("app");
  app.classList.remove("shake", "shake-hard");
  void app.offsetWidth;
  app.classList.add(kind);
  setTimeout(() => app.classList.remove(kind), 700);
}

export function startFx() {
  startSky();
  fxCanvas = document.getElementById("fx");
  if (!fxCanvas) return;
  fx = fxCanvas.getContext("2d");
  fxSize = fit(fxCanvas);
  window.addEventListener("resize", () => {
    fxSize = fit(fxCanvas);
  });

  on("reveal", ({ i, type, team }) => {
    setTimeout(() => {
      const c = centerOf(`[data-card="${i}"]`);
      if (!c) return;
      if (type === "ban") {
        burst(c.x, c.y, "ban", 70, 1.5);
        shake("shake-hard");
      } else if (type === "bot") {
        burst(c.x, c.y, "bot", 14, 0.7);
      } else {
        burst(c.x, c.y, type, type === team ? 38 : 22, type === team ? 1.1 : 0.8);
        if (type !== team) shake("shake");
      }
    }, 300);
  });

  on("over", ({ winner, delay }) => {
    setTimeout(() => confetti(winner, 5), delay + 700);
  });

  on("react", ({ emoji, from }) => {
    const layer = document.getElementById("reactions");
    if (!layer) return;
    const el = document.createElement("div");
    el.className = "float-emoji";
    el.textContent = emoji;
    const mine = from === state.you;
    el.style.left = `${mine ? 50 + (Math.random() - 0.5) * 20 : 8 + Math.random() * 84}%`;
    el.style.setProperty("--sway", `${(Math.random() - 0.5) * 60}px`);
    el.style.setProperty("--spin", `${(Math.random() - 0.5) * 40}deg`);
    layer.append(el);
    setTimeout(() => el.remove(), 2400);
  });
}
