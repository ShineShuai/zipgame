// Unit tests of replay of missed Games of Day, and the streak.
// Part of `npm test` (test/run.mjs); the tiers and t / ta are in test/harness.js.
import '../setup-balls.js';
import { serialize } from '../../src/core/format.js';
import { generate } from '../../src/core/gen/generate.js';
import { runSync } from '../../src/core/run.js';
import {
  utcDayNumber, utcDateString, dateOfDay, fetchGameOfDayFor,
} from '../../src/features/daily.js';
import {
  createReplay, earned, solvesToNext, stepOf, thresholdOf, REPLAY_SHOW, REPEAT_MIN_AGE,
  BACKFILL_DAYS,
} from '../../src/features/replay.js';
import {
  createStreak, play as streakPlay, current as streakNow, fresh as streakFresh, healDay,
  healable as streakHealable, progress as streakProgress, FREEZE_EVERY, FREEZE_MAX, HEAL_DAYS,
  RAMP,
} from '../../src/features/streak.js';
import { REPLAY_DAYS } from '../../src/core/hist.js';
import { createStore } from '../../src/features/stats-store.js';
import { t, ta, eq, ok, registerAsyncTests } from '../harness.js';
import { atDay, fakeStorage } from './helpers.js';

const gotdDay = (clock, k) => dateOfDay(utcDayNumber(clock()) - k); // the date k UTC days before the fake clock

const setup = async (clock = atDay(19), records = {}) => { // records: days back -> attempt record
  const st = fakeStorage(), store = createStore(st, [5]); await store.hydrate(dateOfDay(utcDayNumber(clock())));
  for (const [k, rec] of Object.entries(records)) await store.saveAttempt(gotdDay(clock, +k), rec);
  const R = createReplay(st, store, clock); await R.init(); return { st, store, R };
};

t('daily: dateOfDay inverts utcDayNumber across month and year ends', () => {
  for (const d of [new Date(Date.UTC(2026, 8, 30, 23, 59)), new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2025, 11, 31, 12)), new Date(Date.UTC(2024, 1, 29))]) eq(dateOfDay(utcDayNumber(d)), utcDateString(d));
  eq(dateOfDay(utcDayNumber(new Date(Date.UTC(2026, 0, 1))) - 1), '20251231');
});

ta('daily: fetchGameOfDayFor reads that date\'s file, null when missing; only today\'s file bypasses the cache', async () => {
  const realFetch = globalThis.fetch, calls = [];
  const puzzle = serialize(runSync(generate(5, 1))); // a valid puzzle file
  globalThis.fetch = async (url, init) => { calls.push([url, init]); return url.endsWith('20260918.txt') ? { ok: true, text: async () => puzzle } : { ok: false, text: async () => '' }; };
  try {
    const p = await fetchGameOfDayFor('20260918'); ok(p && p.n === 5 && p.gotdDate === '20260918'); eq(calls[0], ['../demo/GameOfDay/20260918.txt', undefined]);
    eq(await fetchGameOfDayFor('20260917'), null);
    await fetchGameOfDayFor('20260918', { fresh: true }); eq(calls[2][1], { cache: 'no-store' });
  } finally { globalThis.fetch = realFetch; }
});

ta('replay: chances come after 1, 2 more, 3 more, then every 5 more solves; toNext counts the solves still needed', async () => {
  const chances = [0, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4], toNext = [1, 2, 1, 3, 2, 1, 5, 4, 3, 2, 1, 5, 4];
  eq([chances.map((_, i) => earned(i)), toNext.map((_, i) => solvesToNext(i))], [chances, toNext]);
  eq([earned(16), solvesToNext(16), earned(100), solvesToNext(100)], [5, 5, 21, 1]);
  const { R } = await setup(); eq([R.chances(), R.toNext()], [0, 1]);
  for (let i = 1; i <= 12; i++) { await R.addSolved(); eq([R.chances(), R.toNext()], [chances[i], toNext[i]], 'after ' + i); }
});

