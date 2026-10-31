import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newStat, updateStat } from '../../src/core/stats.js';
import { MERGES, RECENT_MAX, SHRINKS, SYNCED_KEYS } from '../../src/core/sync/merge.js';
import { GIFT_KEY } from '../../src/features/gift.js';
import { CREDIT_KEY } from '../../src/features/replay.js';
import { RULES_SEEN_KEY } from '../../src/features/rules-seen.js';
import { GOTD_KEY, STATS_KEY } from '../../src/features/stats-store.js';
import { STREAK_KEY } from '../../src/features/streak.js';
import { PLAYED_KEPT, UNLOCK_KEY } from '../../src/features/unlock.js';

const A = 'AAAAAAAAAAA';
const B = 'BBBBBBBBBBB';
const C = 'CCCCCCCCCCC';
const entry = (dev, value) => ({ dev, value });
const near = (x, y, message) =>
  assert.ok(Math.abs(x - y) < 1e-9 * Math.max(1, Math.abs(x)), message);
const shuffled = list => list.map(x => [Math.random(), x])
  .sort((a, b) => a[0] - b[0]).map(x => x[1]);

test('the synced keys are exactly these, and what is device-local is not among them', () => {
  assert.deepEqual([...SYNCED_KEYS].sort(), [STATS_KEY, GOTD_KEY, STREAK_KEY, UNLOCK_KEY,
    CREDIT_KEY, GIFT_KEY, RULES_SEEN_KEY].sort());
  for (const local of ['zip_playlog_v2', 'zip_behaviour_on', 'zip_theme', 'zip_theme_seed',
    'zip_shared_games', 'zip_coop_stats', 'zip_sync', 'zip_sync_f']) {
    assert.ok(!SYNCED_KEYS.includes(local), local);
  }
});

test('RECENT_MAX is what core/stats.js keeps', () => {
  const st = newStat();
  for (let i = 0; i < RECENT_MAX + 5; i++) updateStat(st, i);
  assert.equal(st.recent.length, RECENT_MAX);
});

// ---- statistics ----------------------------------------------------------------------------

const statOf = samples => samples.reduce((st, x) => updateStat(st, x), newStat());
const packed = st => [st.n, st.mean, st.M2, st.recent];
const statsCopy = (t = {}, d = {}, b = {}) => ({ v: 2, t, d, b });

test('statistics: merging two devices equals the statistics of all their games', () => {
  const xs = [10, 12.5, 9, 30, 21];
  const ys = [15, 11, 40];
  const view = MERGES[STATS_KEY].view([
    entry(A, statsCopy({ s: packed(statOf(xs)) })), entry(B, statsCopy({ s: packed(statOf(ys)) })),
  ]);
  const all = statOf([...xs, ...ys]);
  const [n, mean, M2, recent] = view.t.s;
  assert.equal(n, all.n);
  near(mean, all.mean, 'mean');
  near(M2, all.M2, 'M2');
  assert.deepEqual(recent, [...xs, ...ys]);
});

test('statistics: three devices in any order give the same totals; a device '
  + 'alone is itself', () => {
  const sets = [[1, 2, 3, 4], [10, 20], [7, 7, 7, 9, 100]];
  const entries = [A, B, C].map((dev, i) => entry(dev, statsCopy({ s: packed(statOf(sets[i])) })));
  const all = statOf(sets.flat());
  for (let round = 0; round < 10; round++) {
    const [n, mean, M2] = MERGES[STATS_KEY].view(shuffled(entries)).t.s;
    assert.equal(n, all.n);
    near(mean, all.mean, 'mean');
    near(M2, all.M2, 'M2');
  }
  assert.deepEqual(MERGES[STATS_KEY].view([entries[0]]).t.s, entries[0].value.t.s);
});

test('statistics: the recent times are capped; scopes only one device has are kept', () => {
  const many = Array.from({ length: 30 }, (_, i) => i);
  const view = MERGES[STATS_KEY].view([
    entry(A, statsCopy({ s: packed(statOf(many)), only: packed(statOf([5])) })),
    entry(B, statsCopy({ s: packed(statOf(many)) })),
  ]);
  assert.equal(view.t.s[3].length, RECENT_MAX);
  assert.equal(view.t.only[0], 1);
});

test('statistics: today counts only the newest day; the same day adds up', () => {
  const day = (n, samples) => [n, ...packed(statOf(samples))];
  const view = MERGES[STATS_KEY].view([
    entry(A, statsCopy({}, { s: day(20001, [10, 20]), old: day(20000, [5]) })),
    entry(B, statsCopy({}, { s: day(20001, [30]), old: day(20003, [9]) })),
    entry(C, statsCopy({}, { s: day(19999, [99]) })),
  ]);
  assert.equal(view.d.s[0], 20001);
  assert.equal(view.d.s[1], 3);
  near(view.d.s[2], 20, 'mean of 10, 20, 30');
  assert.deepEqual([view.d.old[0], view.d.old[1]], [20003, 1]);
});

