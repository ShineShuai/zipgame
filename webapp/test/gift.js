// Tests of the happiest-day gift: the rule (core/gift.js) and its state (features/gift.js). Registered by
// tests.js: giftTests(t, ta, ok, eq).
import { chain, monthRows, giftDay, isGiftDay, lastGift, nextGift, firstGift, recentGifts, giftInfo } from '../src/core/gift.js';
import { createGift, sanitize, present, listDays, drawKind, GIFT_KEY, OPEN_DAYS, LIST_DAYS } from '../src/features/gift.js';
import { releaseDays } from '../src/features/solid-release.js';
import { SOLID_RELEASE } from '../src/config.js';
import { EN, ZH } from '../src/ui/i18n.js';

const day = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000;
const ymd = d => new Date(d * 86400000).toISOString().slice(0, 10);
const memory = (init = {}) => {
  const map = new Map(Object.entries(init));
  return { map, async get(k) { return map.has(k) ? { value: map.get(k) } : null; }, async set(k, v) { map.set(k, v); } };
};
const at = d => () => new Date(d * 86400000);
// The 1st of the i-th month counted from the month of `ref` (0 = the month of ref).
const firstOfMonth = (ref, i) => {
  const d = new Date(ref * 86400000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1) / 86400000;
};
// The happiest day of each of the first `count` months with one: the months after the month of `ref`.
const gifts = (ref, count) => Array.from({ length: count }, (_, i) => giftDay(ref, firstOfMonth(ref, i + 1)));