ta('replay: window = yesterday .. REPLAY_DAYS days back (today excluded), newest first; across a year end', async () => {
  const clock = atDay(19), { R } = await setup(clock); eq(R.dates().length, REPLAY_DAYS); eq([R.dates()[0], R.dates().at(-1)], [gotdDay(clock, 1), gotdDay(clock, REPLAY_DAYS)]);
  const ny = () => new Date(Date.UTC(2026, 0, 3, 23, 59)), { R: N } = await setup(ny); eq(N.dates()[0], '20260102'); ok(N.dates().includes('20251231') && !N.dates().includes('20260103'), 'crosses the year end, today left out');
});

ta('replay: missed = window dates without an attempt record; an unsolved (abandoned) record is not missed', async () => {
  ok(REPLAY_DAYS >= 4, 'the fixture needs a window of at least 4 days'); const clock = atDay(19), N = REPLAY_DAYS, g = k => gotdDay(clock, k);
  const { R } = await setup(clock, { 0: { solved: true, time: 30 }, 1: { solved: true, time: 20 }, 3: { solved: false, time: null }, [N]: { solved: true, time: 50 }, [N + 1]: { solved: true, time: 50 } });
  const m = await R.missed(); eq(m.length, N - 3, 'window days minus the 3 that have a record (1, 3 and N days back; 0 and N+1 are outside)');
  eq([g(1), g(3), g(N)].map(d => m.includes(d)), [false, false, false]); eq([g(2), g(4)].map(d => m.includes(d)), [true, true]);
  eq(m[0], g(2), 'newest first');
});

ta('replay: days() = every window date, newest first, with its stored record (null = missed); nothing outside the window', async () => {
  const solved = { solved: true, time: 21.5, sent: true, stats: { n: 4, mean: 30, top: null, pct: 50 } }, abandoned = { solved: false, time: null };
  ok(REPLAY_DAYS >= 4, 'the fixture needs a window of at least 4 days'); const clock = atDay(19), N = REPLAY_DAYS;
  const { R } = await setup(clock, { 0: { solved: true, time: 9 }, 1: solved, 3: abandoned, [N]: solved, [N + 1]: solved });
  const d = await R.days(); eq(d.length, N); eq([d[0].date, d[N - 1].date], [gotdDay(clock, 1), gotdDay(clock, N)]);
  eq(d.map(x => x.attempt === null ? 'missed' : x.attempt.solved ? 'played' : 'abandoned'), Array.from({ length: N }, (_, i) => i === 0 || i === N - 1 ? 'played' : i === 2 ? 'abandoned' : 'missed'));
  eq(d[0].attempt, solved, 'the stored stats come back as they were saved');
  eq((await R.missed()).length, N - 3);
});

ta('replay: begin spends one chance, marks the date played, and refuses without a chance, outside the window, or twice', async () => {
  ok(REPLAY_DAYS >= 3, 'the fixture needs a window of at least 3 days'); const clock = atDay(19), g = k => gotdDay(clock, k), N = REPLAY_DAYS;
  const { R, store } = await setup(clock);
  eq(await R.begin(g(2)), false, 'no chance yet'); for (let i = 0; i < 6; i++) await R.addSolved(); eq(R.chances(), 3);
  eq(await R.begin(g(0)), false, 'today is not a replay'); eq(await R.begin(g(N + 1)), false, 'one day past the window is outside'); eq(R.chances(), 3);
  eq(await R.begin(g(2)), true); eq(R.chances(), 2); eq(store.attemptOn(g(2)), { solved: false, time: null });
  eq(await R.begin(g(2)), true, 'abandoned: offered again'); eq(R.chances(), 1);
  eq(await R.begin(g(N)), true, 'the oldest day of the window'); eq(R.chances(), 0); eq(await R.begin(g(3)), false, 'chances used up');
  eq((await R.missed()).includes(g(2)), false);
});

ta('replay: counters persist; the first init counts the solves recorded before the feature existed, once', async () => {
  const clock = atDay(19), st = fakeStorage(), store = createStore(st, [5]); await store.hydrate('20260919');
  for (const [k, rec] of [[0, { solved: true, time: 9 }], [2, { solved: true, time: 9 }], [5, { solved: false, time: null }], [9, { solved: true, time: 9 }], [BACKFILL_DAYS, { solved: true, time: 9 }], [BACKFILL_DAYS + 1, { solved: true, time: 9 }]]) await store.saveAttempt(dateOfDay(utcDayNumber(clock()) - k), rec);
  const A = createReplay(st, store, clock); await A.init(); eq([A.chances(), A.toNext()], [2, 2], '4 solves counted (the unsolved record and the one past the scan are not)');
  await A.addSolved(); const B = createReplay(st, createStore(st, [5]), clock); await B.init(); eq([B.chances(), B.toNext()], [2, 1], 'reloaded: 5 solved, not recounted');
  await store.saveAttempt('20260918', { solved: true, time: 9 }); const C = createReplay(st, store, clock); await C.init(); eq(C.toNext(), 1, 'a stored counter is never rebuilt from records');
});