test('statistics: the Game-of-Day time is the newest date, on the same date the best time', () => {
  const view = MERGES[STATS_KEY].view([
    entry(A, statsCopy({}, {}, { 7: ['20261029', 30], 8: ['20261030', 50], 9: ['20261001', 5] })),
    entry(B, statsCopy({}, {}, { 7: ['20261030', 90], 8: ['20261030', 40] })),
  ]);
  assert.deepEqual(view.b, { 7: ['20261030', 90], 8: ['20261030', 40], 9: ['20261001', 5] });
});

test('statistics: clean drops what is not a statistic, and names that are not safe', () => {
  const dirty = JSON.parse(`{"v":2,"t":{"ok":[2,1,0,[1,2]],"bad":[0,1,0,[]],"nan":[1,"x",0,[]],
    "__proto__":[2,1,0,[]],"has space":[2,1,0,[]]},"d":{"ok":[5,2,1,0,[1]],"bad":["x"]},
    "b":{"7":["20261030",12],"8":["20261030"]}}`);
  const clean = MERGES[STATS_KEY].clean(dirty);
  assert.deepEqual(Object.keys(clean.t), ['ok']);
  assert.deepEqual(Object.keys(clean.d), ['ok']);
  assert.deepEqual(Object.keys(clean.b), ['7']);
  assert.equal(Object.getPrototypeOf(clean.t), Object.prototype);
  assert.equal(MERGES[STATS_KEY].clean({ v: 1, t: {}, d: {}, b: {} }), null);
  assert.equal(MERGES[STATS_KEY].clean(null), null);
  assert.deepEqual(MERGES[STATS_KEY].clean(clean), clean, 'cleaning twice changes nothing');
});

test('statistics: shrink keeps the numbers and drops the recent times', () => {
  const copy = statsCopy({ s: [3, 2, 1, [1, 2, 3]] }, { s: [20001, 3, 2, 1, [1, 2, 3]] });
  assert.deepEqual(SHRINKS[STATS_KEY](copy).t.s, [3, 2, 1, []]);
  assert.deepEqual(SHRINKS[STATS_KEY](copy).d.s, [20001, 3, 2, 1, []]);
  assert.deepEqual(copy.t.s[3], [1, 2, 3], 'the original is untouched');
});

// ---- Game-of-Day records --------------------------------------------------------------------

const gotdCopy = (a, n = 0) => ({ v: 2, a, n });

test('Game of Day: own solved record stands (with its pending submit); others '
  + 'fill the gaps', () => {
  const view = MERGES[GOTD_KEY].view([
    entry(A, gotdCopy({ 20261030: { solved: true, time: 50, sent: false } })),
    entry(B, gotdCopy({
      20261030: { solved: true, time: 30, sent: true },
      20261029: { solved: true, time: 45, sent: false, stats: { n: 3 } },
      20261028: { solved: false, time: null },
    })),
  ], A);
  assert.deepEqual(view.a['20261030'], { solved: true, time: 50, sent: false });
  assert.deepEqual(view.a['20261029'], { solved: true, time: 45, stats: { n: 3 } });
  assert.deepEqual(view.a['20261028'], { solved: false, time: null });
});

test('Game of Day: another device\'s solve replaces an abandoned try; the '
  + 'fastest other wins', () => {
  const view = MERGES[GOTD_KEY].view([
    entry(A, gotdCopy({ 20261030: { solved: false, time: null } })),
    entry(B, gotdCopy({ 20261030: { solved: true, time: 60 } })),
    entry(C, gotdCopy({ 20261030: { solved: true, time: 40, sent: false } })),
  ], A);
  assert.deepEqual(view.a['20261030'], { solved: true, time: 40 });
});

test('Game of Day: n only grows, and counts the dates the records show', () => {
  const solved = { solved: true, time: 1 };
  const view = MERGES[GOTD_KEY].view([
    entry(A, gotdCopy({ 20261030: solved }, 10)),
    entry(B, gotdCopy({ 20261029: solved, 20261028: solved }, 3)),
  ], A);
  assert.equal(view.n, 10);
  const two = gotdCopy({ 10000001: solved, 10000002: solved }, 1);
  const many = MERGES[GOTD_KEY].view([entry(A, two)], A);
  assert.equal(many.n, 2);
});

test('Game of Day: clean keeps records of real dates only', () => {
  const clean = MERGES[GOTD_KEY].clean({ v: 2, n: 4, a: {
    20261030: { solved: true, time: 5 }, x: { solved: true }, 20261031: { solved: 'yes' },
    2026: {},
  } });
  assert.deepEqual(clean, { v: 2, n: 4, a: { 20261030: { solved: true, time: 5 } } });
  assert.equal(MERGES[GOTD_KEY].clean({ v: 1, a: {} }), null);
  assert.equal(MERGES[GOTD_KEY].clean({ v: 2, a: {}, n: -1 }).n, 0);
});

