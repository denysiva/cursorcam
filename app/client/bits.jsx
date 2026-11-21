/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "./vendor/preact.js";
import { useEffect, useRef, useState } from "./vendor/hooks.js";
import { ui } from "./sound.js";

export const TEAM = {
  sun: {
    name: "Банани",
    gen: "Бананів",
    oracle: "Капітан Бананів",
    banned: "Банани відкрили Акулу",
    found: "Банани знайшли всі свої карти",
  },
  moon: {
    name: "Кокоси",
    gen: "Кокосів",
    oracle: "Капітан Кокосів",
    banned: "Кокоси відкрили Акулу",
    found: "Кокоси знайшли всі свої карти",
  },
};

/** Ukrainian plural: plural(3, ["карта", "карти", "карт"]) → "карти". */
export function plural(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

export const cx = (...parts) => parts.filter(Boolean).join(" ");

const PATHS = {
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  share: (
    <>
      <path d="M12 15V4" />
      <path d="M8 8l4-4 4 4" />
      <path d="M5 13v5a2 2 0 002 2h10a2 2 0 002-2v-5" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 012-2h9" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="9" r="3.2" />
      <path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5" />
      <path d="M16 6.2a3 3 0 010 5.6M17.5 14.4c2 .6 3.2 2.2 3.6 4.6" />
    </>
  ),
  scroll: (
    <>
      <path d="M7 4h11v13a3 3 0 01-3 3H6a2 2 0 01-2-2v-1h10v1a2 2 0 002 2" />
      <path d="M7 4a2 2 0 00-2 2v11M10 9h5M10 12.5h5" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A2.5 2.5 0 016.5 3H20v15H6.5A2.5 2.5 0 004 20.5z" />
      <path d="M4 20.5A2.5 2.5 0 006.5 23H20v-5M9 8h7" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" />
    </>
  ),
  shuffle: (
    <>
      <path d="M3 7h3.5c5 0 5.5 10 10.5 10H21M3 17h3.5c1.6 0 2.7-1 3.6-2.4M21 7h-4c-1.6 0-2.7 1-3.6 2.4" />
      <path d="M18 4l3 3-3 3M18 14l3 3-3 3" />
    </>
  ),
  door: (
    <>
      <path d="M14 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4" />
      <path d="M10 12h9M10 12l3-3M10 12l3 3M5 4h5v16H5z" opacity=".001" />
      <path d="M4 12h10M11 8.5L14.5 12 11 15.5" />
    </>
  ),
  sound: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4.2 4.2 0 010 6M18 6.5a7.6 7.6 0 010 11" />
    </>
  ),
  mute: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    </>
  ),
  crown: <path d="M4 8l4 4 4-7 4 7 4-4-1.6 10H5.6z" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 9.5v4l2.5 2M9.5 2.5h5" />
    </>
  ),
  send: <path d="M4 12l15.5-7.5L15 20l-3.5-6.5z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  skip: <path d="M5 5l9 7-9 7zM18 5v14" />,
  note: (
    <>
      <path d="M9 18V6l10-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M3.5 8.5v7M20.5 8.5v7" />
    </>
  ),
  qr: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <path d="M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM20 14v1M14 20v-1" />
    </>
  ),
  swap: <path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  dice: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3.5" />
      <circle cx="9" cy="9" r="1" fill="currentColor" />
      <circle cx="15" cy="15" r="1" fill="currentColor" />
      <circle cx="15" cy="9" r="1" fill="currentColor" />
      <circle cx="9" cy="15" r="1" fill="currentColor" />
    </>
  ),
};

