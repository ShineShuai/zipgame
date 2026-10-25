// Tests of the Loop variant in the play app and the shared code around it: the closed ring on the
// board, the icon, the registry entry, the share code and record, the grade, a whole game and the
// lucky game. The core and the generator are in loop.js and loop-gen.js. Registered by tests.js:
// loopPlayTests(t, ta, ok, eq).
import { maxNumber } from '../src/core/model.js';
import { wallIds } from '../src/core/edges.js';
import { step, isSolved } from '../src/core/rules.js';
import { solve } from '../src/core/solver/solve.js';
import { runSync } from '../src/core/run.js';
import { generate, PLAY_SIZES } from '../src/core/gen/generate.js';
import { generateLoop, LOOP_SIZES } from '../src/core/gen/loop.js';
import { playGradesFor } from '../src/core/grades.js';
import { modelFor, LOOP_MODEL, TRAP_MODEL } from '../src/core/trap.js';
import { boardSvg, routeCells } from '../src/apps/play/board.js';
import { createUnlock } from '../src/features/unlock.js';
import { variantIcon } from '../src/apps/play/icons.js';
import {
  PLAY_VARIANTS, variantOf, variantById, sizesFor, luckyDefs,
} from '../src/apps/play/variants.js';
import { EN, ZH } from '../src/ui/i18n.js';
import { encodeShare, decodeShare, VARIANTS } from '../src/core/share-code.js';
import { makeShareRecord, shareStatus, shareText } from '../src/features/share.js';