ta('replay: a corrupt counter is rebuilt from the records; before init there are no chances', async () => {
  const st = fakeStorage(), store = createStore(st, [5]); await store.hydrate('20260919'); await store.saveAttempt('20260919', { solved: true, time: 9 });
  await st.set('zip_gotd_credit', '{"solved":-1}'); const R = createReplay(st, store, atDay(19)); eq([R.chances(), R.toNext()], [0, 1]); await R.init(); eq([R.chances(), R.toNext()], [1, 2]);
});

ta('replay: unsent = solved attempts of today and the window the backend never acknowledged', async () => {
  ok(REPLAY_DAYS >= 6, 'the fixture needs a window of at least 6 days');
  const { R } = await setup(atDay(19), { 0: { solved: true, time: 30, sent: false }, 2: { solved: true, time: 41.5, sent: false }, 4: { solved: true, time: 20, sent: true }, 5: { solved: true, time: 20 }, 6: { solved: false, time: null }, [REPLAY_DAYS + 1]: { solved: true, time: 7, sent: false } });
  eq(await R.unsent(), [{ date: '20260919', time: 30 }, { date: '20260917', time: 41.5 }]);
});

ta('replay: repeats = solved window dates older than REPEAT_MIN_AGE days, slowest first, then oldest first', async () => {
  ok(REPLAY_DAYS > REPEAT_MIN_AGE + 5, 'the fixture needs a window longer than the minimum age'); const clock = atDay(19), A = REPEAT_MIN_AGE, g = k => gotdDay(clock, k);
  const { R } = await setup(clock, { [A]: { solved: true, time: 99 }, [A + 1]: { solved: true, time: 20 }, [A + 2]: { solved: true, time: 50 }, [A + 3]: { solved: true, time: 50 },
    [A + 4]: { solved: false, time: null }, 5: { solved: true, time: 200 }, [REPLAY_DAYS + 1]: { solved: true, time: 300 } });
  eq((await R.repeats()).map(x => x.date), [g(A + 3), g(A + 2), g(A + 1)], 'the 99 s day is only A days old, the abandoned and out-of-window ones are no repeats');
  eq((await R.repeats())[0].attempt, { solved: true, time: 50 });
});

ta('replay: a repeat spends a chance and keeps its record; a solved recent day refuses, an abandoned one can be played again', async () => {
  const clock = atDay(19), A = REPEAT_MIN_AGE, g = k => gotdDay(clock, k), rec = { solved: true, time: 33.3, sent: true };
  const { R, store } = await setup(clock, { [A + 1]: rec, [A]: { solved: true, time: 10 }, 3: { solved: false, time: null } });
  for (let i = 0; i < 6; i++) await R.addSolved(); const before = R.chances();
  eq(await R.begin(g(A + 1)), true); eq(R.chances(), before - 1); eq(store.attemptOn(g(A + 1)), rec, 'the record is untouched');
  eq(await R.begin(g(A)), false, 'a solved day younger than the minimum age'); eq(R.chances(), before - 1);
  eq(await R.begin(g(3)), true, 'an abandoned day'); eq(store.attemptOn(g(3)), { solved: false, time: null }); eq(R.chances(), before - 2);
});

t('replay: stepOf = progress inside the current price step (dots of the menu panel)', () => {
  eq([0, 1, 2, 3, 5, 6, 8, 11].map(s => stepOf(s)), [{ done: 0, total: 1 }, { done: 0, total: 2 }, { done: 1, total: 2 }, { done: 0, total: 3 }, { done: 2, total: 3 }, { done: 0, total: 5 }, { done: 2, total: 5 }, { done: 0, total: 5 }]);
  eq([0, 1, 2, 3, 4].map(thresholdOf), [0, 1, 3, 6, 11]);
});

