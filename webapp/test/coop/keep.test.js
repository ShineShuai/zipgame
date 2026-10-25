import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GAME_KEY, KEEP_MS, clearGame, loadGame, makeRecord, parseGame, saveGame,
} from '../../src/coop/keep.js';

const record = (over = {}) => makeRecord({
  role: 'guest',
  seed: 7,
  text: 'zip 4\n...',
  ops: [{
    kind: 'add', a: 0, b: 1, owner: 1, clock: 1, pid: 1, seq: 0,
  }],
  hints: 2,
  startedWall: 1700000000000,
  secret: 'abcdefghijklmnopqrstuv',
  ...over,
}, 1700000100000);

// the storage port of platform/storage.js, in memory
const memory = () => {
  const data = new Map();
  return {
    data,
    get: async key => (data.has(key) ? { value: data.get(key) } : null),
    set: async (key, value) => data.set(key, value) && true,
    remove: async key => data.delete(key),
  };
};

test('a record survives a save and a load; nothing else is kept', async () => {
  const storage = memory();
  const kept = record();
  assert.equal(await saveGame(storage, kept), true);
  assert.deepEqual([...storage.data.keys()], [GAME_KEY]);
  assert.deepEqual(await loadGame(storage, 1700000200000), kept);
  await clearGame(storage);
  assert.equal(await loadGame(storage), null);
});

test('a game is kept for a day, no longer', () => {
  const text = JSON.stringify(record());
  assert.ok(parseGame(text, 1700000100000 + KEEP_MS - 1));
  assert.equal(parseGame(text, 1700000100000 + KEEP_MS), null);
});

test('anything that is not a game of this version is refused', () => {
  const ok = record();
  assert.ok(parseGame(JSON.stringify(ok), ok.saved));
  const bad = [
    null, '', 'not json', '[]', '{}', JSON.stringify({ ...ok, v: 2 }),
    JSON.stringify({ ...ok, role: 'both' }), JSON.stringify({ ...ok, seed: 'x' }),
    JSON.stringify({ ...ok, seed: -1 }), JSON.stringify({ ...ok, text: 5 }),
    JSON.stringify({ ...ok, text: 'x'.repeat(100001) }), JSON.stringify({ ...ok, ops: {} }),
    JSON.stringify({ ...ok, ops: [{ kind: 'zap', a: 0, b: 1, clock: 1, pid: 0, seq: 0 }] }),
    JSON.stringify({ ...ok, ops: [{ kind: 'add', a: 'x', b: 1, clock: 1, pid: 0, seq: 0 }] }),
    JSON.stringify({ ...ok, ops: Array.from({ length: 5001 }, () => ok.ops[0]) }),
    JSON.stringify({ ...ok, hints: 1.5 }), JSON.stringify({ ...ok, secret: 'short' }),
    JSON.stringify({ ...ok, startedWall: 'now' }),
  ];
  bad.forEach(text => assert.equal(parseGame(text, ok.saved), null, String(text).slice(0, 40)));
});

test('a storage that fails does not break the game', async () => {
  const broken = {
    get: async () => {
      throw new Error('disabled');
    },
    set: async () => {
      throw new Error('disabled');
    },
    remove: async () => {
      throw new Error('disabled');
    },
  };
  assert.equal(await loadGame(broken), null);
  assert.equal(await saveGame(broken, record()), false);
  await clearGame(broken);
});
