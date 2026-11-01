// The features with a sync engine: what one device did shows on the other, without a game
// being counted twice, and each device's own storage holds only its own part.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { SYNCED_KEYS } from '../../src/core/sync/merge.js';
import { createGift } from '../../src/features/gift.js';
import { createReplay, earned } from '../../src/features/replay.js';
import { createRulesSeen } from '../../src/features/rules-seen.js';
import { createStore, GOTD_KEY, STATS_KEY } from '../../src/features/stats-store.js';
import { createStreak, STREAK_KEY } from '../../src/features/streak.js';
import { createUnlock, UNLOCK_KEY } from '../../src/features/unlock.js';
import { MIN_CAP } from '../../src/themes/pool.js';
import { slotsFor } from '../../src/themes/slots.js';
import { createSync } from '../../src/platform/sync/engine.js';
import { memoryStorage } from './helpers.js';

const SIZES = [5, 6, 7];
const DAY = 86400000;
const at = day => () => new Date(day * DAY + 3600000);
const defs = [{ id: 'a', locked: [7, 8], pool: [5, 6, 7, 8] }];
const noLog = { all: async () => [] };
const raw = async (d, key) => JSON.parse((await d.storage.get(key)).value);

async function device(enable = true) {
  const storage = memoryStorage();
  const sync = createSync({ storage });
  await sync.init();
  if (enable) await sync.enable({ p2p: true });
  return { storage, sync, port: sync.wrap(storage) };
}

// a tells b everything it has (and b a); then both look again
async function link(a, b) {
  for (const [x, y] of [[a, b], [b, a]]) {
    await x.sync.refresh();
    await y.sync.receive(x.sync.slicesFor(y.sync.have()));
  }
}

test('statistics: the other device\'s games show in the totals, once, and the '
  + 'own blob stays own', async () => {
  const [a, b] = [await device(), await device()];
  const sa = createStore(a.port, SIZES, {}, a.sync);
  const sb = createStore(b.port, SIZES, {}, b.sync);
  await sa.hydrate('20261030');
  await sb.hydrate('20261030');
  await sa.recordSolve(5, 20000, 10);
  await sa.recordSolve(5, 20000, 20);
  await sb.recordSolve(5, 20000, 30);
  assert.equal(sa.total(5).n, 2);
  await link(a, b);
  await link(a, b); // again: nothing is counted twice
  await sa.refresh();
  await sb.refresh();
  for (const s of [sa, sb]) {
    assert.equal(s.total(5).n, 3);
    assert.ok(Math.abs(s.total(5).mean - 20) < 1e-9);
    assert.equal(s.today(5, 20000).n, 3);
  }
  assert.equal((await raw(a, STATS_KEY)).t['5'][0], 2, 'A\'s blob holds A\'s two games');
  assert.equal((await raw(b, STATS_KEY)).t['5'][0], 1, 'B\'s blob holds B\'s one game');

  await sb.recordSolve(5, 20000, 40); // a new game on B shows on both after the next exchange
  assert.equal(sb.total(5).n, 4);
  assert.equal((await raw(b, STATS_KEY)).t['5'][0], 2);
  await link(a, b);
  await sa.refresh();
  assert.equal(sa.total(5).n, 4);
});

test('statistics: with sync off the store is what it always was', async () => {
  const off = await device(false);
  const store = createStore(off.port, SIZES, {}, off.sync);
  await store.hydrate('20261030');
  await store.recordSolve(6, 20000, 12);
  assert.equal(store.total(6).n, 1);
  assert.equal((await raw(off, STATS_KEY)).t['6'][0], 1);
  assert.deepEqual([...off.storage.raw.keys()], [STATS_KEY]);
});

test('Game of Day: a solve on one device is the played record on the other, '
  + 'without a resubmit', async () => {
  const [a, b] = [await device(), await device()];
  const sa = createStore(a.port, SIZES, {}, a.sync);
  const sb = createStore(b.port, SIZES, {}, b.sync);
  await sa.hydrate('20261030');
  await sb.hydrate('20261030');
  await sa.saveAttempt('20261030', { solved: true, time: 41, sent: false });
  await link(a, b);
  assert.deepEqual(await sb.loadAttempt('20261030'), { solved: true, time: 41 });
  assert.deepEqual(await sa.loadAttempt('20261030'), { solved: true, time: 41, sent: false });
  assert.equal(await sb.loadAttempt('20261030', true), null, 'what B itself played: nothing');
  assert.equal(sb.gotdSolves(), 1);
});