ta('replay: a streak milestone adds one chance, once initialised', async () => {
  const clock = atDay(19), { R } = await setup(clock, { 2: { solved: true, time: 9 } }); eq(R.chances(), 1, 'the one backfilled solve'); await R.addBonus(); eq(R.chances(), 2);
  const st = fakeStorage(), cold = createReplay(st, createStore(st, [5]), clock); await cold.addBonus(); eq(cold.chances(), 0, 'before init there is nothing to add to');
});

ta('replay: pick = the newest missed days with a file, filled up to REPLAY_SHOW with the slowest old solved days', async () => {
  const clock = atDay(19), A = REPEAT_MIN_AGE, N = REPLAY_DAYS, g = k => gotdDay(clock, k), rec = {};
  for (let k = 1; k <= N; k++) rec[k] = { solved: true, time: k > A ? 10 + k : 5 };
  for (const k of [3, 4, 5, 6, 7, 8, 9, 10]) delete rec[k]; rec[2] = { solved: false, time: null };
  const files = new Set([...Array.from({ length: N }, (_, i) => g(i + 1))].filter(d => d !== g(6))); // every day has a file but the 6th
  const { R } = await setup(clock, rec), pick = await R.pick(async d => files.has(d));
  eq(pick.map(x => x.date), [g(3), g(4), g(5), g(7), g(8), g(9), g(10), g(N)], '7 missed (day 6 has no file), then the slowest; the abandoned day waits');
  eq(pick.map(x => x.attempt === null), [true, true, true, true, true, true, true, false]);
});

ta('replay: pick with no missed day = at most one abandoned day (the newest), then the slowest old solved days', async () => {
  const clock = atDay(19), A = REPEAT_MIN_AGE, N = REPLAY_DAYS, g = k => gotdDay(clock, k), rec = {};
  for (let k = 1; k <= N; k++) rec[k] = { solved: true, time: k > A ? 10 + k : 5 };
  rec[2] = { solved: false, time: null }; rec[5] = { solved: false, time: null };
  const { R } = await setup(clock, rec), pick = await R.pick(async () => true);
  eq(pick.length, REPLAY_SHOW); eq(pick[0], { date: g(2), attempt: { solved: false, time: null } });
  eq(pick.slice(1).map(x => x.date), Array.from({ length: REPLAY_SHOW - 1 }, (_, i) => g(N - i)));
  eq((await R.pick(async d => d !== g(2))).map(x => x.date)[0], g(5), 'the next abandoned day when the newest has no file');
});

ta('replay: pick offers the days that heal the streak first (marked heal): unplayed ones with a file only', async () => {
  const clock = atDay(19), N = REPLAY_DAYS, g = k => gotdDay(clock, k), rec = {}, all = async () => true;
  for (let k = 1; k <= N; k++) rec[k] = { solved: true, time: 5 };
  for (const k of [3, 4, 5, 6, 7, 8, 9, 10]) delete rec[k]; rec[2] = { solved: false, time: null };
  const { R } = await setup(clock, rec), pick = await R.pick(all, [g(9), g(2), g(1)]); // g(1) is solved: never pinned
  eq(pick.map(x => x.date), [g(2), g(9), g(3), g(4), g(5), g(6), g(7), g(8)], 'pinned days first, newest first, then the missed days');
  eq(pick.map(x => x.heal === true), [true, true, false, false, false, false, false, false]); ok(!('heal' in pick[2]));
  eq((await R.pick(all, [g(9)])).map(x => x.date), [g(9), g(3), g(4), g(5), g(6), g(7), g(8), g(10)]);
  eq((await R.pick(async d => d !== g(9), [g(9)])).map(x => x.date)[0], g(3), 'a pinned day without a file is left out');
});

t('replay: the replay window reaches past the repeat age (else no day could ever be a repeat)', () => { ok(REPLAY_DAYS > REPEAT_MIN_AGE); });

const vet = () => ({ ...streakFresh(), earned: RAMP.length }); // a player past the ramp: a reward every FREEZE_EVERY days

const sPlay = (days, from = vet()) => days.reduce(streakPlay, from);

const span = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// The days of an unbroken streak from day 1 that earn a reward: after RAMP[0] days, RAMP[1] more, ..., then every FREEZE_EVERY.
const rewardDays = upto => {
  const days = [];
  for (let day = 0, k = 0; (day += RAMP[k++] ?? FREEZE_EVERY) <= upto;) days.push(day);
  return days;
};

