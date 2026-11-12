/**
 * Tic Tac Toe² — the rules engine. No Slack in here, on purpose: the whole
 * game is a pure function of (state, move), which is what makes it testable
 * without a workspace to click in.
 *
 * Indexing, used everywhere:
 *   board 0..8   the nine sub-boards, reading order (top-left = 0, bottom-right = 8)
 *   cell  0..8   a square inside a sub-board, same reading order
 *   index 0..80  board * 9 + cell
 *
 * The cell you play in decides which sub-board your opponent plays in next.
 * Play cell 4 (centre) and they must play in board 4 (the centre board). That
 * one sentence is the whole game.
 */

export type Mark = 'X' | 'O';

/** What is in a single square. */
export type CellMark = Mark | null;

/** Who has claimed a sub-board. `'draw'` means nobody ever will. */
export type BoardOwner = Mark | 'draw' | null;

export type GameStatus = 'awaiting_opponent' | 'in_progress' | 'finished';

export type OutcomeReason = 'line' | 'squares' | 'draw' | 'resignation';

export interface Outcome {
  winner: Mark | null;
  reason: OutcomeReason;
  /** The three sub-boards that won it, when `reason` is `'line'`. */
  line: readonly [number, number, number] | null;
}

export interface Move {
  board: number;
  cell: number;
  mark: Mark;
}

