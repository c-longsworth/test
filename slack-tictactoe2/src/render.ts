/**
 * Turning a GameState into something you can look at and tap in Slack.
 *
 * The whole 9x9 grid is drawn as emoji, because emoji are the only thing in a
 * Slack message that reliably line up in a column. Buttons are then offered
 * only for the squares that are actually legal this turn — 81 buttons is a
 * wall of chrome, and Slack has no way to disable one.
 */

import type { ActionsBlock, Button, KnownBlock } from '@slack/types';
import { legalMoves, openBoards, targetBoard, type GameState, type Mark } from './game.js';

/**
 * Swap these for your workspace's own emoji if you like — they are only ever
 * rendered, never parsed.
 */
export const GLYPHS = {
  // Colour tracks the player and shape tracks it too, so the board still
  // reads if you cannot tell red from blue.
  x: ':x:',
  o: ':large_blue_circle:',
  /** An empty square you cannot play in this turn. */
  empty: ':white_large_square:',
  /** An empty square you can play in right now. */
  playable: ':yellow_square:',
  /** A sub-board claimed by X / O — the whole 3x3 fills in. */
  wonX: ':red_square:',
  wonO: ':blue_square:',
  drawnBoard: ':black_large_square:',
} as const;

export const ACTION = {
  move: 'ttt2_move',
  pickBoard: 'ttt2_pick_board',
  clearBoard: 'ttt2_clear_board',
  join: 'ttt2_join',
  resign: 'ttt2_resign',
} as const;

/** Action values carry the whole move, so handlers need no per-user state. */
export const encodeMove = (gameId: string, board: number, cell: number): string =>
  `${gameId}:${board}:${cell}`;

export const encodeBoard = (gameId: string, board: number): string => `${gameId}:${board}`;

export function decodeMove(value: string): { gameId: string; board: number; cell: number } | null {
  const parts = value.split(':');
  if (parts.length !== 3) return null;
  const [gameId, board, cell] = parts as [string, string, string];
  const b = Number(board);
  const c = Number(cell);
  if (!Number.isInteger(b) || !Number.isInteger(c)) return null;
  return { gameId, board: b, cell: c };
}

export function decodeBoard(value: string): { gameId: string; board: number } | null {
  const parts = value.split(':');
  if (parts.length !== 2) return null;
  const [gameId, board] = parts as [string, string];
  const b = Number(board);
  if (!Number.isInteger(b)) return null;
  return { gameId, board: b };
}

const mention = (userId: string): string => `<@${userId}>`;

const glyphForMark = (mark: Mark): string => (mark === 'X' ? GLYPHS.x : GLYPHS.o);

/**
 * The board, as nine lines of nine emoji.
 *
 * Sub-boards are separated by a space horizontally and a blank line
 * vertically, which is enough to read the 3x3-of-3x3 structure at a glance.
 * A claimed sub-board is filled solid with its owner's colour so the meta
 * game — the one that actually decides the match — is the thing you see first.
 */
export function renderGrid(state: GameState): string {
  const playable = new Set(legalMoves(state));
  const lines: string[] = [];

  for (let metaRow = 0; metaRow < 3; metaRow += 1) {
    if (metaRow > 0) lines.push('');
    for (let cellRow = 0; cellRow < 3; cellRow += 1) {
      const row: string[] = [];
      for (let metaCol = 0; metaCol < 3; metaCol += 1) {
        const board = metaRow * 3 + metaCol;
        const owner = state.boards[board]!;
        const group: string[] = [];
        for (let cellCol = 0; cellCol < 3; cellCol += 1) {
          const cell = cellRow * 3 + cellCol;
          group.push(glyphFor(state, board, cell, owner, playable));
        }
        row.push(group.join(''));
      }
      lines.push(row.join(' '));
    }
  }

  return lines.join('\n');
}

function glyphFor(
  state: GameState,
  board: number,
  cell: number,
  owner: GameState['boards'][number],
  playable: ReadonlySet<number>,
): string {
  if (owner === 'X') return GLYPHS.wonX;
  if (owner === 'O') return GLYPHS.wonO;
  if (owner === 'draw') return GLYPHS.drawnBoard;

  const mark = state.cells[board * 9 + cell]!;
  if (mark !== null) return glyphForMark(mark);
  return playable.has(board * 9 + cell) ? GLYPHS.playable : GLYPHS.empty;
}

