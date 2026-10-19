// Tests of the unlockable variants: the lucky day and its offers (core/lucky.js), the unlock state
// (features/unlock.js) and the variant registry (apps/play/variants.js). Registered by tests.js:
// unlockTests(t, ta, ok, eq).
import {
  collatzPeak, weekOf, weekDays, weekTable, luckyDayOf, isLucky, lastLucky, nextLucky, OFFER_DAYS, offerEnd,
  activeOffers,
} from '../src/core/lucky.js';
import { createUnlock, sanitize, UNLOCK_KEY } from '../src/features/unlock.js';
import { createRulesSeen, sanitize as sanitizeSeen, RULES_SEEN_KEY } from '../src/features/rules-seen.js';
import {
  PLAY_VARIANTS, LUCKY_SIZES, variantById, variantOf, sizesFor, luckyDefs, solidDefs,
} from '../src/apps/play/variants.js';
import {
  SOLID_KINDS, SOLID_SIZES, dayOfYmd, releaseDays, stageOf, openSizes,
} from '../src/features/solid-release.js';
import { SOLID_RELEASE } from '../src/config.js';
import { PLAY_SIZES } from '../src/core/gen/generate.js';
import {
  VARIANTS as SHARE_VARIANTS, TELEPORT, TWO_PATHS, PENTAGON,
} from '../src/core/share-code.js';
import { runSync } from '../src/core/run.js';
import { EN, ZH, t as translate } from '../src/ui/i18n.js';
import { createSolidPlay } from '../src/apps/play/solid.js';
import { ballEntry } from '../src/core/surface/topology.js';
import { registerBalls } from '../src/core/surface/ball-registry.js';
import { BALL_CATALOG } from '../src/core/surface/ball-catalog.js';

const MON = 20731; // 2026-10-05, the lucky day of its week; the next one is 20743 (2026-10-17)
const memory = (init = {}) => {
  const map = new Map(Object.entries(init));
  return { map, async get(k) { return map.has(k) ? { value: map.get(k) } : null; }, async set(k, v) { map.set(k, v); } };
};
const at = day => () => new Date(day * 86400000);
const defs = [{ id: 'a', locked: [7, 8], pool: [5, 6, 7, 8] }, { id: 'b', locked: [9], pool: [5, 9] }];
const pick = (...values) => { const q = [...values]; return () => q.shift(); }; // rand(n): the scripted values
const give = async u => { await u.addChoice(); await u.takeChoice(); await u.addToken(); }; // one unlock chance
// the first day with two offers open: a lucky day came less than OFFER_DAYS after the one before
const overlapDay = (() => { for (let d = 20000; ; d++) if (activeOffers(d).length > 1) return d; })();