// ---- streak ----------------------------------------------------------------------------------

const streakCopy = (over = {}) => ({
  last: 20000, streak: 3, best: 3, freezes: 0, earned: 1, prog: 1, brk: null, ...over,
});

test('streak: the state that got furthest wins; the best streak is the best of all', () => {
  const view = MERGES[STREAK_KEY].view([
    entry(A, streakCopy({ last: 20001, streak: 4, best: 4 })),
    entry(B, streakCopy({ last: 20002, streak: 2, best: 9 })),
    entry(C, streakCopy({ last: 20002, streak: 3, best: 3 })),
  ]);
  assert.equal(view.last, 20002);
  assert.equal(view.streak, 3);
  assert.equal(view.best, 9);
});

test('streak: a tie goes to the more rewards, then to the first device id', () => {
  const pick = [
    entry(A, streakCopy({ earned: 1, prog: 0 })), entry(B, streakCopy({ earned: 2, prog: 0 })),
  ];
  assert.equal(MERGES[STREAK_KEY].view(pick).earned, 2);
  assert.equal(MERGES[STREAK_KEY].view(shuffled([
    entry(A, streakCopy({ freezes: 1 })), entry(B, streakCopy({ freezes: 2 })),
  ])).freezes, 1);
});

test('streak: a player with no solve yet (last null) loses to one with a solve', () => {
  const view = MERGES[STREAK_KEY].view([
    entry(A, streakCopy({ last: null, streak: 0, best: 0, earned: 0, prog: 0 })),
    entry(B, streakCopy()),
  ]);
  assert.equal(view.streak, 3);
});

test('streak: clean converts an old state, refuses nonsense', () => {
  const old = MERGES[STREAK_KEY].clean({ last: 5, streak: 9, best: 9, freezes: 1 });
  assert.equal(old.earned, 3);
  assert.equal(old.prog, 2); // 9 % 7
  assert.equal(old.brk, null);
  for (const bad of [null, [], {}, streakCopy({ streak: -1 }), streakCopy({ last: 'x' }),
    streakCopy({ prog: 99 }), streakCopy({ earned: 1.5 })]) {
    assert.equal(MERGES[STREAK_KEY].clean(bad), null, JSON.stringify(bad));
  }
  assert.equal(MERGES[STREAK_KEY].clean(streakCopy({ brk: { from: 'x' } })).brk, null);
});

// ---- unlock ----------------------------------------------------------------------------------

const unlockCopy = (over = {}) => ({
  v: 1, unlocked: {}, tokens: 0, choices: 0, played: [], active: null, ...over,
});

test('unlock: variants unlocked anywhere count, on the earliest day', () => {
  const view = MERGES[UNLOCK_KEY].view([
    entry(A, unlockCopy({ unlocked: { arrows: 20005, exact: 20010 } })),
    entry(B, unlockCopy({ unlocked: { arrows: 20003, cutout: 20001 } })),
  ]);
  assert.deepEqual(view.unlocked, { arrows: 20003, exact: 20010, cutout: 20001 });
});

test('unlock: chances are sums of what each device earned minus spent, never below 0', () => {
  const view = MERGES[UNLOCK_KEY].view([
    entry(A, unlockCopy({ tokens: 2, choices: 1 })),
    entry(B, unlockCopy({ tokens: -1, choices: -1 })),
  ]);
  assert.deepEqual([view.tokens, view.choices], [1, 0]);
  const debt = MERGES[UNLOCK_KEY].view([
    entry(A, unlockCopy({ tokens: 0 })), entry(B, unlockCopy({ tokens: -1 })),
    entry(C, unlockCopy({ tokens: -1 })),
  ]);
  assert.equal(debt.tokens, 0);
});

test('unlock: offers played anywhere count; the list is capped; a game in '
  + 'progress is not shared', () => {
  const view = MERGES[UNLOCK_KEY].view([
    entry(A, unlockCopy({ played: [1, 2, 3, 4, 5], active: { id: 'a' } })),
    entry(B, unlockCopy({ played: [3, 4, 5, 6, 7, 8, 9, 10] })),
  ]);
  assert.deepEqual(view.played, [3, 4, 5, 6, 7, 8, 9, 10].slice(-PLAYED_KEPT));
  assert.equal(view.active, null);
});

