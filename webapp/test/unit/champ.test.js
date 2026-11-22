// Unit tests of the champion rule: the sealed ledger (core/champ-seal.js), the service of a
// device (features/champ.js), and the record fields it needs (live, n).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../setup-balls.js';
import { CHAMP } from '../../src/config.js';
import {
  E_KEPT,
  FLOOR_FROM,
  HI_STEP,
  PER_PICK,
  clean,
  daysOf,
  fresh,
  handedOut,
  isLive,
  judged,
  owedOf,
  progressOf,
  qualifies,
  rise,
  view,
  win,
  winsOf,
} from '../../src/core/champ-seal.js';
import { floorMs } from '../../src/core/floor.js';
import { SEED_MIN } from '../../src/core/hist.js';
import { createChamp, CHAMP_KEY } from '../../src/features/champ.js';
import { dateOfDay, utcDayNumber } from '../../src/features/daily.js';
import { createStore } from '../../src/features/stats-store.js';
import { afterSubmit } from '../../src/platform/leaderboard.js';
import { atDay, fakeStorage } from './helpers.js';

const A = 'AAAAAAAAAAA',
  B = 'BBBBBBBBBBB';
const stats = (pct = 100, n = 9) => ({ n, mean: 40, top: 20, pct });
const rec = (over = {}) => ({
  solved: true,
  time: 30,
  sent: true,
  live: true,
  n: 7,
  stats: stats(),
  ...over,
});
const wins = (v, days) => days.reduce((acc, day) => win(judged(acc, day), day, 30000), v);
const days = (from, count) => Array.from({ length: count }, (_, i) => from + i);

// ---- the sealed ledger -----------------------------------------------------------------------

test('champ: the config asks for the seed players and the player; the floor is 0.5 s a cell', () => {
  assert.ok(CHAMP.minPlayers >= SEED_MIN + 1, 'minPlayers');
  assert.deepStrictEqual(floorMs(7), 24500);
});

test('champ: a copy survives a round trip; any edit of it fails the seals', () => {
  const v = wins(fresh(20000, A), days(20001, 3));
  assert.deepStrictEqual(clean(JSON.parse(JSON.stringify(v))), v);
  const edit = change => {
    const c = JSON.parse(JSON.stringify(v));
    change(c);
    return clean(c);
  };
  assert.deepStrictEqual(
    edit(c => {
      c.g = 1;
    }),
    null,
    'picks handed out',
  );
  assert.deepStrictEqual(
    edit(c => {
      c.hi = 1;
    }),
    null,
    'clock mark',
  );
  assert.deepStrictEqual(
    edit(c => {
      c.j.pop();
    }),
    null,
    'judged days',
  );
  assert.deepStrictEqual(
    edit(c => {
      c.c[0] = 50;
    }),
    null,
    'checkpoint count',
  );
  assert.deepStrictEqual(
    edit(c => {
      c.e[1][1] = 1;
    }),
    null,
    'a time',
  );
  assert.deepStrictEqual(
    edit(c => {
      c.e[1][0] += 1;
    }),
    null,
    'a day',
  );
  assert.deepStrictEqual(
    edit(c => {
      c.e.push([20009, 5, 'x']);
    }),
    null,
    'a win made up',
  );
  assert.deepStrictEqual(
    edit(c => {
      c.e.splice(0, 1);
    }),
    null,
    'a win cut from the front',
  );
  assert.deepStrictEqual(
    edit(c => {
      c.e.splice(1, 1);
    }),
    null,
    'a win cut from the middle',
  );
  assert.deepStrictEqual(
    edit(c => {
      c.id = B;
    }),
    null,
    'another id',
  );
  assert.deepStrictEqual(clean({ ...v, v: 2 }), null);
  assert.deepStrictEqual(clean(null), null);
});

test('champ: a win cut from the end leaves a valid copy with one win less (nothing gained)', () => {
  const v = wins(fresh(20000, A), days(20001, 3));
  const cut = clean({ ...v, e: v.e.slice(0, 2) });
  assert.deepStrictEqual(winsOf(cut), 2);
  assert.deepStrictEqual(winsOf(v), 3);
  assert.ok(cut.j.includes(20003), 'and the day stays judged: it cannot be won again');
});