function statusLine(state: GameState): string {
  if (state.status === 'awaiting_opponent') {
    return `${mention(state.players.X)} is looking for a game. Tap *Join* to play as ${GLYPHS.o}.`;
  }

  if (state.status === 'finished') {
    const outcome = state.outcome!;
    if (outcome.winner === null) {
      return outcome.reason === 'resignation'
        ? 'Game cancelled.'
        : `*Dead heat.* Four boards each, nobody blinked.`;
    }
    const winnerId = state.players[outcome.winner]!;
    switch (outcome.reason) {
      case 'line':
        return `*${mention(winnerId)} wins* with three boards in a row. ${glyphForMark(outcome.winner)}`;
      case 'squares':
        return `*${mention(winnerId)} wins on boards claimed* — no line, but the squares were there.`;
      case 'resignation':
        return `*${mention(winnerId)} wins* by resignation.`;
    }
  }

  const playerId = state.players[state.turn]!;
  const turnGlyph = glyphForMark(state.turn);
  const target = targetBoard(state);

  if (state.activeBoard !== null) {
    return `${turnGlyph} ${mention(playerId)} — you are sent to *board ${state.activeBoard + 1}*.`;
  }
  if (target !== null) {
    return `${turnGlyph} ${mention(playerId)} — *board ${target + 1}*. Pick your square.`;
  }
  return `${turnGlyph} ${mention(playerId)} — *free choice.* Pick any open board.`;
}

function subtitle(state: GameState): string {
  const parts = [`${GLYPHS.x} ${mention(state.players.X)}`];
  parts.push(state.players.O === null ? `${GLYPHS.o} _nobody yet_` : `${GLYPHS.o} ${mention(state.players.O)}`);
  if (state.lastMove) {
    parts.push(`_last: board ${state.lastMove.board + 1}, square ${state.lastMove.cell + 1}_`);
  }
  return parts.join('   ');
}

/**
 * Buttons laid out as a 3x3, one actions block per row.
 *
 * Every button is labelled with its own position (1-9, reading order), so a
 * row with squares missing is still unambiguous — the label says where it is,
 * not where it happens to sit in the row.
 */
function buttonGrid(
  actionId: string,
  entries: ReadonlyArray<{ position: number; value: string; style?: 'primary' | 'danger' }>,
): ActionsBlock[] {
  const blocks: ActionsBlock[] = [];
  for (let row = 0; row < 3; row += 1) {
    const inRow = entries.filter((e) => Math.floor(e.position / 3) === row);
    if (inRow.length === 0) continue;
    blocks.push({
      type: 'actions',
      elements: inRow.map((e): Button => ({
        type: 'button',
        action_id: `${actionId}_${e.position}`,
        text: { type: 'plain_text', text: String(e.position + 1) },
        value: e.value,
        ...(e.style ? { style: e.style } : {}),
      })),
    });
  }
  return blocks;
}

function controls(state: GameState): KnownBlock[] {
  if (state.status === 'awaiting_opponent') {
    return [{
      type: 'actions',
      elements: [
        {
          type: 'button',
          action_id: ACTION.join,
          text: { type: 'plain_text', text: 'Join this game' },
          style: 'primary',
          value: state.id,
        },
        {
          type: 'button',
          action_id: ACTION.resign,
          text: { type: 'plain_text', text: 'Cancel' },
          value: state.id,
        },
      ],
    }];
  }

  if (state.status === 'finished') return [];

  const target = targetBoard(state);

  // Free choice and no board tapped yet: choose the board first. Two taps
  // beats a single screen of eighty-one buttons.
  if (target === null) {
    const boards = openBoards(state);
    return [
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'Choose a board:' }] },
      ...buttonGrid(ACTION.pickBoard, boards.map((b) => ({
        position: b,
        value: encodeBoard(state.id, b),
      }))),
      resignRow(state),
    ];
  }

  const legal = legalMoves(state).filter((i) => Math.floor(i / 9) === target);
  const blocks: KnownBlock[] = [
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Board *${target + 1}* — choose a square:` }],
    },
    ...buttonGrid(ACTION.move, legal.map((index) => ({
      position: index % 9,
      value: encodeMove(state.id, target, index % 9),
    }))),
  ];

  if (state.activeBoard === null) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          action_id: ACTION.clearBoard,
          text: { type: 'plain_text', text: '← Different board' },
          value: state.id,
        },
        resignButton(state),
      ],
    });
    return blocks;
  }

  blocks.push(resignRow(state));
  return blocks;
}

const resignButton = (state: GameState): Button => ({
  type: 'button',
  action_id: ACTION.resign,
  text: { type: 'plain_text', text: 'Resign' },
  style: 'danger',
  value: state.id,
});

const resignRow = (state: GameState): ActionsBlock => ({
  type: 'actions',
  elements: [resignButton(state)],
});

/** Fallback text for notifications and anywhere blocks are not rendered. */
export function fallbackText(state: GameState): string {
  if (state.status === 'awaiting_opponent') return 'Tic Tac Toe² — waiting for a second player';
  if (state.status === 'finished') {
    const winner = state.outcome?.winner;
    if (!winner) return 'Tic Tac Toe² — drawn';
    return `Tic Tac Toe² — ${winner} wins`;
  }
  return `Tic Tac Toe² — ${state.turn} to play`;
}

export function renderGame(state: GameState): { text: string; blocks: KnownBlock[] } {
  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Tic Tac Toe²*\n${subtitle(state)}` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: renderGrid(state) },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: statusLine(state) },
    },
    ...controls(state),
    {
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `Win a board to claim its square · move ${state.moves.length} · \`${state.id}\``,
      }],
    },
  ];

  return { text: fallbackText(state), blocks };
}