test('replay chances: earned anywhere, spent anywhere, the first run counts '
  + 'only own games', async () => {
  const [a, b] = [await device(), await device()];
  const storeA = createStore(a.port, SIZES, {}, a.sync);
  await storeA.hydrate('20261030');
  const ra = createReplay(a.port, storeA, at(20000), a.sync);
  await ra.init();
  await ra.addBonus();
  await ra.addBonus();
  await ra.addSolved();
  const storeB = createStore(b.port, SIZES, {}, b.sync);
  await storeB.hydrate('20261030');
  await link(a, b);
  await storeB.refresh();
  const rb = createReplay(b.port, storeB, at(20000), b.sync);
  await rb.init(); // B's first run: A's solve is in the group's records, but B did not play it
  assert.equal((await raw(b, 'zip_gotd_credit')).solved, 0);
  const expected = earned(1) + 2; // A's one solve and its two bonus chances
  assert.equal(rb.chances(), expected);
  assert.equal(ra.chances(), expected);
});

test('unlock chances: earned on one device, spent on the other, once', async () => {
  const [a, b] = [await device(), await device()];
  const ua = createUnlock(a.port, defs, at(20000), a.sync);
  const ub = createUnlock(b.port, defs, at(20000), b.sync);
  await ua.init();
  await ub.init();
  await ua.addChoice();
  await ua.addToken();
  await link(a, b);
  assert.deepEqual([ub.view().choices, ub.view().tokens], [1, 1]);
  assert.equal(await ub.takeChoice(), true);
  assert.equal(await ub.takeChoice(), false, 'one chance, spent');
  assert.equal((await raw(b, UNLOCK_KEY)).choices, -1, 'B\'s own net is below 0');
  await link(a, b);
  assert.deepEqual([ua.view().choices, ub.view().choices], [0, 0]);
  assert.equal(await ua.takeChoice(), false, 'A sees it spent too');
});

test('unlock: a variant unlocked on one device is unlocked on the other', async () => {
  const [a, b] = [await device(), await device()];
  await a.storage.set(UNLOCK_KEY, JSON.stringify({
    v: 1, unlocked: { a: 19990 }, tokens: 0, choices: 0, played: [], active: null,
  }));
  const ub = createUnlock(b.port, defs, at(20000), b.sync);
  await ub.init();
  assert.equal(ub.unlocked('a'), false);
  await link(a, b);
  assert.equal(ub.unlocked('a'), true);
});

test('streak: a solve on one device is the streak on the other; the next day '
  + 'builds on it', async () => {
  const [a, b] = [await device(), await device()];
  const sa = createStreak(a.port, noLog, at(20000), a.sync);
  const sb = createStreak(b.port, noLog, at(20000), b.sync);
  await sa.init();
  await sb.init();
  await sa.record();
  await link(a, b);
  assert.deepEqual([sb.view().streak, sb.view().today], [1, true]);
  assert.equal(await sb.record(), false, 'today is done: nothing to record');
  const tomorrow = createStreak(b.port, noLog, at(20001), b.sync);
  await tomorrow.init();
  await tomorrow.record();
  assert.equal(tomorrow.view().streak, 2, 'day two counts on A\'s day one');
  assert.equal((await raw(b, STREAK_KEY)).streak, 2);
  await link(a, b);
  const aTomorrow = createStreak(a.port, noLog, at(20001), a.sync);
  await aTomorrow.init();
  assert.equal(aTomorrow.view().streak, 2);
});

test('gift: opened on one device, opened on the other', async () => {
  const [a, b] = [await device(), await device()];
  await a.storage.set('zip_gift', JSON.stringify({ v: 1, day: 20000, kind: 'replay' }));
  const gb = createGift(b.port, null, at(20000), b.sync);
  await gb.init();
  assert.equal(gb.record().day, null);
  await link(a, b);
  assert.deepEqual(gb.record(), { day: 20000, kind: 'replay' });
});

test('rules shown: seen on one device, seen on the other', async () => {
  const [a, b] = [await device(), await device()];
  const ra = createRulesSeen(a.port, ['cutout', 'arrows'], a.sync);
  const rb = createRulesSeen(b.port, ['cutout', 'arrows'], b.sync);
  await ra.init();
  await rb.init();
  await ra.mark('cutout');
  assert.equal(rb.seen('cutout'), false);
  await link(a, b);
  assert.deepEqual([rb.seen('cutout'), rb.seen('arrows')], [true, false]);
});

