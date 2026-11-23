// Tests of the unlockable variants and of the happiest-day gift: the lucky day and its offers
// (core/lucky.js), the unlock state (features/unlock.js), the variant registry
// (apps/play/variants.js), the gift rule (core/gift.js) and its state (features/gift.js).
import '../setup-balls.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FAST, SLOW } from '../harness.js';
import {
  collatzPeak,
  weekOf,
  weekDays,
  weekTable,
  luckyDayOf,
  isLucky,
  lastLucky,
  nextLucky,
  OFFER_DAYS,
  offerEnd,
  activeOffers,
} from '../../src/core/lucky.js';
import { createUnlock, sanitize, UNLOCK_KEY } from '../../src/features/unlock.js';
import {
  createRulesSeen,
  sanitize as sanitizeSeen,
  RULES_SEEN_KEY,
} from '../../src/features/rules-seen.js';
import {
  PLAY_VARIANTS,
  LUCKY_SIZES,
  variantById,
  variantOf,
  sizesFor,
  luckyDefs,
  solidDefs,
} from '../../src/apps/play/variants.js';
import {
  SOLID_KINDS,
  SOLID_SIZES,
  dayOfYmd,
  releaseDays,
  stageOf,
  openSizes,
} from '../../src/features/solid-release.js';
import { SOLID_RELEASE } from '../../src/config.js';
import { PLAY_SIZES } from '../../src/core/gen/generate.js';
import {
  VARIANTS as SHARE_VARIANTS,
  TELEPORT,
  TWO_PATHS,
  PENTAGON,
} from '../../src/core/share-code.js';
import { runSync } from '../../src/core/run.js';
import { EN, ZH, t as translate } from '../../src/ui/i18n.js';
import { createSolidPlay } from '../../src/apps/play/solid.js';
import { ballEntry } from '../../src/core/surface/topology.js';
import { registerBalls } from '../../src/core/solid/ball-registry.js';
import { BALL_CATALOG } from '../../src/core/solid/ball-catalog.js';
import {
  chain,
  monthRows,
  giftDay,
  isGiftDay,
  lastGift,
  nextGift,
  firstGift,
  recentGifts,
  giftInfo,
} from '../../src/core/gift.js';
import {
  createGift,
  sanitize as sanitizeGift,
  present,
  listDays,
  drawKind,
  GIFT_KEY,
  OPEN_DAYS,
  LIST_DAYS,
} from '../../src/features/gift.js';

// ---- the unlockable variants

const MON = 20731; // 2026-10-05, the lucky day of its week; the next one is 20743 (2026-10-17)
const memory = (init = {}) => {
  const map = new Map(Object.entries(init));
  return {
    map,
    async get(k) {
      return map.has(k) ? { value: map.get(k) } : null;
    },
    async set(k, v) {
      map.set(k, v);
    },
  };
};
const at = day => () => new Date(day * 86400000);
const defs = [
  { id: 'a', locked: [7, 8], pool: [5, 6, 7, 8] },
  { id: 'b', locked: [9], pool: [5, 9] },
];
const pick = (...values) => {
  const q = [...values];
  return () => q.shift();
}; // rand(n): the scripted values
const give = async u => {
  await u.addChoice();
  await u.takeChoice();
  await u.addToken();
}; // one unlock chance
// the first day with two offers open: a lucky day came less than OFFER_DAYS after the one before
const overlapDay = (() => {
  for (let d = 20000; ; d++) if (activeOffers(d).length > 1) return d;
})();

test('lucky: collatzPeak of known paths; only positive integers', FAST, () => {
  assert.deepStrictEqual([1, 2, 6, 7, 27].map(collatzPeak), [1, 2, 16, 52, 9232]);
  for (const bad of [0, -3, 1.5, NaN]) {
    let threw = false;
    try {
      collatzPeak(bad);
    } catch (e) {
      threw = e instanceof RangeError;
    }
    assert.ok(threw, `${bad} must throw`);
  }
});

test('lucky: a week starts on Monday and has one winner (the earlier day on a tie)', FAST, () => {
  const week = weekOf(MON);
  assert.ok(
    weekDays(week).every((d, i) => new Date(d * 86400000).getUTCDay() === (i + 1) % 7),
    'Mon..Sun',
  );
  assert.deepStrictEqual(new Date(0).getUTCDay(), 4, 'day 0 was a Thursday, hence the shift by 4');
  const rows = weekTable(week);
  assert.deepStrictEqual(rows.filter(r => r.lucky).length, 1);
  assert.deepStrictEqual(rows.find(r => r.lucky).day, MON);
  assert.deepStrictEqual(
    rows.map(r => r.peak),
    [1702276, 118096, 118096, 1276936, 1276936, 20736, 62212],
  );
  assert.deepStrictEqual(rows[1].peak, rows[2].peak, 'a tie exists in this week');
  assert.deepStrictEqual(luckyDayOf(week), MON);
  // the week after: Saturday 17 Oct wins
  assert.deepStrictEqual(
    weekTable(weekOf(20743)).map(r => [r.peak, r.lucky]),
    [
      [31108, false],
      [93328, false],
      [20740, false],
      [62224, false],
      [46672, false],
      [189268, true],
      [20744, false],
    ],
  );
});

test(
  'lucky: lastLucky / nextLucky / isLucky agree; the next lucky day ' +
    'after Oct 10 2026 is Oct 17',
  FAST,
  () => {
    assert.deepStrictEqual(
      [lastLucky(20736), nextLucky(20736), isLucky(20736), isLucky(MON)],
      [MON, 20743, false, true],
    );
    assert.deepStrictEqual([lastLucky(MON), nextLucky(MON)], [MON, 20743]); // on a lucky day: it is today, the next is after it
    for (let d = 20000; d < 20000 + 1500; d++) {
      assert.ok(lastLucky(d) <= d && d < nextLucky(d), `day ${d}`);
      assert.ok(isLucky(d) === (lastLucky(d) === d), `day ${d}`);
    }
  },
);

test(
  'lucky: one per week, gaps 1..13 days, so every 14 days in a row hold one (2026-2100)',
  FAST,
  () => {
    const from = weekOf(20000),
      to = weekOf(20000 + 365 * 75);
    let prev = null;
    for (let w = from; w < to; w++) {
      const lucky = luckyDayOf(w);
      if (prev !== null)
        assert.ok(lucky - prev >= 1 && lucky - prev <= 13, `week ${w}: gap ${lucky - prev}`);
      prev = lucky;
    }
    for (let d = 20000; d < 20000 + 365 * 75; d += 3)
      assert.ok(d - lastLucky(d) <= 13, `day ${d}`);
  },
);