export function Icon({ name, size = 20, class: cls }) {
  return (
    <svg
      class={cx("icon", cls)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

/**
 * The emblems, drawn rather than typed so they match everywhere: a banana and
 * a coconut for the teams, a shark fin for the instant loss, a beach umbrella
 * for the tourists. Solid shapes with an outline (its colour comes from
 * `--glyph-line`), so they stay readable at 11px on any sticker.
 */
export function Glyph({ team, size = 18 }) {
  const box = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": "true" };
  if (team === "sun") {
    return (
      <svg class="glyph glyph-sun" {...box}>
        <path
          class="g-fill"
          d="M20.6 3.6C22.4 12.6 16.4 21.6 5.2 21.4 3.6 21.4 2.4 20.2 3.1 19 10.4 18.4 15.4 13 16.4 4.4L16 2.6l3.8-1z"
        />
        <path class="g-ink" d="M16 2.6l3.8-1 .6 2.1-4 .9z" />
      </svg>
    );
  }
  if (team === "moon") {
    return (
      <svg class="glyph glyph-moon" {...box}>
        <path class="g-fill" d="M9 5l1.1-3.4L12 3.8l1.9-2.2L15 5z" />
        <circle class="g-fill" cx="12" cy="12.8" r="8.6" />
        <circle class="g-ink" cx="8.8" cy="10.9" r="1.55" />
        <circle class="g-ink" cx="15.2" cy="10.9" r="1.55" />
        <circle class="g-ink" cx="12" cy="15.7" r="1.55" />
      </svg>
    );
  }
  if (team === "ban") {
    return (
      <svg class="glyph glyph-ban" {...box}>
        <path class="g-fill" d="M2.6 19.4C8 15.6 11.6 8.6 15.8 2.2 15.2 9 17.4 15 21.4 19.4z" />
        <path class="g-line" d="M1.4 21.8q2.65-2 5.3 0t5.3 0 5.3 0 5.3 0" />
      </svg>
    );
  }
  return (
    <svg class="glyph glyph-bot" {...box}>
      <path class="g-line" d="M12 12v9.4M8 21.6h8" />
      <path class="g-fill" d="M2.2 12.6a9.8 9.8 0 0119.6 0z" />
      <path fill="#fff" d="M12 3.4c-1.7 2.6-2.7 5.6-2.9 8.6h5.8c-.2-3-1.2-6-2.9-8.6z" />
    </svg>
  );
}

const AVATAR_COUNT = 16;
export const AVATAR_NAMES = [
  "Ананас", "Манго", "Папуга", "Фламінго", "Краб", "Черепаха", "Тукан", "Ігуана",
  "Зірка", "Кавун", "Коктейль", "Дельфін", "Папая", "Пелікан", "Рак", "Лайм",
];

export function Avatar({ index, size = 36, class: cls, ring, off }) {
  const i = ((index ?? 0) % AVATAR_COUNT + AVATAR_COUNT) % AVATAR_COUNT;
  const col = i % 4;
  const row = Math.floor(i / 4);
  return (
    <span
      class={cx("avatar", ring && `ring-${ring}`, off && "is-off", cls)}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        backgroundPosition: `${(col / 3) * 100}% ${(row / 3) * 100}%`,
      }}
    />
  );
}

export function Btn({ kind = "gold", icon, children, onClick, disabled, class: cls, small, block, type = "button", ...rest }) {
  return (
    <button
      type={type}
      class={cx("btn", `btn-${kind}`, small && "btn-s", block && "btn-block", cls)}
      disabled={disabled}
      onClick={(e) => {
        ui.tap();
        onClick?.(e);
      }}
      {...rest}
    >
      {icon && <Icon name={icon} size={small ? 16 : 19} />}
      {children && <span>{children}</span>}
    </button>
  );
}

/** A panel that slides up from the bottom; tap outside or drag down to close. */
export function Sheet({ title, onClose, children, tall, class: cls }) {
  const [closing, setClosing] = useState(false);
  const ref = useRef(null);
  const close = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 220);
  };
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div class={cx("sheet-wrap", closing && "is-closing")} onClick={(e) => e.target === e.currentTarget && close()}>
      <section class={cx("sheet", tall && "sheet-tall", cls)} ref={ref} role="dialog" aria-label={title}>
        <header class="sheet-head">
          <h2>{title}</h2>
          <button class="icon-btn" onClick={close} aria-label="Закрити">
            <Icon name="close" />
          </button>
        </header>
        <div class="sheet-body">{children}</div>
      </section>
    </div>
  );
}

/** A segmented control: one of a few options. */
export function Seg({ value, options, onChange, disabled }) {
  return (
    <div class={cx("seg", disabled && "is-disabled")} role="radiogroup">
      {options.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={o.value === value}
          class={cx("seg-item", o.value === value && "is-on")}
          disabled={disabled}
          onClick={() => {
            ui.tap();
            onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Ornament() {
  return (
    <div class="ornament" aria-hidden="true">
      <i />
      <svg width="18" height="18" viewBox="0 0 24 24">
        <path fill="currentColor" d="M12 2l2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6z" />
      </svg>
      <i />
    </div>
  );
}
