import {
  applyMove,
  createGame,
  type BoardOwner,
  type CellMark,
  type GameState,
  type Mark,
} from '../src/game.js';

export const X = 'U_X';
export const O = 'U_O';

export function fresh(): GameState {
  return createGame({ id: 'test01', channel: 'C1', challenger: X, opponent: O, now: 0 });
}

/** Play a sequence of [board, cell] as alternating players, failing loudly. */
export function play(state: GameState, moves: ReadonlyArray<readonly [number, number]>): GameState {
  let current = state;
  for (const [i, [board, cell]] of moves.entries()) {
    const userId = current.turn === 'X' ? X : O;
    const result = applyMove(current, userId, board, cell);
    if (!result.ok) {
      throw new Error(`move ${i + 1} (board ${board}, cell ${cell}) rejected: ${result.error}`);
    }
    current = result.value;
  }
  return current;
}

/**
 * Build a position directly. The engine is a pure function of state, so
 * handing it a crafted state is a legitimate way to test an endgame without
 * playing forty legal moves to reach it.
 */
export function stateWith(overrides: {
  boards?: Partial<Record<number, BoardOwner>>;
  cells?: Partial<Record<number, CellMark>>;
  turn?: Mark;
  activeBoard?: number | null;
  pendingBoard?: number | null;
}): GameState {
  const base = fresh();
  const boards: BoardOwner[] = Array.from({ length: 9 }, (_, i) => overrides.boards?.[i] ?? null);
  const cells: CellMark[] = Array.from({ length: 81 }, (_, i) => overrides.cells?.[i] ?? null);

  // A claimed board must look played-out, or legalMoves would offer its squares.
  for (let b = 0; b < 9; b += 1) {
    if (boards[b] === null) continue;
    for (let c = 0; c < 9; c += 1) {
      if (cells[b * 9 + c] === null) cells[b * 9 + c] = boards[b] === 'draw' ? 'X' : (boards[b] as Mark);
    }
  }

  return {
    ...base,
    boards,
    cells,
    turn: overrides.turn ?? 'X',
    activeBoard: overrides.activeBoard === undefined ? null : overrides.activeBoard,
    pendingBoard: overrides.pendingBoard ?? null,
  };
}

/** Deterministic PRNG, so a failing fuzz case is a failing case every time. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
