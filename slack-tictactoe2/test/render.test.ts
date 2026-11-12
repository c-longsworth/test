import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGame, legalMoves, pickBoard, resign, type GameState } from '../src/game.js';
import {
  ACTION,
  decodeBoard,
  decodeMove,
  encodeBoard,
  encodeMove,
  GLYPHS,
  renderGame,
  renderGrid,
} from '../src/render.js';
import { fresh, play, stateWith, X } from './helpers.js';

const gridLines = (state: GameState): string[] => renderGrid(state).split('\n');

/** The square buttons on offer, in the order a player reads them. */
function moveButtons(rendered: { blocks: unknown[] }): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  for (const block of rendered.blocks as Array<Record<string, any>>) {
    if (block['type'] !== 'actions') continue;
    for (const element of block['elements'] as Array<Record<string, any>>) {
      if (String(element['action_id']).startsWith(ACTION.move)) {
        out.push({ label: element['text'].text as string, value: element['value'] as string });
      }
    }
  }
  return out;
}

/** Slack's documented Block Kit limits. Breaking one means a message that will not post. */
function assertWithinSlackLimits(rendered: { text: string; blocks: unknown[] }): void {
  assert.ok(rendered.blocks.length <= 50, `${rendered.blocks.length} blocks exceeds Slack's 50`);
  assert.ok(rendered.text.length > 0, 'a message needs fallback text');

  const actionIds = new Set<string>();
  for (const block of rendered.blocks as Array<Record<string, any>>) {
    if (block['type'] === 'section') {
      assert.ok(block['text'].text.length <= 3000, 'section text exceeds 3000 characters');
    }
    if (block['type'] !== 'actions') continue;
    assert.ok(block['elements'].length <= 25, 'an actions block exceeds 25 elements');
    for (const element of block['elements'] as Array<Record<string, any>>) {
      const id = element['action_id'] as string;
      assert.ok(!actionIds.has(id), `duplicate action_id ${id} in one message`);
      actionIds.add(id);
      assert.ok(element['text'].text.length <= 75, 'button text exceeds 75 characters');
      assert.ok((element['value'] as string).length <= 2000, 'button value exceeds 2000 characters');
    }
  }
}

describe('the grid', () => {
  it('is nine rows of nine, in three groups', () => {
    const lines = gridLines(fresh());
    assert.equal(lines.length, 11, 'nine rows plus two blank separators');
    assert.equal(lines[3], '');
    assert.equal(lines[7], '');

    const rows = lines.filter((l) => l !== '');
    assert.equal(rows.length, 9);
    for (const row of rows) {
      assert.equal(row.split(' ').length, 3, 'three sub-boards per row');
      assert.equal(row.replace(/ /g, '').match(/:[a-z_0-9]+:/g)?.length, 9);
    }
  });

  it('highlights exactly the squares that are legal right now', () => {
    const state = play(fresh(), [[4, 7]]);
    const highlighted = (renderGrid(state).match(new RegExp(GLYPHS.playable, 'g')) ?? []).length;
    assert.equal(highlighted, legalMoves(state).length);
    assert.equal(highlighted, 9, 'forced into one board, so nine squares');
  });

  it('shows every empty square as playable on the opening move', () => {
    const highlighted = (renderGrid(fresh()).match(new RegExp(GLYPHS.playable, 'g')) ?? []).length;
    assert.equal(highlighted, 81);
  });

  it('draws played squares with their own mark', () => {
    const state = play(fresh(), [[4, 4], [4, 0]]);
    const grid = renderGrid(state);
    assert.ok(grid.includes(GLYPHS.x));
    assert.ok(grid.includes(GLYPHS.o));
  });

  it('fills a claimed sub-board solid, so the meta game reads first', () => {
    const state = stateWith({ boards: { 4: 'X', 0: 'O', 8: 'draw' }, turn: 'X' });
    const grid = renderGrid(state);
    assert.equal((grid.match(new RegExp(GLYPHS.wonX, 'g')) ?? []).length, 9);
    assert.equal((grid.match(new RegExp(GLYPHS.wonO, 'g')) ?? []).length, 9);
    assert.equal((grid.match(new RegExp(GLYPHS.drawnBoard, 'g')) ?? []).length, 9);
  });

  it('highlights nothing once the game is over', () => {
    const over = resign(fresh(), X);
    assert.equal(over.ok, true);
    if (!over.ok) return;
    assert.ok(!renderGrid(over.value).includes(GLYPHS.playable));
  });
});