test('champ: old wins fold into the checkpoint; the count and the chain stay valid', () => {
  const many = E_KEPT + 12;
  const v = wins(fresh(20000, A), days(20001, many));
  assert.deepStrictEqual([v.e.length, v.c[0], winsOf(v)], [E_KEPT, 12, many]);
  assert.deepStrictEqual(clean(JSON.parse(JSON.stringify(v))), v);
});

test('champ: every PER_PICK wins is one pick; handed-out picks are not owed again', () => {
  let v = fresh(20000, A);
  const owedAfter = [];
  for (let i = 1; i <= 2 * PER_PICK; i++) {
    v = wins(v, [20000 + i]);
    owedAfter.push(owedOf(v));
  }
  assert.deepStrictEqual(owedAfter, [0, 0, 0, 0, 1, 1, 1, 1, 1, 2]);
  assert.deepStrictEqual(owedOf(handedOut(v, 2)), 0);
  assert.deepStrictEqual(progressOf(wins(fresh(1, A), [2, 3, 4])), {
    wins: 3,
    done: 3,
    total: PER_PICK,
  });
  assert.deepStrictEqual(progressOf(v), { wins: 10, done: 0, total: PER_PICK });
});

test('champ: the group has the wins of all devices, one per day, and the picks added up', () => {
  const a = wins(fresh(20000, A), [20001, 20002, 20003]);
  const b = wins(fresh(20000, B), [20003, 20004, 20005]);
  const entries = [
    { dev: A, value: a },
    { dev: B, value: b },
  ];
  const group = view(entries);
  assert.deepStrictEqual(
    [winsOf(group), [...daysOf(group)].sort()],
    [5, [20001, 20002, 20003, 20004, 20005]],
  );
  assert.deepStrictEqual(owedOf(group), 1);
  assert.deepStrictEqual(view([entries[0], { dev: B, value: handedOut(b, 1) }]).g, 1);
  assert.deepStrictEqual(owedOf(view([{ dev: A, value: handedOut(a, 1) }, entries[1]])), 0);
  assert.deepStrictEqual(
    view([...entries].reverse().sort((x, y) => (x.dev < y.dev ? -1 : 1))),
    group,
    'any order',
  );
});

// ---- what is a win ---------------------------------------------------------------------------

test('champ: a win is a live game, pct 100, enough players, and a time above the floor', () => {
  const min = CHAMP.minPlayers;
  assert.ok(qualifies(rec(), min), 'the plain win');
  assert.ok(!qualifies(rec({ live: false }), min), 'a replay');
  assert.ok(!qualifies(rec({ live: undefined }), min), 'no live flag');
  assert.ok(!qualifies(rec({ stats: stats(99) }), min), '99%');
  assert.ok(!qualifies(rec({ stats: stats(null, 1) }), min), 'alone: no percentage');
  assert.ok(!qualifies(rec({ stats: null }), min), 'no answer yet');
  assert.ok(qualifies(rec({ stats: stats(100, min) }), min), 'just enough players');
  assert.ok(!qualifies(rec({ stats: stats(100, min - 1) }), min), 'a day nobody seeded');
  assert.ok(qualifies(rec({ n: FLOOR_FROM, time: 24.5 }), min), 'at the floor');
  assert.ok(!qualifies(rec({ n: FLOOR_FROM, time: 24.4 }), min), 'below the floor');
  assert.ok(qualifies(rec({ n: FLOOR_FROM - 1, time: 3 }), min), 'a small board has no floor');
  assert.ok(!qualifies(rec({ n: undefined }), min), 'no board size');
});

test("champ: live = not a replay, today's date, and a clock not set back", () => {
  const v = fresh(100, A);
  assert.ok(isLive(v, 100, 100, false));
  assert.ok(!isLive(v, 100, 100, true), 'a replay');
  assert.ok(!isLive(v, 99, 100, false), 'another day');
  assert.ok(!isLive(v, 99, 99, false), 'the clock is behind the highest day seen');
  assert.ok(
    isLive(v, 105, 105, false),
    'a clock ahead is live; the champion rule checks the players',
  );
  assert.deepStrictEqual(
    rise(v, 150).hi,
    100 + HI_STEP,
    'a clock far ahead rises a little a launch',
  );
  assert.deepStrictEqual(rise(v, 101).hi, 101);
  assert.deepStrictEqual(rise(v, 90).hi, 100, 'never down');
});