test(
  'lucky: every weekday wins in 10-20% of the weeks; the dates are not ' + 'the same every year',
  FAST,
  () => {
    const count = Array(7).fill(0),
      from = weekOf(20000),
      to = weekOf(20000 + 365 * 75);
    for (let w = from; w < to; w++) count[(luckyDayOf(w) - 4) % 7]++;
    const total = to - from;
    assert.ok(
      count.every(c => c / total > 0.1 && c / total < 0.2),
      count.join(','),
    );
    const md = year =>
      new Set(
        [...Array(60).keys()].map(w => {
          const d = luckyDayOf(weekOf(Date.UTC(year, 0, 1) / 86400000) + w);
          return new Date(d * 86400000).toISOString().slice(5, 10);
        }),
      );
    const a = md(2027),
      b = md(2028);
    assert.ok(
      [...a].some(x => !b.has(x)),
      'the lucky dates of 2027 and 2028 differ',
    );
  },
);

test(
  'lucky: an offer lasts until the next lucky day replaces it, at least OFFER_DAYS days',
  FAST,
  () => {
    assert.deepStrictEqual(
      [offerEnd(MON), activeOffers(MON), activeOffers(20742), activeOffers(20743)],
      [20743, [MON], [MON], [20743]],
    );
    for (let d = 20000; d < 20000 + 3000; d++) {
      const offers = activeOffers(d);
      assert.ok(
        offers.length > 0 && offers.at(-1) === lastLucky(d),
        `day ${d}: the latest offer is always open`,
      );
      assert.ok(
        offers.every((o, i) => o <= d && d < offerEnd(o) && (i === 0 || offers[i - 1] < o)),
        `day ${d}`,
      );
      if (isLucky(d))
        for (let k = 0; k < OFFER_DAYS; k++)
          assert.ok(activeOffers(d + k).includes(d), `${d} lasts ${k} days`);
    }
    assert.deepStrictEqual(
      activeOffers(overlapDay).length,
      2,
      'two offers overlap when lucky days are less than 3 days apart',
    );
  },
);

test(
  'unlock: a new player has nothing, yet the lucky game is open to everyone',
  FAST,
  async () => {
    const u = createUnlock(memory(), defs, at(MON));
    await u.init();
    const v = u.view();
    assert.deepStrictEqual(
      [
        v.tokens,
        v.choices,
        v.open,
        v.offer,
        v.offerLast,
        v.luckyToday,
        v.nextLucky,
        v.daysToNext,
        v.allUnlocked,
      ],
      [0, 0, true, MON, 20742, true, 20743, 12, false],
    );
    assert.deepStrictEqual([u.unlocked('a'), u.allUnlocked()], [false, false]);
    assert.deepStrictEqual(
      createUnlock(memory(), defs, at(20736)).view(),
      null,
      'null before init',
    );
  },
);

test(
  'unlock: without a chance the game is played for fun: nothing ' +
    'unlocks; the offer is used up',
  FAST,
  async () => {
    const st = memory(),
      u = createUnlock(st, defs, at(MON));
    await u.init();
    const game = await u.begin(pick(1, 0)); // variant b, its only locked size 9
    assert.deepStrictEqual(game, { id: 'b', size: 9, isNew: true, holder: false });
    assert.deepStrictEqual(u.view().open, false, 'a game is on');
    assert.deepStrictEqual(await u.begin(pick(0, 0)), null, 'one game at a time');
    assert.deepStrictEqual(await u.finish(true), {
      id: 'b',
      solved: true,
      holder: false,
      newly: false,
    });
    assert.deepStrictEqual([u.unlocked('b'), u.view().open, u.view().tokens], [false, false, 0]);
    assert.deepStrictEqual(await u.begin(pick(0, 0)), null, 'the offer is played');
    let later = createUnlock(st, defs, at(20742));
    await later.init();
    assert.deepStrictEqual(later.view().open, false, 'still the same offer on its last day');
    later = createUnlock(st, defs, at(20743));
    await later.init();
    assert.deepStrictEqual(
      [later.view().open, later.view().offer],
      [true, 20743],
      'the next lucky day brings a new offer',
    );
  },
);

test(
  'unlock: a holder spends the chance by starting; solving unlocks the ' + 'variant, once',
  FAST,
  async () => {
    const st = memory();
    let u = createUnlock(st, defs, at(MON));
    await u.init();
    await give(u);
    await give(u);
    assert.deepStrictEqual(u.view().tokens, 2);
    const game = await u.begin(pick(0, 1)); // variant a, the locked size at index 1
    assert.deepStrictEqual(game, { id: 'a', size: 8, isNew: true, holder: true });
    assert.deepStrictEqual(
      [u.view().tokens, u.view().active.id, u.view().active.holder],
      [1, 'a', true],
    );
    assert.deepStrictEqual(await u.finish(true), {
      id: 'a',
      solved: true,
      holder: true,
      newly: true,
    });
    assert.deepStrictEqual(await u.finish(true), null, 'finishing twice changes nothing');
    assert.deepStrictEqual([u.unlocked('a'), u.unlocked('b'), u.view().tokens], [true, false, 1]);
    assert.deepStrictEqual(JSON.parse(st.map.get(UNLOCK_KEY)).unlocked.a, MON);
    u = createUnlock(st, defs, at(20743));
    await u.init(); // the next offer: variant a is unlocked now
    const dud = await u.begin(pick(0, 2)); // any size of its pool
    assert.deepStrictEqual(dud, { id: 'a', size: 7, isNew: false, holder: true });
    assert.deepStrictEqual(await u.finish(true), {
      id: 'a',
      solved: true,
      holder: true,
      newly: false,
    });
    assert.deepStrictEqual([u.view().tokens, u.unlocked('a'), u.unlocked('b')], [0, true, false]);
  },
);

test(
  'unlock: failing, leaving or reloading loses the chance and the ' +
    'offer; a failed start gives both back',
  FAST,
  async () => {
    const st = memory();
    let u = createUnlock(st, defs, at(MON));
    await u.init();
    await give(u);
    await give(u);
    await u.begin(pick(0, 0));
    assert.deepStrictEqual(await u.finish(false), {
      id: 'a',
      solved: false,
      holder: true,
      newly: false,
    });
    assert.deepStrictEqual([u.unlocked('a'), u.view().tokens, u.view().open], [false, 1, false]);
    u = createUnlock(st, defs, at(20743));
    await u.init();
    await u.begin(pick(1, 0)); // the page is reloaded mid-game
    u = createUnlock(st, defs, at(20743));
    await u.init();
    assert.deepStrictEqual(
      [u.view().active, u.view().tokens, u.view().open, u.unlocked('b')],
      [null, 0, false, false],
    );
    assert.deepStrictEqual(JSON.parse(st.map.get(UNLOCK_KEY)).active, null);
    u = createUnlock(st, defs, at(20755));
    await u.init();
    await give(u); // a later offer: the generator fails
    const before = u.view();
    await u.begin(pick(0, 0));
    await u.refund();
    assert.deepStrictEqual(
      [u.view().tokens, u.view().open, u.view().active],
      [before.tokens, true, null],
    );
    await u.refund();
    assert.deepStrictEqual(u.view().tokens, before.tokens, 'refund without a game does nothing');
  },
);