describe('controls', () => {
  it('offers a Join button while the game is open', () => {
    const open = createGame({ id: 'g', channel: 'C1', challenger: X });
    const rendered = renderGame(open);
    assertWithinSlackLimits(rendered);
    const ids = JSON.stringify(rendered.blocks);
    assert.ok(ids.includes(ACTION.join));
    assert.ok(!ids.includes(ACTION.move), 'nothing to play yet');
  });

  it('offers a board picker on a free turn, not eighty-one squares', () => {
    const rendered = renderGame(fresh());
    assertWithinSlackLimits(rendered);
    const buttons = (JSON.stringify(rendered.blocks).match(new RegExp(ACTION.pickBoard, 'g')) ?? []).length;
    assert.equal(buttons, 9, 'one button per open board');
    assert.ok(!JSON.stringify(rendered.blocks).includes(ACTION.move));
  });

  it('offers squares once a board is settled on', () => {
    const picked = pickBoard(fresh(), X, 5);
    assert.equal(picked.ok, true);
    if (!picked.ok) return;

    const rendered = renderGame(picked.value);
    assertWithinSlackLimits(rendered);
    const json = JSON.stringify(rendered.blocks);
    assert.equal((json.match(new RegExp(`${ACTION.move}_\\d`, 'g')) ?? []).length, 9);
    assert.ok(json.includes(ACTION.clearBoard), 'a free turn can be taken back');
  });

  it('labels every square with its own position, so a gappy row still reads', () => {
    // Squares 1, 2 and 5 of board 3 are gone; the rest keep their own numbers.
    const state = stateWith({
      cells: { 18: 'X', 19: 'O', 22: 'X' },
      turn: 'X',
      activeBoard: 2,
    });
    const labels = moveButtons(renderGame(state)).map((b) => b.label);
    assert.deepEqual(labels, ['3', '4', '6', '7', '8', '9']);
    assert.deepEqual(
      moveButtons(renderGame(state)).map((b) => b.value),
      ['test01:2:2', 'test01:2:3', 'test01:2:5', 'test01:2:6', 'test01:2:7', 'test01:2:8'],
    );
  });

  it('offers no way back when the board was forced', () => {
    const state = play(fresh(), [[4, 7]]);
    const json = JSON.stringify(renderGame(state).blocks);
    assert.ok(json.includes(ACTION.move));
    assert.ok(!json.includes(ACTION.clearBoard), 'there is no choice to undo');
  });

  it('only offers squares that are free', () => {
    const forced = stateWith({
      cells: { 36: 'X', 40: 'O', 44: 'X' },
      turn: 'O',
      activeBoard: 4,
    });
    assert.equal(moveButtons(renderGame(forced)).length, legalMoves(forced).length);
    assert.equal(moveButtons(renderGame(forced)).length, 6);
  });

  it('clears the controls when the game ends', () => {
    const state = stateWith({
      boards: { 0: 'X', 1: 'X' },
      cells: { 18: 'X', 19: 'X' },
      turn: 'X',
      activeBoard: 2,
    });
    const won = play(state, [[2, 2]]);
    const rendered = renderGame(won);
    assertWithinSlackLimits(rendered);
    const json = JSON.stringify(rendered.blocks);
    assert.ok(!json.includes('"actions"'), 'a finished game has nothing to tap');
    assert.ok(json.includes('wins'));
  });

  it('stays inside Slack limits across 60 random positions', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      let state = fresh();
      let steps = seed % 40;
      while (steps > 0 && state.status === 'in_progress') {
        const legal = legalMoves(state);
        const pick = legal[(seed * steps) % legal.length]!;
        state = play(state, [[Math.floor(pick / 9), pick % 9]]);
        steps -= 1;
      }
      assertWithinSlackLimits(renderGame(state));
    }
  });
});

describe('action payloads', () => {
  it('round-trips a move', () => {
    assert.deepEqual(decodeMove(encodeMove('abc123', 4, 7)), { gameId: 'abc123', board: 4, cell: 7 });
  });

  it('round-trips a board pick', () => {
    assert.deepEqual(decodeBoard(encodeBoard('abc123', 8)), { gameId: 'abc123', board: 8 });
  });

  it('rejects anything malformed rather than guessing', () => {
    for (const bad of ['', 'abc', 'abc:1', 'abc:1:2:3', 'abc:x:2', 'abc:1:y']) {
      assert.equal(decodeMove(bad), null, `decodeMove accepted ${bad}`);
    }
    for (const bad of ['', 'abc', 'abc:1:2', 'abc:z']) {
      assert.equal(decodeBoard(bad), null, `decodeBoard accepted ${bad}`);
    }
  });
});
