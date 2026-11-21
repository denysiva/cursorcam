/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "./vendor/preact.js";
import { useEffect, useMemo, useState } from "./vendor/hooks.js";
import qrcode from "./vendor/qrcode.js";
import { Avatar, Btn, Glyph, Icon, Seg, Sheet, TEAM, cx, plural } from "./bits.jsx";
import { Profile } from "./home.jsx";
import { act, isHost, leaveRoom, me, openSheet, roomLink, setPref, state, toast, useStore } from "./store.js";
import { ui } from "./sound.js";

const close = () => openSheet(null);

// ── invite ─────────────────────────────────────────────────────────────────

function QR({ text }) {
  const path = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    }
    return { d, n };
  }, [text]);
  return (
    <svg class="qr" viewBox={`-2 -2 ${path.n + 4} ${path.n + 4}`} role="img" aria-label="QR-код кімнати" shape-rendering="crispEdges">
      <rect x="-2" y="-2" width={path.n + 4} height={path.n + 4} fill="#ffffff" rx="1.5" />
      <path d={path.d} fill="#12324A" />
    </svg>
  );
}

function ShareSheet() {
  const link = roomLink();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast("Посилання скопійовано");
    } catch {
      toast(link);
    }
  };
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Коко Банан", text: `Заходь у гру «Коко Банан», кімната ${state.room}`, url: link });
        return;
      } catch {
        /* cancelled */
      }
    } else copy();
  };
  return (
    <Sheet title="Запросити гравців" onClose={close}>
      <div class="share">
        <QR text={link} />
        <p class="share-code">
          <span>код кімнати</span>
          <b>{state.room}</b>
        </p>
        <p class="sub">Наведи камеру телефона на код або відкрий сайт і введи код кімнати.</p>
        <div class="dock-row">
          <Btn kind="gold" class="grow" icon="share" onClick={share}>
            Поділитися
          </Btn>
          <Btn kind="ghost" icon="copy" onClick={copy}>
            Копіювати
          </Btn>
        </div>
      </div>
    </Sheet>
  );
}

// ── menu ───────────────────────────────────────────────────────────────────

function Toggle({ icon, label, note, value, onChange }) {
  return (
    <button
      class={cx("row row-toggle", value && "is-on")}
      onClick={() => {
        onChange(!value);
        ui.tap();
      }}
      role="switch"
      aria-checked={value}
    >
      <Icon name={icon} />
      <span class="row-text">
        <b>{label}</b>
        {note && <i>{note}</i>}
      </span>
      <span class="switch" />
    </button>
  );
}

function Row({ icon, label, note, onClick, danger }) {
  return (
    <button
      class={cx("row", danger && "row-danger")}
      onClick={() => {
        ui.tap();
        onClick();
      }}
    >
      <Icon name={icon} />
      <span class="row-text">
        <b>{label}</b>
        {note && <i>{note}</i>}
      </span>
    </button>
  );
}

function MenuSheet() {
  const s = useStore();
  const view = s.view;
  const my = me();
  const host = isHost();
  const playing = view?.phase === "play";
  const hostPlayer = view.players.find((p) => p.id === view.hostId);
  const hostAway = !hostPlayer || !hostPlayer.online;
  return (
    <Sheet title="Меню" onClose={close}>
      <div class="rows">
        {my && (
          <button class="row row-me" onClick={() => openSheet("profile")}>
            <Avatar index={my.avatar} size={44} />
            <span class="row-text">
              <b>{my.name}</b>
              <i>Змінити імʼя або героя</i>
            </span>
          </button>
        )}
        <Row icon="users" label="Гравці" note={`${view.players.length} у кімнаті`} onClick={() => openSheet("players")} />
        {view.game && <Row icon="scroll" label="Журнал ходів" onClick={() => openSheet("log")} />}
        <Row icon="book" label="Як грати" onClick={() => openSheet("rules")} />
        <Toggle icon={s.sound ? "sound" : "mute"} label="Звуки" value={s.sound} onChange={(v) => setPref("sound", v)} />
        <Toggle icon="note" label="Музика" note="Тиха фонова мелодія" value={s.music} onChange={(v) => setPref("music", v)} />
        <Toggle icon="phone" label="Вібрація" value={s.haptics} onChange={(v) => setPref("haptics", v)} />
        {host && !playing && <Row icon="gear" label="Налаштування гри" onClick={() => openSheet("settings")} />}
        {host && playing && (
          <Row
            icon="skip"
            label="Пропустити хід"
            note="Якщо хтось завис"
            onClick={() => {
              act({ t: "skip" });
              close();
            }}
          />
        )}
        {host && view.game && (
          <Row
            icon="swap"
            label="Завершити раунд і повернутись у лобі"
            onClick={() => {
              act({ t: "toLobby" });
              close();
            }}
          />
        )}
        {!host && hostAway && (
          <Row
            icon="crown"
            label="Взяти керування грою"
            note="Ведучий не на звʼязку"
            onClick={() => {
              act({ t: "claimHost" });
              close();
            }}
          />
        )}
        <Row icon="door" label="Вийти з кімнати" danger onClick={() => leaveRoom()} />
      </div>
    </Sheet>
  );
}