const loopGame = (n, seed) => runSync(generateLoop(n, seed));
const record = (p, extra = {}) => makeShareRecord({
  n: p.n, timeS: 83.4, legs: [0, 2, 3], K: maxNumber(p), variant: 'loop', puzzle: p, ...extra,
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
    const standard = runSync(generate(5, 1));
    eq(routeCells(standard, standard.path, true), standard.path, 'a standard puzzle is not closed');
    eq(routeCells(p, [path[0]], true), [path[0]], 'a line of one cell');
  });

  t('loop-play: boardSvg draws one more segment when the ring is solved; other boards as before', () => {
    const p = loopGame(6, 2);
    const S = { puzzle: p, path: p.path.slice(), hintCell: null, hintWrongCell: null };
    const open = pathOf(boardSvg({ ...S, finished: false }));
    const closed = pathOf(boardSvg({ ...S, finished: true }));
    eq(segments(closed), segments(open) + 1, 'the closing segment');
    ok(closed.startsWith(open), 'the same line first');
    ok(!/wrap/.test(boardSvg({ ...S, finished: true })), 'not a wrap board');
    const grid = runSync(generate(5, 2));
    const gridS = { puzzle: grid, path: grid.path.slice(), hintCell: null, hintWrongCell: null };
    eq(pathOf(boardSvg({ ...gridS, finished: true })), pathOf(boardSvg({ ...gridS, finished: false })), 'standard');
  });

  t('loop-play: the icon: a closed ring, three numbers; the others are unchanged', () => {
    const icon = variantIcon('loop');
    ok(/class="variant-icon vi-loop"/.test(icon), 'class');
    eq((icon.match(/rx="1\.6"/g) || []).length, 16, 'sixteen tiles');
    const points = icon.match(/<polyline class="vi-path" points="([^"]*)"/)[1].split(' ');
    eq(points[0], points[points.length - 1], 'the line comes back to its start');
    eq((icon.match(/class="vi-num"/g) || []).length, 3, 'three numbers');
    for (const name of ['cutout', 'arrows', 'exact', 'wrap', 'standard']) {
      ok(!variantIcon(name).includes('vi-loop'), `${name} has no loop mark`);
    }
    eq((variantIcon('exact').match(/class="vi-num"/g) || []).length, 4, 'exact keeps its four numbers');
  });

  t('loop-play: registry entry: even sizes, detect, generator, lucky game, both languages', () => {
    const v = variantById('loop');
    ok(v && PLAY_VARIANTS.includes(v), 'loop is registered');
    eq(sizesFor('loop', PLAY_SIZES), [6, 8, 10, 12], 'free play: the even app sizes up to 12');
    eq(sizesFor('loop', PLAY_SIZES), LOOP_SIZES, 'the generator sizes');
    const p = runSync(v.generate(6, 11));
    eq([p.loop, variantOf(p), v.detect(p)], [true, 'loop', true], 'a loop puzzle is detected');
    eq(variantOf(runSync(generate(6, 11))), null, 'a standard puzzle is not');
    const lucky = luckyDefs(PLAY_SIZES).find(d => d.id === 'loop');
    eq(lucky.locked, [8, 10], 'lucky game of a locked variant');
    eq(lucky.pool, [6, 8, 10, 12], 'once unlocked: the sizes of free play');
    for (const key of Object.values(v.keys)) {
      ok(typeof EN[key] === 'string', `EN ${key}`);
      ok(typeof ZH[key] === 'string', `ZH ${key}`);
    }
    ok(VARIANTS[5] === 'loop', 'share id 5');
    for (const other of PLAY_VARIANTS.filter(x => x.id !== 'loop')) {
      ok(!other.detect(p), `${other.id} does not claim a loop puzzle`);
    }
  });

  t('loop-play: share code round-trips a loop game with its walls; damaged codes fail', () => {
    let walls = 0;
    for (const n of [6, 8]) {
      for (let seed = 1; seed <= 4; seed++) {
        const p = loopGame(n, seed);
        const rec = record(p);
        const code = encodeShare(rec);
        ok(typeof code === 'string' && code.length <= 60, `n=${n} seed ${seed}: short code (${code && code.length})`);
        const back = decodeShare(code);
        ok(back && back.variant === 'loop' && back.puzzle.loop === true, 'decodes as loop');
        eq(back.n, n);
        eq(Array.from(back.puzzle.cp), Array.from(p.cp), 'numbers');
        eq(Array.from(back.puzzle.walls), Array.from(p.walls), 'walls');
        eq(back.levels, rec.levels, 'levels');
        eq(solve(back.puzzle, { limit: 2, nodeCap: 1e9, prop: true }).count, 1, 'the decoded puzzle is unique');
        walls += wallIds(p).length;
        const bad = code.slice(0, 10) + (code[10] === 'A' ? 'B' : 'A') + code.slice(11);
        eq(decodeShare(bad), null, 'a mistyped code');
        eq(decodeShare(code.slice(0, -1)), null, 'a truncated code');
      }
    }
    ok(walls > 0, `walls went through the code (${walls})`);
  });

  t('loop-play: an unsound loop record is not encodable', () => {
    const p = loopGame(6, 4);
    ok(encodeShare(record(p)) !== null, 'the sound one is');
    const broken = change => {
      const rec = record(p);
      change(rec);
      return encodeShare(rec) === null;
    };
    ok(broken(rec => { rec.puzzle.loop = false; }), 'no loop flag');
    ok(broken(rec => { rec.puzzle.holes = new Uint8Array(36); }), 'holes');
    ok(broken(rec => { rec.puzzle.wrap = true; }), 'wrap');
    ok(broken(rec => { rec.puzzle.cp[rec.puzzle.cp.indexOf(2)] = 99; }), 'a gap in the numbers');
    ok(broken(rec => { rec.grade = 2; }), 'a record with a grade');
    const odd = loopGame(6, 4);
    const five = { n: 5, cp: new Uint16Array(25), walls: new Uint8Array(25), loop: true };
    five.cp[0] = 1;
    five.cp[4] = 2;
    five.cp[24] = 3;
    ok(encodeShare(record(five)) === null, 'an odd board');
    const two = { n: 6, cp: odd.cp.map(v => (v > 2 ? 0 : v)), walls: odd.walls.slice(), loop: true };
    ok(encodeShare(record(two)) === null, 'two numbers only');
    eq(record({ ...p, holes: new Uint8Array(36) }).puzzle.holes, undefined, 'holes are not copied');
    eq(record({ ...p, loop: false }).puzzle.loop, true, 'the variant sets the flag');
    eq(record(p, { grade: 2 }).grade, null, 'a variant record has no grade');
  });

  t('loop-play: share record copies the puzzle; text, status, sizes', () => {
    const p = loopGame(6, 3);
    const rec = record(p);
    ok(rec.puzzle.loop === true, 'the loop flag');
    ok(rec.puzzle.walls !== p.walls && rec.puzzle.cp !== p.cp, 'a copy, not the same arrays');
    eq(rec.grade, null, 'no grade');
    const tr = (key, ...args) => EN[key].replace(/\{0\}/g, args[0]);
    eq(shareText(rec, 'https://x/?s=abc', tr).split('\n')[0], 'zigzag Loop · 6x6', 'the head line');
    const ctx = { sizes: PLAY_SIZES, algo: 0, sizesOf: id => sizesFor(id, PLAY_SIZES) };
    eq(shareStatus(rec, ctx).status, 'ok', 'playable at once');
    const four = loopGame(4, 3);
    eq(shareStatus(record(four), ctx).status, 'invalid', 'size 4 is not offered');
  });

  t('loop-play: grade: trap only, reduced model, no ladder; grid grades as before', () => {
    const p = loopGame(6, 1);
    eq(modelFor(p), LOOP_MODEL, 'the loop model');
    ok(LOOP_MODEL !== TRAP_MODEL, 'not the full model');
    ok(LOOP_MODEL.w.altFrac === 0 && LOOP_MODEL.w.lTr === 0, 'reduced');
    const g = playGradesFor(p);
    ok(g.legacy === null && g.trap.ok && g.trap.ladTrials === 0, 'trap only');
    ok(Number.isInteger(g.trap.grade) && g.trap.grade >= 0 && g.trap.grade <= 5, 'a grade 0..5');
    const grid = runSync(generate(5, 1));
    eq(modelFor(grid), TRAP_MODEL, 'the grid keeps its model');
    ok(playGradesFor(grid).legacy !== null, 'the grid keeps the old grades');
  });

  t('loop-play: a whole game: the planted ring played with step() solves it; a cover that does not close does not', () => {
    for (const seed of [1, 2, 3]) {
      const p = loopGame(6, seed);
      const path = [];
      for (const cell of p.path) {
        ok(step(p, path, cell, { strictOrder: true }) === 'push', `seed ${seed}`);
      }
      ok(isSolved(p, path), `seed ${seed}: solved`);
    }
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

  t('loop-play: loop puzzles of every offered size are unique (6 to 12)', () => {
    for (const n of LOOP_SIZES) {
      const p = loopGame(n, 21);
      eq(p.n, n, `n=${n}`);
      const r = solve(p, { limit: 2, nodeCap: 2e7, prop: true });
      ok(r.count === 1 && !r.exceeded, `n=${n}: one solution`);
    }
  });

  ta('loop-play: lucky game: 8 and 10 while loop is locked, 6 to 12 once it is unlocked', async () => {
    const memory = () => {
      const map = new Map();
      return {
        map,
        async get(k) { return map.has(k) ? { value: map.get(k) } : null; },
        async set(k, v) { map.set(k, v); },
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
  });
}
