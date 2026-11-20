/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "./vendor/preact.js";
import { useEffect, useLayoutEffect, useRef, useState } from "./vendor/hooks.js";
import { Avatar, Btn, Glyph, Icon, TEAM, cx, plural } from "./bits.jsx";
import { TopBar } from "./lobby.jsx";
import { act, isHost, me, openSheet, react, serverNow, state, toast, useStore } from "./store.js";
import { buzz, ui } from "./sound.js";

export const REACTIONS = ["🔥", "😂", "😱", "👏", "🤯", "💀", "❤️", "🤡"];

const nLabel = (n) => (n === -1 ? "∞" : String(n));

// ── timer ──────────────────────────────────────────────────────────────────

function useCountdown(endsAt, tickSound) {
  const [left, setLeft] = useState(null);
  useEffect(() => {
    if (!endsAt) {
      setLeft(null);
      return;
    }
    let last = null;
    const update = () => {
      const sec = Math.max(0, Math.ceil((endsAt - serverNow()) / 1000));
      if (sec !== last) {
        if (tickSound && last !== null && sec <= 5 && sec > 0) {
          ui.tick();
          buzz(15);
        }
        last = sec;
        setLeft(sec);
      }
    };
    update();
    const id = setInterval(update, 200);
    return () => clearInterval(id);
  }, [endsAt, tickSound]);
  return left;
}

function Timer({ endsAt, mine }) {
  const left = useCountdown(endsAt, mine);
  if (left === null) return null;
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");
  return (
    <span class={cx("timer", left <= 10 && "is-low")} aria-label="Час на хід">
      <Icon name="timer" size={14} />
      {mm}:{ss}
    </span>
  );
}

// ── the banner under the top bar: what is going on right now ───────────────

function Banner({ view, my }) {
  const g = view.game;
  const team = g.turn;
  const oracle = view.players.find((p) => p.team === team && p.role === "oracle");
  const mineTurn = my?.team === team;

  let body;
  if (g.stage === "clue") {
    const iAmUp = mineTurn && my.role === "oracle";
    body = (
      <div class="banner-wait">
        {oracle && <Avatar index={oracle.avatar} size={38} ring={team} off={!oracle.online} />}
        <div>
          <p class="banner-eyebrow">
            <Glyph team={team} size={12} /> {TEAM[team].oracle}
          </p>
          <p class="banner-line">
            {iAmUp ? "Твій хід: придумай знамення" : `${oracle?.name || "Оракул"} шукає знамення`}
            {!iAmUp && (
              <span class="dots">
                <i />
                <i />
                <i />
              </span>
            )}
          </p>
        </div>
      </div>
    );
  } else {
    const leftTries = g.limit === null ? null : g.limit - g.made;
    body = (
      <div class="banner-clue" key={g.turnNo}>
        <div class="banner-clue-main">
          <p class="banner-eyebrow">
            <Glyph team={team} size={12} /> Знамення {TEAM[team].gen}
          </p>
          <p class="clue-word" style={{ "--len": Math.max(g.clue.word.length, 6) }}>
            {g.clue.word}
          </p>
        </div>
        <div class="clue-num" aria-label={`Число ${nLabel(g.clue.n)}`}>
          <b>{nLabel(g.clue.n)}</b>
          <span>{leftTries === null ? "без ліміту" : `ще ${leftTries} ${plural(leftTries, ["спроба", "спроби", "спроб"])}`}</span>
        </div>
      </div>
    );
  }

  return (
    <section class={cx("banner", `banner-${team}`, mineTurn && "is-mine")}>
      {body}
      <Timer endsAt={g.endsAt} mine={mineTurn} />
    </section>
  );
}

// ── the board ──────────────────────────────────────────────────────────────

/**
 * The biggest font size at which `word` fits a card. Words wrap only at spaces
 * and hyphens, so the longest unbreakable piece decides. Widths are measured
 * with the real font once it has loaded; before that, an average is used.
 */