// ── players ────────────────────────────────────────────────────────────────

function PlayersSheet() {
  const s = useStore();
  const view = s.view;
  const host = isHost();
  const groups = [
    ["sun", view.players.filter((p) => p.team === "sun")],
    ["moon", view.players.filter((p) => p.team === "moon")],
    [null, view.players.filter((p) => !p.team)],
  ];
  return (
    <Sheet title="Гравці" onClose={close} tall>
      {groups.map(([team, list]) =>
        list.length ? (
          <section class={cx("plist", team && `plist-${team}`)}>
            <h3>
              {team ? (
                <>
                  <Glyph team={team} size={14} /> {TEAM[team].name}
                </>
              ) : (
                "Глядачі"
              )}
              <span>{list.length}</span>
            </h3>
            <ul>
              {list
                .slice()
                .sort((a, b) => (a.role === "oracle" ? -1 : 0) - (b.role === "oracle" ? -1 : 0))
                .map((p) => (
                  <li>
                    <button class="row" disabled={!host} onClick={() => openSheet("player", p.id)}>
                      <Avatar index={p.avatar} size={36} off={!p.online} />
                      <span class="row-text">
                        <b>
                          {p.name}
                          {p.id === s.you && <em> · це ти</em>}
                        </b>
                        <i>
                          {team ? (p.role === "oracle" ? "Капітан" : "Гравець") : "Не в команді"}
                          {p.id === view.hostId && " · ведучий"}
                          {!p.online && " · не на звʼязку"}
                        </i>
                      </span>
                      {p.wins > 0 && (
                        <span class="row-wins">
                          <Icon name="crown" size={13} /> {p.wins}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ) : null,
      )}
      {host && <p class="sub center">Торкнись гравця, щоб перемістити його чи передати керування.</p>}
    </Sheet>
  );
}

function PlayerSheet({ pid }) {
  const s = useStore();
  const p = s.view?.players.find((x) => x.id === pid);
  useEffect(() => {
    if (!p) close();
  }, [p]);
  if (!p) return null;
  const move = (team, role) => {
    act({ t: "move", pid, team, role });
    close();
  };
  const self = pid === s.you;
  return (
    <Sheet title={p.name} onClose={close}>
      <div class="rows">
        <div class="move-grid">
          {["sun", "moon"].map((team) => (
            <div class={cx("move-col", `move-${team}`)}>
              <p>
                <Glyph team={team} size={14} /> {TEAM[team].name}
              </p>
              <Btn kind={team} small block onClick={() => move(team, "oracle")}>
                Капітан
              </Btn>
              <Btn kind="ghost" small block onClick={() => move(team, "seeker")}>
                Гравець
              </Btn>
            </div>
          ))}
        </div>
        <Row icon="eye" label="Зробити глядачем" onClick={() => move(null)} />
        {!self && (
          <Row
            icon="crown"
            label="Передати керування"
            note="Цей гравець стане ведучим"
            onClick={() => {
              act({ t: "giveHost", pid });
              close();
            }}
          />
        )}
        {!self && (
          <Row
            icon="door"
            label="Видалити з кімнати"
            danger
            onClick={() => {
              act({ t: "kick", pid });
              close();
            }}
          />
        )}
      </div>
    </Sheet>
  );
}

// ── host settings ──────────────────────────────────────────────────────────

function parseWords(text) {
  return text
    .split(/[\n,;]+/)
    .map((w) => w.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function SettingsSheet() {
  const s = useStore();
  const view = s.view;
  const st = view.settings;
  const set = (patch) => act({ t: "settings", patch });
  const [text, setText] = useState(() => (st.custom || []).join("\n"));
  const [dirty, setDirty] = useState(false);
  const words = parseWords(text);

  const togglePack = (id) => {
    const on = st.packs.includes(id);
    const next = on ? st.packs.filter((x) => x !== id) : [...st.packs, id];
    if (!next.length) {
      toast("Потрібен хоча б один набір слів", "error");
      return;
    }
    set({ packs: next });
  };

  const saveWords = () => {
    const packs = words.length ? [...new Set([...st.packs, "custom"])] : st.packs.filter((x) => x !== "custom");
    set({ custom: words, packs: packs.length ? packs : ["base"] });
    setDirty(false);
    toast(words.length ? `Збережено: ${words.length} ${plural(words.length, ["слово", "слова", "слів"])}` : "Свої слова прибрано");
  };

  return (
    <Sheet title="Налаштування гри" onClose={close} tall>
      <div class="settings">
        <div class="field">
          <label>Розмір поля</label>
          <Seg
            value={st.rows}
            onChange={(rows) => set({ rows })}
            options={[
              { value: 4, label: "20 карт" },
              { value: 5, label: "25 карт" },
              { value: 6, label: "30 карт" },
            ]}
          />
          <p class="hint">20 — швидка партія, 30 — довга й напружена.</p>
        </div>

        <div class="field">
          <label>Час на хід</label>
          <Seg
            value={st.timer}
            onChange={(timer) => set({ timer })}
            options={[
              { value: 0, label: "Без" },
              { value: 60, label: "1 хв" },
              { value: 90, label: "1,5" },
              { value: 120, label: "2 хв" },
              { value: 180, label: "3 хв" },
            ]}
          />
          <p class="hint">Таймер окремо на підказку і на пошук. Влучили у свою карту — плюс 15 секунд.</p>
        </div>

        <div class="field">
          <label>Як команда відкриває карту</label>
          <Seg
            value={st.pick}
            onChange={(pick) => set({ pick })}
            options={[
              { value: "free", label: "Хто перший" },
              { value: "vote", label: "Голосування" },
            ]}
          />
          <p class="hint">
            {st.pick === "vote"
              ? "Карта відкривається, коли за неї більшість Гравців команди. Для великих компаній."
              : "Будь-хто з Гравців обирає карту і підтверджує. Швидко й азартно."}
          </p>
        </div>

        <div class="field">
          <label>Акули на полі</label>
          <Seg
            value={st.bans}
            onChange={(bans) => set({ bans })}
            options={[
              { value: 1, label: "1" },
              { value: 2, label: "2" },
              { value: 3, label: "3 — жорстко" },
            ]}
          />
        </div>

        <div class="field">
          <label>Набори слів</label>
          <div class="packs">
            {view.packs.map((p) => (
              <button class={cx("pack", st.packs.includes(p.id) && "is-on")} onClick={() => togglePack(p.id)} aria-pressed={st.packs.includes(p.id)}>
                <span class="pack-check">
                  <Icon name="check" size={14} />
                </span>
                <b>{p.name}</b>
                <i>
                  {p.note} · {p.count}
                </i>
              </button>
            ))}
            {st.customCount > 0 && (
              <button class={cx("pack", st.packs.includes("custom") && "is-on")} onClick={() => togglePack("custom")} aria-pressed={st.packs.includes("custom")}>
                <span class="pack-check">
                  <Icon name="check" size={14} />
                </span>
                <b>Свої слова</b>
                <i>Ваш власний набір · {st.customCount}</i>
              </button>
            )}
          </div>
          <p class="hint">Обрані набори діляться полем порівну, хоч би якими різними за розміром вони були.</p>
        </div>

        <div class="field">
          <label for="custom">Свої слова</label>
          <textarea
            id="custom"
            class="text-area"
            rows={5}
            value={text}
            onInput={(e) => {
              setText(e.target.value);
              setDirty(true);
            }}
            placeholder={"Кожне слово з нового рядка або через кому:\nДЕДЛАЙН, ПʼЯТНИЦЯ, КАВОМАШИНА"}
            spellcheck={false}
          />
          <div class="dock-row">
            <p class="hint grow">
              {words.length} {plural(words.length, ["слово", "слова", "слів"])}. Якщо їх мало, поле доповнить «Класика».
            </p>
            <Btn kind="gold" small disabled={!dirty} onClick={saveWords}>
              Зберегти
            </Btn>
          </div>
        </div>

        {view.score.sun + view.score.moon > 0 && (
          <Btn kind="ghost" small block onClick={() => act({ t: "resetScore" })}>
            Обнулити рахунок ({view.score.sun} : {view.score.moon})
          </Btn>
        )}
      </div>
    </Sheet>
  );
}

// ── rules ──────────────────────────────────────────────────────────────────

function RulesSheet() {
  return (
    <Sheet title="Як грати" onClose={close} tall>
      <div class="rules">
        <p class="rules-lead">
          Дві команди — <b class="c-sun">{TEAM.sun.name}</b> і <b class="c-moon">{TEAM.moon.name}</b> — шукають свої карти на спільному полі слів.
          Хто першим знайде всі свої, той і переміг.
        </p>

        <ol class="steps">
          <li>
            <span class="step-n">1</span>
            <div>
              <h3>Капітан бачить усе</h3>
              <p>У кожної команди є Капітан, і лише Капітан знає, які слова чиї. Решта команди — Гравці.</p>
            </div>
          </li>
          <li>
            <span class="step-n">2</span>
            <div>
              <h3>Підказка: слово і число</h3>
              <p>
                Капітан називає одне слово, яке поєднує кілька карт своєї команди, і число — скільки саме. Наприклад:
                <b> «МОРЕ, 3»</b>.
              </p>
            </div>
          </li>
          <li>
            <span class="step-n">3</span>
            <div>
              <h3>Гравці відкривають карти</h3>
              <p>Радьтесь уголос і відкривайте карти по одній. Спроб на одну більше, ніж число в підказці. Після першої карти можна зупинитись.</p>
            </div>
          </li>
        </ol>

        <h3 class="rules-h">Що ховається під картою</h3>
        <ul class="faces">
          <li>
            <img src="/img/card-sun.webp" alt="" loading="lazy" />
            <div>
              <b>Своя карта</b>
              <p>Влучили — шукаєте далі.</p>
            </div>
          </li>
          <li>
            <img src="/img/card-moon.webp" alt="" loading="lazy" />
            <div>
              <b>Карта суперника</b>
              <p>Подарували їм очко, хід переходить.</p>
            </div>
          </li>
          <li>
            <img src="/img/card-bot.webp" alt="" loading="lazy" />
            <div>
              <b>Турист</b>
              <p>Нічия карта. Турист дрімає під парасолькою, хід переходить.</p>
            </div>
          </li>
          <li>
            <img src="/img/card-ban.webp" alt="" loading="lazy" />
            <div>
              <b>Акула</b>
              <p>Відкрили Акулу — миттєво програли раунд.</p>
            </div>
          </li>
        </ul>

        <h3 class="rules-h">Кодекс Капітана</h3>
        <ul class="bullets">
          <li>Лише одне слово і число. Жодних жестів, інтонацій і «ну майже».</li>
          <li>Не можна називати слово, яке лежить на столі, або його частину.</li>
          <li>Число 0 означає «жодна наша карта не про це», ∞ знімає ліміт спроб.</li>
          <li>Поки команда шукає, Капітан мовчить і тримає обличчя.</li>
        </ul>
      </div>
    </Sheet>
  );
}

// ── log ────────────────────────────────────────────────────────────────────

const TYPE_LABEL = { sun: `карта ${TEAM.sun.gen}`, moon: `карта ${TEAM.moon.gen}`, bot: "Турист", ban: "Акула" };

function LogSheet() {
  const s = useStore();
  const g = s.view?.game;
  if (!g) return null;
  const turns = [];
  for (const e of g.log) {
    let t = turns[turns.length - 1];
    if (!t || t.turn !== e.turn) {
      t = { turn: e.turn, team: e.team, items: [] };
      turns.push(t);
    }
    t.items.push(e);
  }
  turns.reverse();
  return (
    <Sheet title="Журнал ходів" onClose={close} tall>
      {turns.length === 0 && <p class="sub center">Ще жодного ходу. Усе попереду.</p>}
      <ol class="log">
        {turns.map((t) => (
          <li class={cx("log-turn", `log-${t.team}`)}>
            <span class="log-n">{t.turn}</span>
            <div class="log-items">
              {t.items.map((e) => {
                if (e.k === "clue") {
                  return (
                    <p class="log-clue">
                      <Glyph team={e.team} size={13} />
                      <b>{e.word}</b>
                      <span class="log-num">{e.n === -1 ? "∞" : e.n}</span>
                      <i>{e.name}</i>
                    </p>
                  );
                }
                if (e.k === "pick") {
                  return (
                    <p class={cx("log-pick", `pick-${e.type}`, e.type === e.team && "is-hit")}>
                      <Glyph team={e.type} size={12} />
                      <b>{e.word}</b>
                      <i>
                        {TYPE_LABEL[e.type]}
                        {e.name ? ` · ${e.name}` : " · голосування"}
                      </i>
                    </p>
                  );
                }
                if (e.k === "pass") return <p class="log-note">{e.name ? `${e.name} завершує хід` : "Команда завершує хід"}</p>;
                if (e.k === "timeout") return <p class="log-note">Час вийшов</p>;
                if (e.k === "skip") return <p class="log-note">Хід пропущено</p>;
                return null;
              })}
            </div>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}

// ── the switchboard ────────────────────────────────────────────────────────

export function Sheets() {
  const s = useStore();
  const sheet = s.sheet;
  if (!sheet) return null;
  if (sheet.name === "rules") return <RulesSheet />;
  if (!s.view) return null;
  switch (sheet.name) {
    case "share":
      return <ShareSheet />;
    case "menu":
      return <MenuSheet />;
    case "players":
      return <PlayersSheet />;
    case "player":
      return <PlayerSheet pid={sheet.data} />;
    case "settings":
      return isHost() ? <SettingsSheet /> : null;
    case "log":
      return <LogSheet />;
    case "profile":
      return (
        <Sheet title="Твій профіль" onClose={close} tall>
          <Profile onDone={close} />
        </Sheet>
      );
    default:
      return null;
  }
}