test('turning sync off brings every feature back to its own data', async () => {
  const [a, b] = [await device(), await device()];
  const ra = createRulesSeen(a.port, ['cutout'], a.sync);
  const rb = createRulesSeen(b.port, ['cutout'], b.sync);
  await ra.init();
  await rb.init();
  await ra.mark('cutout');
  await link(a, b);
  assert.equal(rb.seen('cutout'), true);
  await b.sync.disable();
  assert.equal(rb.seen('cutout'), false);
  await b.sync.enable({ p2p: true });
  assert.equal(rb.seen('cutout'), true, 'the slices were kept');
  await b.sync.leave();
  assert.equal(rb.seen('cutout'), false);
});

test('GOTD_KEY is kept apart from the group: B\'s blob never holds A\'s record', async () => {
  const [a, b] = [await device(), await device()];
  const sa = createStore(a.port, SIZES, {}, a.sync);
  await sa.hydrate('20261030');
  await sa.saveAttempt('20261030', { solved: true, time: 41 });
  await link(a, b);
  const sb = createStore(b.port, SIZES, {}, b.sync);
  await sb.hydrate('20261030');
  await sb.saveAttempt('20261029', { solved: true, time: 50 });
  const own = await raw(b, GOTD_KEY);
  assert.deepEqual(Object.keys(own.a), ['20261029']);
});

test('theme slots follow the activity of all devices; the themes themselves '
  + 'stay on each device', async () => {
  const [a, b] = [await device(), await device()];
  const sa = createStore(a.port, SIZES, {}, a.sync);
  const sb = createStore(b.port, SIZES, {}, b.sync);
  await sa.hydrate('20261030');
  await sb.hydrate('20261030');
  for (let i = 0; i < 7; i++) await sa.saveAttempt(`2026100${i + 1}`, { solved: true, time: 30 });
  for (let i = 0; i < 5; i++) await sb.saveAttempt(`2026101${i}`, { solved: true, time: 30 });
  const slots = s => slotsFor({ gotdSolves: s.gotdSolves(), bestStreak: 0 });
  assert.deepEqual([slots(sa), slots(sb)], [MIN_CAP, MIN_CAP], 'each alone: 7 and 5 of 12');
  await b.sync.leave();
  await b.sync.enable({ p2p: true });
  await link(a, b);
  await sb.refresh();
  await sa.refresh();
  assert.equal(sb.gotdSolves(), 12, 'the dates of both devices');
  assert.deepEqual([slots(sa), slots(sb)], [MIN_CAP + 1, MIN_CAP + 1]);
  await b.sync.disable();
  await sb.refresh();
  assert.equal(sb.gotdSolves(), 12, 'turning sync off does not take a slot back');
});

test('the best streak of any device can earn the slot', async () => {
  const [a, b] = [await device(), await device()];
  await a.storage.set('zip_streak', JSON.stringify({
    last: 20000, streak: 30, best: 30, freezes: 0, earned: 3, prog: 2, brk: null }));
  const sb = createStreak(b.port, noLog, at(20000), b.sync);
  await sb.init();
  assert.equal(slotsFor({ gotdSolves: 0, bestStreak: sb.view().best }), MIN_CAP);
  await link(a, b);
  assert.equal(slotsFor({ gotdSolves: 0, bestStreak: sb.view().best }), MIN_CAP + 1);
});

test('nothing the themes keep is synced: not the choice, not the themes, not the trial', () => {
  const files = [...readdirSync(new URL('../../src/themes/', import.meta.url))
    .map(f => new URL(`../../src/themes/${f}`, import.meta.url)),
  ...readdirSync(new URL('../../src/ui/', import.meta.url)).filter(f => f.startsWith('theme'))
    .map(f => new URL(`../../src/ui/${f}`, import.meta.url))];
  const keys = new Set();
  for (const file of files) {
    if (!file.pathname.endsWith('.js')) continue;
    const source = readFileSync(file, 'utf8');
    for (const [key] of source.matchAll(/zip_theme[A-Za-z0-9_]*/g)) keys.add(key);
  }
  assert.ok(keys.has('zip_theme_v2') && keys.has('zip_theme') && keys.has('zip_theme_seed'));
  for (const key of keys) {
    assert.ok(!SYNCED_KEYS.some(synced => key.startsWith(synced) || synced.startsWith(key)), key);
  }
});
