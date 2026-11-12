import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyMove,
  clearPendingBoard,
  countClaimed,
  createGame,
  evaluateBoard,
  joinGame,
  legalMoves,
  metaLine,
  openBoards,
  pickBoard,
  resign,
  resolveOutcome,
  type BoardOwner,
  type CellMark,
} from '../src/game.js';
import { fresh, lcg, O, play, stateWith, X } from './helpers.js';

const board = (spec: string): CellMark[] =>
  [...spec].map((ch) => (ch === 'X' ? 'X' : ch === 'O' ? 'O' : null));

describe('evaluateBoard', () => {
  it('finds a row, a column and a diagonal', () => {
    assert.equal(evaluateBoard(board('XXX......')), 'X');
    assert.equal(evaluateBoard(board('O..O..O..')), 'O');
    assert.equal(evaluateBoard(board('X...X...X')), 'X');
    assert.equal(evaluateBoard(board('..X.X.X..')), 'X');
  });

  it('leaves an unfinished board open', () => {
    assert.equal(evaluateBoard(board('XO.......')), null);
  });

  it('calls a full board with no line a draw', () => {
    assert.equal(evaluateBoard(board('XXOOOXXOX')), 'draw');
  });
});

describe('the meta board', () => {
  const owners = (spec: string): BoardOwner[] =>
    [...spec].map((ch) => (ch === 'X' ? 'X' : ch === 'O' ? 'O' : ch === 'd' ? 'draw' : null));

  it('wins on three claimed boards in a line', () => {
    const line = metaLine(owners('XXX......'));
    assert.deepEqual(line, { winner: 'X', line: [0, 1, 2] });
  });

  it('does not let a drawn board complete a line', () => {
    assert.equal(metaLine(owners('XdX......')), null);
  });

  it('counts claimed boards, ignoring draws', () => {
    const b = owners('XXOddO...');
    assert.equal(countClaimed(b, 'X'), 2);
    assert.equal(countClaimed(b, 'O'), 2);
  });

  describe('resolveOutcome', () => {
    it('is undecided while a board is still open', () => {
      assert.equal(resolveOutcome(owners('XO.......')), null);
    });

    it('awards a line outright', () => {
      assert.deepEqual(resolveOutcome(owners('XXXOO.d..')), {
        winner: 'X', reason: 'line', line: [0, 1, 2],
      });
    });

    it('falls back to boards claimed once everything is settled', () => {
      // No line anywhere, X holds four boards to O's three.
      const outcome = resolveOutcome(owners('XOXOXOdXd'));
      assert.deepEqual(outcome, { winner: 'X', reason: 'squares', line: null });
    });

    it('is a genuine draw on equal boards', () => {
      assert.deepEqual(resolveOutcome(owners('XOXOXOOXd')), {
        winner: null, reason: 'draw', line: null,
      });
    });
  });
});

describe('opening position', () => {
  it('gives X a free first move anywhere', () => {
    const state = fresh();
    assert.equal(state.turn, 'X');
    assert.equal(state.activeBoard, null);
    assert.equal(legalMoves(state).length, 81);
  });

  it('waits for a second player when nobody was challenged', () => {
    const state = createGame({ id: 'g', channel: 'C1', challenger: X });
    assert.equal(state.status, 'awaiting_opponent');
    assert.equal(legalMoves(state).length, 0);

    const rejected = applyMove(state, X, 0, 0);
    assert.equal(rejected.ok, false);
  });
});

