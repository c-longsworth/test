/**
 * `npm run demo` — play a random game out in the terminal.
 *
 * Here so you can see the rules working before you have an app token, a
 * workspace, or anyone to play against. The emoji map is demo-only: Slack
 * renders the shortcodes itself.
 */

import { applyMove, legalMoves, createGame, type GameState } from './game.js';
import { renderGrid } from './render.js';

const EMOJI: Record<string, string> = {
  ':x:': '❌',
  ':large_blue_circle:': '🔵',
  ':white_large_square:': '⬜',
  ':yellow_square:': '🟨',
  ':red_square:': '🟥',
  ':blue_square:': '🟦',
  ':black_large_square:': '⬛',
};

const asEmoji = (text: string): string => text.replace(/:[a-z_0-9]+:/g, (m) => EMOJI[m] ?? m);

const seed = Number(process.argv[2] ?? Date.now() % 100000);
let s = seed >>> 0;
const random = (): number => {
  s = (s * 1664525 + 1013904223) >>> 0;
  return s / 0x100000000;
};

let game: GameState = createGame({
  id: 'demo',
  channel: 'terminal',
  challenger: 'Ada',
  opponent: 'Grace',
});

console.log(`Tic Tac Toe² — random game, seed ${seed}\n`);

while (game.status === 'in_progress') {
  const legal = legalMoves(game);
  const pick = legal[Math.floor(random() * legal.length)]!;
  const board = Math.floor(pick / 9);
  const cell = pick % 9;
  const player = game.turn === 'X' ? 'Ada' : 'Grace';
  const wasFree = game.activeBoard === null;

  const result = applyMove(game, player, board, cell);
  if (!result.ok) throw new Error(`engine offered an illegal move: ${result.error}`);
  game = result.value;

  const claimed = game.boards[board] !== null ? `  ← claims board ${board + 1}` : '';
  console.log(
    `${String(game.moves.length).padStart(2)}. ${player.padEnd(5)} ` +
    `board ${board + 1} square ${cell + 1}${wasFree ? ' (free choice)' : ''}${claimed}`,
  );
}

console.log(`\n${asEmoji(renderGrid(game))}\n`);

const outcome = game.outcome!;
const name = outcome.winner === 'X' ? 'Ada' : 'Grace';
switch (outcome.reason) {
  case 'line':
    console.log(`${name} wins — boards ${outcome.line!.map((b) => b + 1).join(', ')} in a row.`);
    break;
  case 'squares':
    console.log(`${name} wins on boards claimed. No line, but more of the board.`);
    break;
  default:
    console.log('Drawn.');
}
