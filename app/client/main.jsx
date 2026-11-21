/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment, render } from "./vendor/preact.js";
import { useEffect } from "./vendor/hooks.js";
import { Btn, Ornament, cx } from "./bits.jsx";
import { startFx } from "./fx.js";
import { Announce, Game } from "./game.jsx";
import { Home, ProfileGate } from "./home.jsx";
import { Lobby } from "./lobby.jsx";
import { Sheets } from "./sheets.jsx";
import "./sound.js";
import { connect, enterRoom, leaveRoom, state, useStore } from "./store.js";

function Toasts() {
  const s = useStore();
  return (
    <div class="toasts" aria-live="assertive">
      {s.toasts.map((t) => (
        <div key={t.id} class={cx("toast", `toast-${t.kind}`)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function Connecting() {
  return (
    <main class="gate gate-center">
      <div class="boot-eye" />
      <p class="sub">Стелимо рушник у кімнаті {state.room}…</p>
    </main>
  );
}

function Bye() {
  const reason = state.bye;
  const text =
    reason === "kicked"
      ? "Тебе прибрали з кімнати. Буває."
      : reason === "left"
        ? "Ти більше не в цій кімнаті."
        : reason || "Кімната недоступна.";
  const room = state.room;
  return (
    <main class="gate gate-center">
      <Ornament />
      <h1 class="title">Пляж зачинено</h1>
      <p class="sub">{text}</p>
      <div class="home-actions">
        <Btn
          kind="gold"
          block
          onClick={() => {
            leaveRoom({ tellServer: false });
            enterRoom(room);
          }}
        >
          Спробувати ще раз
        </Btn>
        <Btn kind="ghost" block onClick={() => leaveRoom({ tellServer: false })}>
          На головну
        </Btn>
      </div>
    </main>
  );
}

function App() {
  const s = useStore();
  const hasProfile = Boolean(s.profile.name);
  const inRoom = Boolean(s.room);

  // Open the socket as soon as we know who is coming and to which room.
  useEffect(() => {
    if (inRoom && hasProfile && s.conn === "idle") connect();
  }, [inRoom, hasProfile, s.conn]);

  let screen;
  if (!inRoom) screen = <Home />;
  else if (s.conn === "bye") screen = <Bye />;
  else if (!hasProfile) screen = <ProfileGate />;
  else if (!s.view) screen = <Connecting />;
  else if (s.view.phase === "lobby" || !s.view.game) screen = <Lobby />;
  else screen = <Game />;

  const turn = s.view?.game && s.view.phase !== "lobby" ? s.view.game.winner || s.view.game.turn : null;
  useEffect(() => {
    document.documentElement.dataset.turn = turn || "none";
  }, [turn]);

  return (
    <>
      {screen}
      {s.view && s.view.phase === "play" && <Announce />}
      <div id="reactions" aria-hidden="true" />
      <Sheets />
      {inRoom && s.conn === "lost" && (
        <div class="conn" role="status">
          <span class="pulse-dot" /> Звʼязок зник. Повертаємось…
        </div>
      )}
      <Toasts />
    </>
  );
}

const root = document.getElementById("app");
root.textContent = "";
render(<App />, root);
startFx();