t('streak: consecutive days count; the same day twice and an earlier day change nothing', () => {
  const s = sPlay([10, 11, 12]); eq([s.streak, s.best, s.last], [3, 3, 12]);
  eq(streakPlay(s, 12), s); eq(streakPlay(s, 5), s);
});

t('streak: a freeze is earned every FREEZE_EVERY streak days, capped at FREEZE_MAX', () => {
  const run = n => sPlay(Array.from({ length: n }, (_, i) => 100 + i));
  eq([run(FREEZE_EVERY - 1).freezes, run(FREEZE_EVERY).freezes, run(2 * FREEZE_EVERY).freezes, run(5 * FREEZE_EVERY).freezes], [0, 1, 2, FREEZE_MAX]);
});

t('streak: a freeze covers a missed day (streak goes on, freeze spent); a longer gap restarts at 1 and keeps the freezes', () => {
  const week = Array.from({ length: FREEZE_EVERY }, (_, i) => 100 + i), last = 100 + FREEZE_EVERY - 1;
  const kept = streakPlay(sPlay(week), last + 2); eq([kept.streak, kept.freezes], [FREEZE_EVERY + 1, 0], 'one day missed, one freeze');
  const lost = streakPlay(sPlay(week), last + 3); eq([lost.streak, lost.freezes, lost.best], [1, 1, FREEZE_EVERY], 'two days missed, one freeze: restart');
  eq(streakPlay(streakFresh(), 7).streak, 1); eq(streakPlay(sPlay([1, 2]), 5).streak, 1, 'no freeze: restart');
});

ta('streak: record() answers true on the first solve of a reward day only (the ramp, then every FREEZE_EVERY)', async () => {
  let d = 1; const S = createStreak(fakeStorage(), { all: async () => [] }, () => new Date(Date.UTC(2026, 0, d, 12))); await S.init();
  const won = []; for (; d <= 18; d++) { if (await S.record()) won.push(d); eq(await S.record(), false, 'the second solve of a day'); }
  eq(won, rewardDays(18));
});

t('streak: current() shows 0 once the gap exceeds the freezes left', () => {
  const s = sPlay(Array.from({ length: FREEZE_EVERY }, (_, i) => 100 + i)), l = s.last; // 1 freeze
  eq([streakNow(s, l), streakNow(s, l + 1), streakNow(s, l + 2), streakNow(s, l + 3), streakNow(streakFresh(), 5)], [7, 7, 7, 0, 0]);
});

ta('streak: record() counts any solve once per day and persists; the first init rebuilds it from the play log', async () => {
  const st = fakeStorage(), day = k => new Date(Date.UTC(2026, 8, k, 12)), at = k => day(k).getTime();
  const log = { all: async () => [{ at: at(17), solved: true }, { at: at(18), solved: true }, { at: at(18), solved: true }, { at: at(14), solved: false }] };
  let now = day(19); const S = createStreak(st, log, () => now); eq(S.view(), null, 'nothing before init'); await S.init();
  eq(S.view(), { streak: 2, best: 2, freezes: 1, today: false }, 'days 17 and 18 from the log (the 2nd day earns the first reward); the unsolved record counts for nothing');
  eq(await S.record(), false); eq(await S.record(), false); eq(S.view(), { streak: 3, best: 3, freezes: 1, today: true });
  const B = createStreak(st, { all: async () => [] }, () => now); await B.init(); eq(B.view().streak, 3, 'stored, not rebuilt');
  now = day(25); eq(B.view().streak, 0, 'a gap without freezes ends it');
  await st.set('zip_streak', '{"streak":-1}'); const C = createStreak(st, log, () => day(19)); await C.init(); eq(C.view().streak, 2, 'corrupt state is rebuilt');
});