describe('the forcing rule — the whole game', () => {
  it('sends the opponent to the board matching the square just played', () => {
    const after = play(fresh(), [[4, 7]]);
    assert.equal(after.activeBoard, 7, 'playing square 8 of a board sends you to board 8');
    assert.equal(after.turn, 'O');
  });

  it('refuses a move outside the forced board', () => {
    const state = play(fresh(), [[4, 7]]);
    const rejected = applyMove(state, O, 3, 0);
    assert.equal(rejected.ok, false);
    assert.match(rejected.ok ? '' : rejected.error, /board 8/);
  });

  it('narrows legal moves to the forced board', () => {
    const state = play(fresh(), [[4, 7]]);
    const legal = legalMoves(state);
    assert.equal(legal.length, 9);
    assert.ok(legal.every((i) => Math.floor(i / 9) === 7));
  });

  it('grants a free choice when sent to a board that is already decided', () => {
    // O takes board 0 on the 2-4-6 diagonal, bouncing X around the board
    // between each of its moves.
    const won = play(fresh(), [
      [0, 0], [0, 4],
      [4, 0], [0, 8],
      [8, 0], [0, 2],
      [2, 0], [0, 6],
    ]);
    assert.equal(won.boards[0], 'O', 'O should have claimed board 0');
    assert.equal(won.activeBoard, 6, 'the winning square was 7, so X goes to board 7');

    // X now plays square 1, which would send O to board 0 — already claimed.
    const free = play(won, [[6, 0]]);
    assert.equal(free.activeBoard, null);
    assert.ok(legalMoves(free).length > 9, 'a free choice spans several boards');
    assert.ok(
      legalMoves(free).every((i) => Math.floor(i / 9) !== 0),
      'a decided board is never playable again',
    );
    assert.ok(!openBoards(free).includes(0));
  });
});

describe('rejected moves', () => {
  it('will not let the wrong player move', () => {
    const result = applyMove(fresh(), O, 0, 0);
    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.error, /Not your turn/);
  });

  it('will not let a bystander move', () => {
    const result = applyMove(fresh(), 'U_SOMEONE_ELSE', 0, 0);
    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.error, /not in this game/);
  });

  it('will not reuse a square', () => {
    const state = play(fresh(), [[4, 4]]);
    const result = applyMove(state, O, 4, 4);
    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.error, /taken/);
  });

  it('will not play in a decided board', () => {
    const state = stateWith({ boards: { 3: 'X' }, turn: 'X', activeBoard: null });
    const result = applyMove(state, X, 3, 0);
    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.error, /already decided/);
  });

  it('rejects coordinates off the board', () => {
    for (const [b, c] of [[9, 0], [0, 9], [-1, 0], [0, 1.5]] as const) {
      assert.equal(applyMove(fresh(), X, b, c).ok, false, `${b},${c} should be rejected`);
    }
  });

  it('leaves the original state untouched when a move is rejected', () => {
    const state = play(fresh(), [[4, 4]]);
    const before = JSON.stringify(state);
    applyMove(state, O, 4, 4);
    applyMove(state, X, 0, 0);
    assert.equal(JSON.stringify(state), before);
  });
});

describe('claiming boards and winning', () => {
  it('claims a sub-board the moment it is won', () => {
    const state = play(fresh(), [
      [0, 0], [0, 4],
      [4, 0], [0, 8],
      [8, 0], [0, 2],
      [2, 0], [0, 6],
    ]);
    assert.equal(state.boards[0], 'O');
    assert.equal(state.status, 'in_progress', 'one board is not the match');
  });

  it('ends the match on three claimed boards in a row', () => {
    // X holds boards 0 and 1 and is one square from taking board 2.
    const state = stateWith({
      boards: { 0: 'X', 1: 'X' },
      cells: { 18: 'X', 19: 'X' },
      turn: 'X',
      activeBoard: 2,
    });

    const result = applyMove(state, X, 2, 2);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.value.status, 'finished');
    assert.deepEqual(result.value.outcome, { winner: 'X', reason: 'line', line: [0, 1, 2] });
    assert.equal(legalMoves(result.value).length, 0);
  });

  it('refuses any further move once the match is over', () => {
    const state = stateWith({
      boards: { 0: 'X', 1: 'X' },
      cells: { 18: 'X', 19: 'X' },
      turn: 'X',
      activeBoard: 2,
    });
    const won = applyMove(state, X, 2, 2);
    assert.equal(won.ok, true);
    if (!won.ok) return;

    const after = applyMove(won.value, O, 3, 0);
    assert.equal(after.ok, false);
    assert.match(after.ok ? '' : after.error, /over/);
  });

  it('decides a lineless finish on boards claimed', () => {
    // Eight boards settled with no line available; X takes the last one and
    // leads 4-3 on boards.
    const state = stateWith({
      boards: { 0: 'X', 1: 'O', 2: 'X', 3: 'O', 4: 'X', 5: 'O', 6: 'draw', 7: null, 8: 'draw' },
      cells: { 63: 'X', 64: 'X' },
      turn: 'X',
      activeBoard: 7,
    });

    const result = applyMove(state, X, 7, 2);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.value.boards[7], 'X');
    assert.deepEqual(result.value.outcome, { winner: 'X', reason: 'squares', line: null });
  });
});