test('unlock: two overlapping offers can both be played, the older first', FAST, async () => {
  const u = createUnlock(memory(), defs, at(overlapDay));
  await u.init();
  const [older, newer] = activeOffers(overlapDay);
  assert.deepStrictEqual(u.view().offer, older);
  await u.begin(pick(0, 0));
  await u.finish(false);
  assert.deepStrictEqual([u.view().open, u.view().offer], [true, newer]);
  await u.begin(pick(0, 0));
  await u.finish(false);
  assert.deepStrictEqual(u.view().open, false);
});

test('unlock: streak choices; nothing to play once everything is unlocked', FAST, async () => {
  const u = createUnlock(memory(), defs, at(MON));
  await u.init();
  assert.deepStrictEqual(await u.takeChoice(), false);
  await u.addChoice();
  await u.addChoice();
  assert.deepStrictEqual(u.view().choices, 2);
  assert.deepStrictEqual(await u.takeChoice(), true);
  await u.addToken();
  assert.deepStrictEqual([u.view().choices, u.view().tokens], [1, 1]);
  const st = memory();
  for (const [k, day] of [
    [0, MON],
    [1, 20743],
  ]) {
    const x = createUnlock(st, defs, at(day));
    await x.init();
    await give(x);
    await x.begin(pick(k, 0));
    await x.finish(true);
  }
  const done = createUnlock(st, defs, at(20755));
  await done.init();
  assert.deepStrictEqual(
    [done.allUnlocked(), done.view().allUnlocked, done.view().open],
    [true, true, false],
  );
  assert.deepStrictEqual(await done.begin(pick(0, 0)), null);
});

test(
  'unlock: a corrupt, foreign or hostile record is replaced; old ' +
    'records convert; storage errors are harmless',
  FAST,
  async () => {
    for (const junk of [
      'not json',
      '{}',
      '[]',
      'null',
      '{"v":2}',
      '{"v":1,"unlocked":{},"tokens":1.5,"choices":0}',
      '{"v":1,"unlocked":5,"tokens":0,"choices":0}',
      '{"v":1,"unlocked":{},"tokens":0,"choices":0,"played":["x"]}',
    ]) {
      const u = createUnlock(memory({ [UNLOCK_KEY]: junk }), defs, at(MON));
      await u.init();
      assert.deepStrictEqual(
        [u.view().tokens, u.view().choices, u.unlocked('a')],
        [0, 0, false],
        junk,
      );
    }
    const rec = {
      v: 1,
      unlocked: { a: 5, gone: 9, b: 'x' },
      tokens: 2,
      choices: 1,
      played: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      active: { id: 'a' },
    };
    assert.deepStrictEqual(sanitize(rec, ['a', 'b']), {
      v: 1,
      unlocked: { a: 5 },
      tokens: 2,
      choices: 1,
      played: [3, 4, 5, 6, 7, 8, 9, 10],
      active: null,
    });
    assert.deepStrictEqual(
      sanitize({ v: 1, unlocked: {}, tokens: [20000, 20001], choices: 0, solves: 4 }, ['a'])
        .tokens,
      2,
      'an older record: a list',
    );
    // a device's chances are what it earned minus what it spent: below 0 while it spends another device's (device sync)
    assert.deepStrictEqual(sanitize({ v: 1, unlocked: {}, tokens: -1, choices: -2 }, ['a']), {
      v: 1,
      unlocked: {},
      tokens: -1,
      choices: -2,
      played: [],
      active: null,
    });
    const broken = {
      async get() {
        throw new Error('no');
      },
      async set() {
        throw new Error('full');
      },
    };
    const u = createUnlock(broken, defs, at(MON));
    await u.init();
    await give(u);
    assert.deepStrictEqual(u.view().tokens, 1);
  },
);

test(
  'variants: ids are known to the share link, every text exists in ' +
    'both languages, the lucky sizes are on offer',
  FAST,
  () => {
    assert.deepStrictEqual(PLAY_VARIANTS.map(v => v.id).slice(0, 3), [
      'cutout',
      'arrows',
      'exact',
    ]); // later ones append
    for (const v of PLAY_VARIANTS) {
      // Teleport, Two paths and Pentagon have a link version of their own (SHARE_VERSION_PORTAL,
      // SHARE_VERSION_SPLIT, SHARE_VERSION_PENTAGON), so that the type field of the older links
      // stays as it was
      assert.ok(
        SHARE_VARIANTS.includes(v.id) || [TELEPORT, TWO_PATHS, PENTAGON].includes(v.id),
        `${v.id} is in core/share-code.js VARIANTS (or has a version of its own)`,
      );
      for (const dict of [EN, ZH]) {
        for (const key of Object.values(v.keys)) assert.ok(dict[key], `${v.id}: ${key}`);
        assert.deepStrictEqual(
          typeof dict[v.countKey] === 'function' || typeof dict[v.countKey] === 'string',
          true,
          v.countKey,
        );
      }
      assert.deepStrictEqual(variantById(v.id), v);
    }
    assert.deepStrictEqual(
      [variantById('standard'), variantById(null), sizesFor('standard', [5, 6])],
      [null, null, [5, 6]],
    );
    const lucky = luckyDefs(PLAY_SIZES);
    const sizes = LUCKY_SIZES;
    const first = [
      ['cutout', sizes],
      ['arrows', sizes],
      ['exact', sizes],
    ];
    assert.deepStrictEqual(lucky.map(d => [d.id, d.locked]).slice(0, 3), first);
    assert.ok(lucky.every(d => d.locked.every(n => d.pool.includes(n))));
    assert.deepStrictEqual(
      lucky.map(d => d.pool),
      PLAY_VARIANTS.map(v => sizesFor(v.id, PLAY_SIZES)),
    );
    const fallback = luckyDefs([5, 6]).map(d => d.locked);
    const derived = fallback.slice(0, 3); // the first three take their sizes from `all`
    assert.ok(
      derived.every(s => s.join() === '5,6'),
      'a variant without such sizes: all its sizes',
    );
  },
);

test(
  'variants: each generator makes a puzzle that detect() and variantOf() assign to it',
  SLOW,
  () => {
    for (const v of PLAY_VARIANTS) {
      // a ring needs an even board; a Pentagon board has its own sizes
      const n = v.id === 'loop' ? 6 : v.id === PENTAGON ? 4 : 5;
      const puzzle = runSync(v.generate(n, 11));
      assert.ok(v.detect(puzzle), `${v.id}: detect`);
      assert.deepStrictEqual(variantOf(puzzle), v.id);
    }
  },
);