// ---- the service of a device -----------------------------------------------------------------

const DAY0 = utcDayNumber(atDay(19)());
const dateAt = k => dateOfDay(DAY0 - k);
const setup = async (clock = atDay(19), st = fakeStorage(), sync = null) => {
  const champ = createChamp(st, { minPlayers: 4 }, clock, sync);
  await champ.init();
  return { st, champ };
};
const winOn = async (champ, k) => champ.judge(dateAt(k), rec());

test("champ: live only for today's game, never for a replay", async () => {
  const { champ } = await setup();
  assert.ok(champ.live(dateAt(0), false));
  assert.ok(!champ.live(dateAt(0), true));
  assert.ok(!champ.live(dateAt(1), false));
  assert.ok(!createChamp(fakeStorage(), { minPlayers: 4 }).live(dateAt(0), false), 'before init');
});

test('champ: a day is judged once, at its first answer; a replay is not judged', async () => {
  const { champ } = await setup();
  assert.ok(!(await champ.judge(dateAt(0), rec({ stats: stats(80) }))), 'not a win');
  assert.ok(
    !(await champ.judge(dateAt(0), rec())),
    'the day is judged: a better answer does not count',
  );
  assert.ok(!(await champ.judge(dateAt(1), rec({ live: undefined }))), 'a replay');
  assert.ok(await champ.judge(dateAt(1), rec()), 'the replay did not use up the day');
  assert.ok(!(await champ.judge(dateAt(1), rec())), 'a win counts once');
  assert.ok(!(await champ.judge(dateAt(2), rec({ stats: null }))), 'no answer');
  assert.ok(await champ.judge(dateAt(2), rec()), 'no answer did not use up the day');
  assert.deepStrictEqual(champ.progress(), { wins: 2, done: 2, total: PER_PICK });
});

test('champ: 5 wins give one pick, once, and a restart does not give it again', async () => {
  const { st, champ } = await setup();
  for (let k = 0; k < 4; k++) assert.ok(await winOn(champ, k));
  assert.deepStrictEqual(await champ.takePicks(), 0);
  assert.ok(await winOn(champ, 4));
  assert.deepStrictEqual(await champ.takePicks(), 1);
  assert.deepStrictEqual(await champ.takePicks(), 0);
  const again = createChamp(st, { minPlayers: 4 }, atDay(19));
  await again.init();
  assert.deepStrictEqual(
    [again.progress().wins, await again.takePicks()],
    [5, 0],
    'persisted before it is granted',
  );
});

test('champ: a copy that fails its seals starts again; nothing is earned by editing', async () => {
  const { st, champ } = await setup();
  for (let k = 0; k < 5; k++) await winOn(champ, k);
  const stored = JSON.parse((await st.get(CHAMP_KEY)).value);
  stored.g = 0;
  stored.c[0] = 40;
  await st.set(CHAMP_KEY, JSON.stringify(stored));
  const again = createChamp(st, { minPlayers: 4 }, atDay(19));
  await again.init();
  assert.deepStrictEqual(again.progress(), { wins: 0, done: 0, total: PER_PICK });
  await st.set(CHAMP_KEY, '{not json');
  const broken = createChamp(st, { minPlayers: 4 }, atDay(19));
  await broken.init();
  assert.deepStrictEqual(await broken.takePicks(), 0);
});

test('champ: a write that is refused is not a win and not a pick', async () => {
  const st = fakeStorage();
  const { champ } = await setup(atDay(19), st);
  const set = st.set;
  st.set = async () => false;
  assert.ok(!(await winOn(champ, 0)));
  assert.deepStrictEqual(champ.progress().wins, 0);
  st.set = set;
  assert.ok(await winOn(champ, 0), 'the day was not judged: the next try counts');
});