t('streak: rewards come after the ramp days, then every FREEZE_EVERY; a restart resets the progress, not the count', () => {
  const horizon = RAMP.reduce((a, b) => a + b, 0) + 2 * FREEZE_EVERY;
  let s = streakFresh(); const won = [];
  for (let d = 1; d <= horizon; d++) { const n = streakPlay(s, d); if (n.earned > s.earned) won.push(d); s = n; }
  eq(won, rewardDays(horizon));
  const first = RAMP[0], two = sPlay(span(1, first), streakFresh()); eq([two.earned, two.prog, two.freezes], [1, 0, 1]);
  const back = first + 7; // six days missed, one freeze
  const b = streakPlay(two, back); eq([b.streak, b.earned, b.prog], [1, 1, 1], 'six days missed, one freeze: restart, the first reward stays earned');
  eq(sPlay([back + 1], b).earned, 1); eq(sPlay(span(back + 1, back + RAMP[1] - 1), b).earned, 2, 'the second reward needs RAMP[1] days, the restart day included');
});

t('streak: progress() = days done, days needed, days to go; full right after a reward, empty once the streak is gone', () => {
  const at = (s, d) => streakProgress(s, d), n0 = streakFresh(), one = streakPlay(n0, 1), two = streakPlay(one, 2), three = streakPlay(two, 3);
  eq(at(n0, 1), { on: 0, total: 2, left: 2 }); eq(at(one, 1), { on: 1, total: 2, left: 1 });
  eq(at(two, 2), { on: 2, total: 2, left: 3 }, 'the bar of the reward just earned, then the next one needs 3');
  eq(at(three, 3), { on: 1, total: 3, left: 2 }); eq(at(one, 9), { on: 0, total: 2, left: 2 }, 'a gap the freezes cannot cover');
});

ta('streak: a state saved before rewards were counted keeps the plain FREEZE_EVERY cycle', async () => {
  const st = fakeStorage(), u = d => Math.floor(Date.UTC(2026, 0, d, 12) / 86400000);
  await st.set('zip_streak', JSON.stringify({ last: u(9), streak: 9, best: 9, freezes: 1 }));
  const S = createStreak(st, { all: async () => [] }, () => new Date(Date.UTC(2026, 0, 10, 12))); await S.init();
  eq(S.progress(), { on: 2, total: 7, left: 5 }); eq(S.view().streak, 9);
});

t('streak: healing a day a freeze covered gives the freeze back, counts the day, and is capped at FREEZE_MAX', () => {
  const s = streakPlay(sPlay(span(100, 106)), 108); // 7 days (1 freeze), day 107 missed
  eq([s.streak, s.freezes, streakHealable(s, 108)], [8, 0, [107]]);
  const r = healDay(s, 107, 108); eq([r.state.streak, r.state.freezes, r.rewards, r.state.brk], [9, 1, 0, null]);
  eq(healDay(r.state, 107, 108), null, 'once');
  const w = streakPlay(sPlay(span(100, 113)), 115); eq([w.freezes, w.streak], [1, 15]); // 14 days (2 freezes), day 114 missed
  const full = sPlay(span(116, 121), w); eq([full.freezes, full.streak], [2, 21], 'a reward refilled the freezes');
  const c = healDay(full, 114, 121); eq([c.state.freezes, c.state.streak], [FREEZE_MAX, 22], 'refund above the cap is lost; the day still counts');
  eq(healDay(full, 114, 122), null, 'only HEAL_DAYS after the missed day'); ok(HEAL_DAYS >= 2);
});

t('streak: a healed day that reaches a reward day grants it', () => {
  const s = streakPlay({ ...sPlay(span(100, 104)), freezes: 1 }, 106); // streak 5, day 105 missed (freeze), solved 106: streak 6
  eq([s.streak, s.freezes, s.prog], [6, 0, 6]);
  const r = healDay(s, 105, 106); eq([r.state.streak, r.state.freezes, r.rewards, r.state.prog], [7, 2, 1, 0], 'refund + the reward\'s freeze');
});