test('i18n: the unlock and lucky game texts exist in both languages', FAST, () => {
  const keys = [
    'lucky.chances',
    'unlock.tip.chance',
    'unlock.tip.streak',
    'lucky.title',
    'lucky.readyChance',
    'lucky.readyFun',
    'lucky.used',
    'lucky.play',
    'lucky.tag',
    'lucky.onceChance',
    'lucky.onceFun',
    'lucky.unlocked',
    'lucky.already',
    'lucky.noChance',
    'lucky.lostNote',
    'lucky.how',
    'lucky.howText',
    'lucky.week',
    'reward.title',
    'reward.pick',
    'reward.replay',
    'reward.unlock',
    'stats.gotdTitle',
    'stats.gotdSub',
    'stats.date',
    'stats.time',
  ];
  for (const dict of [EN, ZH]) for (const key of keys) assert.ok(dict[key], key);
  assert.ok(
    EN['lucky.chances'](1) === '1 unlock chance' && EN['lucky.chances'](0) === '0 unlock chances',
    'plural',
  );
  assert.ok(EN['lucky.used'](1, 'Sat').includes('1 day)'), 'singular');
  assert.ok(EN['lucky.used'](6, 'Sat').includes('6 days)'), 'plural');
});

test(
  'rules tooltip: every puzzle type has a name and rules in both ' +
    'languages, and the game screen label exists',
  FAST,
  () => {
    for (const dict of [EN, ZH]) {
      assert.ok(dict['game.rulesLabel'], 'game.rulesLabel');
      for (const id of ['standard', ...PLAY_VARIANTS.map(v => v.id)]) {
        assert.ok(dict['mode.' + id] && dict['mode.' + id + 'Rules'], id);
      }
    }
  },
);

test(
  'rules seen: nothing is seen at first, marking persists, only ' + 'variants of the app count',
  FAST,
  async () => {
    const ids = PLAY_VARIANTS.map(v => v.id),
      store = memory();
    const a = createRulesSeen(store, ids);
    await a.init();
    assert.ok(
      ids.every(id => !a.seen(id)),
      'a new player has seen nothing',
    );
    await a.mark('wrap');
    await a.mark('nope'); // not a type of the app
    assert.ok(a.seen('wrap') && !a.seen('exact') && !a.seen('nope'));
    assert.deepStrictEqual(JSON.parse(store.map.get(RULES_SEEN_KEY)), {
      v: 1,
      seen: { wrap: true },
    });
    const b = createRulesSeen(store, ids);
    await b.init();
    assert.ok(b.seen('wrap') && !b.seen('arrows'), 'a reload remembers it');
  },
);

test(
  'rules seen: a corrupt, foreign or outdated record is a fresh start; ' +
    'unknown ids are dropped',
  FAST,
  async () => {
    const ids = ['arrows', 'wrap'];
    for (const raw of [
      '{not json',
      '[]',
      'null',
      '{"v":2,"seen":{"wrap":true}}',
      '{"v":1}',
      '{"v":1,"seen":7}',
    ]) {
      const rs = createRulesSeen(memory({ [RULES_SEEN_KEY]: raw }), ids);
      await rs.init();
      assert.ok(!rs.seen('wrap') && !rs.seen('arrows'), raw);
    }
    const rs = createRulesSeen(
      memory({ [RULES_SEEN_KEY]: '{"v":1,"seen":{"wrap":true,"gone":true,"arrows":1}}' }),
      ids,
    );
    await rs.init();
    assert.ok(
      rs.seen('wrap') && !rs.seen('arrows') && !rs.seen('gone'),
      'only true values of known ids',
    );
    assert.deepStrictEqual(sanitizeSeen({ v: 1, seen: { wrap: true, gone: true } }, ids), {
      v: 1,
      seen: { wrap: true },
    });
    const broken = {
      async get() {
        throw new Error('no storage');
      },
      async set() {
        throw new Error('no storage');
      },
    };
    const safe = createRulesSeen(broken, ids);
    await safe.init();
    await safe.mark('wrap'); // must not throw
    assert.ok(safe.seen('wrap'), 'it still works for this page load');
  },
);

// ---------- the release of the 3D puzzles (features/solid-release.js) ----------
const RELEASE = { first: 20261201, tetra: 7, cube: 21, ball: 35 };

test('solid release: dates, stages and the sizes open to everyone', FAST, () => {
  assert.deepStrictEqual(dayOfYmd(20261201), Date.UTC(2026, 11, 1) / 86400000);
  for (const bad of [20261301, 20260230, '2026-12-01', 'x', null, 0, 202612011]) {
    assert.throws(() => dayOfYmd(bad), RangeError, `date ${bad} must throw a RangeError`);
  }
  assert.deepStrictEqual(releaseDays(null), null);
  assert.deepStrictEqual(
    releaseDays({ ...RELEASE, first: null }),
    null,
    'no first day: nothing is released',
  );
  const rel = releaseDays(RELEASE);
  const f = rel.first;
  assert.deepStrictEqual([rel.tetra - f, rel.cube - f, rel.ball - f], [7, 21, 35]);
  const stages = day => SOLID_KINDS.map(kind => stageOf(kind, day, rel));
  assert.deepStrictEqual(stages(f - 1), ['none', 'none', 'none']);
  assert.deepStrictEqual(stages(f), ['part', 'none', 'none']);
  assert.deepStrictEqual(stages(f + 6), ['part', 'none', 'none']);
  assert.deepStrictEqual(stages(f + 7), ['all', 'none', 'none']);
  assert.deepStrictEqual(stages(f + 20), ['all', 'none', 'none']);
  assert.deepStrictEqual(stages(f + 21), ['all', 'all', 'none']);
  assert.deepStrictEqual(stages(f + 34), ['all', 'all', 'none']);
  assert.deepStrictEqual(stages(f + 35), ['all', 'all', 'all']);
  assert.deepStrictEqual(
    SOLID_KINDS.map(kind => stageOf(kind, f + 99, null)),
    ['none', 'none', 'none'],
  );
  const tetraSizes = [f - 1, f, f + 6, f + 7].map(day => openSizes('tetra', day, rel));
  assert.deepStrictEqual(tetraSizes, [[], [2], [2], [2, 3, 4, 5]]);
  const cubeSizes = [f + 20, f + 21].map(day => openSizes('cube', day, rel));
  assert.deepStrictEqual(cubeSizes, [[], SOLID_SIZES.cube]);
  assert.deepStrictEqual(
    releaseDays({ ...RELEASE, tetra: 0 }).tetra,
    f,
    'zero days: all tetra sizes at once',
  );
  for (const key of ['tetra', 'cube', 'ball']) {
    for (const bad of [-1, 1.5, '7', undefined]) {
      assert.throws(
        () => releaseDays({ ...RELEASE, [key]: bad }),
        RangeError,
        `${key}: ${bad} must throw a RangeError`,
      );
    }
  }
  releaseDays(SOLID_RELEASE); // the shipped config is valid
});

