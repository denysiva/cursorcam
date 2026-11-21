/**
 * КОКО БАНАН — the rules.
 *
 * A team word-association game. Two teams (Bananas and Coconuts) share one grid
 * of words. Each team has a Captain who alone sees which words belong to whom
 * and gives one-word clues (a word + a number); the team's Players open cards.
 * Open all of your cards first to win; open a Shark and you lose on the spot.
 *
 * The ids in the code and on the wire keep their first names. What players read
 * → what the code says: Bananas → `sun`, Coconuts → `moon`, Captain → `oracle`,
 * Player → `seeker`, Tourist (nobody's card) → `bot`, Shark → `ban`. Comments
 * below use the code's names.
 *
 * This module is PURE: no imports, no clock, no randomness of its own. The room
 * (src/room.ts) injects two trusted fields into every action before it gets
 * here — `_now` (ms epoch) and `_rand` (a fresh uint32) — and it refuses any
 * client action whose type starts with "_", so the internal actions below
 * (`_join`, `_presence`, `_timeout`) can only come from the server.
 *
 * The whole room lifecycle (lobby → play → over → lobby) lives in the state, so
 * `isGameOver` always answers "no": a finished round is just another phase.
 */

export const meta = { game: "Коко Банан", minPlayers: 1, maxPlayers: 60 };

// ── constants ──────────────────────────────────────────────────────────────

const MAX_PLAYERS = 60;
const AVATARS = 16;
const COLS = 5;
const NAME_MAX = 16;
const CLUE_MAX = 24;
const CUSTOM_MAX = 600;
const WORD_MAX = 24;
const LOG_MAX = 400;
const FIRST_CLUE_BONUS = 45;
const HIT_BONUS = 15;
const TIMERS = [0, 60, 90, 120, 180];
const ROWS = [4, 5, 6];
/** rows → [cards of the team that starts, cards of the other team] */
const SHARE = { 4: [7, 6], 5: [9, 8], 6: [11, 10] };

const other = (team) => (team === "sun" ? "moon" : "sun");
const isTeam = (t) => t === "sun" || t === "moon";
const fail = (error) => ({ ok: false, error });
const clone = (v) => JSON.parse(JSON.stringify(v));

// ── deterministic randomness ───────────────────────────────────────────────