export interface GameState {
  id: string;
  /** 81 squares. */
  cells: readonly CellMark[];
  /** 9 sub-board owners. */
  boards: readonly BoardOwner[];
  turn: Mark;
  /**
   * The sub-board the current player is forced into, or null when the last
   * move sent them to a board that is already decided — then they may play
   * anywhere.
   */
  activeBoard: number | null;
  /**
   * Only used when `activeBoard` is null: which board the current player has
   * tapped, before they tap a square in it. Purely a UI affordance — picking
   * a board commits them to nothing.
   */
  pendingBoard: number | null;
  players: { X: string; O: string | null };
  status: GameStatus;
  outcome: Outcome | null;
  lastMove: Move | null;
  moves: readonly Move[];
  channel: string;
  /** Message timestamp, once the board has been posted. */
  ts: string | null;
  createdAt: number;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const err = (error: string): Result<never> => ({ ok: false, error });

/** The eight three-in-a-rows, used for both the sub-boards and the meta board. */
export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export const other = (mark: Mark): Mark => (mark === 'X' ? 'O' : 'X');

export const isDecided = (owner: BoardOwner): boolean => owner !== null;

export const indexOf = (board: number, cell: number): number => board * 9 + cell;

const inRange = (n: number): boolean => Number.isInteger(n) && n >= 0 && n <= 8;

export function createGame(opts: {
  id: string;
  channel: string;
  challenger: string;
  opponent?: string | null;
  now?: number;
}): GameState {
  const opponent = opts.opponent ?? null;
  return {
    id: opts.id,
    cells: Array.from({ length: 81 }, () => null),
    boards: Array.from({ length: 9 }, () => null),
    turn: 'X',
    // The opening move goes anywhere.
    activeBoard: null,
    pendingBoard: null,
    // Whoever threw down the challenge is X and moves first.
    players: { X: opts.challenger, O: opponent },
    status: opponent === null ? 'awaiting_opponent' : 'in_progress',
    outcome: null,
    lastMove: null,
    moves: [],
    channel: opts.channel,
    ts: null,
    createdAt: opts.now ?? Date.now(),
  };
}

export function markOf(state: GameState, userId: string): Mark | null {
  if (state.players.X === userId) return 'X';
  if (state.players.O === userId) return 'O';
  return null;
}

export function currentPlayerId(state: GameState): string | null {
  return state.players[state.turn];
}

/** The sub-board whose squares the current player can tap right now. */
export function targetBoard(state: GameState): number | null {
  return state.activeBoard ?? state.pendingBoard;
}

/** Sub-boards that are still open to play in. */
export function openBoards(state: GameState): number[] {
  const out: number[] = [];
  for (let b = 0; b < 9; b += 1) {
    if (!isDecided(state.boards[b]!) && boardCells(state, b).some((c) => c === null)) out.push(b);
  }
  return out;
}

export function boardCells(state: GameState, board: number): CellMark[] {
  return state.cells.slice(board * 9, board * 9 + 9) as CellMark[];
}

/**
 * Every square the current player could legally play, as global indices.
 * Note this ignores `pendingBoard` — a board tapped in the UI is not a
 * commitment, so it never narrows what is legal.
 */
export function legalMoves(state: GameState): number[] {
  if (state.status !== 'in_progress') return [];
  const boards = state.activeBoard !== null ? [state.activeBoard] : openBoards(state);
  const out: number[] = [];
  for (const b of boards) {
    if (isDecided(state.boards[b]!)) continue;
    for (let c = 0; c < 9; c += 1) {
      if (state.cells[indexOf(b, c)] === null) out.push(indexOf(b, c));
    }
  }
  return out;
}

/** Winner, draw, or still open — for one set of nine squares. */
export function evaluateBoard(cells: readonly CellMark[]): BoardOwner {
  for (const [a, b, c] of LINES) {
    const v = cells[a];
    if (v !== null && v === cells[b] && v === cells[c]) return v!;
  }
  return cells.some((cell) => cell === null) ? null : 'draw';
}

/** A line of three claimed sub-boards wins the game. A drawn board claims nothing. */
export function metaLine(boards: readonly BoardOwner[]): { winner: Mark; line: readonly [number, number, number] } | null {
  for (const line of LINES) {
    const [a, b, c] = line;
    const v = boards[a];
    if (v !== null && v !== undefined && v !== 'draw' && v === boards[b] && v === boards[c]) {
      return { winner: v, line };
    }
  }
  return null;
}

export function countClaimed(boards: readonly BoardOwner[], mark: Mark): number {
  return boards.filter((owner) => owner === mark).length;
}

/**
 * Has the game ended?
 *
 * A line of three claimed boards ends it outright. Otherwise, once every board
 * is decided, the player holding more squares takes it — a house rule, but a
 * better ending than "all 81 squares played, nobody wins". Equal squares is a
 * genuine draw. See README to make it a strict draw instead.
 */
export function resolveOutcome(boards: readonly BoardOwner[]): Outcome | null {
  const line = metaLine(boards);
  if (line) return { winner: line.winner, reason: 'line', line: line.line };

  if (boards.every((owner) => isDecided(owner))) {
    const x = countClaimed(boards, 'X');
    const o = countClaimed(boards, 'O');
    if (x === o) return { winner: null, reason: 'draw', line: null };
    return { winner: x > o ? 'X' : 'O', reason: 'squares', line: null };
  }

  return null;
}

export function joinGame(state: GameState, userId: string): Result<GameState> {
  if (state.status !== 'awaiting_opponent') return err('That game already has two players.');
  if (state.players.X === userId) return err('You cannot play yourself — wait for a challenger.');
  return ok({
    ...state,
    players: { ...state.players, O: userId },
    status: 'in_progress',
  });
}

/** Tapping a sub-board when the player has a free choice. Reversible. */
export function pickBoard(state: GameState, userId: string, board: number): Result<GameState> {
  if (state.status !== 'in_progress') return err('That game is not running.');
  if (markOf(state, userId) === null) return err('You are not in this game.');
  if (currentPlayerId(state) !== userId) return err('Not your turn.');
  if (state.activeBoard !== null) return err('You do not get to choose a board this turn.');
  if (!inRange(board)) return err('No such board.');
  if (isDecided(state.boards[board]!)) return err('That board is already decided.');
  return ok({ ...state, pendingBoard: board });
}

export function clearPendingBoard(state: GameState, userId: string): Result<GameState> {
  if (currentPlayerId(state) !== userId) return err('Not your turn.');
  return ok({ ...state, pendingBoard: null });
}

export function applyMove(
  state: GameState,
  userId: string,
  board: number,
  cell: number,
): Result<GameState> {
  if (state.status === 'awaiting_opponent') return err('That game is still waiting for a second player.');
  if (state.status === 'finished') return err('That game is over.');
  if (!inRange(board) || !inRange(cell)) return err('No such square.');

  const mark = markOf(state, userId);
  if (mark === null) return err('You are not in this game. Start your own with `/ttt2`.');
  if (state.turn !== mark) return err('Not your turn.');

  if (state.activeBoard !== null && state.activeBoard !== board) {
    return err(`You have to play in board ${state.activeBoard + 1} this turn.`);
  }
  if (isDecided(state.boards[board]!)) return err('That board is already decided.');
  if (state.cells[indexOf(board, cell)] !== null) return err('That square is taken.');

  const cells = [...state.cells];
  cells[indexOf(board, cell)] = mark;

  const boards = [...state.boards];
  // Only the board just played in can have changed hands.
  boards[board] = evaluateBoard(cells.slice(board * 9, board * 9 + 9));

  const outcome = resolveOutcome(boards);
  const move: Move = { board, cell, mark };

  // The square played decides the opponent's board — unless that board is
  // already settled, in which case they get a free choice.
  const sentTo = cell;
  const nextActive = isDecided(boards[sentTo]!) ? null : sentTo;

  return ok({
    ...state,
    cells,
    boards,
    turn: other(mark),
    activeBoard: outcome ? null : nextActive,
    pendingBoard: null,
    status: outcome ? 'finished' : 'in_progress',
    outcome,
    lastMove: move,
    moves: [...state.moves, move],
  });
}

export function resign(state: GameState, userId: string): Result<GameState> {
  if (state.status === 'finished') return err('That game is already over.');
  const mark = markOf(state, userId);
  if (mark === null) return err('You are not in this game.');
  if (state.status === 'awaiting_opponent') {
    return ok({
      ...state,
      status: 'finished',
      outcome: { winner: null, reason: 'resignation', line: null },
    });
  }
  return ok({
    ...state,
    status: 'finished',
    pendingBoard: null,
    outcome: { winner: other(mark), reason: 'resignation', line: null },
  });
}