test('champ: the start judges a stored live answer that was never judged (once)', async () => {
  const { champ } = await setup();
  const records = {
    [dateAt(0)]: rec(),
    [dateAt(1)]: rec(),
    [dateAt(2)]: rec({ live: undefined }),
    [dateAt(3)]: rec(),
  };
  const store = { loadAttempt: async date => records[date] || null };
  await champ.catchUp(store);
  assert.deepStrictEqual(
    champ.progress().wins,
    2,
    'today and yesterday; the replay and the old day do not count',
  );
  await champ.catchUp(store);
  assert.deepStrictEqual(champ.progress().wins, 2, 'not twice');
});

test('champ: a clock set back is not live; a clock far ahead rises a little a launch', async () => {
  const st = fakeStorage();
  await setup(atDay(19), st);
  const back = createChamp(st, { minPlayers: 4 }, atDay(15));
  await back.init();
  assert.ok(!back.live(dateOfDay(DAY0 - 4), false), 'back from day 19 to 15');
  const ahead = createChamp(st, { minPlayers: 4 }, atDay(28));
  await ahead.init();
  const later = createChamp(st, { minPlayers: 4 }, atDay(19));
  await later.init();
  assert.ok(
    !later.live(dateAt(0), false),
    'the mark rose to 21: day 19 is behind it until the clock is',
  );
});

test("champ: with device sync the picks follow the group's wins, handed out once", async () => {
  const other = wins(fresh(DAY0, B), [DAY0 - 10, DAY0 - 11]);
  const group = { value: other };
  const sync = {
    view: (_key, local) =>
      view([
        { dev: A, value: local },
        { dev: B, value: group.value },
      ]),
  };
  const { champ } = await setup(atDay(19), fakeStorage(), sync);
  for (let k = 0; k < 3; k++) await winOn(champ, k);
  assert.deepStrictEqual(await champ.takePicks(), 1, '3 here + 2 on the other device');
  assert.deepStrictEqual(await champ.takePicks(), 0);
  group.value = handedOut(group.value, 1);
  assert.deepStrictEqual(
    await champ.takePicks(),
    0,
    'the other device handed it out meanwhile: not twice',
  );
});

// ---- the record fields -----------------------------------------------------------------------

test('champ: the record keeps live and the board size through the submit rounds', async () => {
  const st = fakeStorage(),
    store = createStore(st, [7]);
  await store.hydrate(dateAt(0));
  await store.recordGotd(7, dateAt(0), 31.2, true, false, true);
  await store.recordGotd(7, dateAt(1), 31.2, true, true, false);
  await store.recordGotd(7, dateAt(2), 31.2, false, false, true);
  assert.deepStrictEqual(await store.loadAttempt(dateAt(0)), {
    solved: true,
    time: 31.2,
    sent: false,
    live: true,
    n: 7,
  });
  assert.deepStrictEqual(
    await store.loadAttempt(dateAt(1)),
    { solved: true, time: 31.2, sent: false, live: false },
    'a replay says it is not live',
  );
  assert.deepStrictEqual(
    await store.loadAttempt(dateAt(2)),
    { solved: true, time: 31.2 },
    'nothing to submit',
  );
  const order = ['asia'],
    prev = await store.loadAttempt(dateAt(0));
  const done = r =>
    afterSubmit(
      prev,
      { status: 'ok', done: ['asia'], complete: r, backend: 'asia', summary: stats() },
      order,
    );
  assert.deepStrictEqual(done(true), {
    solved: true,
    time: 31.2,
    sent: true,
    live: true,
    n: 7,
    stats: stats(),
  });
  assert.deepStrictEqual(done(false).live, true);
  const reply = {
    status: 'ok',
    done: ['asia'],
    complete: true,
    backend: 'asia',
    summary: stats(),
  };
  assert.deepStrictEqual(
    afterSubmit({ solved: true, time: 9, sent: false }, reply, order),
    { solved: true, time: 9, sent: true, stats: stats() },
    'an old record has no fields',
  );
  assert.deepStrictEqual(
    afterSubmit({ solved: true, time: 9, sent: false, live: false }, reply, order),
    { solved: true, time: 9, sent: true, live: false, stats: stats() },
    'live: false stays',
  );
});
