/**
 * Guard the `logic.js` contract at build time, so a broken game fails HERE with
 * a clear message instead of at runtime in front of players.
 *
 *   1. all six exports present, `meta` sane;
 *   2. no imports — logic.js is pure rules;
 *   3. no timers, clock or randomness — the room injects `_now` / `_rand`.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const logicPath = resolve(app, "src/logic.js");

const REQUIRED = ["meta", "setup", "validateAction", "applyAction", "isGameOver", "viewFor"];

const BANNED = [
  [/\brequire\s*\(/, "logic.js must not require() anything — it is pure game rules"],
  [/^\s*import\s+[^.\n]/m, "logic.js must not import packages — it is pure game rules"],
  [/\bset(Timeout|Interval)\s*\(/, "use the room's alarm instead of timers"],
  [/\bDate\s*\.\s*now\s*\(/, "logic must be deterministic — use the injected _now"],
  [/\bnew\s+Date\s*\(/, "logic must be deterministic — use the injected _now"],
  [/\bMath\s*\.\s*random\s*\(/, "logic must be deterministic — use the seeded generator"],
  [/\bfetch\s*\(/, "logic.js has no network access"],
];

const source = await readFile(logicPath, "utf8");
// Strip comments so a rule mentioned in prose is not mistaken for real code.
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const problems = [];
for (const [pattern, why] of BANNED) {
  if (pattern.test(code)) problems.push(`${why} (matched ${pattern})`);
}

const logic = await import(logicPath);
for (const name of REQUIRED) {
  if (!(name in logic)) problems.push(`missing export: ${name}`);
}
for (const name of REQUIRED.slice(1)) {
  if (name in logic && typeof logic[name] !== "function") problems.push(`${name} must be a function`);
}

const meta = logic.meta;
if (!meta || typeof meta !== "object") {
  problems.push("meta must be an object");
} else {
  const { minPlayers, maxPlayers } = meta;
  if (!Number.isInteger(minPlayers) || minPlayers < 1) problems.push("meta.minPlayers must be an integer >= 1");
  if (!Number.isInteger(maxPlayers) || maxPlayers < 1) problems.push("meta.maxPlayers must be an integer >= 1");
  if (minPlayers > maxPlayers) problems.push("meta.minPlayers must be <= meta.maxPlayers");
  if (typeof meta.game !== "string" || !meta.game.trim()) problems.push("meta.game must be a non-empty display name");
}

if (problems.length) {
  console.error("src/logic.js does not satisfy the game contract:\n");
  for (const p of problems) console.error(`  • ${p}`);
  process.exit(1);
}

console.log(`logic.js OK — ${meta.game} (${meta.minPlayers}-${meta.maxPlayers} players)`);