test('solid release: luckyDefs has the 3D kinds only when given a release', FAST, () => {
  assert.ok(!luckyDefs(PLAY_SIZES).some(d => d.solid), 'without a release: flat variants only');
  const rel = releaseDays(RELEASE);
  const defsOn = luckyDefs(PLAY_SIZES, rel);
  assert.deepStrictEqual(defsOn.length, PLAY_VARIANTS.length + 3);
  const solid = defsOn.filter(d => d.solid);
  assert.deepStrictEqual(
    solid.map(d => d.id),
    SOLID_KINDS,
  );
  assert.ok(
    solid.every(d => d.from === rel.first),
    'live from the first day',
  );
  const unreleased = luckyDefs(PLAY_SIZES, null).filter(d => d.solid);
  assert.ok(
    unreleased.every(d => d.from === null),
    'not released: never live',
  );
  for (const d of solid.filter(d => d.id !== 'ball')) {
    assert.ok(
      d.locked.every(n => d.pool.includes(n)),
      `${d.id}: locked sizes are pool sizes`,
    );
  }
  const byId = Object.fromEntries(solid.map(d => [d.id, d]));
  assert.ok(!byId.tetra.locked.includes(2), 'the free tetra size 2 is never a locked one');
  assert.deepStrictEqual(byId.tetra.locked, [3, 4]);
  assert.deepStrictEqual(byId.cube.locked, [2, 3]);
  assert.deepStrictEqual(byId.cube.pool, [2, 3, 4]);
  assert.deepStrictEqual(byId.ball.locked, [{ min: 10, max: 30 }]);
  assert.deepStrictEqual(byId.ball.pool, [{ min: 8, max: 100 }]);
  const open = d => [rel.first, rel.tetra, rel.cube, rel.ball].map(day => d.open(day));
  assert.deepStrictEqual(solid.map(open), [
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
const saved = (unlocked, tokens = 0) =>
  memory({
    [UNLOCK_KEY]: JSON.stringify({
      v: 1,
      unlocked,
      tokens,
      choices: 0,
      played: [],
      active: null,
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

test('solid unlock: 3D kinds wait for every flat variant and the first day', FAST, async () => {
  const early = createUnlock(memory(), withSolid, at(solidRel.first + 40));
  await early.init();
  assert.deepStrictEqual(
    (await drawn(early)).n,
    2,
    'a flat variant is still locked: 2 to draw from',
  );

  const before = createUnlock(saved(allFlat), withSolid, at(solidRel.first - 1));
  await before.init();
  assert.deepStrictEqual(
    [before.allUnlocked(), before.view().allUnlocked, before.view().open],
    [true, true, false],
    'all unlocked before the 3D release',
  );

  const day = createUnlock(saved(allFlat), withSolid, at(solidRel.first));
  await day.init();
  assert.deepStrictEqual(
    [day.allUnlocked(), day.view().open],
    [false, true],
    'the first day: the 3D kinds are new things to unlock',
  );
  assert.deepStrictEqual((await drawn(day)).n, 5, 'two flat and three 3D');
});

test('solid unlock: a chance on a 3D kind unlocks it for good, early', FAST, async () => {
  const day = solidRel.first + 2;
  const st = saved(allFlat, 1);
  const u = createUnlock(st, withSolid, at(day));
  await u.init();
  const { game } = await drawn(u, 2); // the tetra
  assert.deepStrictEqual(game.id, 'tetra');
  assert.ok(game.isNew && game.holder, 'a new kind, an unlock chance');
  assert.ok([3, 4].includes(game.size), 'a locked tetra is played at 3 or 4');
  assert.deepStrictEqual(await u.finish(true), {
    id: 'tetra',
    solved: true,
    holder: true,
    newly: true,
  });
  assert.deepStrictEqual(
    [u.unlocked('tetra'), u.unlocked('cube'), u.unlocked('ball')],
    [true, false, false],
  );
  assert.deepStrictEqual(JSON.parse(st.map.get(UNLOCK_KEY)).unlocked.tetra, day);
  const again = createUnlock(st, withSolid, at(day));
  await again.init();
  assert.ok(again.unlocked('tetra'), 'it persists');
  assert.deepStrictEqual(
    createUnlock(st, flatDefs, at(day)).unlocked('tetra'),
    false,
    'false before init',
  );
});

test('solid unlock: a kind open to everyone counts as unlocked', FAST, async () => {
  const none = createUnlock(memory(), withSolid, at(solidRel.tetra));
  await none.init();
  assert.deepStrictEqual(
    [none.unlocked('tetra'), none.unlocked('cube')],
    [true, false],
    'the tetra is open to everyone after a week',
  );

  const rich = createUnlock(saved(allFlat, 1), withSolid, at(solidRel.tetra));
  await rich.init();
  const game = await rich.begin(pick(2, 0)); // the tetra, the first size of its pool
  assert.deepStrictEqual(
    game,
    { id: 'tetra', size: 2, isNew: false, holder: true },
    'every size is drawn',
  );
  assert.deepStrictEqual(
    await rich.finish(true),
    { id: 'tetra', solved: true, holder: true, newly: false },
    'nothing to unlock',
  );

  const last = createUnlock(saved(allFlat, 1), withSolid, at(solidRel.ball));
  await last.init();
  assert.deepStrictEqual(
    [last.allUnlocked(), last.view().open],
    [true, false],
    'everything is open: no lucky game left',
  );
});

test(
  'solid lucky: a 3D lucky game is one try; a failed start gives the chance back',
  FAST,
  async () => {
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
      genNoticeHtml: () => '',
      paintGenerating: () => {},
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
    assert.deepStrictEqual([S.screen, S.lucky, timers], ['solid', true, 1]);
    let html = play.screenHtml();
    assert.ok(html.includes('lucky-chip') && html.includes('lucky-once'), 'the chip and the note');
    assert.ok(/id="solidNew" style="display:none"/.test(html), 'no new puzzle');
    assert.ok(hintHidden(html), 'no hint');
    assert.ok(html.includes('data-done="false"'), 'the lucky result goes under the game');
    S.showDev = true;
    assert.ok(!hintHidden(play.screenHtml()), 'V brings the hint back');
    S.showDev = false;

    for (const size of [2, 3]) {
      await play.start({ kind: 'cube', size, lucky: true });
      assert.deepStrictEqual([S.screen, S.lucky], ['solid', true], `cube ${size}`);
    }

    // a ball: its size is the range of cells
    for (const seed of [1, 7, 4294967295]) {
      seedValue = seed;
      await play.start({ kind: 'ball', size: { min: 10, max: 30 }, lucky: true });
      const id = /ball · ([^ ]+) · seed/.exec(play.screenHtml())[1];
      const cells = ballEntry(id).r.length;
      assert.ok(cells >= 10 && cells <= 30, `${id} has ${cells} cells`);
    }

    // a free game is no lucky game
    await play.start({ kind: 'tetra', size: 2 });
    html = play.screenHtml();
    assert.deepStrictEqual(S.lucky, false);
    assert.ok(!html.includes('lucky-chip'), 'no chip');
    assert.ok(/id="solidNew" style=""/.test(html), 'a new puzzle');
    assert.ok(!hintHidden(html), 'a hint');

    // a start that fails tells the lucky game, which gives the chance back
    const restore = [globalThis.alert, console.error];
    globalThis.alert = () => {};
    console.error = () => {};
    try {
      await play.start({ kind: 'tetra', size: 99, lucky: true }); // no such board
    } finally {
      [globalThis.alert, console.error] = restore;
    }
    assert.deepStrictEqual([calls, S.screen], [['failed'], 'menu']);
  },
);

// ---- the gift

const day = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000;
const ymd = d => new Date(d * 86400000).toISOString().slice(0, 10);
// The 1st of the i-th month counted from the month of `ref` (0 = the month of ref).
const firstOfMonth = (ref, i) => {
  const d = new Date(ref * 86400000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1) / 86400000;
};
// The happiest day of each of the first `count` months with one: the months after the month of `ref`.
const gifts = (ref, count) =>
  Array.from({ length: count }, (_, i) => giftDay(ref, firstOfMonth(ref, i + 1)));

test('gift: chain of known numbers (steps, peak); only positive integers', FAST, () => {
  assert.deepStrictEqual(chain(1), { happy: true, steps: 0, peak: 1 });
  assert.deepStrictEqual(chain(13), { happy: true, steps: 2, peak: 13 });
  assert.deepStrictEqual(chain(7), { happy: true, steps: 5, peak: 130 });
  assert.deepStrictEqual(chain(100), { happy: true, steps: 1, peak: 100 });
  assert.deepStrictEqual(
    chain(4),
    { happy: false, steps: 8, peak: 145 },
    'in the cycle: 8 steps until 4 comes back',
  );
  assert.deepStrictEqual(
    chain(2),
    { happy: false, steps: 9, peak: 145 },
    'one step before the cycle',
  );
  assert.deepStrictEqual(
    [...Array(100).keys()].map(i => i + 1).filter(n => chain(n).happy),
    [1, 7, 10, 13, 19, 23, 28, 31, 32, 44, 49, 68, 70, 79, 82, 86, 91, 94, 97, 100],
  );
  for (const bad of [0, -3, 1.5, NaN]) {
    let threw = false;
    try {
      chain(bad);
    } catch (e) {
      threw = e instanceof RangeError;
    }
    assert.ok(threw, `${bad} must throw`);
  }
});

test(
  'gift: from n = 244 on the chain never climbs above n (key 3 is then "the later day")',
  FAST,
  () => {
    for (let n = 244; n < 100000; n++) if (chain(n).peak !== n) throw new Error(`peak of ${n}`);
    assert.ok(chain(68).peak > 68 && chain(7).peak > 7, 'small numbers do climb');
  },
);

test(
  'gift: reference day 2026-12-01: its own month has no happiest day; the first is 2027-01-01 (n = 32), then 68 (tie with 86, earlier), 100, 130',
  FAST,
  () => {
    const ref = day(2026, 12, 1);
    assert.deepStrictEqual(
      monthRows(ref, ref),
      [],
      'the month of the reference day has no days that count',
    );
    assert.deepStrictEqual(
      [giftDay(ref, ref), giftDay(ref, day(2026, 12, 31)), giftDay(ref, day(2026, 11, 15))],
      [null, null, null],
    );
    const wins = gifts(ref, 12);
    assert.deepStrictEqual(wins.map(ymd), [
      '2027-01-01',
      '2027-02-06',
      '2027-03-10',
      '2027-04-09',
      '2027-05-25',
      '2027-06-26',
      '2027-07-18',
      '2027-08-20',
      '2027-09-27',
      '2027-10-06',
      '2027-11-03',
      '2027-12-18',
    ]);
    assert.deepStrictEqual(wins.map(d => d - ref + 1).slice(0, 4), [32, 68, 100, 130]);
    assert.deepStrictEqual(firstGift(ref), wins[0]);
    const feb = monthRows(ref, day(2027, 2, 10));
    assert.deepStrictEqual(feb.length, 28, 'a whole month');
    const [a, b] = [68, 86].map(n => feb.find(r => r.n === n));
    assert.deepStrictEqual(
      [a.steps, a.peak, b.steps, b.peak],
      [2, 100, 2, 100],
      'a full tie: the earlier day wins',
    );
  },
);

test(
  'gift: a late reference day: the rest of its month is skipped too; the first gift comes in the next month',
  FAST,
  () => {
    const ref = day(2026, 11, 28);
    assert.deepStrictEqual(
      [giftDay(ref, ref), giftDay(ref, day(2026, 11, 30)), lastGift(ref, day(2026, 11, 30))],
      [null, null, null],
    );
    assert.deepStrictEqual(ymd(firstGift(ref)), '2026-12-07', 'n = 10 reaches 1 in one step');
    assert.deepStrictEqual(ymd(giftDay(ref, day(2026, 12, 15))), '2026-12-07');
    assert.deepStrictEqual(
      monthRows(ref, day(2026, 10, 15)),
      [],
      'a month before ref has no days',
    );
    assert.deepStrictEqual(
      [
        nextGift(ref, day(2026, 10, 1)),
        nextGift(ref, ref),
        nextGift(ref, day(2026, 12, 6)),
        nextGift(ref, day(2026, 12, 7)),
      ].map(ymd),
      ['2026-12-07', '2026-12-07', '2026-12-07', '2027-01-15'],
    ); // Jan: n = 49 climbs to 130, n = 44 not: both take 4 steps
    assert.deepStrictEqual(day(2026, 12, 1) === firstOfMonth(ref, 1), true);
    assert.deepStrictEqual(
      [
        giftDay(null, ref),
        lastGift(null, ref),
        nextGift(null, ref),
        firstGift(null),
        isGiftDay(null, ref),
      ],
      [null, null, null, null, false],
    );
  },
);

test(
  'gift: a month without a happy number falls back to the fewest steps until a number repeats',
  FAST,
  () => {
    const ref = day(2026, 12, 1),
      d = day(2036, 6, 15);
    const rows = monthRows(ref, d);
    assert.ok(!rows.some(r => r.happy), 'June 2036 holds no happy number');
    assert.deepStrictEqual(ymd(giftDay(ref, d)), '2036-06-10');
    const win = rows.find(r => r.day === giftDay(ref, d));
    assert.deepStrictEqual([win.n, win.steps], [3480, 9]);
    assert.ok(
      rows.every(r => r.steps > win.steps || (r.steps === win.steps && r.peak <= win.peak)),
      'nobody beats it',
    );
  },
);

test(
  'gift: reference 2026-11-28, 120 months: 47 months tie on the steps alone, 1 on steps and peak',
  FAST,
  () => {
    const ref = day(2026, 11, 28);
    let tiesSteps = 0,
      tiesPeak = 0;
    for (let m = 1; m <= 120; m++) {
      const rows = monthRows(ref, firstOfMonth(ref, m));
      const pool = rows.some(r => r.happy) ? rows.filter(r => r.happy) : rows;
      const best = Math.min(...pool.map(r => r.steps)),
        top = pool.filter(r => r.steps === best);
      if (top.length > 1) tiesSteps++;
      if (top.filter(r => r.peak === Math.max(...top.map(x => x.peak))).length > 1) tiesPeak++;
    }
    assert.deepStrictEqual([tiesSteps, tiesPeak], [47, 1]);
  },
);

test(
  'gift: one happiest day per month for ten years; last/next/is agree; gaps 1..61 days',
  FAST,
  () => {
    for (const ref of [day(2026, 11, 20), day(2026, 12, 1), day(2026, 12, 12)]) {
      const wins = gifts(ref, 120);
      wins.forEach((g, i) => {
        assert.deepStrictEqual(
          ymd(g).slice(0, 7),
          ymd(firstOfMonth(ref, i + 1)).slice(0, 7),
          `month ${i + 1}: its happiest day is in it`,
        );
        assert.ok(g > ref && (!i || (g - wins[i - 1] >= 1 && g - wins[i - 1] <= 61)), `gap ${i}`);
      });
      for (let d = ref - 5; d < ref + 800; d++) {
        assert.deepStrictEqual(
          lastGift(ref, d),
          wins.filter(g => g <= d).at(-1) ?? null,
          `last ${d}`,
        );
        assert.deepStrictEqual(
          nextGift(ref, d),
          wins.find(g => g > d),
          `next ${d}`,
        );
        assert.deepStrictEqual(isGiftDay(ref, d), wins.includes(d), `is ${d}`);
      }
    }
  },
);

test(
  'gift: the reference day is never a happiest day, for any reference day of two years',
  FAST,
  () => {
    for (let ref = day(2026, 11, 1); ref < day(2028, 11, 1); ref++) {
      assert.ok(!isGiftDay(ref, ref), `${ymd(ref)} is the reference day itself`);
      assert.ok(
        firstGift(ref) > ref && firstGift(ref) < firstOfMonth(ref, 2),
        `the first gift of ${ymd(ref)} is in the next month`,
      );
    }
    const rel = releaseDays({ first: '20261201', tetra: 7, cube: 21, ball: 35 });
    assert.deepStrictEqual(isGiftDay(rel.first, rel.first), false);
    assert.deepStrictEqual(
      releaseDays({ ...SOLID_RELEASE, first: null }),
      null,
      'no release day, no reference day: no gift',
    );
  },
);

test(
  'gift: the latest happiest days, oldest first, newest on or before the day; fewer when there are not that many',
  FAST,
  () => {
    const ref = day(2026, 12, 1);
    assert.deepStrictEqual(recentGifts(ref, day(2027, 3, 12), 3).map(ymd), [
      '2027-01-01',
      '2027-02-06',
      '2027-03-10',
    ]);
    assert.deepStrictEqual(
      recentGifts(ref, day(2027, 3, 9), 3).map(ymd),
      ['2027-01-01', '2027-02-06'],
      'March is not decided yet on the 9th',
    );
    assert.deepStrictEqual(
      recentGifts(ref, day(2027, 1, 20), 6).map(ymd),
      ['2027-01-01'],
      'only one so far',
    );
    assert.deepStrictEqual(
      recentGifts(ref, day(2026, 12, 31), 6),
      [],
      'none in the month of the reference day',
    );
    assert.deepStrictEqual(recentGifts(null, ref, 6), []);
  },
);

test(
  'gift: the tooltip lists the latest 6 happiest days, but only once 6 exist (a shorter list would hold the first gift)',
  FAST,
  () => {
    const ref = day(2026, 12, 1),
      wins = gifts(ref, 8);
    assert.deepStrictEqual(listDays(ref, wins[4] + 10), [], 'five gifts so far');
    assert.deepStrictEqual(listDays(ref, wins[5] - 1), [], 'the sixth is not decided yet');
    assert.deepStrictEqual(listDays(ref, wins[5]), wins.slice(0, 6), 'on the day of the sixth');
    assert.deepStrictEqual(listDays(ref, wins[7] + 3), wins.slice(2, 8), 'always the latest six');
    assert.deepStrictEqual(listDays(null, wins[7]), []);
  },
);

test(
  'gift: the listed days are enough to find the reference day (the puzzle): one day fits, for several references and times',
  SLOW,
  () => {
    const fits = (list, from) => {
      // the reference days that give exactly these happiest days
      const out = [];
      for (let m = from; m < firstOfMonth(list[0], 0); m++)
        if (list.every(g => giftDay(m, g) === g)) out.push(m);
      return out;
    };
    for (const ref of [day(2026, 11, 28), day(2026, 12, 1), day(2026, 12, 9)]) {
      for (const months of [8, 30, 100]) {
        const list = listDays(ref, giftDay(ref, firstOfMonth(ref, months)));
        assert.deepStrictEqual(list.length, LIST_DAYS);
        assert.deepStrictEqual(
          fits(list, list[0] - 6000),
          [ref],
          `${ymd(ref)} after ${months} months`,
        );
      }
    }
  },
);

test(
  'gift state: no gift before the first happiest day or without a reference day; nothing to open on an ordinary day',
  FAST,
  async () => {
    const ref = day(2026, 12, 1);
    for (const [r, d] of [
      [null, ref],
      [ref, day(2026, 11, 30)],
      [ref, ref],
      [ref, day(2026, 12, 20)],
      [ref, firstGift(ref) + 1],
    ]) {
      const g = createGift(memory(), r, at(d));
      await g.init();
      assert.deepStrictEqual(
        [g.view(), await g.claim(() => 0)],
        [null, null],
        `${r && ymd(r)} on ${ymd(d)}`,
      );
    }
    assert.deepStrictEqual(
      await createGift(memory(), ref, at(firstGift(ref))).claim(() => 0),
      null,
      'not initialised: nothing',
    );
  },
);

test(
  'gift state: open the gift once; the kind is drawn; it stays opened for the day and is remembered',
  FAST,
  async () => {
    const ref = day(2026, 12, 1),
      first = firstGift(ref),
      st = memory(),
      asked = [];
    let g = createGift(st, ref, at(first));
    await g.init();
    assert.deepStrictEqual(g.view(), { day: first, opened: false, kind: null });
    assert.deepStrictEqual(
      await g.claim(n => {
        asked.push(n);
        return 1;
      }),
      'unlock',
    );
    assert.deepStrictEqual(asked, [2], 'a draw between the two kinds');
    assert.deepStrictEqual(g.view(), { day: first, opened: true, kind: 'unlock' });
    assert.deepStrictEqual(await g.claim(() => 0), null, 'once per happiest day');
    g = createGift(st, ref, at(first));
    await g.init(); // a reload
    assert.deepStrictEqual(g.view(), { day: first, opened: true, kind: 'unlock' });
    assert.deepStrictEqual(await g.claim(() => 0), null);
    assert.deepStrictEqual(JSON.parse(st.map.get(GIFT_KEY)), { v: 1, day: first, kind: 'unlock' });
    // the next month's day is a new gift
    const next = nextGift(ref, first);
    g = createGift(st, ref, at(next));
    await g.init();
    assert.deepStrictEqual(g.view(), { day: next, opened: false, kind: null });
    assert.deepStrictEqual(await g.claim(() => 0), 'replay');
    assert.deepStrictEqual(JSON.parse(st.map.get(GIFT_KEY)), { v: 1, day: next, kind: 'replay' });
  },
);

test(
  'gift state: nothing left to unlock gives a replay without a draw; a missed gift is gone after OPEN_DAYS',
  FAST,
  async () => {
    const ref = day(2026, 12, 1),
      first = firstGift(ref),
      g = createGift(memory(), ref, at(first));
    await g.init();
    assert.deepStrictEqual(
      await g.claim(() => {
        throw new Error('no draw');
      }, true),
      'replay',
    );
    const late = createGift(memory(), ref, at(first + OPEN_DAYS));
    await late.init();
    assert.deepStrictEqual([late.view(), await late.claim(() => 0)], [null, null]);
  },
);

test('gift state: a stored record is cleaned; junk is dropped', FAST, () => {
  assert.deepStrictEqual(sanitizeGift({ v: 1, day: null, kind: null }), {
    v: 1,
    day: null,
    kind: null,
  });
  assert.deepStrictEqual(sanitizeGift({ v: 1, day: 20800, kind: 'replay', extra: 1 }), {
    v: 1,
    day: 20800,
    kind: 'replay',
  });
  for (const bad of [
    null,
    'x',
    {},
    { v: 2, day: null },
    { v: 1, day: -1, kind: 'replay' },
    { v: 1, day: 1.5, kind: 'replay' },
    { v: 1, day: 5, kind: 'gold' },
  ]) {
    assert.deepStrictEqual(sanitizeGift(bad), null, JSON.stringify(bad));
  }
});

test('gift state: a corrupt stored value starts afresh', FAST, async () => {
  const st = memory({ [GIFT_KEY]: 'not json' }),
    ref = day(2026, 12, 1),
    first = firstGift(ref),
    g = createGift(st, ref, at(first));
  await g.init();
  assert.deepStrictEqual(g.view(), { day: first, opened: false, kind: null });
});

test(
  'gift dev note (hold V): everything about today in one object; null without a reference day',
  FAST,
  () => {
    const ref = day(2026, 12, 1);
    assert.deepStrictEqual(giftInfo(null, ref), null);
    assert.deepStrictEqual(giftInfo(undefined, ref), null);
    let info = giftInfo(ref, day(2026, 12, 20));
    assert.deepStrictEqual(
      [info.n, info.chain, info.today, info.last, info.count],
      [20, chain(20), false, null, 0],
    );
    assert.deepStrictEqual([ymd(info.first), ymd(info.next)], ['2027-01-01', '2027-01-01']);
    assert.deepStrictEqual(info.upcoming.map(ymd), [
      '2027-01-01',
      '2027-02-06',
      '2027-03-10',
      '2027-04-09',
      '2027-05-25',
      '2027-06-26',
    ]);
    info = giftInfo(ref, day(2027, 2, 6)); // a happiest day: it is today, the next is after it
    assert.deepStrictEqual(
      [info.today, ymd(info.last), ymd(info.next), info.count, info.n],
      [true, '2027-02-06', '2027-03-10', 2, 68],
    );
    assert.deepStrictEqual(info.chain, { happy: true, steps: 2, peak: 100 });
    assert.deepStrictEqual(
      giftInfo(ref, day(2026, 11, 20)).chain,
      null,
      'before the reference day: no number',
    );
    assert.deepStrictEqual(giftInfo(ref, ref + 10, 2).upcoming.length, 2);
  },
);

test('gift: drawKind draws between the kinds, or gives a replay without a draw', FAST, () => {
  assert.deepStrictEqual([drawKind(() => 0), drawKind(() => 1)], ['replay', 'unlock']);
  assert.deepStrictEqual(
    drawKind(() => {
      throw new Error('no draw');
    }, true),
    'replay',
  );
});

test('gift state: the stored record can be read (dev note)', FAST, async () => {
  const ref = day(2026, 12, 1),
    first = firstGift(ref),
    g = createGift(memory(), ref, at(first));
  assert.deepStrictEqual(g.record(), null, 'before init');
  await g.init();
  assert.deepStrictEqual(g.record(), { day: null, kind: null });
  await g.claim(() => 1);
  assert.deepStrictEqual(g.record(), { day: first, kind: 'unlock' });
});

test('gift page: button and toast follow the gift, a running game and what was told', FAST, () => {
  const wait = { day: 20788, opened: false, kind: null },
    done = { ...wait, opened: true, kind: 'replay' };
  assert.deepStrictEqual(
    present(null, null, false),
    { button: false, toast: false },
    'no gift today',
  );
  assert.deepStrictEqual(present(done, null, false), { button: false, toast: false }, 'opened');
  assert.deepStrictEqual(
    present(wait, null, false),
    { button: true, toast: true },
    'a gift waits: button and toast',
  );
  assert.deepStrictEqual(
    present(wait, null, true),
    { button: true, toast: false },
    'in a game: the button only, no toast over the board',
  );
  assert.deepStrictEqual(
    present(wait, 20788, false),
    { button: true, toast: false },
    'told once per happiest day',
  );
  assert.deepStrictEqual(
    present(wait, 20757, false),
    { button: true, toast: true },
    'told about an earlier day: tell again',
  );
});

test(
  'gift: both languages have the texts; the tooltip never says what the reference day is',
  FAST,
  () => {
    const keys = [
      'info.gift',
      'gift.title',
      'gift.ready',
      'gift.open',
      'gift.opened',
      'gift.how',
      'gift.howText',
      'gift.recent',
      'gift.soon',
    ];
    for (const dict of [EN, ZH]) {
      for (const k of keys) assert.ok(dict[k], k);
      assert.ok(dict['gift.opened'].includes('{0}'), 'the kind goes in');
      for (const k of keys.filter(x => x !== 'gift.opened')) {
        assert.ok(
          !/3D|3d|solid|release|launch|上线|发布|立体/i.test(dict[k]),
          `${k} must not tell what the reference day is`,
        );
      }
      assert.ok(
        !/own month|its own month|所在月份/.test(dict['gift.howText']),
        'no hint that the reference day wins a month',
      );
    }
  },
);