test('unlock: clean takes negative nets and the old token list, refuses the rest', () => {
  assert.equal(MERGES[UNLOCK_KEY].clean(unlockCopy({ tokens: -2 })).tokens, -2);
  assert.equal(MERGES[UNLOCK_KEY].clean(unlockCopy({ tokens: [1, 2, 3] })).tokens, 3);
  assert.equal(MERGES[UNLOCK_KEY].clean(unlockCopy({ active: { id: 'a' } })).active, null);
  for (const bad of [null, {}, unlockCopy({ tokens: 1.5 }), unlockCopy({ played: ['x'] }),
    unlockCopy({ unlocked: 5 }), { ...unlockCopy(), v: 2 }]) {
    assert.equal(MERGES[UNLOCK_KEY].clean(bad), null, JSON.stringify(bad));
  }
  const dirty = unlockCopy({ unlocked: { a: 1, b: 'x', c: -1 } });
  assert.deepEqual(MERGES[UNLOCK_KEY].clean(dirty).unlocked, { a: 1 });
});

// ---- replay chances, gift, rules ---------------------------------------------------------------

test('replay chances: the three counters add up', () => {
  const view = MERGES[CREDIT_KEY].view([
    entry(A, { solved: 3, used: 1, bonus: 0 }), entry(B, { solved: 4, used: 2, bonus: 5 }),
  ]);
  assert.deepEqual(view, { solved: 7, used: 3, bonus: 5 });
  assert.deepEqual(MERGES[CREDIT_KEY].clean({ solved: 1, used: 0 }),
    { solved: 1, used: 0, bonus: 0 });
  for (const bad of [null, {}, { solved: -1, used: 0 }, { solved: 1, used: 0, bonus: 1.5 }]) {
    assert.equal(MERGES[CREDIT_KEY].clean(bad), null);
  }
});

test('gift: the record of the latest day; none yet loses to any', () => {
  const view = MERGES[GIFT_KEY].view([
    entry(A, { v: 1, day: null, kind: null }), entry(B, { v: 1, day: 20000, kind: 'replay' }),
    entry(C, { v: 1, day: 19990, kind: 'unlock' }),
  ]);
  assert.deepEqual(view, { v: 1, day: 20000, kind: 'replay' });
  assert.equal(MERGES[GIFT_KEY].clean({ v: 1, day: 5, kind: 'nothing' }), null);
  assert.deepEqual(MERGES[GIFT_KEY].clean({ v: 1, day: null }), { v: 1, day: null, kind: null });
});

test('rules shown: any device\'s counts', () => {
  const view = MERGES[RULES_SEEN_KEY].view([
    entry(A, { v: 1, seen: { cutout: true } }), entry(B, { v: 1, seen: { arrows: true } }),
  ]);
  assert.deepEqual(view, { v: 1, seen: { cutout: true, arrows: true } });
  assert.deepEqual(MERGES[RULES_SEEN_KEY].clean({ v: 1, seen: { a: true, b: false, c: 1 } }),
    { v: 1, seen: { a: true } });
});

// ---- every rule: the same set of entries gives the same value, in any order ------------

test('every rule is a function of the set of entries (any order, same value)', () => {
  const samples = {
    [GOTD_KEY]: [
      gotdCopy({ 20261030: { solved: true, time: 50 },
        20261029: { solved: false, time: null } }, 4),
      gotdCopy({ 20261030: { solved: true, time: 30 }, 20261029: { solved: true, time: 20 } }, 2),
      gotdCopy({ 20261028: { solved: true, time: 22 } }, 9),
    ],
    [STREAK_KEY]: [streakCopy(), streakCopy({ last: 20002 }), streakCopy({ streak: 5, best: 7 })],
    [UNLOCK_KEY]: [unlockCopy({ tokens: 2, played: [3] }),
      unlockCopy({ tokens: -1, played: [1, 2] }),
      unlockCopy({ unlocked: { a: 4 }, choices: 3 })],
    [CREDIT_KEY]: [{ solved: 1, used: 0, bonus: 0 }, { solved: 2, used: 1, bonus: 1 },
      { solved: 5, used: 5, bonus: 0 }],
    [GIFT_KEY]: [{ v: 1, day: 5, kind: 'replay' }, { v: 1, day: 9, kind: 'unlock' },
      { v: 1, day: null, kind: null }],
    [RULES_SEEN_KEY]: [{ v: 1, seen: { a: true } }, { v: 1, seen: { b: true } },
      { v: 1, seen: { a: true, c: true } }],
  };
  for (const [key, values] of Object.entries(samples)) {
    const entries = [A, B, C].map((dev, i) => entry(dev, MERGES[key].clean(values[i])));
    const first = MERGES[key].view(entries, A);
    for (let round = 0; round < 12; round++) {
      const sorted = shuffled(entries).sort((x, y) => (x.dev < y.dev ? -1 : 1));
      assert.deepEqual(MERGES[key].view(sorted, A), first, key);
      assert.deepEqual(MERGES[key].view(entries, A), first, `${key}: pure`);
    }
  }
});
