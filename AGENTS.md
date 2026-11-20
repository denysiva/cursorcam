# Оракул

A team word-association party game in Ukrainian, played together from phones. Two teams (Sun and Moon) share a grid of words; each team's Oracle sees the key and gives a one-word omen plus a number; Seekers open cards; a BAN card loses the round. The live game is https://orakul.higgsfield.app, hosted on Higgsfield as a `type: "game"` website (one Cloudflare Worker, one Durable Object per room).

Everything ships from `app/`. This repository is a mirror of the Higgsfield website repo's `app/` folder plus `design/`.

## Commands

Use Bun, from `app/`.

- `bun run build`: checks `logic.js`, typechecks, bundles the Worker and the client into `dist/`. Run it before calling work done.
- `bun run test`: rules and room tests in the real Workers runtime.
- `bun run dev`: local server on port 8787. It serves `dist/`, so build first, and restart it after every build (the build wipes `dist/`).
- `python3 design/build-assets.py`: rebuilds `app/public/img` and `app/public/sfx` from `design/raw` (not committed).

## Layout

- `app/src/logic.js`: the rules and the word packs. Six exports the platform requires (`meta`, `setup`, `validateAction`, `applyAction`, `isGameOver`, `viewFor`). Pure: no imports, no clock, no randomness. `run()` judges and applies an action on a copy of the state, so validation and application cannot disagree.
- `app/src/room.ts`: the Durable Object. Hashes the browser's secret token into the public player id, injects `_now` and `_rand` into every action, owns the server-only actions (`_join`, `_presence`, `_timeout`), sets the alarm for the turn timer, and sends each player only `viewFor(state, them)`.
- `app/src/protocol.ts`: validates every frame from a browser. Actions starting with `_` are refused here.
- `app/client/`: the interface in Preact with JSX, bundled by `scripts/build.mjs`. `store.js` holds the socket and the latest view and turns view changes into events; `sound.js` and `fx.js` hang off those events. Screens: `home.jsx`, `lobby.jsx`, `game.jsx`, `sheets.jsx`. Libraries are vendored in `client/vendor` so the build needs no install.
- `app/client/styles/`: plain CSS, concatenated in file-name order into `app.css`.
- `app/public/`: `index.html`, fonts, images, sounds.
- `app/tests/`: `logic.test.ts` (rules) and `room.test.ts` (WebSockets against the real runtime).
- `design/`: prompts and the asset pipeline.

## Rules

- The key (which card is whose) leaves the server only inside an Oracle's view, or everyone's once the round is over. Anything new in `viewFor` must respect that; `tests/` assert it.
- Never trust the client: every condition for an action is checked in `logic.js`.
- All interface text is Ukrainian, addressed informally. Keep wording gender-neutral for players.
- State must stay JSON-serializable; no state in fields on the `Room` class.
- Cyrillic fonts: Yeseva One (display), Sofia Sans Extra Condensed (capitals only, its lowercase uses Bulgarian letterforms), Alegreya Sans (body), Cormorant Garamond Italic (flavour lines).
- Every change comes with a test where a rule or the wire protocol changes.
- Commit messages use `feat`, `fix`, `perf`, `chore`, `docs`, `refactor`, `test`, `ci`, `build` or `revert`.

## Deploying

The Higgsfield website repo is separate from this one. To ship: copy `app/` into the website checkout (keep its `bun.lock`), commit, push with the Higgsfield website tools, then deploy the website.
