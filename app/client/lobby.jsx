/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "./vendor/preact.js";
import { Avatar, Btn, Glyph, Icon, TEAM, cx, plural } from "./bits.jsx";
import { act, isHost, me, openSheet, state, useStore } from "./store.js";
import { ui } from "./sound.js";

export function settingsSummary(view) {
  const s = view.settings;
  const names = s.packs.map((id) => (id === "custom" ? "Свої слова" : view.packs.find((p) => p.id === id)?.name)).filter(Boolean);
  return [
    `Поле 5×${s.rows}`,
    s.timer ? `${s.timer} с на хід` : "Без таймера",
    s.pick === "vote" ? "Голосування" : "Хто перший",
    `${s.bans} ${plural(s.bans, ["БАН", "БАНи", "БАНів"])}`,
    names.join(" + "),
  ];
}

export function TopBar({ children, right }) {
  return (
    <header class="topbar">
      <button
        class="room-chip"
        onClick={() => {
          ui.tap();
          openSheet("share");
        }}
        aria-label="Запросити гравців"
      >
        <span class="room-chip-label">кімната</span>
        <b>{state.room}</b>
        <Icon name="qr" size={17} />
      </button>
      <div class="topbar-mid">{children}</div>
      <div class="topbar-right">
        {right}
        <button
          class="icon-btn"
          onClick={() => {
            ui.tap();
            openSheet("menu");
          }}
          aria-label="Меню"
        >
          <Icon name="menu" />
        </button>
      </div>
    </header>
  );
}

function PlayerRow({ p, you, host, canManage }) {
  const body = (
    <>
      <Avatar index={p.avatar} size={30} off={!p.online} />
      <span class="who-name">{p.name}</span>
      {host && <Icon name="crown" size={13} class="who-crown" />}
      {p.wins > 0 && <span class="who-wins">{p.wins}</span>}
    </>
  );
  const cls = cx("who", you && "is-me", !p.online && "is-off");
  if (!canManage) return <li class={cls}>{body}</li>;
  return (
    <li class={cls}>
      <button
        class="who-btn"
        onClick={() => {
          ui.tap();
          openSheet("player", p.id);
        }}
      >
        {body}
      </button>
    </li>
  );
}

function TeamPanel({ team }) {
  const s = useStore();
  const view = s.view;
  const my = me();
  const host = isHost();
  const list = view.players.filter((p) => p.team === team);
  const oracle = list.find((p) => p.role === "oracle");
  const seekers = list.filter((p) => p.role === "seeker");
  const mineHere = my?.team === team;
  const iAmOracle = mineHere && my.role === "oracle";

  return (
    <section class={cx("team", `team-${team}`, mineHere && "is-mine")}>
      <header class="team-head">
        <span class="team-art" aria-hidden="true">
          <img src={`/img/oracle-${team}.webp`} alt="" loading="lazy" />
        </span>
        <div>
          <h2>
            <Glyph team={team} size={15} /> {TEAM[team].name}
          </h2>
          <p>
            {list.length} {plural(list.length, ["гравець", "гравці", "гравців"])}
          </p>
        </div>
      </header>

      <div class="slot">
        <span class="slot-label">
          <Icon name="eye" size={13} /> Оракул
        </span>
        {oracle ? (
          <ul class="who-list">
            <PlayerRow p={oracle} you={oracle.id === s.you} host={oracle.id === view.hostId} canManage={host} />
          </ul>
        ) : (
          <button class="slot-empty" onClick={() => act({ t: "seat", team, role: "oracle" })}>
            <Icon name="plus" size={15} /> Стати Оракулом
          </button>
        )}
      </div>

      <div class="slot slot-grow">
        <span class="slot-label">
          <Icon name="users" size={13} /> Шукачі
        </span>
        {seekers.length ? (
          <ul class="who-list">
            {seekers.map((p) => (
              <PlayerRow key={p.id} p={p} you={p.id === s.you} host={p.id === view.hostId} canManage={host} />
            ))}
          </ul>
        ) : (
          <p class="slot-none">Поки нікого</p>
        )}
      </div>

      {!mineHere && (
        <Btn kind={team} small block onClick={() => act({ t: "seat", team, role: "seeker" })}>
          До {TEAM[team].gen}
        </Btn>
      )}
      {mineHere && !iAmOracle && (
        <Btn kind="ghost" small block onClick={() => act({ t: "seat", team: null })}>
          Вийти з команди
        </Btn>
      )}
      {iAmOracle && (
        <Btn kind="ghost" small block onClick={() => act({ t: "seat", team, role: "seeker" })}>
          Стати Шукачем
        </Btn>
      )}
    </section>
  );
}