/** mulberry32 step: advances `s.seed` and returns a float in [0, 1). */
function rnd(s) {
  s.seed = (s.seed + 0x6d2b79f5) >>> 0;
  let t = s.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rint = (s, n) => Math.floor(rnd(s) * n);
function shuffle(s, list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rint(s, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── text helpers ───────────────────────────────────────────────────────────

function cleanText(raw, max) {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[’ʼ`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}
const cleanName = (raw) => cleanText(raw, NAME_MAX);
/** Letters only, lower-cased — what two words are compared by. */
const bare = (w) => String(w).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

function cleanWord(raw) {
  const w = cleanText(raw, WORD_MAX).toUpperCase();
  if (!w || !/\p{L}/u.test(w)) return "";
  if (!/^[\p{L}\p{N}' .\-]+$/u.test(w)) return "";
  return w;
}

// ── state ──────────────────────────────────────────────────────────────────

function defaultSettings() {
  return { rows: 5, timer: 0, pick: "free", bans: 1, packs: ["base"], custom: [] };
}

export function setup() {
  return {
    v: 1,
    phase: "lobby",
    hostId: null,
    players: {},
    order: [],
    settings: defaultSettings(),
    seed: 0x9e3779b9,
    round: 0,
    score: { sun: 0, moon: 0 },
    lastFirst: null,
    used: [],
    game: null,
  };
}

const members = (s, team) => s.order.map((id) => s.players[id]).filter((p) => p && p.team === team);
const oracleOf = (s, team) => members(s, team).find((p) => p.role === "oracle") || null;
const seekersOf = (s, team) => members(s, team).filter((p) => p.role === "seeker");

function ensureHost(s) {
  if (s.hostId && s.players[s.hostId]) return;
  const next = s.order.find((id) => s.players[id]?.online) || s.order[0] || null;
  s.hostId = next;
}

function pushLog(g, entry) {
  g.log.push(entry);
  if (g.log.length > LOG_MAX) g.log.splice(0, g.log.length - LOG_MAX);
}

// ── board generation ───────────────────────────────────────────────────────

function packWords(s, id) {
  if (id === "custom") return s.settings.custom;
  return PACKS[id] ? PACKS[id].words : [];
}

function drawWords(s, count) {
  const packs = s.settings.packs.filter((id) => packWords(s, id).length > 0);
  const ids = packs.length ? packs : ["base"];
  const total = new Set();
  for (const id of ids) for (const w of packWords(s, id)) total.add(bare(w));
  // Not enough fresh words left? Forget what was played and start over.
  let used = new Set(s.used);
  if (total.size - [...total].filter((w) => used.has(w)).length < count) used = new Set();
  // Small pools (a short custom list) fall back to the classic pack to fill up.
  if (total.size < count && !ids.includes("base")) ids.push("base");

  const taken = new Set();
  const pools = ids.map((id) => shuffle(s, packWords(s, id)).filter((w) => !used.has(bare(w))));
  const words = [];
  let guard = 0;
  while (words.length < count && guard++ < 5000) {
    const live = pools.filter((p) => p.length > 0);
    if (!live.length) break;
    // Every selected pack gets an equal share of the board, however big it is.
    const pool = live[rint(s, live.length)];
    const w = pool.pop();
    const key = bare(w);
    if (taken.has(key)) continue;
    taken.add(key);
    words.push(w);
  }
  // Last resort (tiny pools everywhere): reuse played words.
  if (words.length < count) {
    for (const w of shuffle(s, PACKS.base.words)) {
      if (words.length >= count) break;
      if (!taken.has(bare(w))) {
        taken.add(bare(w));
        words.push(w);
      }
    }
  }
  // Remember what was just played so the next rounds bring fresh words, but
  // never remember so much that the pool runs dry.
  const cap = Math.max(0, total.size - count * 2);
  const merged = [...used, ...words.map(bare)];
  s.used = cap > 0 ? merged.slice(-cap) : [];
  return shuffle(s, words);
}

function startRound(s, now) {
  const rows = s.settings.rows;
  const count = rows * COLS;
  const first = s.lastFirst ? other(s.lastFirst) : rnd(s) < 0.5 ? "sun" : "moon";
  const [a, b] = SHARE[rows];
  const bans = Math.min(s.settings.bans, count - a - b - 2);
  const key = [];
  for (let i = 0; i < a; i++) key.push(first);
  for (let i = 0; i < b; i++) key.push(other(first));
  for (let i = 0; i < bans; i++) key.push("ban");
  while (key.length < count) key.push("bot");

  s.round += 1;
  s.lastFirst = first;
  s.phase = "play";
  const timer = s.settings.timer;
  s.game = {
    rows,
    cols: COLS,
    words: drawWords(s, count),
    key: shuffle(s, key),
    revealed: Array(count).fill(null),
    first,
    turn: first,
    stage: "clue",
    clue: null,
    made: 0,
    marks: {},
    log: [],
    turnNo: 1,
    startedAt: now,
    endsAt: timer ? now + (timer + FIRST_CLUE_BONUS) * 1000 : null,
    winner: null,
    reason: null,
    // Everyone who has seen the key this round: they may not guess any more.
    sawKey: [],
    // Which team each player belongs to for this round: no switching sides.
    bound: {},
    awards: [],
  };
  for (const t of ["sun", "moon"]) {
    const o = oracleOf(s, t);
    if (o) s.game.sawKey.push(o.id);
  }
  for (const p of Object.values(s.players)) if (p.team) s.game.bound[p.id] = p.team;
}

const left = (g, team) => g.key.reduce((n, t, i) => n + (t === team && !g.revealed[i] ? 1 : 0), 0);

function endTurn(s, now) {
  const g = s.game;
  g.turn = other(g.turn);
  g.stage = "clue";
  g.clue = null;
  g.made = 0;
  g.marks = {};
  g.turnNo += 1;
  g.endsAt = s.settings.timer ? now + s.settings.timer * 1000 : null;
}

function finish(s, winner, reason) {
  const g = s.game;
  g.winner = winner;
  g.reason = reason;
  g.endsAt = null;
  g.marks = {};
  s.phase = "over";
  s.score[winner] += 1;
  for (const p of Object.values(s.players)) if (p.team === winner) p.wins = (p.wins || 0) + 1;
  g.awards = computeAwards(g);
}

/** Open card `i` for the team whose turn it is. `by` is a player or null. */
function reveal(s, i, by, now) {
  const g = s.game;
  const type = g.key[i];
  const team = g.turn;
  g.revealed[i] = type;
  g.marks = {};
  pushLog(g, {
    k: "pick",
    team,
    by: by ? by.id : null,
    name: by ? by.name : "",
    i,
    word: g.words[i],
    type,
    turn: g.turnNo,
  });

  if (type === "ban") return finish(s, other(team), "ban");
  if (left(g, "sun") === 0) return finish(s, "sun", "cards");
  if (left(g, "moon") === 0) return finish(s, "moon", "cards");

  if (type !== team) return endTurn(s, now);
  g.made += 1;
  const limit = g.clue && g.clue.n >= 1 ? g.clue.n + 1 : null;
  if (limit !== null && g.made >= limit) return endTurn(s, now);
  if (g.endsAt) g.endsAt += HIT_BONUS * 1000;
}

/** How many matching votes open a card in "vote" mode. */
function votesNeeded(s, team) {
  const online = seekersOf(s, team).filter((p) => p.online).length;
  return Math.max(1, Math.floor(online / 2) + 1);
}

function tallyVotes(s, now) {
  const g = s.game;
  const need = votesNeeded(s, g.turn);
  const counts = {};
  for (const [pid, i] of Object.entries(g.marks)) {
    const p = s.players[pid];
    if (!p || !p.online || p.team !== g.turn || p.role !== "seeker") continue;
    counts[i] = (counts[i] || 0) + 1;
  }
  for (const [key, n] of Object.entries(counts)) {
    if (n < need) continue;
    const i = Number(key);
    if (i === -1) {
      if (g.made < 1) continue;
      pushLog(g, { k: "pass", team: g.turn, by: null, name: "", turn: g.turnNo });
      return endTurn(s, now);
    }
    return reveal(s, i, null, now);
  }
}

function computeAwards(g) {
  const per = {};
  const bump = (e, field) => {
    if (!e.by) return;
    per[e.by] = per[e.by] || { id: e.by, name: e.name, hit: 0, gift: 0, bot: 0, ban: 0 };
    per[e.by][field] += 1;
  };
  let best = null;
  let current = null;
  for (const e of g.log) {
    if (e.k === "clue") {
      current = { ...e, hits: 0 };
    } else if (e.k === "pick") {
      if (e.type === e.team) {
        bump(e, "hit");
        if (current) {
          current.hits += 1;
          if (!best || current.hits > best.hits) best = current;
        }
      } else if (e.type === "ban") bump(e, "ban");
      else if (e.type === "bot") bump(e, "bot");
      else bump(e, "gift");
    }
  }
  const top = (field) =>
    Object.values(per)
      .filter((p) => p[field] > 0)
      .sort((x, y) => y[field] - x[field])[0];
  const awards = [];
  if (best && best.hits >= 2) {
    awards.push({ id: "omen", pid: best.by, name: best.name, word: best.word, n: best.hits });
  }
  const seer = top("hit");
  if (seer) awards.push({ id: "seer", pid: seer.id, name: seer.name, n: seer.hit });
  const banned = top("ban");
  if (banned) awards.push({ id: "ban", pid: banned.id, name: banned.name, n: banned.ban });
  const gift = top("gift");
  if (gift) awards.push({ id: "gift", pid: gift.id, name: gift.name, n: gift.gift });
  const bot = top("bot");
  if (bot && bot.bot >= 2) awards.push({ id: "bot", pid: bot.id, name: bot.name, n: bot.bot });
  return awards.slice(0, 4);
}

// ── the reducer ────────────────────────────────────────────────────────────

function clueProblem(g, word) {
  const c = bare(word);
  for (let i = 0; i < g.words.length; i++) {
    if (g.revealed[i]) continue;
    const w = bare(g.words[i]);
    if (c === w) return `«${g.words[i]}» лежить на столі — це слово не можна називати`;
    const short = Math.min(c.length, w.length);
    if (short >= 4 && (c.includes(w) || w.includes(c))) {
      return `Занадто схоже на «${g.words[i]}» зі столу`;
    }
  }
  return null;
}

function seat(s, p, team, role) {
  p.team = team;
  p.role = team ? role : "seeker";
}

function shuffleTeams(s) {
  const pool = shuffle(
    s,
    s.order.filter((id) => s.players[id].online || s.players[id].team),
  );
  const half = Math.ceil(pool.length / 2);
  const startSun = rnd(s) < 0.5;
  pool.forEach((id, idx) => {
    const inFirst = idx < half;
    const team = inFirst === startSun ? "sun" : "moon";
    seat(s, s.players[id], team, "seeker");
  });
  for (const t of ["sun", "moon"]) {
    const online = members(s, t).filter((p) => p.online);
    const pick = (online.length ? online : members(s, t))[0];
    if (pick) pick.role = "oracle";
  }
}

function rotateOracles(s) {
  for (const t of ["sun", "moon"]) {
    const team = members(s, t);
    if (team.length < 2) continue;
    const idx = team.findIndex((p) => p.role === "oracle");
    for (const p of team) p.role = "seeker";
    // Prefer the next teammate who is actually here.
    for (let step = 1; step <= team.length; step++) {
      const cand = team[(Math.max(idx, 0) + step) % team.length];
      if (cand.online || step === team.length) {
        cand.role = "oracle";
        break;
      }
    }
  }
}

function readyProblem(s) {
  for (const t of ["sun", "moon"]) {
    const label = t === "sun" ? "Бананів" : "Кокосів";
    if (!oracleOf(s, t)) return `Команді ${label} потрібен Капітан`;
    if (seekersOf(s, t).length < 1) return `Команді ${label} потрібен хоча б один Гравець`;
  }
  return null;
}

function applySettings(s, patch) {
  const next = { ...s.settings };
  if (!patch || typeof patch !== "object") return "Невірні налаштування";
  if ("rows" in patch) {
    if (!ROWS.includes(patch.rows)) return "Невірний розмір поля";
    next.rows = patch.rows;
  }
  if ("timer" in patch) {
    if (!TIMERS.includes(patch.timer)) return "Невірний таймер";
    next.timer = patch.timer;
  }
  if ("pick" in patch) {
    if (patch.pick !== "free" && patch.pick !== "vote") return "Невірний режим вибору";
    next.pick = patch.pick;
  }
  if ("bans" in patch) {
    if (![1, 2, 3].includes(patch.bans)) return "Невірна кількість акул";
    next.bans = patch.bans;
  }
  if ("custom" in patch) {
    if (!Array.isArray(patch.custom)) return "Невірний список слів";
    const seen = new Set();
    const list = [];
    for (const raw of patch.custom.slice(0, CUSTOM_MAX * 2)) {
      const w = cleanWord(raw);
      if (!w || seen.has(bare(w))) continue;
      seen.add(bare(w));
      list.push(w);
      if (list.length >= CUSTOM_MAX) break;
    }
    next.custom = list;
    if (!list.length) next.packs = next.packs.filter((id) => id !== "custom");
  }
  if ("packs" in patch) {
    if (!Array.isArray(patch.packs)) return "Невірний набір слів";
    const ids = [...new Set(patch.packs)].filter(
      (id) => (id === "custom" && next.custom.length > 0) || Boolean(PACKS[id]),
    );
    if (!ids.length) return "Обери хоча б один набір слів";
    next.packs = ids;
  }
  s.settings = next;
  return null;
}

/**
 * The single place every action is judged AND applied, on a private copy of the
 * state. `validateAction` runs it and throws the copy away; `applyAction` runs
 * it again and keeps the copy — so the two can never disagree.
 */
function run(state, pid, a) {
  if (!a || typeof a !== "object" || typeof a.t !== "string") return fail("Невідома дія");
  const s = clone(state);
  const now = Number(a._now) || 0;
  if (typeof a._rand === "number") s.seed = (s.seed ^ (a._rand >>> 0)) >>> 0;
  const me = s.players[pid];
  const g = s.game;
  if (g && !g.bound) g.bound = {};
  const host = Boolean(me) && s.hostId === pid;
  // Player ids arrive from the client in host actions: only real, own keys count.
  const known = (id) => typeof id === "string" && Object.prototype.hasOwnProperty.call(s.players, id);
  if (typeof pid !== "string") return fail("Невідома дія");
  const done = () => ({ ok: true, state: s });

  // ── server-only actions ──────────────────────────────────────────────────
  if (a.t === "_join") {
    const name = cleanName(a.name);
    const avatar = Number.isInteger(a.avatar) && a.avatar >= 0 && a.avatar < AVATARS ? a.avatar : null;
    if (!me) {
      if (s.order.length >= MAX_PLAYERS) return fail("Кімната заповнена");
      s.players[pid] = {
        id: pid,
        name: name || `Гість ${s.order.length + 1}`,
        avatar: avatar ?? rint(s, AVATARS),
        team: null,
        role: "seeker",
        online: true,
        wins: 0,
      };
      s.order.push(pid);
    } else {
      me.online = true;
      if (name) me.name = name;
      if (avatar !== null) me.avatar = avatar;
    }
    ensureHost(s);
    return done();
  }
  if (a.t === "_presence") {
    const on = new Set(Array.isArray(a.on) ? a.on : []);
    for (const p of Object.values(s.players)) p.online = on.has(p.id);
    ensureHost(s);
    // Someone left mid-vote: the votes already cast may now be a majority.
    if (s.phase === "play" && g.stage === "guess" && s.settings.pick === "vote") tallyVotes(s, now);
    return done();
  }
  if (a.t === "_timeout") {
    if (s.phase !== "play" || !g.endsAt || now < g.endsAt - 250) return fail("Таймер ще йде");
    pushLog(g, { k: "timeout", team: g.turn, stage: g.stage, turn: g.turnNo });
    endTurn(s, now);
    return done();
  }
  if (a.t.startsWith("_")) return fail("Невідома дія");

  if (!me) return fail("Спершу увійди в кімнату");

  switch (a.t) {
    case "profile": {
      const name = cleanName(a.name);
      if (!name) return fail("Вкажи імʼя");
      me.name = name;
      if (Number.isInteger(a.avatar) && a.avatar >= 0 && a.avatar < AVATARS) me.avatar = a.avatar;
      return done();
    }

    case "seat": {
      const team = a.team === null ? null : a.team;
      if (team !== null && !isTeam(team)) return fail("Невірна команда");
      const role = a.role === "oracle" ? "oracle" : "seeker";
      if (s.phase === "play") {
        const saw = g.sawKey.includes(pid);
        if (team === null) {
          if (me.role === "oracle" && me.team) return fail("Капітан не може покинути гру посеред раунду");
          seat(s, me, null, "seeker");
          delete g.marks[pid];
          return done();
        }
        if (me.team && me.team !== team) return fail("Змінити команду можна після раунду");
        if (g.bound[pid] && g.bound[pid] !== team) return fail("Змінити команду можна після раунду");
        if (role === "seeker") {
          if (saw) return fail("Ти вже знаєш ключ цього раунду");
          seat(s, me, team, "seeker");
          g.bound[pid] = team;
          return done();
        }
        const current = oracleOf(s, team);
        if (current && current.id !== pid && current.online) return fail("У цієї команди вже є Капітан");
        if (current && current.id !== pid) {
          // The Oracle being replaced knows the key: they sit the round out.
          current.role = "seeker";
          current.team = null;
          delete g.marks[current.id];
        }
        seat(s, me, team, "oracle");
        g.bound[pid] = team;
        if (!saw) g.sawKey.push(pid);
        delete g.marks[pid];
        return done();
      }
      if (team && role === "oracle") {
        const current = oracleOf(s, team);
        if (current && current.id !== pid) {
          if (current.online) return fail("У цієї команди вже є Капітан");
          current.role = "seeker";
        }
      }
      seat(s, me, team, role);
      return done();
    }

    case "claimHost": {
      const h = s.players[s.hostId];
      if (h && h.online && s.hostId !== pid) return fail("Ведучий на звʼязку");
      s.hostId = pid;
      return done();
    }

    case "leave": {
      if (s.phase === "play" && me.team && me.role === "oracle") me.role = "seeker";
      delete s.players[pid];
      s.order = s.order.filter((id) => id !== pid);
      if (g) delete g.marks[pid];
      if (s.hostId === pid) s.hostId = null;
      ensureHost(s);
      return done();
    }

    // ── host controls ──────────────────────────────────────────────────────
    case "settings": {
      if (!host) return fail("Це може лише ведучий");
      if (s.phase === "play") return fail("Налаштування змінюються між раундами");
      const problem = applySettings(s, a.patch);
      return problem ? fail(problem) : done();
    }
    case "shuffle": {
      if (!host) return fail("Це може лише ведучий");
      if (s.phase === "play") return fail("Команди змінюються між раундами");
      shuffleTeams(s);
      return done();
    }
    case "move": {
      if (!host) return fail("Це може лише ведучий");
      if (!known(a.pid)) return fail("Гравця не знайдено");
      const p = s.players[a.pid];
      const team = a.team === null ? null : a.team;
      if (team !== null && !isTeam(team)) return fail("Невірна команда");
      const role = a.role === "oracle" ? "oracle" : "seeker";
      if (s.phase === "play") {
        const saw = g.sawKey.includes(p.id);
        if (p.team && team && p.team !== team) return fail("Змінити команду можна після раунду");
        if (team && g.bound[p.id] && g.bound[p.id] !== team) return fail("Змінити команду можна після раунду");
        if (team && role === "seeker" && saw) return fail("Ця людина вже знає ключ цього раунду");
        if (team) g.bound[p.id] = team;
        if (team === null && p.role === "oracle" && p.team) {
          return fail("Спершу признач іншого Капітана");
        }
        if (team && role === "oracle" && !saw) g.sawKey.push(p.id);
        delete g.marks[p.id];
      }
      if (team && role === "oracle") {
        const current = oracleOf(s, team);
        if (current && current.id !== p.id) current.role = "seeker";
        if (s.phase === "play" && current && current.id !== p.id) {
          // The outgoing Oracle knows the key — they sit the rest of it out.
          current.team = null;
        }
      }
      seat(s, p, team, role);
      return done();
    }
    case "kick": {
      if (!host) return fail("Це може лише ведучий");
      if (a.pid === pid) return fail("Себе видалити не можна");
      if (!known(a.pid)) return fail("Гравця не знайдено");
      delete s.players[a.pid];
      s.order = s.order.filter((id) => id !== a.pid);
      if (g) delete g.marks[a.pid];
      return done();
    }
    case "giveHost": {
      if (!host) return fail("Це може лише ведучий");
      if (!known(a.pid)) return fail("Гравця не знайдено");
      s.hostId = a.pid;
      return done();
    }
    case "start": {
      if (!host) return fail("Почати гру може лише ведучий");
      if (s.phase === "play") return fail("Раунд уже йде");
      if (a.mode === "rotate") rotateOracles(s);
      else if (a.mode === "shuffle") shuffleTeams(s);
      const problem = readyProblem(s);
      if (problem) return fail(problem);
      startRound(s, now);
      return done();
    }
    case "toLobby": {
      if (!host) return fail("Це може лише ведучий");
      s.phase = "lobby";
      s.game = null;
      return done();
    }
    case "skip": {
      if (!host) return fail("Це може лише ведучий");
      if (s.phase !== "play") return fail("Раунд не йде");
      pushLog(g, { k: "skip", team: g.turn, stage: g.stage, turn: g.turnNo });
      endTurn(s, now);
      return done();
    }
    case "resetScore": {
      if (!host) return fail("Це може лише ведучий");
      s.score = { sun: 0, moon: 0 };
      for (const p of Object.values(s.players)) p.wins = 0;
      return done();
    }

    // ── the round itself ───────────────────────────────────────────────────
    case "clue": {
      if (s.phase !== "play") return fail("Раунд не йде");
      if (me.team !== g.turn || me.role !== "oracle") return fail("Зараз не ваш хід");
      if (g.stage !== "clue") return fail("Підказку вже дано");
      const word = cleanText(a.word, CLUE_MAX).toUpperCase();
      if (!word) return fail("Напиши слово-підказку");
      if (!/^[\p{L}\p{N}'\- ]+$/u.test(word) || !/\p{L}/u.test(word)) {
        return fail("Лише літери, цифри та дефіс");
      }
      if (word.split(" ").length > 2) return fail("Підказка — це одне слово (максимум два)");
      const n = a.n;
      if (!Number.isInteger(n) || n < -1 || n > 9) return fail("Число має бути від 0 до 9 або ∞");
      const problem = clueProblem(g, word);
      if (problem) return fail(problem);
      g.clue = { word, n, by: pid, name: me.name };
      g.stage = "guess";
      g.made = 0;
      g.marks = {};
      pushLog(g, { k: "clue", team: g.turn, by: pid, name: me.name, word, n, turn: g.turnNo });
      if (s.settings.timer) g.endsAt = now + s.settings.timer * 1000;
      return done();
    }
    case "mark": {
      if (s.phase !== "play") return fail("Раунд не йде");
      if (me.team !== g.turn || me.role !== "seeker") return fail("Зараз не ваш хід");
      if (g.sawKey.includes(pid)) return fail("Ти вже знаєш ключ цього раунду");
      if (g.stage !== "guess") return fail("Чекаємо на підказку Капітана");
      const i = a.i;
      const vote = s.settings.pick === "vote";
      if (i === -1) {
        if (!vote) return fail("Невірна карта");
        if (g.made < 1) return fail("Спершу відкрийте хоча б одну карту");
      } else if (!Number.isInteger(i) || i < 0 || i >= g.words.length || g.revealed[i]) {
        return fail("Невірна карта");
      }
      if (g.marks[pid] === i) delete g.marks[pid];
      else g.marks[pid] = i;
      if (vote) tallyVotes(s, now);
      return done();
    }
    case "pick": {
      if (s.phase !== "play") return fail("Раунд не йде");
      if (me.team !== g.turn || me.role !== "seeker") return fail("Зараз не ваш хід");
      if (g.sawKey.includes(pid)) return fail("Ти вже знаєш ключ цього раунду");
      if (g.stage !== "guess") return fail("Чекаємо на підказку Капітана");
      if (s.settings.pick === "vote") return fail("У цьому режимі карту відкриває голосування");
      const i = a.i;
      if (!Number.isInteger(i) || i < 0 || i >= g.words.length || g.revealed[i]) {
        return fail("Невірна карта");
      }
      reveal(s, i, me, now);
      return done();
    }
    case "pass": {
      if (s.phase !== "play") return fail("Раунд не йде");
      if (me.team !== g.turn || me.role !== "seeker") return fail("Зараз не ваш хід");
      if (g.sawKey.includes(pid)) return fail("Ти вже знаєш ключ цього раунду");
      if (g.stage !== "guess") return fail("Чекаємо на підказку Капітана");
      if (s.settings.pick === "vote") return fail("У цьому режимі хід завершує голосування");
      if (g.made < 1) return fail("Спершу відкрийте хоча б одну карту");
      pushLog(g, { k: "pass", team: g.turn, by: pid, name: me.name, turn: g.turnNo });
      endTurn(s, now);
      return done();
    }
    default:
      return fail("Невідома дія");
  }
}

// ── the contract ───────────────────────────────────────────────────────────

export function validateAction(state, playerId, action) {
  const res = run(state, playerId, action);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export function applyAction(state, playerId, action) {
  const res = run(state, playerId, action);
  return res.ok ? res.state : state;
}

/** A finished round is a phase of the room, not the end of it. */
export function isGameOver() {
  return { over: false };
}

/**
 * What one player may know. The key (which card is whose) goes only to the
 * Oracles and — once the round is over — to everybody.
 */
export function viewFor(state, playerId) {
  const s = state;
  const me = s.players[playerId] || null;
  const host = s.hostId === playerId;
  const view = {
    phase: s.phase,
    hostId: s.hostId,
    round: s.round,
    score: s.score,
    players: s.order.map((id) => {
      const p = s.players[id];
      return {
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        team: p.team,
        role: p.role,
        online: p.online,
        wins: p.wins || 0,
      };
    }),
    settings: {
      rows: s.settings.rows,
      timer: s.settings.timer,
      pick: s.settings.pick,
      bans: s.settings.bans,
      packs: s.settings.packs,
      customCount: s.settings.custom.length,
      // Only the host edits the list, so only the host carries it around.
      custom: host ? s.settings.custom : null,
    },
    packs: Object.entries(PACKS).map(([id, p]) => ({ id, name: p.name, note: p.note, count: p.words.length })),
    ready: s.phase === "play" ? null : readyProblem(s),
    game: null,
  };

  const g = s.game;
  if (g) {
    const over = s.phase === "over";
    const seesKey = over || (me && me.role === "oracle" && isTeam(me.team)) || false;
    const marks = {};
    for (const [pid, i] of Object.entries(g.marks)) {
      if (!s.players[pid]) continue;
      (marks[i] = marks[i] || []).push(pid);
    }
    const limit = g.clue && g.clue.n >= 1 ? g.clue.n + 1 : null;
    view.game = {
      rows: g.rows,
      cols: g.cols,
      words: g.words,
      revealed: g.revealed,
      key: seesKey ? g.key : null,
      first: g.first,
      turn: g.turn,
      stage: g.stage,
      clue: g.clue,
      made: g.made,
      limit,
      marks,
      need: s.settings.pick === "vote" ? votesNeeded(s, g.turn) : null,
      left: { sun: left(g, "sun"), moon: left(g, "moon") },
      total: {
        sun: g.key.filter((t) => t === "sun").length,
        moon: g.key.filter((t) => t === "moon").length,
      },
      log: g.log,
      turnNo: g.turnNo,
      endsAt: g.endsAt,
      winner: g.winner,
      reason: g.reason,
      awards: over ? g.awards : [],
      sawKey: Boolean(me) && g.sawKey.includes(playerId),
    };
  }
  return view;
}

// ── word packs ─────────────────────────────────────────────────────────────

const list = (text) => [...new Set(text.split(/\s+/).filter(Boolean).map((w) => w.replace(/_/g, " ")))];

const PACKS = {
  base: {
    name: "Класика",
    note: "Звичні слова на всі випадки",
    words: list(`
      КІТ ПЕС ВОВК ЛИСИЦЯ ВЕДМІДЬ ЗАЄЦЬ ЇЖАК ОРЕЛ СОВА ВОРОН ЛЕЛЕКА ЛЕБІДЬ КАЧКА ПІВЕНЬ КІНЬ КОРОВА
      СВИНЯ КОЗА ВІВЦЯ МИШКА ЩУР ЗМІЯ ЖАБА РИБА АКУЛА КИТ ДЕЛЬФІН ВОСЬМИНІГ КРАБ РАК БДЖОЛА МУРАХА
      ПАВУК МЕТЕЛИК КОМАР МУХА ЛЕВ ТИГР СЛОН МАВПА ЖИРАФА ЗЕБРА ВЕРБЛЮД ПІНГВІН КРОКОДИЛ ЧЕРЕПАХА
      ДРАКОН ЄДИНОРІГ ПАПУГА КАЖАН
      ЛІС ПОЛЕ ГОРА РІЧКА МОРЕ ОКЕАН ОЗЕРО ОСТРІВ ПУСТЕЛЯ ВУЛКАН ПЕЧЕРА СКЕЛЯ БЕРЕГ ХВИЛЯ ДОЩ СНІГ
      ГРІМ БЛИСКАВКА ВІТЕР ТУМАН ХМАРА ВЕСЕЛКА МОРОЗ ЛІД ВОГОНЬ ДИМ ПОПІЛ ЗЕМЛЯ ПІСОК КАМІНЬ ДЕРЕВО
      ДУБ ВЕРБА ЯЛИНКА КВІТКА ТРОЯНДА СОНЯШНИК МАК ТРАВА ЛИСТ КОРІНЬ ГРИБ ЯГОДА ШИШКА
      ЗІРКА ПЛАНЕТА КОМЕТА РАКЕТА СУПУТНИК КОСМОС МАРС ОРБІТА ТЕЛЕСКОП АСТРОНАВТ ГАЛАКТИКА
      ХЛІБ СІЛЬ ЦУКОР МЕД МОЛОКО СИР МАСЛО ЯЙЦЕ БОРЩ ВАРЕНИК САЛО КОВБАСА ПІЦА СУШІ БУРГЕР ТОРТ
      ШОКОЛАД МОРОЗИВО КАВА ЧАЙ ВИНО ПИВО СІК ЛИМОН ЯБЛУКО ГРУША ВИШНЯ КАВУН БАНАН ГАРБУЗ КАРТОПЛЯ
      ЦИБУЛЯ ЧАСНИК ПЕРЕЦЬ ОГІРОК ПОМІДОР ГОРІХ РИС ЛОКШИНА МЛИНЕЦЬ ПИРІГ ЦУКЕРКА ПОПКОРН КЕТЧУП
      СТІЛ СТІЛЕЦЬ ЛІЖКО ДИВАН ШАФА ДВЕРІ ВІКНО КЛЮЧ ЗАМОК ДЗЕРКАЛО ЛАМПА СВІЧКА ГОДИННИК КИЛИМ
      ПОДУШКА КОВДРА ЧАШКА ТАРІЛКА ВИДЕЛКА ЛОЖКА НІЖ КАСТРУЛЯ ПЛИТА ХОЛОДИЛЬНИК ПРАСКА ПИЛОСОС МИЛО
      РУШНИК ГРЕБІНЕЦЬ ЩІТКА ВІДРО ДРАБИНА МОЛОТОК ПИЛКА СОКИРА ЛОПАТА ГОЛКА НИТКА НОЖИЦІ ҐУДЗИК
      ПАРАСОЛЯ ВАЛІЗА РЮКЗАК ГАМАНЕЦЬ КОШИК КОРОБКА ПЛЯШКА БОЧКА МОТУЗКА ЛАНЦЮГ ДЗВІН СВИСТОК
      КАПЕЛЮХ ШАПКА ШАРФ КРАВАТКА СОРОЧКА СУКНЯ ШТАНИ ПОЯС ЧЕРЕВИК ЧОБІТ КАПЕЦЬ РУКАВИЧКА ПЕРСТЕНЬ
      КОРОНА МАСКА ОКУЛЯРИ КИШЕНЯ
      ГОЛОВА ОКО ВУХО НІС РОТ ЗУБ ЯЗИК РУКА ПАЛЕЦЬ НОГА СЕРЦЕ КРОВ КІСТКА ШКІРА ВОЛОССЯ БОРОДА ВУСА
      СПИНА ПЛЕЧЕ КОЛІНО МОЗОК НЕРВ
      КОРОЛЬ КОРОЛЕВА ПРИНЦ ЛИЦАР КОЗАК ПІРАТ ШПИГУН ДЕТЕКТИВ ЛІКАР ВЧИТЕЛЬ КУХАР ПІЛОТ КАПІТАН
      ГЕНЕРАЛ СУДДЯ АДВОКАТ АКТОР СПІВАК ХУДОЖНИК ПОЕТ ФОКУСНИК КЛОУН ВІДЬМА ЧАКЛУН ПРИВИД ВАМПІР
      РОБОТ ПРИБУЛЕЦЬ ВЕЛЕТЕНЬ ГНОМ РУСАЛКА АНГЕЛ ЧОРТ МУМІЯ НІНДЗЯ КОВБОЙ МИСЛИВЕЦЬ РИБАЛКА ПАСТУХ
      КОВАЛЬ МЕЛЬНИК ГІСТЬ СУСІД БАБУСЯ ДІД ДИТИНА НАРЕЧЕНА ЧЕМПІОН ТРЕНЕР ФАНАТ ТУРИСТ ВОДІЙ ПОШТАР
      ПОЖЕЖНИК ЗЛОДІЙ
      МІСТО СЕЛО ВУЛИЦЯ МІСТ ПЛОЩА РИНОК МАГАЗИН АПТЕКА ЛІКАРНЯ ШКОЛА БІБЛІОТЕКА МУЗЕЙ ТЕАТР КІНО
      ЦИРК ЗООПАРК СТАДІОН ЦЕРКВА ФОРТЕЦЯ ПАЛАЦ ВЕЖА ТЮРМА БАНК ГОТЕЛЬ РЕСТОРАН БАР КУХНЯ ПІДВАЛ
      ГОРИЩЕ ДАХ БАЛКОН САД ПАРК ФЕРМА МЛИН ШАХТА ЗАВОД ПОРТ ВОКЗАЛ АЕРОПОРТ МЕТРО ТУНЕЛЬ КОРДОН
      ТАБІР ПЛЯЖ БАСЕЙН ЛАЗНЯ КАЗИНО ОФІС ЛІФТ КОРИДОР
      МАШИНА АВТОБУС ТРАМВАЙ ПОТЯГ ЛІТАК ГЕЛІКОПТЕР КОРАБЕЛЬ ЧОВЕН ЯХТА ВЕЛОСИПЕД МОТОЦИКЛ ТАКСІ
      ТРАКТОР КОЛЕСО КЕРМО ДВИГУН ГАЛЬМО ЯКІР ВІТРИЛО КРИЛО ПАРАШУТ РЕЙКА ДОРОГА СВІТЛОФОР
      ЧАС ДЕНЬ НІЧ РАНОК ЗИМА ЛІТО ОСІНЬ ВЕСНА РІК СВЯТО ВЕСІЛЛЯ ПОДАРУНОК ІГРАШКА ГРА КАРТА КУБИК
      ШАХИ ГОЛ КУБОК МЕДАЛЬ РЕКОРД ФІНІШ СТАРТ БІЙ МИР ЗАКОН СУД ШТРАФ ГРОШІ МОНЕТА ЗОЛОТО СРІБЛО
      ДІАМАНТ СКАРБ ЦІНА БОРГ ПОДАТОК ЧЕК КВИТОК КНИГА СТОРІНКА ГАЗЕТА ЖУРНАЛ ЛІТЕРА СЛОВО МОВА
      КАЗКА ВІРШ ПІСНЯ МУЗИКА НОТА ГІТАРА БАРАБАН СКРИПКА ПІАНІНО СОПІЛКА ТРУБА ТАНЕЦЬ КАРТИНА ФАРБА
      ПЕНЗЕЛЬ ОЛІВЕЦЬ РУЧКА ЗОШИТ ЛІНІЙКА ГЛОБУС КОМПАС ФОТО КАМЕРА ЕКРАН ТЕЛЕФОН РАДІО АНТЕНА
      БАТАРЕЯ РОЗЕТКА ДРІТ КНОПКА КЛАВІША ВІРУС ПАРОЛЬ КОД МЕРЕЖА СЕРВЕР ФАЙЛ ПАПКА
      АТОМ ЛАЗЕР МАГНІТ СТРУМ ГАЗ НАФТА ВУГІЛЛЯ ЗАЛІЗО СТАЛЬ СКЛО ПАПІР ПЛАСТИК ГУМА ШОВК ВОВНА ЛІКИ
      ШПРИЦ ТАБЛЕТКА МІКРОСКОП ФОРМУЛА ЧИСЛО НУЛЬ КОЛО КВАДРАТ ТРИКУТНИК ЛІНІЯ ТОЧКА КУТ ЦЕНТР
      ПІРАМІДА КУЛЯ
      СОН МРІЯ СТРАХ СМІХ СЛЬОЗА ПОЦІЛУНОК ЛЮБОВ ДРУЖБА УДАЧА ДОЛЯ ТАЄМНИЦЯ ЗАГАДКА ПАСТКА СЛІД ТІНЬ
      СВІТЛО ЛУНА ГОЛОС ШЕПІТ КРИК ТИША ВУЗОЛ ПЕТЛЯ ДІРКА ЩІЛИНА СТІНА ПАРКАН ВОРОТА СХОДИ КРАН КОСА
      ЛУК СТРІЛА МЕЧ ЩИТ ГАРМАТА БОМБА ПОРОХ ОТРУТА ЗІЛЛЯ КРИСТАЛ АМУЛЕТ ТРОН ПРАПОР ГЕРБ ГІМН
      ПЕЧАТКА ДОГОВІР ПЛАН СЕКРЕТ НОМЕР АДРЕСА ПАСПОРТ ВІЗА
    `),
  },
  ukraine: {
    name: "Україна",
    note: "Борщ, Карпати і маршрутка",
    words: list(`
      БОРЩ ВАРЕНИКИ САЛО УЗВАР КУТЯ ПАСКА ПИСАНКА ВИШИВАНКА ВІНОК РУШНИК БАНДУРА ТРЕМБІТА КОБЗАР
      КОЗАК ГЕТЬМАН СІЧ ШАБЛЯ ХОРТИЦЯ ДНІПРО КАРПАТИ ГОВЕРЛА ОДЕСА ЛЬВІВ КИЇВ ХАРКІВ ХРЕЩАТИК
      МАЙДАН ЛАВРА ТРИЗУБ ГРИВНЯ КОПІЙКА ЧОРНОЗЕМ СТЕП ПШЕНИЦЯ СОНЯШНИК КАЛИНА ВЕРБА МАЛЬВА
      ЧОРНОБРИВЦІ ЛЕЛЕКА СОЛОВЕЙ ХАТА ПІЧ ГЛЕЧИК МАКІТРА КУМ СВАТ ВЕСІЛЛЯ КОЛЯДА ЩЕДРИК ВЕРТЕП
      МАЛАНКА КУПАЛА ГОПАК ШАРОВАРИ ЧУМАК ЯРМАРОК ДИКАНЬКА МАВКА ВІЙ РУСАЛКА ШЕВЧЕНКО ФРАНКО
      СКОВОРОДА МАЗЕПА РОКСОЛАНА УСИК ДИНАМО ШАХТАР МРІЯ ЄВРОБАЧЕННЯ МОНОБАНК УКРПОШТА ДІЯ
      МАРШРУТКА ЕЛЕКТРИЧКА ІНТЕРСІТІ БУКОВЕЛЬ ЗАТОКА СИНЕВИР ПОДІЛ РОШЕН СІЛЬПО ЖИВЧИК МІВІНА
      ДЕРУНИ ГОЛУБЦІ ХОЛОДЕЦЬ БАНОШ БРИНЗА ПАМПУШКА НАЛИВКА МЕДОВУХА КВАС СИРНИК ДАЧА ШАШЛИК
      ГРЯДКА ЗАКРУТКА ПОГРІБ КОМОРА КРИНИЦЯ ТИН ОБЕРІГ СОПІЛКА ЦИМБАЛИ ТРОЇСТІ ВУЛИК ПАСІКА ЛАН
      НОВА_ПОШТА ЧОРНЕ_МОРЕ КИЇВСЬКИЙ_ТОРТ
    `),
  },
  office: {
    name: "Офіс і діджитал",
    note: "Дедлайни, трафік і пʼятниця",
    words: list(`
      ДЕДЛАЙН БРИФ КРЕАТИВ ТРАФІК ЛІД ОФЕР БАНЕР КЛІК КОНВЕРСІЯ ВОРОНКА ЛЕНДІНГ ТАРГЕТ БЮДЖЕТ ЗВІТ
      МІТИНГ КОЛ ЗУМ СЛАК ТАБЛИЦЯ ПРЕМІЯ ВІДПУСТКА ЛІКАРНЯНИЙ ЗАРПЛАТА АВАНС БОНУС СТАЖЕР ТІМЛІД
      БАЄР ДИЗАЙНЕР КОПІРАЙТЕР АНАЛІТИК МЕНЕДЖЕР КЛІЄНТ ПАРТНЕР ІНВОЙС РАХУНОК ПЛАТІЖ КАРТКА КРИПТА
      КЕШ ПРОФІТ МІНУС ROI CPA CPM KPI CRM CTR ТЕСТ СПЛІТ ГІПОТЕЗА МЕТРИКА ДАШБОРД ТРЕКЕР ПІКСЕЛЬ
      КАБІНЕТ АКАУНТ МОДЕРАЦІЯ АПЕЛЯЦІЯ КЛОАКА ПРОКСІ ФАРМ ЗАЛИВ ЗВ'ЯЗКА ВЕРТИКАЛЬ ГЕО ПЕЙАУТ КАП
      ХОЛД АПРУВ ТРЕШ ФРОД СПАМ ПУШ СТОРІЗ РІЛС ТІКТОК ІНСТАГРАМ ФЕЙСБУК ГУГЛ ЮТУБ ТЕЛЕГРАМ ЧАТ
      СТІКЕР МЕМ ГІФКА ЕМОДЗІ ЛАЙК РЕПОСТ ХЕШТЕГ БЛОГЕР ІНФЛЮЕНСЕР ПІДПИСНИК ОХОПЛЕННЯ ХАЙП ТРЕНД
      ПРЕЗЕНТАЦІЯ СЛАЙД НОУТБУК МОНІТОР НАВУШНИКИ ЗАРЯДКА ВАЙФАЙ ЕКСЕЛЬ НЕЙРОНКА ПРОМПТ СКРИПТ БАГ
      ФІЧА РЕЛІЗ СПРИНТ ТАСКА ТІКЕТ ДЕМО ПІТЧ СТАРТАП ІНВЕСТОР КОНКУРЕНТ БРЕНД ЛОГОТИП СЛОГАН
      РЕКЛАМА АУДИТОРІЯ СЕГМЕНТ КУКІ КОРПОРАТИВ ТІМБІЛДІНГ КАВОМАШИНА КУЛЕР ПЕЧИВО ОВЕРТАЙМ
      ВИГОРАННЯ ПОНЕДІЛОК П'ЯТНИЦЯ ОБІД ПЕРЕКУР ОПЕНСПЕЙС РЕМОУТ КОВОРКІНГ СПІВБЕСІДА РЕЗЮМЕ
      ОНБОРДИНГ ФІДБЕК РЕВ'Ю ДЕЙЛІК РЕТРО ПЛАНЕРКА ДЖЕКПОТ СТАВКА СЛОТ ФРІСПІН ДЕПОЗИТ МАТЧ СВАЙП
      АНКЕТА ПОБАЧЕННЯ ЗАЯВКА ДЗВІНОК КОЛ-ЦЕНТР АПСЕЛ ЧЕКАУТ ПРЕЛЕНД ВАЙТ СПЕНД СКЕЙЛ БІД АУКЦІОН
    `),
  },
};