t('streak: healing the days of a broken gap joins the streaks again (heal days count); a partial heal counts only what touches the new streak', () => {
  const one = streakPlay(sPlay(span(100, 105)), 107); // 6 days, no freeze, day 106 missed: broken
  eq([one.streak, one.freezes, streakHealable(one, 107)], [1, 0, [106]]);
  const a = healDay(one, 106, 107); eq([a.state.streak, a.state.best, a.state.freezes, a.rewards, a.state.prog], [8, 8, 1, 1, 1], '6 + healed + today: crosses day 7');
  const two = streakPlay(sPlay(span(100, 104)), 107); eq(streakHealable(two, 107), [106, 105]);
  const p = healDay(two, 105, 107); eq([p.state.streak, p.rewards], [1, 0], 'one of two days: still broken');
  const q = healDay(p.state, 106, 107); eq([q.state.streak, q.rewards, q.state.freezes], [8, 1, 1]);
  const f = streakPlay(sPlay(span(100, 104)), 107); const part = healDay(f, 106, 107); // 1 of 2 healed, nothing covers the other: still broken, but day 106 touches the new streak
  eq([part.state.streak, part.state.brk.frozen], [2, false]);
  const cover = healDay({ ...f, freezes: 1 }, 106, 107);
  eq([cover.state.streak, cover.state.freezes, cover.state.brk.frozen], [7, 1, true], 'a freeze covers the day still missed; 5 + 1 + 1 is a reward day');
  eq(healDay(cover.state, 105, 107).state.freezes, 2, 'the covered day can still be healed: its freeze comes back');
});

t('streak: only the latest gap can be healed, and healable() lists the open days newest first', () => {
  const s = streakPlay(streakPlay(sPlay(span(100, 102)), 105), 108); // gaps 103-104, then 106-107
  eq(streakHealable(s, 108), [107, 106]); eq(healDay(s, 104, 108), null, 'an older gap');
  const late = sPlay(span(100, 102)); eq(streakHealable(late, 106), [105, 104, 103], 'open days since the last solve');
  eq(streakHealable(late, 102 + HEAL_DAYS + FREEZE_MAX + 2), [], 'a gap too long to repair'); eq(streakHealable(streakFresh(), 5), []);
  eq(streakHealable(late, 111), [110, 109, 108, 107, 106, 105, 104], 'only the last HEAL_DAYS days');
});

const brokenGap = () => streakPlay(sPlay(span(100, 100)), 107); // day 100 solved, 101-106 missed, 107 solved: broken, streak 1

t('streak: a healed day right before the new streak joins it (+1) while the gap stays broken; days apart from it count once they connect', () => {
  const s = brokenGap(); eq([s.streak, s.prog, s.freezes], [1, 1, 0]);
  const a = healDay(s, 106, 107); eq([a.state.streak, a.state.best, a.state.prog, a.rewards, a.state.brk.x], [2, 2, 2, 0, 1]);
  const next = streakPlay(a.state, 108); eq([next.streak, next.prog], [3, 3], 'the next solve goes on from the longer streak');
  const apart = healDay(s, 104, 107); eq([apart.state.streak, apart.state.prog, apart.state.brk.x ?? 0], [1, 1, 0], 'not touching the new streak: nothing yet');
  const bridge = healDay(healDay(apart.state, 105, 107).state, 106, 107); eq([bridge.state.streak, bridge.state.brk.x], [4, 3], '104-106 connect: 3 days join at once');
  eq(healDay(a.state, 106, 107), null, 'once');
  const both = healDay(healDay(s, 106, 107).state, 105, 107); eq(both.state.streak, 3, 'two days, one after the other');
});

t('streak: the healed days counted into a broken streak are not counted twice when the gap is joined again', () => {
  const two = streakPlay(sPlay(span(100, 104)), 107); // 5 days, 105-106 missed, no freeze: broken
  const near = healDay(healDay(two, 106, 107).state, 105, 107).state, far = healDay(healDay(two, 105, 107).state, 106, 107).state;
  eq([near.streak, near.brk], [8, null], '5 + 2 healed + day 107 = 8');
  eq([far.streak, far.earned, far.prog, far.freezes], [near.streak, near.earned, near.prog, near.freezes], 'the order changes nothing');
  eq(healDay(healDay({ ...two, freezes: 1 }, 106, 107).state, 105, 107).state.streak, 8, 'with a freeze covering the last day');
});

t('streak: a healed day that touches the new streak and reaches a reward day grants it, once', () => {
  const s = { ...brokenGap(), prog: 6 }; // 6 of 7 days: the next streak day is a reward day
  const r = healDay(s, 106, 107); eq([r.state.streak, r.rewards, r.state.earned - s.earned, r.state.prog, r.state.freezes], [2, 1, 1, 0, 1]);
  const again = healDay(r.state, 105, 107); eq([again.rewards, again.state.streak], [0, 3], 'the next healed day: no second reward');
});