export function Lobby() {
  const s = useStore();
  const view = s.view;
  const host = isHost();
  const bench = view.players.filter((p) => !p.team);
  const hostPlayer = view.players.find((p) => p.id === view.hostId);
  const played = view.score.sun + view.score.moon > 0;

  return (
    <main class="lobby">
      <TopBar />

      <div class="lobby-scroll">
        <div class="lobby-title">
          <h1 class="title">{played ? "Новий раунд" : "Збираємо команди"}</h1>
          {played ? (
            <p class="scoreline">
              <span class="c-sun">
                <Glyph team="sun" size={16} /> {view.score.sun}
              </span>
              <i>:</i>
              <span class="c-moon">
                {view.score.moon} <Glyph team="moon" size={16} />
              </span>
            </p>
          ) : (
            <p class="sub">У кожної команди — один Оракул і хоча б один Шукач</p>
          )}
        </div>

        <div class="teams">
          <TeamPanel team="sun" />
          <TeamPanel team="moon" />
        </div>

        {view.players.length < 4 && (
          <button
            class="invite"
            onClick={() => {
              ui.tap();
              openSheet("share");
            }}
          >
            <span class="invite-qr">
              <Icon name="qr" size={26} />
            </span>
            <span class="invite-text">
              <b>Поклич команду</b>
              <i>Покажи QR-код або скинь посилання. Для гри потрібно щонайменше четверо.</i>
            </span>
          </button>
        )}

        {bench.length > 0 && (
          <section class="bench">
            <h3>
              Ще обирають <span>{bench.length}</span>
            </h3>
            <ul class="bench-list">
              {bench.map((p) => (
                <PlayerRow key={p.id} p={p} you={p.id === s.you} host={p.id === view.hostId} canManage={host} />
              ))}
            </ul>
          </section>
        )}

        <button
          class={cx("rules-chip", host && "is-host")}
          onClick={() => {
            ui.tap();
            openSheet(host ? "settings" : "rules");
          }}
        >
          <Icon name={host ? "gear" : "book"} size={16} />
          <span>{settingsSummary(view).join(" · ")}</span>
        </button>
      </div>

      <footer class="dock lobby-dock">
        {host ? (
          <>
            <div class="dock-row">
              <Btn kind="ghost" icon="shuffle" onClick={() => act({ t: "shuffle" })} aria-label="Перемішати команди">
                Перемішати
              </Btn>
              <Btn kind="gold" class="grow" disabled={Boolean(view.ready)} onClick={() => act({ t: "start" })}>
                Почати гру
              </Btn>
            </div>
            <p class="dock-hint">{view.ready || "Усе готово. Натискай, коли всі зайшли."}</p>
          </>
        ) : (
          <p class="dock-wait">
            <span class="pulse-dot" />
            {view.ready ? view.ready : `Чекаємо, поки ${hostPlayer?.name || "ведучий"} почне гру`}
          </p>
        )}
        {!host && hostPlayer && !hostPlayer.online && (
          <Btn kind="ghost" small block onClick={() => act({ t: "claimHost" })}>
            Ведучий зник — взяти керування
          </Btn>
        )}
      </footer>
    </main>
  );
}
