// Tests of the Loop variant in the play app and the shared code around it: the closed ring on the
// board, the icon, the registry entry, the share code and record, the grade, a whole game and the
// lucky game. The core and the generator are in loop.js and loop-gen.js. Registered by unit/loop.test.js:
// loopPlayTests(t, ta, ok, eq).
import { maxNumber } from '../src/core/model.js';
import { step, isSolved } from '../src/core/rules.js';
import { PLAY_SIZES } from '../src/core/gen/generate.js';
import { boardSvg, routeCells } from '../src/apps/play/board.js';
import { createUnlock } from '../src/features/unlock.js';
import { luckyDefs } from '../src/apps/play/variants.js';
import { encodeShare } from '../src/core/share-code.js';
import { makeShareRecord } from '../src/features/share.js';
import { made } from './fixtures/made.js';

const loopGame = (n, seed) => made('loop', n, seed);
const record = (p, extra = {}) =>
  makeShareRecord({
    n: p.n,
    timeS: 83.4,
    legs: [0, 2, 3],
    K: maxNumber(p),
    variant: 'loop',
    puzzle: p,
    ...extra,
  });
// The number of line segments of an SVG path d.
const segments = d => (d.match(/[ML]/g) || []).length;
const pathOf = svg => svg.match(/data-role="path" d="([^"]*)"/)[1];

export function loopPlayTests(t, ta, ok, eq) {
  t('loop-play: routeCells closes the ring of a solved Loop puzzle only', () => {
    const p = loopGame(6, 1);
    const path = p.path.slice();
    eq(routeCells(p, path, false), path, 'not solved yet: the line as it is');
    eq(routeCells(p, path, true), [...path, path[0]], 'solved: back to cell 1');
    const standard = made('std', 5, 1);
    eq(
      routeCells(standard, standard.path, true),
      standard.path,
      'a standard puzzle is not closed',
    );
    eq(routeCells(p, [path[0]], true), [path[0]], 'a line of one cell');
  });

  t(
    'loop-play: boardSvg draws one more segment when the ring is solved; other boards as before',
    () => {
      const p = loopGame(6, 2);
      const S = { puzzle: p, path: p.path.slice(), hintCell: null, hintWrongCell: null };
      const open = pathOf(boardSvg({ ...S, finished: false }));
      const closed = pathOf(boardSvg({ ...S, finished: true }));
      eq(segments(closed), segments(open) + 1, 'the closing segment');
      ok(closed.startsWith(open), 'the same line first');
      ok(!/wrap/.test(boardSvg({ ...S, finished: true })), 'not a wrap board');
      const grid = made('std', 5, 2);
      const gridS = { puzzle: grid, path: grid.path.slice(), hintCell: null, hintWrongCell: null };
      eq(
        pathOf(boardSvg({ ...gridS, finished: true })),
        pathOf(boardSvg({ ...gridS, finished: false })),
        'standard',
      );
    },
  );

  t('loop-play: an unsound loop record is not encodable', () => {
    const p = loopGame(6, 4);
    ok(encodeShare(record(p)) !== null, 'the sound one is');
    const broken = change => {
      const rec = record(p);
      change(rec);
      return encodeShare(rec) === null;
    };
    ok(
      broken(rec => {
        rec.puzzle.loop = false;
      }),
      'no loop flag',
    );
    ok(
      broken(rec => {
        rec.puzzle.holes = new Uint8Array(36);
      }),
      'holes',
    );
    ok(
      broken(rec => {
        rec.puzzle.wrap = true;
      }),
      'wrap',
    );
    ok(
      broken(rec => {
        rec.puzzle.cp[rec.puzzle.cp.indexOf(2)] = 99;
      }),
      'a gap in the numbers',
    );
    ok(
      broken(rec => {
        rec.grade = 2;
      }),
      'a record with a grade',
    );
    const odd = loopGame(6, 4);
    const five = { n: 5, cp: new Uint16Array(25), walls: new Uint8Array(25), loop: true };
    five.cp[0] = 1;
    five.cp[4] = 2;
    five.cp[24] = 3;
    ok(encodeShare(record(five)) === null, 'an odd board');
    const two = {
      n: 6,
      cp: odd.cp.map(v => (v > 2 ? 0 : v)),
      walls: odd.walls.slice(),
      loop: true,
    };
    ok(encodeShare(record(two)) === null, 'two numbers only');
    eq(
      record({ ...p, holes: new Uint8Array(36) }).puzzle.holes,
      undefined,
      'holes are not copied',
    );
    eq(record({ ...p, loop: false }).puzzle.loop, true, 'the variant sets the flag');
    eq(record(p, { grade: 2 }).grade, null, 'a variant record has no grade');
  });

  // (that the planted ring solves the puzzle is a row of variant-contract.js)
  t('loop-play: a cover that does not close the ring does not solve the puzzle', () => {
    // 4 x 4, numbers on three corners: the serpentine covers the board but ends 3 cells from cell 1
    const p = { n: 4, cp: new Uint16Array(16), walls: new Uint8Array(16), loop: true };
    p.cp[0] = 1;
    p.cp[3] = 2;
    p.cp[15] = 3;
    const snake = [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12];
    const path = [];
    for (const cell of snake) step(p, path, cell, { strictOrder: true });
    eq(path.length, 16, 'all cells are covered');
    ok(!isSolved(p, path), 'but the last cell does not touch cell 1');
  });

  ta(
    'loop-play: lucky game: 8 and 10 while loop is locked, 6 to 12 once it is unlocked',
    async () => {
      const memory = () => {
        const map = new Map();
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
      const defs = luckyDefs(PLAY_SIZES);
      const index = defs.findIndex(d => d.id === 'loop');
      const MON = 20731;
      const at = day => () => new Date(day * 86400000);
      const pick = (...values) => {
        const q = [...values];
        return () => q.shift();
      };
      const store = memory();
      let u = createUnlock(store, defs, at(MON));
      await u.init();
      await u.addChoice();
      await u.takeChoice();
      await u.addToken();
      const seen = [];
      for (let k = 0; k < defs[index].locked.length; k++) {
        const game = await u.begin(pick(index, k));
        seen.push(game.size);
        eq(game.isNew, true, 'a locked variant');
        await u.refund();
      }
      eq(seen, [8, 10], 'locked: only 8 and 10');
      await u.begin(pick(index, 0));
      eq((await u.finish(true)).newly, true, 'solved: unlocked');
      u = createUnlock(store, defs, at(20743));
      await u.init();
      const sizes = [];
      for (let k = 0; k < defs[index].pool.length; k++) {
        const game = await u.begin(pick(index, k));
        sizes.push(game.size);
        eq(game.isNew, false, 'an unlocked variant');
        await u.refund();
      }
      eq(sizes, [6, 8, 10, 12], 'unlocked: the sizes of free play');
    },
  );
}