const WORD_FONT = '800 100px "Sofia XC"';
let ruler = null;
let rulerReady = false;
const widths = new Map();
function pieceWidth(piece) {
  if (!rulerReady) return piece.length * 0.56;
  let w = widths.get(piece);
  if (w === undefined) {
    ruler.font = WORD_FONT;
    w = ruler.measureText(piece).width / 100 + piece.length * 0.012;
    widths.set(piece, w);
  }
  return w;
}
function fitWord(word, cardW, cardH) {
  // No regex lookbehind here: older iPhones cannot even parse it.
  const pieces = word.replace(/-/g, "- ").split(/\s+/).filter(Boolean);
  const widest = Math.max(...pieces.map(pieceWidth));
  const lines = pieces.length;
  const byWidth = (cardW - 11) / widest;
  const byHeight = (cardH * 0.6) / lines / 1.02;
  return Math.max(7, Math.min(byWidth, byHeight, cardW * 0.36, 34));
}
function useWordRuler() {
  const [, bump] = useState(0);
  useEffect(() => {
    if (rulerReady) return;
    let alive = true;
    const ready = () => {
      if (!alive || rulerReady) return;
      ruler = document.createElement("canvas").getContext("2d");
      rulerReady = Boolean(ruler);
      bump((n) => n + 1);
    };
    if (document.fonts?.load) {
      document.fonts.load(WORD_FONT, "ЖЩЮ").then(ready, ready);
    } else ready();
    return () => {
      alive = false;
    };
  }, []);
}

function Card({ i, word, open, keyType, marks, mine, canTap, fresh, size, byId, need, dim, onTap }) {
  const fs = fitWord(word, size.w, size.h);
  const shown = marks ? marks.slice(0, 3) : [];
  return (
    <button
      type="button"
      data-card={i}
      class={cx(
        "card",
        open && "is-open",
        open && `open-${open}`,
        fresh && "is-fresh",
        !open && keyType && `key-${keyType}`,
        mine && "is-marked",
        canTap && !open && "can-tap",
        dim && "is-dim",
      )}
      style={{ "--i": i, "--fs": `${fs.toFixed(1)}px` }}
      disabled={open || !canTap}
      aria-label={open ? `${word}, відкрито` : word}
      onClick={onTap}
    >
      <span class="card-flip">
        <span class="card-face card-front">
          {keyType && (
            <span class="card-keymark">
              <Glyph team={keyType} size={Math.max(10, Math.min(15, size.w * 0.17))} />
            </span>
          )}
          <span class="card-word">{word}</span>
        </span>
        <span class={cx("card-face card-back", open && `back-${open}`)}>
          {open && <img src={`/img/card-${open}.webp`} alt="" draggable={false} />}
          <span class="card-back-word">{word}</span>
        </span>
      </span>
      {shown.length > 0 && !open && (
        <span class="card-marks">
          {shown.map((pid) => (
            <Avatar key={pid} index={byId[pid]?.avatar} size={Math.max(16, Math.min(22, size.w * 0.26))} />
          ))}
          {need ? (
            <b class="card-votes">
              {marks.length}/{need}
            </b>
          ) : (
            marks.length > 3 && <b class="card-votes">+{marks.length - 3}</b>
          )}
        </span>
      )}
    </button>
  );
}