export function unlockTests(t, ta, ok, eq) {
  t('lucky: collatzPeak of known paths; only positive integers', () => {
    eq([1, 2, 6, 7, 27].map(collatzPeak), [1, 2, 16, 52, 9232]);
    for (const bad of [0, -3, 1.5, NaN]) {
      let threw = false;
      try { collatzPeak(bad); } catch (e) { threw = e instanceof RangeError; }
      ok(threw, `${bad} must throw`);
    }
  });

  t('lucky: a week starts on Monday and has one winner (the earlier day on a tie)', () => {
    const week = weekOf(MON);
    ok(weekDays(week).every((d, i) => new Date(d * 86400000).getUTCDay() === (i + 1) % 7), 'Mon..Sun');
    eq(new Date(0).getUTCDay(), 4, 'day 0 was a Thursday, hence the shift by 4');
    const rows = weekTable(week);
    eq(rows.filter(r => r.lucky).length, 1);
    eq(rows.find(r => r.lucky).day, MON);
    eq(rows.map(r => r.peak), [1702276, 118096, 118096, 1276936, 1276936, 20736, 62212]);
    eq(rows[1].peak, rows[2].peak, 'a tie exists in this week');
    eq(luckyDayOf(week), MON);
    // the week after: Saturday 17 Oct wins
    eq(weekTable(weekOf(20743)).map(r => [r.peak, r.lucky]),
      [[31108, false], [93328, false], [20740, false], [62224, false], [46672, false], [189268, true], [20744, false]]);
  });

  t('lucky: lastLucky / nextLucky / isLucky agree; the next lucky day '
    + 'after Oct 10 2026 is Oct 17', () => {
    eq([lastLucky(20736), nextLucky(20736), isLucky(20736), isLucky(MON)], [MON, 20743, false, true]);
    eq([lastLucky(MON), nextLucky(MON)], [MON, 20743]); // on a lucky day: it is today, the next is after it
    for (let d = 20000; d < 20000 + 1500; d++) {
      ok(lastLucky(d) <= d && d < nextLucky(d), `day ${d}`);
      ok(isLucky(d) === (lastLucky(d) === d), `day ${d}`);
    }
  });

  t('lucky: one per week, gaps 1..13 days, so every 14 days in a row hold one (2026-2100)', () => {
    const from = weekOf(20000), to = weekOf(20000 + 365 * 75);
    let prev = null;
    for (let w = from; w < to; w++) {
      const lucky = luckyDayOf(w);
      if (prev !== null) ok(lucky - prev >= 1 && lucky - prev <= 13, `week ${w}: gap ${lucky - prev}`);
      prev = lucky;
    }
    for (let d = 20000; d < 20000 + 365 * 75; d += 3) ok(d - lastLucky(d) <= 13, `day ${d}`);
  });

  t('lucky: every weekday wins in 10-20% of the weeks; the dates are not '
    + 'the same every year', () => {
    const count = Array(7).fill(0), from = weekOf(20000), to = weekOf(20000 + 365 * 75);
    for (let w = from; w < to; w++) count[(luckyDayOf(w) - 4) % 7]++;
    const total = to - from;
    ok(count.every(c => c / total > 0.1 && c / total < 0.2), count.join(','));
    const md = year => new Set([...Array(60).keys()].map(w => {
      const d = luckyDayOf(weekOf(Date.UTC(year, 0, 1) / 86400000) + w);
      return new Date(d * 86400000).toISOString().slice(5, 10);
    }));
    const a = md(2027), b = md(2028);
    ok([...a].some(x => !b.has(x)), 'the lucky dates of 2027 and 2028 differ');
  });

  t('lucky: an offer lasts until the next lucky day replaces it, but at least 3 days', () => {
    eq(OFFER_DAYS, 3);
    eq([offerEnd(MON), activeOffers(MON), activeOffers(20742), activeOffers(20743)], [20743, [MON], [MON], [20743]]);
    for (let d = 20000; d < 20000 + 3000; d++) {
      const offers = activeOffers(d);
      ok(offers.length > 0 && offers.at(-1) === lastLucky(d), `day ${d}: the latest offer is always open`);
      ok(offers.every((o, i) => o <= d && d < offerEnd(o) && (i === 0 || offers[i - 1] < o)), `day ${d}`);
      if (isLucky(d)) for (let k = 0; k < OFFER_DAYS; k++) ok(activeOffers(d + k).includes(d), `${d} lasts ${k} days`);
    }
    eq(activeOffers(overlapDay).length, 2, 'two offers overlap when lucky days are less than 3 days apart');
  });

  ta('unlock: a new player has nothing, yet the lucky game is open to everyone', async () => {
    const u = createUnlock(memory(), defs, at(MON)); await u.init();
    const v = u.view();
    eq([v.tokens, v.choices, v.open, v.offer, v.offerLast, v.luckyToday, v.nextLucky, v.daysToNext, v.allUnlocked],
      [0, 0, true, MON, 20742, true, 20743, 12, false]);
    eq([u.unlocked('a'), u.allUnlocked()], [false, false]);
    eq(createUnlock(memory(), defs, at(20736)).view(), null, 'null before init');
  });

  ta('unlock: without a chance the game is played for fun: nothing '
    + 'unlocks; the offer is used up', async () => {
    const st = memory(), u = createUnlock(st, defs, at(MON)); await u.init();
    const game = await u.begin(pick(1, 0)); // variant b, its only locked size 9
    eq(game, { id: 'b', size: 9, isNew: true, holder: false });
    eq(u.view().open, false, 'a game is on');
    eq(await u.begin(pick(0, 0)), null, 'one game at a time');
    eq(await u.finish(true), { id: 'b', solved: true, holder: false, newly: false });
    eq([u.unlocked('b'), u.view().open, u.view().tokens], [false, false, 0]);
    eq(await u.begin(pick(0, 0)), null, 'the offer is played');
    let later = createUnlock(st, defs, at(20742)); await later.init();
    eq(later.view().open, false, 'still the same offer on its last day');
    later = createUnlock(st, defs, at(20743)); await later.init();
    eq([later.view().open, later.view().offer], [true, 20743], 'the next lucky day brings a new offer');
  });

  ta('unlock: a holder spends the chance by starting; solving unlocks the '
    + 'variant, once', async () => {
    const st = memory(); let u = createUnlock(st, defs, at(MON)); await u.init(); await give(u); await give(u);
    eq(u.view().tokens, 2);
    const game = await u.begin(pick(0, 1)); // variant a, the locked size at index 1
    eq(game, { id: 'a', size: 8, isNew: true, holder: true });
    eq([u.view().tokens, u.view().active.id, u.view().active.holder], [1, 'a', true]);
    eq(await u.finish(true), { id: 'a', solved: true, holder: true, newly: true });
    eq(await u.finish(true), null, 'finishing twice changes nothing');
    eq([u.unlocked('a'), u.unlocked('b'), u.view().tokens], [true, false, 1]);
    eq(JSON.parse(st.map.get(UNLOCK_KEY)).unlocked.a, MON);
    u = createUnlock(st, defs, at(20743)); await u.init(); // the next offer: variant a is unlocked now
    const dud = await u.begin(pick(0, 2)); // any size of its pool
    eq(dud, { id: 'a', size: 7, isNew: false, holder: true });
    eq(await u.finish(true), { id: 'a', solved: true, holder: true, newly: false });
    eq([u.view().tokens, u.unlocked('a'), u.unlocked('b')], [0, true, false]);
  });

  ta('unlock: failing, leaving or reloading loses the chance and the '
    + 'offer; a failed start gives both back', async () => {
    const st = memory(); let u = createUnlock(st, defs, at(MON)); await u.init(); await give(u); await give(u);
    await u.begin(pick(0, 0));
    eq(await u.finish(false), { id: 'a', solved: false, holder: true, newly: false });
    eq([u.unlocked('a'), u.view().tokens, u.view().open], [false, 1, false]);
    u = createUnlock(st, defs, at(20743)); await u.init();
    await u.begin(pick(1, 0)); // the page is reloaded mid-game
    u = createUnlock(st, defs, at(20743)); await u.init();
    eq([u.view().active, u.view().tokens, u.view().open, u.unlocked('b')], [null, 0, false, false]);
    eq(JSON.parse(st.map.get(UNLOCK_KEY)).active, null);
    u = createUnlock(st, defs, at(20755)); await u.init(); await give(u); // a later offer: the generator fails
    const before = u.view();
    await u.begin(pick(0, 0)); await u.refund();
    eq([u.view().tokens, u.view().open, u.view().active], [before.tokens, true, null]);
    await u.refund(); eq(u.view().tokens, before.tokens, 'refund without a game does nothing');
  });

  ta('unlock: two overlapping offers can both be played, the older first', async () => {
    const u = createUnlock(memory(), defs, at(overlapDay)); await u.init();
    const [older, newer] = activeOffers(overlapDay);
    eq(u.view().offer, older);
    await u.begin(pick(0, 0)); await u.finish(false);
    eq([u.view().open, u.view().offer], [true, newer]);
    await u.begin(pick(0, 0)); await u.finish(false);
    eq(u.view().open, false);
  });

  ta('unlock: streak choices; nothing to play once everything is unlocked', async () => {
    const u = createUnlock(memory(), defs, at(MON)); await u.init();
    eq(await u.takeChoice(), false);
    await u.addChoice(); await u.addChoice(); eq(u.view().choices, 2);
    eq(await u.takeChoice(), true); await u.addToken(); eq([u.view().choices, u.view().tokens], [1, 1]);
    const st = memory();
    for (const [k, day] of [[0, MON], [1, 20743]]) {
      const x = createUnlock(st, defs, at(day)); await x.init(); await give(x);
      await x.begin(pick(k, 0)); await x.finish(true);
    }
    const done = createUnlock(st, defs, at(20755)); await done.init();
    eq([done.allUnlocked(), done.view().allUnlocked, done.view().open], [true, true, false]);
    eq(await done.begin(pick(0, 0)), null);
  });

  ta('unlock: a corrupt, foreign or hostile record is replaced; old '
    + 'records convert; storage errors are harmless', async () => {
    for (const junk of ['not json', '{}', '[]', 'null', '{"v":2}', '{"v":1,"unlocked":{},"tokens":-1,"choices":0}',
      '{"v":1,"unlocked":{},"tokens":1.5,"choices":0}', '{"v":1,"unlocked":5,"tokens":0,"choices":0}',
      '{"v":1,"unlocked":{},"tokens":0,"choices":0,"played":["x"]}']) {
      const u = createUnlock(memory({ [UNLOCK_KEY]: junk }), defs, at(MON)); await u.init();
      eq([u.view().tokens, u.view().choices, u.unlocked('a')], [0, 0, false], junk);
    }
    const rec = { v: 1, unlocked: { a: 5, gone: 9, b: 'x' }, tokens: 2, choices: 1, played: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], active: { id: 'a' } };
    eq(sanitize(rec, ['a', 'b']), { v: 1, unlocked: { a: 5 }, tokens: 2, choices: 1, played: [3, 4, 5, 6, 7, 8, 9, 10], active: null });
    eq(sanitize({ v: 1, unlocked: {}, tokens: [20000, 20001], choices: 0, solves: 4 }, ['a']).tokens, 2, 'an older record: a list');
    const broken = { async get() { throw new Error('no'); }, async set() { throw new Error('full'); } };
    const u = createUnlock(broken, defs, at(MON)); await u.init(); await give(u);
    eq(u.view().tokens, 1);
  });

  t('variants: ids are known to the share link, every text exists in '
    + 'both languages, the lucky sizes are on offer', () => {
    eq(PLAY_VARIANTS.map(v => v.id).slice(0, 3), ['cutout', 'arrows', 'exact']); // later ones append
    eq(LUCKY_SIZES, [7, 8, 9, 10]);
    for (const v of PLAY_VARIANTS) {
      // Teleport, Two paths and Pentagon have a link version of their own (SHARE_VERSION_PORTAL,
      // SHARE_VERSION_SPLIT, SHARE_VERSION_PENTAGON), so that the type field of the older links
      // stays as it was
      ok(SHARE_VARIANTS.includes(v.id) || [TELEPORT, TWO_PATHS, PENTAGON].includes(v.id),
        `${v.id} is in core/share-code.js VARIANTS (or has a version of its own)`);
      for (const dict of [EN, ZH]) {
        for (const key of Object.values(v.keys)) ok(dict[key], `${v.id}: ${key}`);
        eq(typeof dict[v.countKey] === 'function' || typeof dict[v.countKey] === 'string', true, v.countKey);
      }
      eq(variantById(v.id), v);
    }
    eq([variantById('standard'), variantById(null), sizesFor('standard', [5, 6])], [null, null, [5, 6]]);
    const lucky = luckyDefs(PLAY_SIZES);
    const sizes = [7, 8, 9, 10];
    const first = [['cutout', sizes], ['arrows', sizes], ['exact', sizes]];
    eq(lucky.map(d => [d.id, d.locked]).slice(0, 3), first);
    ok(lucky.every(d => d.locked.every(n => d.pool.includes(n))));
    eq(lucky.map(d => d.pool), PLAY_VARIANTS.map(v => sizesFor(v.id, PLAY_SIZES)));
    const fallback = luckyDefs([5, 6]).map(d => d.locked);
    const derived = fallback.slice(0, 3); // the first three take their sizes from `all`
    ok(derived.every(s => s.join() === '5,6'), 'a variant without such sizes: all its sizes');
  });

  t('variants: each generator makes a puzzle that detect() and variantOf() assign to it', () => {
    for (const v of PLAY_VARIANTS) {
      // a ring needs an even board; a Pentagon board has its own sizes
      const n = v.id === 'loop' ? 6 : v.id === PENTAGON ? 4 : 5;
      const puzzle = runSync(v.generate(n, 11));
      ok(v.detect(puzzle), `${v.id}: detect`);
      eq(variantOf(puzzle), v.id);
    }
  });

  t('i18n: the unlock and lucky game texts exist in both languages', () => {
    const keys = ['lucky.chances', 'unlock.tip.chance', 'unlock.tip.streak', 'lucky.title', 'lucky.readyChance',
      'lucky.readyFun', 'lucky.used', 'lucky.play', 'lucky.tag', 'lucky.onceChance', 'lucky.onceFun', 'lucky.unlocked',
      'lucky.already', 'lucky.noChance', 'lucky.lostNote', 'lucky.how', 'lucky.howText', 'lucky.week', 'lucky.winner',
      'reward.title', 'reward.pick', 'reward.replay', 'reward.unlock', 'stats.gotdTitle', 'stats.gotdSub', 'stats.date',
      'stats.time'];
    for (const dict of [EN, ZH]) for (const key of keys) ok(dict[key], key);
    ok(EN['lucky.chances'](1) === '1 unlock chance' && EN['lucky.chances'](0) === '0 unlock chances', 'plural');
    ok(EN['lucky.used'](1, 'Sat').includes('1 day)'), 'singular');
    ok(EN['lucky.used'](6, 'Sat').includes('6 days)'), 'plural');
  });

  t('rules tooltip: every puzzle type has a name and rules in both '
    + 'languages, and the game screen label exists', () => {
    for (const dict of [EN, ZH]) {
      ok(dict['game.rulesLabel'], 'game.rulesLabel');
      for (const id of ['standard', ...PLAY_VARIANTS.map(v => v.id)]) {
        ok(dict['mode.' + id] && dict['mode.' + id + 'Rules'], id);
      }
    }
  });

  ta('rules seen: nothing is seen at first, marking persists, only '
    + 'variants of the app count', async () => {
    const ids = PLAY_VARIANTS.map(v => v.id), store = memory();
    const a = createRulesSeen(store, ids);
    await a.init();
    ok(ids.every(id => !a.seen(id)), 'a new player has seen nothing');
    await a.mark('wrap');
    await a.mark('nope'); // not a type of the app
    ok(a.seen('wrap') && !a.seen('exact') && !a.seen('nope'));
    eq(JSON.parse(store.map.get(RULES_SEEN_KEY)), { v: 1, seen: { wrap: true } });
    const b = createRulesSeen(store, ids);
    await b.init();
    ok(b.seen('wrap') && !b.seen('arrows'), 'a reload remembers it');
  });

  ta('rules seen: a corrupt, foreign or outdated record is a fresh start; '
    + 'unknown ids are dropped', async () => {
    const ids = ['arrows', 'wrap'];
    for (const raw of ['{not json', '[]', 'null', '{"v":2,"seen":{"wrap":true}}', '{"v":1}', '{"v":1,"seen":7}']) {
      const rs = createRulesSeen(memory({ [RULES_SEEN_KEY]: raw }), ids);
      await rs.init();
      ok(!rs.seen('wrap') && !rs.seen('arrows'), raw);
    }
    const rs = createRulesSeen(memory({ [RULES_SEEN_KEY]: '{"v":1,"seen":{"wrap":true,"gone":true,"arrows":1}}' }), ids);
    await rs.init();
    ok(rs.seen('wrap') && !rs.seen('arrows') && !rs.seen('gone'), 'only true values of known ids');
    eq(sanitizeSeen({ v: 1, seen: { wrap: true, gone: true } }, ids), { v: 1, seen: { wrap: true } });
    const broken = { async get() { throw new Error('no storage'); }, async set() { throw new Error('no storage'); } };
    const safe = createRulesSeen(broken, ids);
    await safe.init();
    await safe.mark('wrap'); // must not throw
    ok(safe.seen('wrap'), 'it still works for this page load');
  });

  // ---------- the release of the 3D puzzles (features/solid-release.js) ----------
  const RELEASE = { first: 20261201, tetra: 7, cube: 21, ball: 35 };

  const throwsRange = (fn, what) => {
    let threw = false;
    try {
      fn();
    } catch (error) {
      threw = error instanceof RangeError;
    }
    ok(threw, `${what} must throw a RangeError`);
  };

  t('solid release: dates, stages and the sizes open to everyone', () => {
    eq(dayOfYmd(20261201), Date.UTC(2026, 11, 1) / 86400000);
    for (const bad of [20261301, 20260230, '2026-12-01', 'x', null, 0, 202612011]) {
      throwsRange(() => dayOfYmd(bad), `date ${bad}`);
    }
    eq(releaseDays(null), null);
    eq(releaseDays({ ...RELEASE, first: null }), null, 'no first day: nothing is released');
    const rel = releaseDays(RELEASE);
    const f = rel.first;
    eq([rel.tetra - f, rel.cube - f, rel.ball - f], [7, 21, 35]);
    const stages = day => SOLID_KINDS.map(kind => stageOf(kind, day, rel));
    eq(stages(f - 1), ['none', 'none', 'none']);
    eq(stages(f), ['part', 'none', 'none']);
    eq(stages(f + 6), ['part', 'none', 'none']);
    eq(stages(f + 7), ['all', 'none', 'none']);
    eq(stages(f + 20), ['all', 'none', 'none']);
    eq(stages(f + 21), ['all', 'all', 'none']);
    eq(stages(f + 34), ['all', 'all', 'none']);
    eq(stages(f + 35), ['all', 'all', 'all']);
    eq(SOLID_KINDS.map(kind => stageOf(kind, f + 99, null)), ['none', 'none', 'none']);
    const tetraSizes = [f - 1, f, f + 6, f + 7].map(day => openSizes('tetra', day, rel));
    eq(tetraSizes, [[], [2], [2], [2, 3, 4, 5]]);
    const cubeSizes = [f + 20, f + 21].map(day => openSizes('cube', day, rel));
    eq(cubeSizes, [[], SOLID_SIZES.cube]);
    eq(releaseDays({ ...RELEASE, tetra: 0 }).tetra, f, 'zero days: all tetra sizes at once');
    for (const key of ['tetra', 'cube', 'ball']) {
      for (const bad of [-1, 1.5, '7', undefined]) {
        throwsRange(() => releaseDays({ ...RELEASE, [key]: bad }), `${key}: ${bad}`);
      }
    }
    releaseDays(SOLID_RELEASE); // the shipped config is valid
  });

  t('solid release: luckyDefs has the 3D kinds only when given a release', () => {
    ok(!luckyDefs(PLAY_SIZES).some(d => d.solid), 'without a release: flat variants only');
    const rel = releaseDays(RELEASE);
    const defsOn = luckyDefs(PLAY_SIZES, rel);
    eq(defsOn.length, PLAY_VARIANTS.length + 3);
    const solid = defsOn.filter(d => d.solid);
    eq(solid.map(d => d.id), SOLID_KINDS);
    ok(solid.every(d => d.from === rel.first), 'live from the first day');
    const unreleased = luckyDefs(PLAY_SIZES, null).filter(d => d.solid);
    ok(unreleased.every(d => d.from === null), 'not released: never live');
    for (const d of solid.filter(d => d.id !== 'ball')) {
      ok(d.locked.every(n => d.pool.includes(n)), `${d.id}: locked sizes are pool sizes`);
    }
    const byId = Object.fromEntries(solid.map(d => [d.id, d]));
    ok(!byId.tetra.locked.includes(2), 'the free tetra size 2 is never a locked one');
    eq(byId.tetra.locked, [3, 4]);
    eq(byId.cube.locked, [2, 3]);
    eq(byId.cube.pool, [2, 3, 4]);
    eq(byId.ball.locked, [{ min: 10, max: 30 }]);
    eq(byId.ball.pool, [{ min: 8, max: 100 }]);
    const open = d => [rel.first, rel.tetra, rel.cube, rel.ball].map(day => d.open(day));
    eq(solid.map(open), [
      [false, true, true, true],
      [false, false, true, true],
      [false, false, false, true],
    ]);
  });

  const solidRel = releaseDays(RELEASE);
  const flatDefs = [
    { id: 'a', locked: [7], pool: [7, 8] },
    { id: 'b', locked: [9], pool: [9] },
  ];
  const withSolid = [...flatDefs, ...solidDefs(solidRel)];
  const allFlat = { a: 1, b: 1 };
  const saved = (unlocked, tokens = 0) => memory({
    [UNLOCK_KEY]: JSON.stringify({
      v: 1, unlocked, tokens, choices: 0, played: [], active: null,
    }),
  });
  // how many variants the lucky game draws from, and the game it started
  const drawn = async (u, value = 0) => {
    const seen = [];
    const game = await u.begin(n => {
      seen.push(n);
      return value % n;
    });
    return { n: seen[0], game };
  };

  ta('solid unlock: 3D kinds wait for every flat variant and the first day', async () => {
    const early = createUnlock(memory(), withSolid, at(solidRel.first + 40));
    await early.init();
    eq((await drawn(early)).n, 2, 'a flat variant is still locked: 2 to draw from');

    const before = createUnlock(saved(allFlat), withSolid, at(solidRel.first - 1));
    await before.init();
    eq([before.allUnlocked(), before.view().allUnlocked, before.view().open],
      [true, true, false], 'all unlocked before the 3D release');

    const day = createUnlock(saved(allFlat), withSolid, at(solidRel.first));
    await day.init();
    eq([day.allUnlocked(), day.view().open], [false, true],
      'the first day: the 3D kinds are new things to unlock');
    eq((await drawn(day)).n, 5, 'two flat and three 3D');
  });

  ta('solid unlock: a chance on a 3D kind unlocks it for good, early', async () => {
    const day = solidRel.first + 2;
    const st = saved(allFlat, 1);
    const u = createUnlock(st, withSolid, at(day));
    await u.init();
    const { game } = await drawn(u, 2); // the tetra
    eq(game.id, 'tetra');
    ok(game.isNew && game.holder, 'a new kind, an unlock chance');
    ok([3, 4].includes(game.size), 'a locked tetra is played at 3 or 4');
    eq(await u.finish(true), { id: 'tetra', solved: true, holder: true, newly: true });
    eq([u.unlocked('tetra'), u.unlocked('cube'), u.unlocked('ball')], [true, false, false]);
    eq(JSON.parse(st.map.get(UNLOCK_KEY)).unlocked.tetra, day);
    const again = createUnlock(st, withSolid, at(day));
    await again.init();
    ok(again.unlocked('tetra'), 'it persists');
    eq(createUnlock(st, flatDefs, at(day)).unlocked('tetra'), false, 'false before init');
  });

  ta('solid unlock: a kind open to everyone counts as unlocked', async () => {
    const none = createUnlock(memory(), withSolid, at(solidRel.tetra));
    await none.init();
    eq([none.unlocked('tetra'), none.unlocked('cube')], [true, false],
      'the tetra is open to everyone after a week');

    const rich = createUnlock(saved(allFlat, 1), withSolid, at(solidRel.tetra));
    await rich.init();
    const game = await rich.begin(pick(2, 0)); // the tetra, the first size of its pool
    eq(game, { id: 'tetra', size: 2, isNew: false, holder: true }, 'every size is drawn');
    eq(await rich.finish(true), { id: 'tetra', solved: true, holder: true, newly: false },
      'nothing to unlock');

    const last = createUnlock(saved(allFlat, 1), withSolid, at(solidRel.ball));
    await last.init();
    eq([last.allUnlocked(), last.view().open], [true, false],
      'everything is open: no lucky game left');
  });

  ta('solid lucky: a 3D lucky game is one try; a failed start gives the chance back', async () => {
    registerBalls(BALL_CATALOG);
    const calls = [];
    const S = { showDev: false, screen: 'menu', luckyHolder: true };
    let timers = 0;
    let seedValue = 7;
    const play = createSolidPlay({
      S,
      $: () => null,
      t: translate,
      render: () => {},
      startTimer: () => {
        timers++;
      },
      stopTimer: () => {},
      randomSeed: () => seedValue,
      luckyHtml: done => `<i data-done="${done}"></i>`,
      luckyFailed: async () => {
        calls.push('failed');
      },
      leaveLucky: () => {
        calls.push('left');
      },
    });
    const hintHidden = html => /id="solidHint"[^>]*style="display:none"/.test(html);

    await play.start({ kind: 'tetra', size: 3, lucky: true });
    eq([S.screen, S.lucky, timers], ['solid', true, 1]);
    let html = play.screenHtml();
    ok(html.includes('lucky-chip') && html.includes('lucky-once'), 'the chip and the note');
    ok(/id="solidNew" style="display:none"/.test(html), 'no new puzzle');
    ok(hintHidden(html), 'no hint');
    ok(html.includes('data-done="false"'), 'the lucky result goes under the game');
    S.showDev = true;
    ok(!hintHidden(play.screenHtml()), 'V brings the hint back');
    S.showDev = false;

    for (const size of [2, 3]) {
      await play.start({ kind: 'cube', size, lucky: true });
      eq([S.screen, S.lucky], ['solid', true], `cube ${size}`);
    }

    // a ball: its size is the range of cells
    for (const seed of [1, 7, 4294967295]) {
      seedValue = seed;
      await play.start({ kind: 'ball', size: { min: 10, max: 30 }, lucky: true });
      const id = /ball · ([^ ]+) · seed/.exec(play.screenHtml())[1];
      const cells = ballEntry(id).r.length;
      ok(cells >= 10 && cells <= 30, `${id} has ${cells} cells`);
    }

    // a free game is no lucky game
    await play.start({ kind: 'tetra', size: 2 });
    html = play.screenHtml();
    eq(S.lucky, false);
    ok(!html.includes('lucky-chip'), 'no chip');
    ok(/id="solidNew" style=""/.test(html), 'a new puzzle');
    ok(!hintHidden(html), 'a hint');

    // a start that fails tells the lucky game, which gives the chance back
    const restore = [globalThis.alert, console.error];
    globalThis.alert = () => {};
    console.error = () => {};
    try {
      await play.start({ kind: 'tetra', size: 99, lucky: true }); // no such board
    } finally {
      [globalThis.alert, console.error] = restore;
    }
    eq([calls, S.screen], [['failed'], 'menu']);
  });
}
