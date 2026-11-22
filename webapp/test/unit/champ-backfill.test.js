// Unit tests of the champion backfill (features/champ-backfill.js): the wins of the records from
// before the champion rule. Delete this file with the backfill.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../setup-balls.js';
import { PER_PICK } from '../../src/core/champ-seal.js';
import {
  BACKFILL_KEY,
  backfillChamp,
  backfillOpen,
  isOldWin,
} from '../../src/features/champ-backfill.js';
import { createChamp } from '../../src/features/champ.js';
import { dateOfDay, utcDayNumber } from '../../src/features/daily.js';
import { createStore } from '../../src/features/stats-store.js';
import { atDay, fakeStorage } from './helpers.js';

const CFG = { minPlayers: 4, backfillUntil: '2026-12-02' };
const stats = (pct = 100, n = 9) => ({ n, mean: 40, top: 20, pct });
const old = (over = {}) => ({ solved: true, time: 30, sent: true, stats: stats(), ...over });
const DAY0 = utcDayNumber(atDay(19)());
const dateAt = k => dateOfDay(DAY0 - k);
const NOW = new Date('2026-11-25T10:00:00Z');

test('backfill: an old win is a solved record without live, pct 100, enough players', () => {
  assert.ok(isOldWin(old(), 4));
  assert.ok(isOldWin(old({ stats: stats(100, 4) }), 4), 'just enough players');
  assert.ok(!isOldWin(old({ stats: stats(100, 3) }), 4), 'too few players');
  assert.ok(!isOldWin(old({ stats: stats(99) }), 4), '99%');
  assert.ok(!isOldWin(old({ stats: null }), 4), 'no answer');
  assert.ok(!isOldWin(old({ solved: false }), 4), 'not solved');
  assert.ok(!isOldWin(old({ live: false }), 4), 'a replay since the rule');
  assert.ok(!isOldWin(old({ live: true, n: 7 }), 4), 'a live game is judged by the rule itself');
  assert.ok(!isOldWin(null, 4));
});

test('backfill: the window is open until the date, inclusive, in UTC', () => {
  assert.ok(backfillOpen(CFG, new Date('2026-12-02T23:59:59Z')));
  assert.ok(!backfillOpen(CFG, new Date('2026-12-03T00:00:00Z')));
  assert.ok(!backfillOpen({ ...CFG, backfillUntil: null }, NOW));
});

const setup = async (records, cfg = CFG, st = fakeStorage()) => {
  const store = createStore(st, [7]);
  for (const [date, rec] of Object.entries(records)) await store.saveAttempt(date, rec);
  const champ = createChamp(st, cfg, atDay(19));
  await champ.init();
  return { st, store, champ, run: (now = NOW) => backfillChamp(champ, store, st, cfg, () => now) };
};

test('backfill: old wins count once, replays too; the rest does not', async () => {
  const { st, champ, run } = await setup({
    [dateAt(0)]: old(),
    [dateAt(1)]: old(),
    [dateAt(2)]: old({ stats: stats(99) }),
    [dateAt(3)]: old({ stats: stats(100, 3) }),
    [dateAt(4)]: old({ live: false }),
    [dateAt(5)]: old({ live: true, n: 7 }),
    [dateAt(6)]: old(),
  });
  assert.deepStrictEqual(await run(), 3);
  assert.deepStrictEqual(champ.progress(), { wins: 3, done: 3, total: PER_PICK });
  assert.ok(await st.get(BACKFILL_KEY), 'the marker is set');
  assert.deepStrictEqual(await run(), 0, 'once per device');
  assert.deepStrictEqual(champ.progress().wins, 3);
});

test('backfill: 5 old wins give a pick, 12 give two', async () => {
  const records = {};
  for (let k = 0; k < 12; k++) records[dateAt(k)] = old();
  const { champ, run } = await setup(records);
  assert.deepStrictEqual(await run(), 12);
  assert.deepStrictEqual(await champ.takePicks(), 2);
  assert.deepStrictEqual(await champ.takePicks(), 0);
});

test('backfill: a record that appears after the run is not backfilled (the marker)', async () => {
  const { store, run } = await setup({ [dateAt(0)]: old() });
  assert.deepStrictEqual(await run(), 1);
  await store.saveAttempt(dateAt(1), old());
  assert.deepStrictEqual(await run(), 0);
});

test('backfill: not after the date, without a date, or before the ledger is loaded', async () => {
  const records = { [dateAt(0)]: old() };
  const late = await setup(records);
  assert.deepStrictEqual(await late.run(new Date('2026-12-03T00:00:00Z')), 0);
  assert.deepStrictEqual(await late.st.get(BACKFILL_KEY), null, 'no marker: nothing was done');
  const none = await setup(records, { ...CFG, backfillUntil: null });
  assert.deepStrictEqual(await none.run(), 0);
  const st = fakeStorage(),
    store = createStore(st, [7]);
  await store.saveAttempt(dateAt(0), old());
  const cold = createChamp(st, CFG, atDay(19));
  assert.deepStrictEqual(await backfillChamp(cold, store, st, CFG, () => NOW), 0, 'no init yet');
});

test('backfill: a day that was judged or won is not counted again', async () => {
  const { champ } = await setup({});
  assert.ok(await champ.settle(dateAt(0), true, 30));
  assert.ok(!(await champ.settle(dateAt(0), true, 30)), 'won once');
  assert.ok(!(await champ.settle(dateAt(1), false, 30)), 'judged: not a win');
  assert.ok(!(await champ.settle(dateAt(1), true, 30)), 'judged once');
  assert.deepStrictEqual(champ.progress().wins, 1);
});