export function giftTests(t, ta, ok, eq) {
  t('gift: chain of known numbers (steps, peak); only positive integers', () => {
    eq(chain(1), { happy: true, steps: 0, peak: 1 });
    eq(chain(13), { happy: true, steps: 2, peak: 13 });
    eq(chain(7), { happy: true, steps: 5, peak: 130 });
    eq(chain(100), { happy: true, steps: 1, peak: 100 });
    eq(chain(4), { happy: false, steps: 8, peak: 145 }, 'in the cycle: 8 steps until 4 comes back');
    eq(chain(2), { happy: false, steps: 9, peak: 145 }, 'one step before the cycle');
    eq([...Array(100).keys()].map(i => i + 1).filter(n => chain(n).happy),
      [1, 7, 10, 13, 19, 23, 28, 31, 32, 44, 49, 68, 70, 79, 82, 86, 91, 94, 97, 100]);
    for (const bad of [0, -3, 1.5, NaN]) {
      let threw = false;
      try { chain(bad); } catch (e) { threw = e instanceof RangeError; }
      ok(threw, `${bad} must throw`);
    }
  });

  t('gift: from n = 244 on the chain never climbs above n (key 3 is then "the later day")', () => {
    for (let n = 244; n < 100000; n++) if (chain(n).peak !== n) throw new Error(`peak of ${n}`);
    ok(chain(68).peak > 68 && chain(7).peak > 7, 'small numbers do climb');
  });

  t('gift: reference day 2026-12-01: its own month has no happiest day; the first is 2027-01-01 (n = 32), then 68 (tie with 86, earlier), 100, 130', () => {
    const ref = day(2026, 12, 1);
    eq(monthRows(ref, ref), [], 'the month of the reference day has no days that count');
    eq([giftDay(ref, ref), giftDay(ref, day(2026, 12, 31)), giftDay(ref, day(2026, 11, 15))], [null, null, null]);
    const wins = gifts(ref, 12);
    eq(wins.map(ymd), ['2027-01-01', '2027-02-06', '2027-03-10', '2027-04-09', '2027-05-25', '2027-06-26',
      '2027-07-18', '2027-08-20', '2027-09-27', '2027-10-06', '2027-11-03', '2027-12-18']);
    eq(wins.map(d => d - ref + 1).slice(0, 4), [32, 68, 100, 130]);
    eq(firstGift(ref), wins[0]);
    const feb = monthRows(ref, day(2027, 2, 10));
    eq(feb.length, 28, 'a whole month');
    const [a, b] = [68, 86].map(n => feb.find(r => r.n === n));
    eq([a.steps, a.peak, b.steps, b.peak], [2, 100, 2, 100], 'a full tie: the earlier day wins');
  });

  t('gift: a late reference day: the rest of its month is skipped too; the first gift comes in the next month', () => {
    const ref = day(2026, 11, 28);
    eq([giftDay(ref, ref), giftDay(ref, day(2026, 11, 30)), lastGift(ref, day(2026, 11, 30))], [null, null, null]);
    eq(ymd(firstGift(ref)), '2026-12-07', 'n = 10 reaches 1 in one step');
    eq(ymd(giftDay(ref, day(2026, 12, 15))), '2026-12-07');
    eq(monthRows(ref, day(2026, 10, 15)), [], 'a month before ref has no days');
    eq([nextGift(ref, day(2026, 10, 1)), nextGift(ref, ref), nextGift(ref, day(2026, 12, 6)), nextGift(ref, day(2026, 12, 7))].map(ymd),
      ['2026-12-07', '2026-12-07', '2026-12-07', '2027-01-15']); // Jan: n = 49 climbs to 130, n = 44 not: both take 4 steps
    eq(day(2026, 12, 1) === firstOfMonth(ref, 1), true);
    eq([giftDay(null, ref), lastGift(null, ref), nextGift(null, ref), firstGift(null), isGiftDay(null, ref)], [null, null, null, null, false]);
  });

  t('gift: a month without a happy number falls back to the fewest steps until a number repeats', () => {
    const ref = day(2026, 12, 1), d = day(2036, 6, 15);
    const rows = monthRows(ref, d);
    ok(!rows.some(r => r.happy), 'June 2036 holds no happy number');
    eq(ymd(giftDay(ref, d)), '2036-06-10');
    const win = rows.find(r => r.day === giftDay(ref, d));
    eq([win.n, win.steps], [3480, 9]);
    ok(rows.every(r => r.steps > win.steps || (r.steps === win.steps && r.peak <= win.peak)), 'nobody beats it');
  });

  t('gift: reference 2026-11-28, 120 months: 47 months tie on the steps alone, 1 on steps and peak', () => {
    const ref = day(2026, 11, 28);
    let tiesSteps = 0, tiesPeak = 0;
    for (let m = 1; m <= 120; m++) {
      const rows = monthRows(ref, firstOfMonth(ref, m));
      const pool = rows.some(r => r.happy) ? rows.filter(r => r.happy) : rows;
      const best = Math.min(...pool.map(r => r.steps)), top = pool.filter(r => r.steps === best);
      if (top.length > 1) tiesSteps++;
      if (top.filter(r => r.peak === Math.max(...top.map(x => x.peak))).length > 1) tiesPeak++;
    }
    eq([tiesSteps, tiesPeak], [47, 1]);
  });

  t('gift: one happiest day per month for ten years; last/next/is agree; gaps 1..61 days', () => {
    for (const ref of [day(2026, 11, 20), day(2026, 12, 1), day(2026, 12, 12)]) {
      const wins = gifts(ref, 120);
      wins.forEach((g, i) => {
        eq(ymd(g).slice(0, 7), ymd(firstOfMonth(ref, i + 1)).slice(0, 7), `month ${i + 1}: its happiest day is in it`);
        ok(g > ref && (!i || (g - wins[i - 1] >= 1 && g - wins[i - 1] <= 61)), `gap ${i}`);
      });
      for (let d = ref - 5; d < ref + 800; d++) {
        eq(lastGift(ref, d), wins.filter(g => g <= d).at(-1) ?? null, `last ${d}`);
        eq(nextGift(ref, d), wins.find(g => g > d), `next ${d}`);
        eq(isGiftDay(ref, d), wins.includes(d), `is ${d}`);
      }
    }
  });

  t('gift: the reference day is never a happiest day, for any reference day of two years', () => {
    for (let ref = day(2026, 11, 1); ref < day(2028, 11, 1); ref++) {
      ok(!isGiftDay(ref, ref), `${ymd(ref)} is the reference day itself`);
      ok(firstGift(ref) > ref && firstGift(ref) < firstOfMonth(ref, 2), `the first gift of ${ymd(ref)} is in the next month`);
    }
    const rel = releaseDays({ first: '20261201', tetra: 7, cube: 21, ball: 35 });
    eq(isGiftDay(rel.first, rel.first), false);
    eq(releaseDays({ ...SOLID_RELEASE, first: null }), null, 'no release day, no reference day: no gift');
  });

  t('gift: the latest happiest days, oldest first, newest on or before the day; fewer when there are not that many', () => {
    const ref = day(2026, 12, 1);
    eq(recentGifts(ref, day(2027, 3, 12), 3).map(ymd), ['2027-01-01', '2027-02-06', '2027-03-10']);
    eq(recentGifts(ref, day(2027, 3, 9), 3).map(ymd), ['2027-01-01', '2027-02-06'], 'March is not decided yet on the 9th');
    eq(recentGifts(ref, day(2027, 1, 20), 6).map(ymd), ['2027-01-01'], 'only one so far');
    eq(recentGifts(ref, day(2026, 12, 31), 6), [], 'none in the month of the reference day');
    eq(recentGifts(null, ref, 6), []);
    eq(LIST_DAYS, 6);
  });

  t('gift: the tooltip lists the latest 6 happiest days, but only once 6 exist (a shorter list would hold the first gift)', () => {
    const ref = day(2026, 12, 1), wins = gifts(ref, 8);
    eq(listDays(ref, wins[4] + 10), [], 'five gifts so far');
    eq(listDays(ref, wins[5] - 1), [], 'the sixth is not decided yet');
    eq(listDays(ref, wins[5]), wins.slice(0, 6), 'on the day of the sixth');
    eq(listDays(ref, wins[7] + 3), wins.slice(2, 8), 'always the latest six');
    eq(listDays(null, wins[7]), []);
  });

  t('gift: the listed days are enough to find the reference day (the puzzle): one day fits, for several references and times', () => {
    const fits = (list, from) => { // the reference days that give exactly these happiest days
      const out = [];
      for (let m = from; m < firstOfMonth(list[0], 0); m++) if (list.every(g => giftDay(m, g) === g)) out.push(m);
      return out;
    };
    for (const ref of [day(2026, 11, 28), day(2026, 12, 1), day(2026, 12, 9)]) {
      for (const months of [8, 30, 100]) {
        const list = listDays(ref, giftDay(ref, firstOfMonth(ref, months)));
        eq(list.length, LIST_DAYS);
        eq(fits(list, list[0] - 6000), [ref], `${ymd(ref)} after ${months} months`);
      }
    }
  });

  ta('gift state: no gift before the first happiest day or without a reference day; nothing to open on an ordinary day', async () => {
    const ref = day(2026, 12, 1);
    for (const [r, d] of [[null, ref], [ref, day(2026, 11, 30)], [ref, ref], [ref, day(2026, 12, 20)], [ref, firstGift(ref) + 1]]) {
      const g = createGift(memory(), r, at(d)); await g.init();
      eq([g.view(), await g.claim(() => 0)], [null, null], `${r && ymd(r)} on ${ymd(d)}`);
    }
    eq(await createGift(memory(), ref, at(firstGift(ref))).claim(() => 0), null, 'not initialised: nothing');
  });

  ta('gift state: open the gift once; the kind is drawn; it stays opened for the day and is remembered', async () => {
    const ref = day(2026, 12, 1), first = firstGift(ref), st = memory(), asked = [];
    let g = createGift(st, ref, at(first)); await g.init();
    eq(g.view(), { day: first, opened: false, kind: null });
    eq(await g.claim(n => { asked.push(n); return 1; }), 'unlock');
    eq(asked, [2], 'a draw between the two kinds');
    eq(g.view(), { day: first, opened: true, kind: 'unlock' });
    eq(await g.claim(() => 0), null, 'once per happiest day');
    g = createGift(st, ref, at(first)); await g.init(); // a reload
    eq(g.view(), { day: first, opened: true, kind: 'unlock' });
    eq(await g.claim(() => 0), null);
    eq(JSON.parse(st.map.get(GIFT_KEY)), { v: 1, day: first, kind: 'unlock' });
    // the next month's day is a new gift
    const next = nextGift(ref, first);
    g = createGift(st, ref, at(next)); await g.init();
    eq(g.view(), { day: next, opened: false, kind: null });
    eq(await g.claim(() => 0), 'replay');
    eq(JSON.parse(st.map.get(GIFT_KEY)), { v: 1, day: next, kind: 'replay' });
  });

  ta('gift state: nothing left to unlock gives a replay without a draw; a missed gift is gone after OPEN_DAYS', async () => {
    const ref = day(2026, 12, 1), first = firstGift(ref), g = createGift(memory(), ref, at(first));
    await g.init();
    eq(await g.claim(() => { throw new Error('no draw'); }, true), 'replay');
    eq(OPEN_DAYS, 1);
    const late = createGift(memory(), ref, at(first + OPEN_DAYS)); await late.init();
    eq([late.view(), await late.claim(() => 0)], [null, null]);
  });

  t('gift state: a stored record is cleaned; junk is dropped', () => {
    eq(sanitize({ v: 1, day: null, kind: null }), { v: 1, day: null, kind: null });
    eq(sanitize({ v: 1, day: 20800, kind: 'replay', extra: 1 }), { v: 1, day: 20800, kind: 'replay' });
    for (const bad of [null, 'x', {}, { v: 2, day: null }, { v: 1, day: -1, kind: 'replay' }, { v: 1, day: 1.5, kind: 'replay' }, { v: 1, day: 5, kind: 'gold' }]) {
      eq(sanitize(bad), null, JSON.stringify(bad));
    }
  });

  ta('gift state: a corrupt stored value starts afresh', async () => {
    const st = memory({ [GIFT_KEY]: 'not json' }), ref = day(2026, 12, 1), first = firstGift(ref), g = createGift(st, ref, at(first));
    await g.init();
    eq(g.view(), { day: first, opened: false, kind: null });
  });

  t('gift dev note (hold V): everything about today in one object; null without a reference day', () => {
    const ref = day(2026, 12, 1);
    eq(giftInfo(null, ref), null);
    eq(giftInfo(undefined, ref), null);
    let info = giftInfo(ref, day(2026, 12, 20));
    eq([info.n, info.chain, info.today, info.last, info.count], [20, chain(20), false, null, 0]);
    eq([ymd(info.first), ymd(info.next)], ['2027-01-01', '2027-01-01']);
    eq(info.upcoming.map(ymd), ['2027-01-01', '2027-02-06', '2027-03-10', '2027-04-09', '2027-05-25', '2027-06-26']);
    info = giftInfo(ref, day(2027, 2, 6)); // a happiest day: it is today, the next is after it
    eq([info.today, ymd(info.last), ymd(info.next), info.count, info.n], [true, '2027-02-06', '2027-03-10', 2, 68]);
    eq(info.chain, { happy: true, steps: 2, peak: 100 });
    eq(giftInfo(ref, day(2026, 11, 20)).chain, null, 'before the reference day: no number');
    eq(giftInfo(ref, ref + 10, 2).upcoming.length, 2);
  });

  t('gift: drawKind draws between the kinds, or gives a replay without a draw', () => {
    eq([drawKind(() => 0), drawKind(() => 1)], ['replay', 'unlock']);
    eq(drawKind(() => { throw new Error('no draw'); }, true), 'replay');
  });

  ta('gift state: the stored record can be read (dev note)', async () => {
    const ref = day(2026, 12, 1), first = firstGift(ref), g = createGift(memory(), ref, at(first));
    eq(g.record(), null, 'before init');
    await g.init();
    eq(g.record(), { day: null, kind: null });
    await g.claim(() => 1);
    eq(g.record(), { day: first, kind: 'unlock' });
  });

  t('gift page: button and toast follow the gift, a running game and what was told', () => {
    const wait = { day: 20788, opened: false, kind: null }, done = { ...wait, opened: true, kind: 'replay' };
    eq(present(null, null, false), { button: false, toast: false }, 'no gift today');
    eq(present(done, null, false), { button: false, toast: false }, 'opened');
    eq(present(wait, null, false), { button: true, toast: true }, 'a gift waits: button and toast');
    eq(present(wait, null, true), { button: true, toast: false }, 'in a game: the button only, no toast over the board');
    eq(present(wait, 20788, false), { button: true, toast: false }, 'told once per happiest day');
    eq(present(wait, 20757, false), { button: true, toast: true }, 'told about an earlier day: tell again');
  });

  t('gift: both languages have the texts; the tooltip never says what the reference day is', () => {
    const keys = ['info.gift', 'gift.title', 'gift.ready', 'gift.open', 'gift.opened', 'gift.how', 'gift.howText', 'gift.recent', 'gift.soon'];
    for (const dict of [EN, ZH]) {
      for (const k of keys) ok(dict[k], k);
      ok(dict['gift.opened'].includes('{0}'), 'the kind goes in');
      for (const k of keys.filter(x => x !== 'gift.opened')) {
        ok(!/3D|3d|solid|release|launch|上线|发布|立体/i.test(dict[k]), `${k} must not tell what the reference day is`);
      }
      ok(!/own month|its own month|所在月份/.test(dict['gift.howText']), 'no hint that the reference day wins a month');
    }
  });
}