ta('streak: a state saved before healed days counted into a broken streak is repaired on load; its rewards come back from init()', async () => {
  const st = fakeStorage(), u = d => Math.floor(Date.UTC(2026, 9, d, 12) / 86400000), now = () => new Date(Date.UTC(2026, 9, 19, 12));
  const saved = { last: u(19), streak: 2, best: 2, freezes: 0, earned: 3, prog: 2, brk: { from: u(11), to: u(18), a: 1, e: 3, p: 1, frozen: false, healed: [u(17)] } };
  await st.set('zip_streak', JSON.stringify(saved));
  const S = createStreak(st, { all: async () => [] }, now); eq(await S.init(), { rewards: 0 });
  eq([S.view().streak, S.view().best, S.progress().on], [3, 3, 3], 'days 17, 18, 19');
  const stored = JSON.parse((await st.get('zip_streak')).value); eq([stored.streak, stored.prog, stored.brk.x], [3, 3, 1], 'saved');
  const B = createStreak(st, { all: async () => [] }, now); eq(await B.init(), { rewards: 0 }); eq(B.view().streak, 3, 'a second load does not count it again');
  await st.set('zip_streak', JSON.stringify({ ...saved, prog: 6 }));
  const C = createStreak(st, { all: async () => [] }, now); eq(await C.init(), { rewards: 1 }, 'the counted day reaches a reward day'); eq(C.view().streak, 3);
  await st.set('zip_streak', JSON.stringify({ ...saved, brk: { ...saved.brk, x: 'bad' } }));
  const D = createStreak(st, { all: async () => [] }, now); eq(await D.init(), { rewards: 0 }); eq(D.view().streak, 2, 'a damaged gap record is dropped, as before');
});

ta('streak: heal() after record() — rewards returned, state persisted, a second heal refused', async () => {
  const st = fakeStorage(), u = d => Math.floor(Date.UTC(2026, 0, d, 12) / 86400000); let d = 8;
  await st.set('zip_streak', JSON.stringify({ last: u(5), streak: 5, best: 5, freezes: 0, earned: RAMP.length, prog: 5, brk: null }));
  const S = createStreak(st, { all: async () => [] }, () => new Date(Date.UTC(2026, 0, d, 12))); await S.init();
  eq(S.healable(), [u(7), u(6)]); eq(await S.record(), false); eq(S.view().streak, 1);
  eq(await S.heal(u(7)), { rewards: 0 }); eq(S.view().streak, 2, 'half healed: day 7 touches today\'s streak'); eq(S.healable(), [u(6)]);
  eq(await S.heal(u(6)), { rewards: 1 }); eq(S.view(), { streak: 8, best: 8, freezes: 1, today: true });
  eq(await S.heal(u(6)), null); eq(S.healable(), []);
  const B = createStreak(st, { all: async () => [] }, () => new Date(Date.UTC(2026, 0, d, 12))); await B.init(); eq(B.view().streak, 8, 'stored');
  const old = createStreak(fakeStorage(), { all: async () => [] }); eq(await old.heal(u(1)), null, 'before init');
});

ta('replay: beginShared opens a missed window day without spending a chance; same window / once rules; refuses before init()', async () => {
  const clock = atDay(19), { R, store } = await setup(clock, { 2: { solved: false, time: null } }), g = k => gotdDay(clock, k);
  eq(await R.beginShared(g(3)), true);
  eq(store.attemptOn(g(3)), { solved: false, time: null }, 'the date is spent, like begin()');
  eq(R.chances(), 0);
  eq(await R.beginShared(g(3)), false, 'once per date');
  eq(await R.beginShared(g(2)), false, 'already has a record');
  eq(await R.beginShared(g(REPLAY_DAYS + 1)), false, 'outside the window');
  eq(await R.beginShared(g(0)), false, 'today is the live game, not a replay');
  await R.addSolved();
  eq([R.chances(), R.toNext()], [1, 2], 'solving it counts towards the next replay chance');
  const chances = R.chances();
  eq(await R.beginShared(g(4)), true);
  eq(R.chances(), chances, 'a shared replay costs no chance');
  const st = fakeStorage(), cold = createReplay(st, createStore(st, [5]), clock);
  eq(await cold.beginShared(g(5)), false, 'before init() there is no credit to count the solve in');
});

registerAsyncTests();