describe('picking a board on a free turn', () => {
  it('narrows the buttons without committing the player', () => {
    const state = fresh();
    const picked = pickBoard(state, X, 5);
    assert.equal(picked.ok, true);
    if (!picked.ok) return;

    assert.equal(picked.value.pendingBoard, 5);
    assert.equal(
      legalMoves(picked.value).length, 81,
      'a tapped board is a UI hint, not a commitment — everything is still legal',
    );

    const cleared = clearPendingBoard(picked.value, X);
    assert.equal(cleared.ok, true);
    if (!cleared.ok) return;
    assert.equal(cleared.value.pendingBoard, null);
  });

  it('is not offered when the player is forced', () => {
    const state = play(fresh(), [[4, 7]]);
    const result = pickBoard(state, O, 3);
    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.error, /do not get to choose/);
  });

  it('clears once a move is played', () => {
    const picked = pickBoard(fresh(), X, 5);
    assert.equal(picked.ok, true);
    if (!picked.ok) return;
    const moved = play(picked.value, [[5, 0]]);
    assert.equal(moved.pendingBoard, null);
  });

  it('refuses a decided board and the wrong player', () => {
    const state = stateWith({ boards: { 2: 'O' }, turn: 'X', activeBoard: null });
    assert.equal(pickBoard(state, X, 2).ok, false);
    assert.equal(pickBoard(state, O, 1).ok, false);
  });
});

describe('joining and resigning', () => {
  it('seats the second player', () => {
    const open = createGame({ id: 'g', channel: 'C1', challenger: X });
    const joined = joinGame(open, O);
    assert.equal(joined.ok, true);
    if (!joined.ok) return;
    assert.equal(joined.value.players.O, O);
    assert.equal(joined.value.status, 'in_progress');
  });

  it('will not seat the challenger against themselves', () => {
    const open = createGame({ id: 'g', channel: 'C1', challenger: X });
    assert.equal(joinGame(open, X).ok, false);
  });

  it('will not seat a third player', () => {
    assert.equal(joinGame(fresh(), 'U_THIRD').ok, false);
  });

  it('hands the win to the other player', () => {
    const result = resign(fresh(), X);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.status, 'finished');
    assert.deepEqual(result.value.outcome, { winner: 'O', reason: 'resignation', line: null });
  });

  it('cancels rather than loses an unjoined game', () => {
    const open = createGame({ id: 'g', channel: 'C1', challenger: X });
    const result = resign(open, X);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.outcome?.winner, null);
    assert.equal(result.value.outcome?.reason, 'resignation');
  });

  it('is not open to bystanders', () => {
    assert.equal(resign(fresh(), 'U_NOSY').ok, false);
  });
});

describe('self-play', () => {
  it('always reaches a legal finish, from 200 random games', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const random = lcg(seed);
      let state = fresh();
      let plies = 0;

      while (state.status === 'in_progress') {
        const legal = legalMoves(state);
        assert.ok(legal.length > 0, `seed ${seed}: running game with no legal move`);

        const pick = legal[Math.floor(random() * legal.length)]!;
        const userId = state.turn === 'X' ? X : O;
        const result = applyMove(state, userId, Math.floor(pick / 9), pick % 9);
        assert.equal(result.ok, true, `seed ${seed}: legalMoves offered an illegal move`);
        if (!result.ok) return;

        state = result.value;
        plies += 1;
        assert.ok(plies <= 81, `seed ${seed}: more plies than squares`);

        // Invariants that must hold after every single move.
        assert.equal(state.cells.filter((c) => c !== null).length, plies);
        for (let b = 0; b < 9; b += 1) {
          assert.equal(
            state.boards[b],
            evaluateBoard(state.cells.slice(b * 9, b * 9 + 9)),
            `seed ${seed}: board ${b} owner disagrees with its squares`,
          );
        }
        if (state.activeBoard !== null) {
          assert.equal(state.boards[state.activeBoard], null, `seed ${seed}: forced into a decided board`);
        }
      }

      assert.equal(state.status, 'finished');
      assert.ok(state.outcome, `seed ${seed}: finished with no outcome`);
      assert.equal(legalMoves(state).length, 0);
    }
  });
});
