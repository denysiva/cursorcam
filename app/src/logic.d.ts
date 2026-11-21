/**
 * Types for the `logic.js` contract — the six exports the room calls.
 *
 * `logic.js` stays plain JavaScript on purpose: it must contain no imports and
 * no timers, and keeping it dependency- and syntax-light means the platform's
 * build check can load it directly. This declaration file is what gives the
 * room type-checking anyway.
 *
 * Every function is PURE: same inputs → same outputs. Time and randomness are
 * injected by the room as `_now` / `_rand` on the action.
 */

/** Static description of the game, read by the room and sent to clients. */
export const meta: {
  game: string;
  minPlayers: number;
  maxPlayers: number;
};

/** The persisted room state. Opaque to the room except for the bits below. */
export interface LogicState {
  phase: "lobby" | "play" | "over";
  players: Record<string, { id: string; online: boolean }>;
  game: { endsAt: number | null } | null;
}

/** A fresh room: an empty lobby. */
export function setup(players?: string[]): LogicState;

export function validateAction(
  state: LogicState,
  playerId: string,
  action: unknown,
): { ok: true } | { ok: false; error?: string };

export function applyAction(state: LogicState, playerId: string, action: unknown): LogicState;

export function isGameOver(state: LogicState): { over: false };

/** What `playerId` is allowed to see — the key never leaves here for Seekers. */
export function viewFor(state: LogicState, playerId: string): unknown;
