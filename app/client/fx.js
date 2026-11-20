/**
 * Two canvases behind and in front of the interface.
 *
 *   #sky — the night the game is played under: drifting, twinkling stars and
 *          the occasional shooting star. Its tint follows whose turn it is.
 *   #fx  — bursts of sparks when a card opens, and the confetti of a win.
 *
 * Both stop drawing when there is nothing to draw or the tab is hidden, and
 * both stand still for people who asked for reduced motion.
 */

import { on, state } from "./store.js";

const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const DPR = Math.min(window.devicePixelRatio || 1, 2);

const COLORS = {
  sun: ["#ffd76a", "#ff9a3c", "#fff1b8", "#ff6f3c"],
  moon: ["#b9f1f5", "#6fd0e6", "#8ea0ff", "#ffffff"],
  bot: ["#d9cfbb", "#a39781", "#f3ead6"],
  ban: ["#ff3355", "#ff7a8f", "#7a0d22", "#ffffff"],
  gold: ["#fbe8ae", "#e2b356", "#fff6d8", "#c98f2f"],
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

// ── the sky ────────────────────────────────────────────────────────────────

function startSky() {
  const canvas = document.getElementById("sky");
  if (!canvas) return;
  const g = canvas.getContext("2d");
  let size = fit(canvas);
  let stars = [];
  let shooting = null;
  let nextShot = 4000;

  function seed() {
    const count = Math.round(Math.min(170, (size.w * size.h) / 5200));
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * size.w,
      y: Math.random() * size.h,
      r: Math.random() < 0.08 ? 1.5 + Math.random() : 0.4 + Math.random() * 0.9,
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 1.4,
      drift: 0.6 + Math.random() * 2.2,
      warm: Math.random() < 0.3,
    }));
  }
  seed();
  window.addEventListener("resize", () => {
    size = fit(canvas);
    seed();
    if (calm) draw(0, 0);
  });

  function draw(t, dt) {
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.clearRect(0, 0, size.w, size.h);
    for (const s of stars) {
      s.y -= (s.drift * dt) / 1000;
      if (s.y < -4) {
        s.y = size.h + 4;
        s.x = Math.random() * size.w;
      }
      const a = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(s.phase + (t / 1000) * s.speed));
      g.globalAlpha = a * (s.r > 1.4 ? 0.95 : 0.7);
      g.fillStyle = s.warm ? "#ffe2a8" : "#dfe6ff";
      g.beginPath();
      g.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      g.fill();
      if (s.r > 1.4) {
        g.globalAlpha = a * 0.35;
        g.fillRect(s.x - s.r * 3.2, s.y - 0.4, s.r * 6.4, 0.8);
        g.fillRect(s.x - 0.4, s.y - s.r * 3.2, 0.8, s.r * 6.4);
      }
    }
    if (shooting) {
      shooting.life += dt;
      const p = shooting.life / shooting.dur;
      if (p >= 1) shooting = null;
      else {
        const x = shooting.x + shooting.dx * p;
        const y = shooting.y + shooting.dy * p;
        const tail = g.createLinearGradient(x, y, x - shooting.dx * 0.22, y - shooting.dy * 0.22);
        tail.addColorStop(0, `rgba(255,244,214,${0.9 * (1 - p)})`);
        tail.addColorStop(1, "rgba(255,244,214,0)");
        g.globalAlpha = 1;
        g.strokeStyle = tail;
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - shooting.dx * 0.22, y - shooting.dy * 0.22);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
  }

  if (calm) {
    draw(0, 0);
    return;
  }
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(now - last, 60);
    last = now;
    if (document.visibilityState === "visible") {
      nextShot -= dt;
      if (nextShot <= 0 && !shooting) {
        nextShot = 7000 + Math.random() * 12000;
        shooting = {
          x: Math.random() * size.w * 0.7,
          y: Math.random() * size.h * 0.35,
          dx: size.w * (0.35 + Math.random() * 0.3),
          dy: size.h * (0.12 + Math.random() * 0.14),
          dur: 900 + Math.random() * 500,
          life: 0,
        };
      }
      draw(now, dt);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
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
