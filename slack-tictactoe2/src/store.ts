/**
 * Where games live.
 *
 * In-memory and process-local: restart the app and games in flight are gone,
 * which is why the handlers tell you that plainly instead of pretending the
 * board never existed. That is a fine trade for a game you play in an
 * afternoon; see README for swapping in something durable.
 */

import type { GameState } from './game.js';

export interface GameStore {
  get(id: string): GameState | undefined;
  save(state: GameState): void;
  delete(id: string): void;
  size(): number;
}

export interface MemoryStoreOptions {
  /** Games untouched for this long are dropped. Default 24 hours. */
  ttlMs?: number;
  /** Hard cap, so a busy channel cannot grow the process without bound. */
  maxGames?: number;
  now?: () => number;
}

export function createMemoryStore(options: MemoryStoreOptions = {}): GameStore {
  const ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
  const maxGames = options.maxGames ?? 500;
  const now = options.now ?? (() => Date.now());

  const games = new Map<string, { state: GameState; touchedAt: number }>();

  const evict = (): void => {
    const cutoff = now() - ttlMs;
    for (const [id, entry] of games) {
      if (entry.touchedAt < cutoff) games.delete(id);
    }
    // Map preserves insertion order, and `save` re-inserts, so the first keys
    // are the least recently touched.
    while (games.size > maxGames) {
      const oldest = games.keys().next();
      if (oldest.done) break;
      games.delete(oldest.value);
    }
  };

  return {
    get(id) {
      const entry = games.get(id);
      if (!entry) return undefined;
      if (entry.touchedAt < now() - ttlMs) {
        games.delete(id);
        return undefined;
      }
      return entry.state;
    },
    save(state) {
      games.delete(state.id);
      games.set(state.id, { state, touchedAt: now() });
      evict();
    },
    delete(id) {
      games.delete(id);
    },
    size() {
      return games.size;
    },
  };
}

/** Short, pronounceable, and unambiguous when read off a screen. */
export function newGameId(random: () => number = Math.random): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[Math.floor(random() * alphabet.length)];
  }
  return out;
}
