/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "./vendor/preact.js";
import { useEffect, useRef, useState } from "./vendor/hooks.js";
import { Avatar, AVATAR_NAMES, Btn, Glyph, Ornament, cx } from "./bits.jsx";
import { cleanRoomCode, enterRoom, makeRoomCode, openSheet, setProfile, state, toast, useStore } from "./store.js";
import { ui } from "./sound.js";

export function Home() {
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState("");
  const input = useRef(null);

  useEffect(() => {
    if (joining) input.current?.focus();
  }, [joining]);

  const submit = (e) => {
    e?.preventDefault();
    const clean = cleanRoomCode(code);
    if (clean.length < 3) {
      toast("Введіть код кімнати", "error");
      return;
    }
    enterRoom(clean);
  };

  return (
    <main class="home">
      <div class="home-art" aria-hidden="true">
        <div class="home-rays" />
        <img src="/img/hero.webp" alt="" width="960" height="1200" fetchpriority="high" />
      </div>

      <div class="home-body">
        <p class="eyebrow">
          <Glyph team="sun" size={14} /> командна гра натяків <Glyph team="moon" size={14} />
        </p>
        <h1 class="logo" data-text="ОРАКУЛ">
          ОРАКУЛ
        </h1>
        <p class="tagline">Одне слово. Багато здогадок. І карта, якої краще не торкатися.</p>

        {!joining ? (
          <div class="home-actions">
            <Btn kind="gold" block onClick={() => enterRoom(makeRoomCode())}>
              Створити гру
            </Btn>
            <Btn kind="ghost" block onClick={() => setJoining(true)}>
              Увійти за кодом
            </Btn>
          </div>
        ) : (
          <form class="home-actions" onSubmit={submit}>
            <input
              ref={input}
              class="code-input"
              value={code}
              onInput={(e) => setCode(cleanRoomCode(e.target.value))}
              placeholder="КОД"
              maxLength={8}
              autocomplete="off"
              autocapitalize="characters"
              spellcheck={false}
              inputmode="text"
              aria-label="Код кімнати"
            />
            <Btn kind="gold" block type="submit">
              Увійти
            </Btn>
            <button type="button" class="link" onClick={() => setJoining(false)}>
              Назад
            </button>
          </form>
        )}

        <button class="link home-rules" onClick={() => openSheet("rules")}>
          Як грати?
        </button>
      </div>
    </main>
  );
}

const NAME_IDEAS = ["Провидець", "Містик", "Зоря", "Ворожка", "Пророк", "Чаклун", "Мольфар", "Знахар"];

/** Name + avatar. Shown before the first room, and from the menu afterwards. */
export function Profile({ onDone, first }) {
  const s = useStore();
  const [name, setName] = useState(s.profile.name || "");
  const [avatar, setAvatar] = useState(s.profile.avatar ?? Math.floor(Math.random() * 16));
  const input = useRef(null);

  useEffect(() => {
    if (first && !name) input.current?.focus();
  }, []);

  const submit = (e) => {
    e?.preventDefault();
    const clean = name.replace(/\s+/g, " ").trim().slice(0, 16);
    if (!clean) {
      toast("Як тебе звати?", "error");
      input.current?.focus();
      return;
    }
    setProfile(clean, avatar);
    onDone?.();
  };

  return (
    <form class="profile" onSubmit={submit}>
      <div class="profile-me">
        <Avatar index={avatar} size={92} class="profile-avatar" key={avatar} />
        <div class="profile-field">
          <label for="name">Твоє імʼя</label>
          <input
            id="name"
            ref={input}
            class="text-input"
            value={name}
            onInput={(e) => setName(e.target.value.slice(0, 16))}
            placeholder={NAME_IDEAS[avatar % NAME_IDEAS.length]}
            maxLength={16}
            autocomplete="nickname"
            enterkeyhint="done"
          />
        </div>
      </div>

      <p class="label">Обери тотем</p>
      <div class="avatar-grid">
        {AVATAR_NAMES.map((label, i) => (
          <button
            type="button"
            class={cx("avatar-pick", i === avatar && "is-on")}
            onClick={() => {
              ui.mark();
              setAvatar(i);
            }}
            aria-label={label}
            aria-pressed={i === avatar}
          >
            <Avatar index={i} size={56} />
          </button>
        ))}
      </div>

      <Btn kind="gold" block type="submit">
        {first ? "Увійти в кімнату" : "Зберегти"}
      </Btn>
    </form>
  );
}

/** The gate between a room link and the room: who are you? */
export function ProfileGate() {
  return (
    <main class="gate">
      <Ornament />
      <h1 class="title">Хто заходить?</h1>
      <p class="sub">
        Кімната <b class="mono">{state.room}</b> чекає. Назвися й обери тотем, щоб команда тебе впізнала.
      </p>
      <Profile first />
    </main>
  );
}