function Board({ view, my, canGuess }) {
  const s = useStore();
  const g = view.game;
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 64, h: 78 });
  useWordRuler();

  // Card size comes from the board's own box, never from a card: cards are
  // mid-animation (scaled, tilted) exactly when a round starts.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
      const w = (el.clientWidth - gap * (g.cols - 1)) / g.cols;
      const h = (el.clientHeight - gap * (g.rows - 1)) / g.rows;
      if (w > 0 && h > 0) {
        setSize((old) => (Math.abs(old.w - w) < 0.5 && Math.abs(old.h - h) < 0.5 ? old : { w, h }));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [g.rows, g.cols, s.dealId]);

  const byId = {};
  for (const p of view.players) byId[p.id] = p;
  const myMark = Object.entries(g.marks).find(([, ids]) => ids.includes(s.you))?.[0];
  const over = view.phase === "over";

  return (
    <div class="board-wrap">
      <div
        ref={ref}
        key={s.dealId}
        class={cx("board", s.dealId > 0 && "is-dealt", g.key && !over && "is-key", over && "is-over")}
        style={{ "--rows": g.rows, "--cols": g.cols }}
      >
        {g.words.map((word, i) => (
          <Card
            key={i}
            i={i}
            word={word}
            open={g.revealed[i]}
            keyType={g.key ? g.key[i] : null}
            marks={g.marks[i]}
            mine={String(myMark) === String(i)}
            canTap={canGuess}
            fresh={Boolean(s.fresh[i]) && Date.now() - s.fresh[i] < 2500}
            size={size}
            byId={byId}
            need={g.need}
            dim={over && !g.revealed[i]}
            onTap={() => {
              ui.mark();
              buzz(12);
              act({ t: "mark", i });
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── the dock: what YOU can do right now ────────────────────────────────────

function Reactions() {
  return (
    <div class="reactions" role="group" aria-label="Реакції">
      {REACTIONS.map((e) => (
        <button
          type="button"
          class="reaction"
          onClick={() => {
            react(e);
            buzz(10);
          }}
        >
          {e}
        </button>
      ))}
    </div>
  );
}

function Dock({ view, my, canGuess, canClue, onClue }) {
  const s = useStore();
  const g = view.game;
  const team = g.turn;
  const vote = view.settings.pick === "vote";
  const markEntry = Object.entries(g.marks).find(([, ids]) => ids.includes(s.you));
  const myMark = markEntry ? Number(markEntry[0]) : null;

  if (canClue) {
    return (
      <footer class={cx("dock", `dock-${team}`)}>
        <Btn kind={team} block onClick={onClue} icon="eye">
          Дати знамення
        </Btn>
        <p class="dock-hint">Одне слово і число: скільки карт воно поєднує</p>
      </footer>
    );
  }

  if (canGuess) {
    const passVotes = g.marks[-1]?.length || 0;
    const canPass = g.made >= 1;
    const picked = myMark !== null && myMark >= 0;
    return (
      <footer class={cx("dock", `dock-${team}`)}>
        <div class="dock-row">
          {picked ? (
            vote ? (
              <div class="vote-box grow">
                <span>Твій голос</span>
                <b>{g.words[myMark]}</b>
                <i>
                  {g.marks[myMark].length} з {g.need}
                </i>
              </div>
            ) : (
              <Btn kind={team} class="grow btn-open" onClick={() => act({ t: "pick", i: myMark })}>
                Відкрити «{g.words[myMark]}»
              </Btn>
            )
          ) : (
            <p class="dock-prompt grow">
              <span class="tap-dot" />
              {vote ? "Торкнись карти, щоб проголосувати" : "Торкнись карти, щоб обрати її"}
            </p>
          )}
          <Btn
            kind="ghost"
            icon="skip"
            disabled={!canPass}
            class={cx(vote && myMark === -1 && "is-on")}
            onClick={() => act(vote ? { t: "mark", i: -1 } : { t: "pass" })}
          >
            {vote && passVotes > 0 ? `Досить ${passVotes}/${g.need}` : "Досить"}
          </Btn>
        </div>
        <p class="dock-hint">
          {!canPass
            ? "Відкрийте хоча б одну карту, тоді можна завершити хід"
            : vote
              ? `Карту відкривають ${g.need} ${plural(g.need, ["голос", "голоси", "голосів"])}`
              : "Свою карту відкрили? Можна шукати далі або завершити хід"}
        </p>
      </footer>
    );
  }

  let line;
  if (!my || !my.team) {
    line = g.sawKey ? "Ключ цього раунду ти вже знаєш, тож спостерігаєш" : "Ти глядач. Можеш приєднатися до команди";
  } else if (my.team === team) {
    line =
      my.role === "oracle"
        ? "Твої Шукачі думають. Жодних підказок, навіть бровою!"
        : `${TEAM[team].oracle} думає. Готуйся шукати`;
  } else {
    line = g.stage === "clue" ? `Хід ${TEAM[team].gen}: чекаємо знамення` : `${TEAM[team].name} шукає свої карти`;
  }

  return (
    <footer class="dock dock-idle">
      <p class="dock-status">
        <Glyph team={team} size={13} /> {line}
      </p>
      {(!my || !my.team) && !g.sawKey ? (
        <div class="dock-row">
          <Btn kind="sun" small class="grow" onClick={() => act({ t: "seat", team: "sun", role: "seeker" })}>
            До Сонця
          </Btn>
          <Btn kind="moon" small class="grow" onClick={() => act({ t: "seat", team: "moon", role: "seeker" })}>
            До Місяця
          </Btn>
        </div>
      ) : (
        <Reactions />
      )}
    </footer>
  );
}

// ── giving an omen ─────────────────────────────────────────────────────────

const NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0, -1];

function ClueSheet({ team, onClose }) {
  const [word, setWord] = useState("");
  const [n, setN] = useState(null);
  const input = useRef(null);
  useEffect(() => {
    input.current?.focus();
  }, []);

  const submit = (e) => {
    e?.preventDefault();
    const clean = word.replace(/\s+/g, " ").trim();
    if (!clean) {
      toast("Напиши слово-знамення", "error");
      input.current?.focus();
      return;
    }
    if (n === null) {
      toast("Обери число", "error");
      return;
    }
    act({ t: "clue", word: clean, n });
  };

  return (
    <div class="clue-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form class={cx("clue-sheet", `clue-sheet-${team}`)} onSubmit={submit}>
        <header>
          <h2>Твоє знамення</h2>
          <button type="button" class="icon-btn" onClick={onClose} aria-label="Закрити">
            <Icon name="close" />
          </button>
        </header>
        <input
          ref={input}
          class="clue-input"
          value={word}
          onInput={(e) => setWord(e.target.value.slice(0, 24))}
          placeholder="ОДНЕ СЛОВО"
          maxLength={24}
          autocomplete="off"
          autocapitalize="characters"
          autocorrect="off"
          spellcheck={false}
          enterkeyhint="done"
          aria-label="Слово-знамення"
        />
        <p class="label">Скільки карт воно поєднує</p>
        <div class="num-grid">
          {NUMBERS.map((v) => (
            <button
              type="button"
              class={cx("num", v === n && "is-on")}
              onClick={() => {
                ui.mark();
                setN(v);
              }}
              aria-pressed={v === n}
            >
              {nLabel(v)}
            </button>
          ))}
        </div>
        <p class="clue-help">
          0 — «жодна з наших карт не про це». ∞ — без обмеження спроб.
        </p>
        <Btn kind={team} block type="submit" icon="send">
          Оголосити
        </Btn>
      </form>
    </div>
  );
}

// ── the banner that sweeps across the board ────────────────────────────────

export function Announce() {
  const s = useStore();
  const a = s.announce;
  if (!a) return null;
  let content;
  if (a.kind === "clue") {
    content = (
      <>
        <p class="ann-eyebrow">
          <Glyph team={a.team} size={14} /> Знамення {TEAM[a.team].gen}
        </p>
        <p class="ann-word" style={{ "--len": Math.max(a.word.length, 5) }}>
          {a.word.split("").map((ch, i) => (
            <span style={{ "--i": i }}>{ch === " " ? " " : ch}</span>
          ))}
        </p>
        <p class="ann-num">
          <b>{nLabel(a.n)}</b>
        </p>
      </>
    );
  } else if (a.kind === "turn") {
    content = (
      <>
        {a.why === "timeout" && <p class="ann-eyebrow">Час вийшов</p>}
        <p class="ann-title">
          <Glyph team={a.team} size={30} /> Хід {TEAM[a.team].gen}
        </p>
      </>
    );
  } else {
    content = (
      <>
        <p class="ann-eyebrow">Раунд {a.round}</p>
        <p class="ann-title">
          <Glyph team={a.team} size={30} /> Починає {TEAM[a.team].name}
        </p>
      </>
    );
  }
  return (
    <div class={cx("announce", `announce-${a.team}`, `announce-${a.kind}`)} key={a.id} style={{ "--ms": `${a.ms}ms` }} aria-live="polite">
      <div class="announce-band">{content}</div>
    </div>
  );
}

// ── the end of a round ─────────────────────────────────────────────────────

const AWARD = {
  omen: (a) => ({ icon: "eye", title: "Знамення раунду", text: `«${a.word}» від ${a.name}: ${a.n} ${plural(a.n, ["влучання", "влучання", "влучань"])}` }),
  seer: (a) => ({ icon: "crown", title: "Провидець", text: `${a.name}: ${a.n} ${plural(a.n, ["своя карта", "свої карти", "своїх карт"])}` }),
  ban: (a) => ({ icon: "x", title: "Рука долі", text: `Карту БАН відкриває ${a.name}` }),
  gift: (a) => ({ icon: "swap", title: "Щедра душа", text: `${a.name}: ${a.n} ${plural(a.n, ["карта", "карти", "карт"])} у подарунок суперникам` }),
  bot: (a) => ({ icon: "dice", title: "Друг ботів", text: `${a.name}: ${a.n} ${plural(a.n, ["бот", "боти", "ботів"])}` }),
};

function Over({ view, my, onPeek }) {
  const g = view.game;
  const w = g.winner;
  const host = isHost();
  const hostPlayer = view.players.find((p) => p.id === view.hostId);
  const loser = w === "sun" ? "moon" : "sun";
  const mineWon = my?.team ? my.team === w : null;

  return (
    <div class={cx("over", `over-${w}`)}>
      <div class="over-card">
        <div class="over-art" aria-hidden="true">
          <div class="over-rays" />
          <img src={`/img/oracle-${w}.webp`} alt="" />
        </div>
        <p class="over-eyebrow">
          {mineWon === null ? "Раунд завершено" : mineWon ? "Твоя команда перемогла" : "Цього разу не ваша ніч"}
        </p>
        <h1 class="over-title">
          Перемога {TEAM[w].gen}
        </h1>
        <p class="over-reason">
          {g.reason === "ban" ? TEAM[loser].banned : TEAM[w].found}
        </p>

        <p class="scoreline over-score">
          <span class="c-sun">
            <Glyph team="sun" size={18} /> {view.score.sun}
          </span>
          <i>:</i>
          <span class="c-moon">
            {view.score.moon} <Glyph team="moon" size={18} />
          </span>
        </p>

        {g.awards.length > 0 && (
          <ul class="awards">
            {g.awards.map((a, i) => {
              const d = AWARD[a.id]?.(a);
              if (!d) return null;
              return (
                <li class={cx("award", `award-${a.id}`)} style={{ "--i": i }}>
                  <span class="award-icon">
                    <Icon name={d.icon} size={17} />
                  </span>
                  <div>
                    <b>{d.title}</b>
                    <p>{d.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {host ? (
          <div class="over-actions">
            <Btn kind="gold" block onClick={() => act({ t: "start", mode: "rotate" })}>
              Ще раунд, нові Оракули
            </Btn>
            <div class="dock-row">
              <Btn kind="ghost" small class="grow" onClick={() => act({ t: "start" })}>
                Ті самі Оракули
              </Btn>
              <Btn kind="ghost" small class="grow" onClick={() => act({ t: "toLobby" })}>
                У лобі
              </Btn>
            </div>
          </div>
        ) : (
          <p class="dock-wait">
            <span class="pulse-dot" />
            {hostPlayer?.name || "Ведучий"} вирішує, що далі
          </p>
        )}
        {!host && (!hostPlayer || !hostPlayer.online) && (
          <Btn kind="ghost" small block onClick={() => act({ t: "claimHost" })}>
            Ведучий зник — взяти керування
          </Btn>
        )}
        <button class="link" onClick={onPeek}>
          Подивитись поле
        </button>
      </div>
    </div>
  );
}

// ── the screen ─────────────────────────────────────────────────────────────

function useWakeLock() {
  useEffect(() => {
    let lock = null;
    const ask = async () => {
      try {
        if (document.visibilityState === "visible") lock = await navigator.wakeLock?.request("screen");
      } catch {
        /* the phone said no; nothing to do */
      }
    };
    ask();
    document.addEventListener("visibilitychange", ask);
    return () => {
      document.removeEventListener("visibilitychange", ask);
      lock?.release?.().catch(() => {});
    };
  }, []);
}

export function Game() {
  const s = useStore();
  const view = s.view;
  const g = view.game;
  const my = me();
  const [clueOpen, setClueOpen] = useState(false);
  const [peek, setPeek] = useState(false);
  useWakeLock();

  const playing = view.phase === "play";
  const myTurn = playing && my?.team === g.turn;
  const canGuess = Boolean(myTurn && my.role === "seeker" && g.stage === "guess");
  const canClue = Boolean(myTurn && my.role === "oracle" && g.stage === "clue");

  useEffect(() => {
    if (!canClue) setClueOpen(false);
  }, [canClue]);
  useEffect(() => {
    if (playing) setPeek(false);
  }, [playing, view.round]);
  // Your turn has come: a nudge for a phone lying on the table.
  useEffect(() => {
    if (canClue || canGuess) buzz([0, 40, 60, 40]);
  }, [canClue, canGuess]);

  const role = !my?.team ? "Глядач" : my.role === "oracle" ? "Оракул" : "Шукач";

  return (
    <main class={cx("game", `turn-${g.turn}`, my?.team && `my-${my.team}`)} data-phase={view.phase}>
      <TopBar>
        <div class="tally" aria-label="Залишилось карт">
          <span class={cx("tally-side tally-sun", playing && g.turn === "sun" && "is-on")} key={`s${g.left.sun}`}>
            <Glyph team="sun" size={15} />
            <b>{g.left.sun}</b>
          </span>
          <span class={cx("tally-side tally-moon", playing && g.turn === "moon" && "is-on")} key={`m${g.left.moon}`}>
            <b>{g.left.moon}</b>
            <Glyph team="moon" size={15} />
          </span>
        </div>
      </TopBar>

      {playing ? (
        <Banner view={view} my={my} />
      ) : (
        <section class={cx("banner", `banner-${g.winner}`)}>
          <div class="banner-wait">
            <div>
              <p class="banner-eyebrow">
                <Glyph team={g.winner} size={12} /> Раунд завершено
              </p>
              <p class="banner-line">Перемога {TEAM[g.winner].gen}. Ось де що лежало</p>
            </div>
          </div>
          <Btn kind="ghost" small onClick={() => setPeek(false)}>
            Підсумки
          </Btn>
        </section>
      )}

      <Board view={view} my={my} canGuess={canGuess} />

      {playing ? (
        <Dock view={view} my={my} canGuess={canGuess} canClue={canClue} onClue={() => setClueOpen(true)} />
      ) : (
        <footer class="dock dock-idle">
          <p class="dock-status">Тьмяні карти так і не відкрили</p>
          <Reactions />
        </footer>
      )}

      <div class="me-chip" aria-label="Твоя роль">
        {my?.team && <Glyph team={my.team} size={11} />}
        {role}
        <button
          class="me-chip-log"
          onClick={() => {
            ui.tap();
            openSheet("log");
          }}
          aria-label="Журнал ходів"
        >
          <Icon name="scroll" size={14} />
        </button>
      </div>

      {clueOpen && canClue && <ClueSheet team={g.turn} onClose={() => setClueOpen(false)} />}
      {view.phase === "over" && s.overShown && !peek && <Over view={view} my={my} onPeek={() => setPeek(true)} />}
    </main>
  );
}
