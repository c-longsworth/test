import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseOpponent } from '../src/app.js';
import { createMemoryStore, newGameId } from '../src/store.js';
import { fresh, lcg } from './helpers.js';

describe('parseOpponent', () => {
  it('reads an escaped mention, with or without the name', () => {
    assert.deepEqual(parseOpponent('<@U012ABCDEF|ada>'), { userId: 'U012ABCDEF' });
    assert.deepEqual(parseOpponent('<@U012ABCDEF>'), { userId: 'U012ABCDEF' });
    assert.deepEqual(parseOpponent('  <@W012ABCDEF>  '), { userId: 'W012ABCDEF' });
  });

  it('reports a plain @name as unresolved rather than guessing an ID', () => {
    assert.deepEqual(parseOpponent('@ada'), { unresolved: 'ada' });
  });

  it('treats empty input as an open game', () => {
    assert.equal(parseOpponent(''), null);
    assert.equal(parseOpponent('   '), null);
  });

  it('ignores text that names nobody', () => {
    assert.equal(parseOpponent('lets play'), null);
  });
});

describe('the store', () => {
  it('saves and returns a game', () => {
    const store = createMemoryStore();
    const game = fresh();
    store.save(game);
    assert.equal(store.get(game.id)?.id, game.id);
    assert.equal(store.get('nope'), undefined);
  });

  it('forgets a game once it is stale', () => {
    let clock = 1_000;
    const store = createMemoryStore({ ttlMs: 100, now: () => clock });
    store.save(fresh());
    assert.ok(store.get('test01'));
    clock += 101;
    assert.equal(store.get('test01'), undefined);
    assert.equal(store.size(), 0);
  });

  it('drops the least recently touched game when full', () => {
    const store = createMemoryStore({ maxGames: 2 });
    store.save({ ...fresh(), id: 'a' });
    store.save({ ...fresh(), id: 'b' });
    store.save({ ...fresh(), id: 'a' }); // touching 'a' makes 'b' the oldest
    store.save({ ...fresh(), id: 'c' });

    assert.equal(store.size(), 2);
    assert.ok(store.get('a'));
    assert.ok(store.get('c'));
    assert.equal(store.get('b'), undefined);
  });

  it('deletes on request', () => {
    const store = createMemoryStore();
    store.save(fresh());
    store.delete('test01');
    assert.equal(store.size(), 0);
  });
});

describe('newGameId', () => {
  it('is six characters of an unambiguous alphabet', () => {
    const id = newGameId(lcg(42));
    assert.match(id, /^[abcdefghjkmnpqrstuvwxyz23456789]{6}$/);
    assert.ok(!/[ilo01]/.test(id), 'no characters that are misread out loud');
  });

  it('does not collide in practice', () => {
    const random = lcg(7);
    const ids = new Set(Array.from({ length: 2000 }, () => newGameId(random)));
    assert.ok(ids.size > 1990, `too many collisions: ${2000 - ids.size}`);
  });
});
