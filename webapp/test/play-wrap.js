// Tests of the wrap-around variant in the play app and the shared code around it: view geometry
// (pointer to cell, the path over a seam, seam walls), the board markup, the icon, the registry
// entry, the share code and record, and the grade. Registered by test/wrap-all.js:
// wrapPlayTests(t, ta, ok, eq).
import { makePuzzle, maxNumber } from '../src/core/model.js';
import { setWallId, edgeId, wallIds } from '../src/core/edges.js';
import { step, isSolved } from '../src/core/rules.js';
import { solve } from '../src/core/solver/solve.js';
import { runSync } from '../src/core/run.js';
import {
  generate, PLAY_SIZES, WRAP_SIZES, WRAP_CANDIDATES,
} from '../src/core/gen/generate.js';
import { playGradesFor } from '../src/core/grades.js';
import { modelFor, WRAP_MODEL, TRAP_MODEL } from '../src/core/trap.js';
import { makeRng } from '../src/core/rng.js';
import {
  cellAtPoint, pathD, wallSegments, seamMarks, WRAP_PAD, SEAM_STUB,
} from '../src/view/geometry.js';
import { boardSvg, seamMarksSvg, CELL } from '../src/apps/play/board.js';
import { createUnlock } from '../src/features/unlock.js';
import { variantIcon } from '../src/apps/play/icons.js';
import {
  PLAY_VARIANTS, variantOf, variantById, sizesFor, luckyDefs,
} from '../src/apps/play/variants.js';
import { EN, ZH } from '../src/ui/i18n.js';
import { encodeShare, decodeShare, VARIANTS } from '../src/core/share-code.js';
import { makeShareRecord, shareStatus, shareText } from '../src/features/share.js';
import { torusPuzzle } from './wrap.js';

const wrapGame = (n, seed) => runSync(generate(n, seed, { wrap: true }));
const numbers = d => d.match(/-?\d+(\.\d+)?/g).map(Number);
const record = (p, extra = {}) => makeShareRecord({
  n: p.n, timeS: 83.4, legs: [0, 2, 3], K: maxNumber(p), variant: 'wrap', puzzle: p, ...extra,
});
// The old pointer rule, kept here as the reference for boards without margin.
const oldCellAt = (n, x, y, w, h) => (x < 0 || y < 0 || x >= w || y >= h
  ? -1 : Math.floor(y / (h / n)) * n + Math.floor(x / (w / n)));

export function wrapPlayTests(t, ta, ok, eq) {
  t('wrap-play: cellAtPoint = old rule without margin; the margin wraps on a wrap board', () => {
    for (const n of [5, 6, 7, 9]) {
      for (const size of [300, 301, 477.5]) {
        for (let x = -3; x <= size + 3; x += 7.3) {
          for (let y = -3; y <= size + 3; y += 11.1) {
            const want = oldCellAt(n, x, y, size, size);
            eq(cellAtPoint(n, x, y, size, size), want, `n=${n} ${x},${y}`);
          }
        }
      }
    }
    // a 5 x 5 board with a margin of WRAP_PAD cells: the box is 5.8 cells wide
    const n = 5, unit = 100, box = (n + 2 * WRAP_PAD) * unit, at = (cx, cy, wrap = true) =>
      cellAtPoint(n, (cx + WRAP_PAD) * unit, (cy + WRAP_PAD) * unit, box, box, WRAP_PAD, wrap);
    eq(at(0.5, 0.5), 0, 'the top left cell');
    eq(at(4.5, 4.5), 24, 'the bottom right cell');
    eq(at(-0.2, 2.5), 2 * n + 4, 'the left margin is the last column of the row');
    eq(at(5.2, 2.5), 2 * n, 'the right margin is the first column of the row');
    eq(at(1.5, -0.2), 4 * n + 1, 'the top margin is the last row');
    eq(at(1.5, 5.2), 1, 'the bottom margin is the first row');
    eq(at(-0.2, -0.2), 24, 'a corner of the margin');
    eq(at(-0.2, 2.5, false), -1, 'without wrap the margin is outside');
    eq(cellAtPoint(n, -1, 5, box, box, WRAP_PAD, true), -1, 'outside the box');
  });

  t('wrap-play: a drag out of one side and into the other is a legal step', () => {
    const n = 5, p = { ...makePuzzle(n), wrap: true };
    p.cp[2 * n + 4] = 1;
    p.cp[2 * n + 1] = 2;
    const unit = 100, box = (n + 2 * WRAP_PAD) * unit;
    const cellAt = (cx, cy) => cellAtPoint(n, (cx + WRAP_PAD) * unit, (cy + WRAP_PAD) * unit, box,
      box, WRAP_PAD, true);
    const path = [];
    eq(step(p, path, cellAt(4.5, 2.5)), 'push', 'start on the last column');
    eq(step(p, path, cellAt(5.2, 2.5)), 'push', 'the margin on the right: the first column');
    eq(path, [2 * n + 4, 2 * n], 'the head is on the first column');
    eq(step(p, path, cellAt(-0.2, 2.5)), 'pop', 'back out of the left margin undoes the step');
    setWallId(p.walls, edgeId(n, 2 * n + 4, 2 * n, true), true);
    eq(step(p, path, cellAt(5.2, 2.5)), null, 'a wall on the seam blocks it');
  });

  t('wrap-play: pathD: grid path unchanged; a seam step is two stubs inside the margin', () => {
    for (const n of [4, 5]) {
      const plain = [0, 1, 2, n + 2, n + 1];
      const expect = plain.map((i, k) => (k ? 'L' : 'M') +
        [((i % n) + 0.5) * 60, (((i / n) | 0) + 0.5) * 60].join(' ')).join(' ');
      eq(pathD(n, plain, 60), expect, `n=${n}: grid path as before`);
      eq(numbers(pathD(n, plain, 60, true)), numbers(expect), `n=${n}: no seam step, same points`);
    }
    const n = 5, s = 60;
    eq(pathD(n, [4, 0], s, true), 'M270 30L315 30M-15 30L30 30', 'right over the seam');
    eq(pathD(n, [0, 4], s, true), 'M30 30L-15 30M315 30L270 30', 'left over the seam');
    eq(pathD(n, [0, 20], s, true), 'M30 30L30 -15M30 315L30 270', 'up over the seam');
    eq(pathD(n, [20, 0], s, true), 'M30 270L30 315M30 -15L30 30', 'down over the seam');
    for (let seed = 1; seed <= 12; seed++) {
      const p = wrapGame(n, seed), d = pathD(n, p.path, s, true);
      const nums = numbers(d), jumps = (d.match(/M/g) || []).length - 1;
      ok(jumps > 0, `seed ${seed}: the planted path crosses a seam`);
      ok(nums.every(v => v >= -SEAM_STUB * s - 1e-9 && v <= (n + SEAM_STUB) * s + 1e-9),
        `seed ${seed}: everything stays inside the margin`);
    }
  });

  t('wrap-play: no drawn segment of a wrap path is longer than one cell', () => {
    const n = 6, s = 60;
    for (let seed = 1; seed <= 10; seed++) {
      const p = wrapGame(n, seed), d = pathD(n, p.path, s, true);
      const parts = d.match(/[ML]-?[\d.]+ -?[\d.]+/g);
      let prev = null;
      for (const part of parts) {
        const [x, y] = part.slice(1).split(' ').map(Number);
        if (part[0] === 'L' && prev) {
          ok(Math.hypot(x - prev[0], y - prev[1]) <= 1.01 * s, `seed ${seed}: segment ${part}`);
        }
        prev = [x, y];
      }
    }
  });

  t('wrap-play: wallSegments: a seam wall on both borders; the grid is unchanged', () => {
    const n = 4, s = 10, p = { ...makePuzzle(n), wrap: true };
    setWallId(p.walls, edgeId(n, 1, 2, true), true); // inside
    setWallId(p.walls, edgeId(n, 7, 4, true), true); // right seam, row 1
    setWallId(p.walls, edgeId(n, 13, 1, true), true); // bottom seam, column 1
    const segs = wallSegments(p, s);
    eq(segs.length, 5, 'one plus two plus two');
    ok(segs.some(g => g.join() === [40, 10, 40, 20].join()), 'right border, row 1');
    ok(segs.some(g => g.join() === [0, 10, 0, 20].join()), 'left border, row 1');
    ok(segs.some(g => g.join() === [10, 40, 20, 40].join()), 'bottom border, column 1');
    ok(segs.some(g => g.join() === [10, 0, 20, 0].join()), 'top border, column 1');
    const grid = makePuzzle(n);
    setWallId(grid.walls, edgeId(n, 1, 2), true);
    setWallId(grid.walls, edgeId(n, 5, 9), true);
    eq(wallSegments(grid, s), [[20, 0, 20, 10], [10, 20, 20, 20]], 'grid walls: one segment each');
  });

  t('wrap-play: boardSvg: margin, dashed outline on a wrap board; grid board as before', () => {
    const p = wrapGame(5, 2);
    const S = { puzzle: p, path: p.path.slice(0, 8), hintCell: null, hintWrongCell: null };
    const svg = boardSvg(S);
    const m = WRAP_PAD * CELL;
    const side = 5 * CELL + 2 * m;
    ok(svg.includes(`viewBox="${-m} ${-m} ${side} ${side}"`), 'padded viewBox');
    ok(/class="zip-svg wrap"/.test(svg), 'the wrap class');
    ok(/data-role="outline"[^>]*stroke-dasharray/.test(svg), 'dashed outline');
    ok(/data-role="path" d="M/.test(svg), 'the path is drawn');
    const grid = runSync(generate(5, 2));
    const gridSvg = boardSvg({ puzzle: grid, path: [], hintCell: null, hintWrongCell: null });
    ok(gridSvg.includes(`viewBox="0 0 ${5 * CELL} ${5 * CELL}"`), 'grid: viewBox without margin');
    ok(!/wrap/.test(gridSvg) && !/dasharray/.test(gridSvg), 'grid: nothing of the wrap board');
  });

  t('wrap-play: the icon: two path pieces and two stubs; the others are unchanged', () => {
    const icon = variantIcon('wrap');
    ok(/class="variant-icon vi-wrap"/.test(icon), 'class');
    eq((icon.match(/rx="1\.6"/g) || []).length, 16, 'sixteen tiles');
    eq((icon.match(/<polyline class="vi-path"/g) || []).length, 2, 'two path pieces');
    eq((icon.match(/<circle class="vi-dot"/g) || []).length, 2, 'start and end');
    for (const name of ['cutout', 'arrows', 'exact', 'standard']) {
      ok(!variantIcon(name).includes('vi-wrap'), `${name} has no wrap mark`);
    }
  });

  t('wrap-play: registry entry: sizes, detect, generator, lucky game, both languages', () => {
    const v = variantById('wrap');
    ok(v && PLAY_VARIANTS.includes(v), 'wrap is registered');
    eq(WRAP_SIZES, [4, 5, 6, 7, 8], 'the generator sizes on offer');
    eq(sizesFor('wrap', PLAY_SIZES), [4, 5, 6, 7, 8], 'free play: 4 to 8 (4 is not an app size)');
    ok(!PLAY_SIZES.includes(4), 'the standard game does not get 4');
    ok(WRAP_SIZES.every(n => WRAP_CANDIDATES[n] >= 2), 'every offered size has a candidate count');
    const p = runSync(v.generate(5, 11));
    eq([p.wrap, variantOf(p), v.detect(p)], [true, 'wrap', true], 'a wrap puzzle is detected');
    eq(variantOf(runSync(generate(5, 11))), null, 'a standard puzzle is not');
    const lucky = luckyDefs(PLAY_SIZES).find(d => d.id === 'wrap');
    eq(lucky.locked, [4, 5, 6], 'lucky game of a locked variant: 4 to 6');
    eq(lucky.pool, [4, 5, 6, 7, 8], 'once unlocked: the sizes of free play');
    eq(lucky.pool, sizesFor('wrap', PLAY_SIZES), 'the same list');
    for (const key of Object.values(v.keys)) {
      ok(typeof EN[key] === 'string' || typeof EN[key] === 'function', `EN ${key}`);
      ok(typeof ZH[key] === 'string' || typeof ZH[key] === 'function', `ZH ${key}`);
    }
    ok(VARIANTS[4] === 'wrap', 'share id 4');
  });

  t('wrap-play: share code round-trips a wrap game with seam walls; damaged codes fail', () => {
    let seamWalls = 0;
    for (const n of [5, 6]) {
      for (let seed = 1; seed <= 6; seed++) {
        const p = wrapGame(n, seed), rec = record(p);
        const code = encodeShare(rec);
        ok(typeof code === 'string' && code.length <= 45, `n=${n} seed ${seed}: short code`);
        const back = decodeShare(code);
        ok(back && back.variant === 'wrap' && back.puzzle.wrap === true, 'decodes as wrap');
        eq(Array.from(back.puzzle.cp), Array.from(p.cp), 'numbers');
        eq(Array.from(back.puzzle.walls), Array.from(p.walls), 'walls, seam ones included');
        eq(back.levels, rec.levels, 'levels');
        eq(solve(back.puzzle, { limit: 2, nodeCap: 1e9 }).count, 1, 'the decoded puzzle is unique');
        const seam = e => (e & 1 ? (e >> 1) >= n * (n - 1) : (e >> 1) % n === n - 1);
        seamWalls += wallIds(p).filter(seam).length;
        const bad = code.slice(0, 10) + (code[10] === 'A' ? 'B' : 'A') + code.slice(11);
        eq(decodeShare(bad), null, 'a mistyped code');
        eq(decodeShare(code.slice(0, -1)), null, 'a truncated code');
      }
    }
    ok(seamWalls > 0, `a seam wall went through the code (${seamWalls})`);
  });

  t('wrap-play: an unsound wrap record is not encodable', () => {
    const p = wrapGame(5, 4);
    ok(encodeShare(record(p)) !== null, 'the sound one is');
    const broken = change => {
      const rec = record(p);
      change(rec);
      return encodeShare(rec) === null;
    };
    ok(broken(rec => { rec.puzzle.wrap = false; }), 'no wrap flag');
    ok(broken(rec => { rec.puzzle.holes = new Uint8Array(25); }), 'holes');
    ok(broken(rec => { rec.puzzle.cp[rec.puzzle.cp.indexOf(2)] = 9; }), 'a gap in the numbers');
    ok(broken(rec => { rec.grade = 2; }), 'a record with a grade');
    const two = { ...makePuzzle(2), wrap: true };
    two.cp[0] = 1;
    two.cp[3] = 2;
    ok(encodeShare(record(two)) === null, '2 x 2');
    eq(record({ ...p, holes: new Uint8Array(25) }).puzzle.holes, undefined, 'holes are not copied');
    eq(record({ ...p, wrap: false }).puzzle.wrap, true, 'the variant sets the flag');
    eq(record(p, { grade: 2 }).grade, null, 'a variant record has no grade');
  });

  t('wrap-play: share record copies the puzzle; text, status', () => {
    const p = wrapGame(6, 3), rec = record(p);
    ok(rec.puzzle.wrap === true, 'the wrap flag');
    ok(rec.puzzle.walls !== p.walls && rec.puzzle.cp !== p.cp, 'a copy, not the same arrays');
    eq(rec.grade, null, 'no grade');
    const tr = (key, ...args) => EN[key].replace(/\{0\}/g, args[0]);
    const text = shareText(rec, 'https://x/?s=abc', tr);
    eq(text.split('\n')[0], 'zigzag Wrap-around · 6x6', 'the head line');
    eq(shareStatus(rec, { sizes: PLAY_SIZES, algo: 0 }).status, 'ok', 'playable at once');
  });

  t('wrap-play: grade: trap only, reduced model, no ladder; grid grades as before', () => {
    const p = wrapGame(5, 1);
    eq(modelFor(p), WRAP_MODEL, 'the wrap model');
    ok(WRAP_MODEL !== TRAP_MODEL, 'not the full model');
    ok(WRAP_MODEL.w.altFrac === 0 && WRAP_MODEL.w.lTr === 0, 'reduced');
    const g = playGradesFor(p);
    ok(g.legacy === null && g.trap.ok && g.trap.ladTrials === 0, 'trap only');
    ok(Number.isInteger(g.trap.grade) && g.trap.grade >= 0 && g.trap.grade <= 5, 'a grade 0..5');
    const grid = runSync(generate(5, 1));
    eq(modelFor(grid), TRAP_MODEL, 'the grid keeps its model');
    ok(playGradesFor(grid).legacy !== null, 'the grid keeps the old grades');
  });

  t('wrap-play: a whole game: the planted path played with step() solves it', () => {
    for (const seed of [1, 2, 3]) {
      const p = wrapGame(6, seed), path = [];
      for (const cell of p.path) {
        ok(step(p, path, cell, { strictOrder: true }) === 'push', `seed ${seed}`);
      }
      ok(isSolved(p, path), `seed ${seed}: solved`);
    }
    const { p, path } = torusPuzzle(5, 5, makeRng(5), 0.3), played = [];
    for (const cell of path) step(p, played, cell);
    ok(isSolved(p, played), 'a hand-made torus puzzle');
  });

  t('wrap-play: seamMarks: an out and an in arrowhead per seam step, in its direction', () => {
    const n = 5, s = 60;
    eq(seamMarks(n, [0, 1, 2], s), [], 'no seam step, no marks');
    const right = seamMarks(n, [4, 0], s); // right over the seam, row 0
    eq(right.map(m => m.kind), ['out', 'in'], 'one of each');
    eq(right[0], { kind: 'out', x: 300 + 0.17 * s, y: 30, dx: 1, dy: 0 }, 'out: right of it');
    eq(right[1], { kind: 'in', x: -0.15 * s, y: 30, dx: 1, dy: 0 }, 'in: left of the board');
    const left = seamMarks(n, [0, 4], s);
    eq([left[0].x < 0, left[0].dx, left[1].x > 300, left[1].dx], [true, -1, true, -1], 'left');
    const upSeam = seamMarks(n, [0, 20], s);
    const [upOut, upIn] = upSeam;
    eq([upOut.y < 0, upOut.dy, upIn.y > 300, upIn.dy], [true, -1, true, -1], 'up');
    const downSeam = seamMarks(n, [20, 0], s);
    const [downOut, downIn] = downSeam;
    eq([downOut.y > 300, downOut.dy, downIn.y < 0, downIn.dy], [true, 1, true, 1], 'down');
    for (let seed = 1; seed <= 10; seed++) {
      const p = wrapGame(6, seed), marks = seamMarks(6, p.path, 60);
      const jumps = (pathD(6, p.path, 60, true).match(/M/g) || []).length - 1;
      eq(marks.length, 2 * jumps, `seed ${seed}: two marks per seam step`);
      for (const m of marks) {
        const outside = m.x < 0 || m.x > 360 || m.y < 0 || m.y > 360;
        ok(outside, `seed ${seed}: ${m.kind} mark in the margin`);
        const within = v => v >= -WRAP_PAD * 60 && v <= 360 + WRAP_PAD * 60;
        ok(within(m.x) && within(m.y), `seed ${seed}: inside the drawn margin`);
        // out: pointing away from the board centre; in: pointing toward it
        const far = (x, y) => (x - 180) ** 2 + (y - 180) ** 2; // from the board centre
        const away = far(m.x + m.dx, m.y + m.dy) > far(m.x, m.y);
        ok(m.kind === 'out' ? away : !away, `seed ${seed}: ${m.kind} direction`);
      }
    }
  });

  t('wrap-play: the board draws the marks for the path and none without a seam step', () => {
    const p = wrapGame(5, 2);
    const full = boardSvg({ puzzle: p, path: p.path, hintCell: null, hintWrongCell: null });
    const jumps = (pathD(5, p.path, CELL, true).match(/M/g) || []).length - 1;
    eq((full.match(/data-mark="out"/g) || []).length, jumps, 'out marks');
    eq((full.match(/data-mark="in"/g) || []).length, jumps, 'in marks');
    ok(/<g data-role="seam">/.test(full), 'the group the input updates');
    eq(seamMarksSvg(5, [0, 1, 2]), '', 'nothing without a seam step');
    const plain = runSync(generate(5, 2));
    const grid = boardSvg({ puzzle: plain, path: [], hintCell: null, hintWrongCell: null });
    ok(!/data-role="seam"/.test(grid) && !/data-mark/.test(grid), 'the grid board has none');
  });

  t('wrap-play: a shared wrap game of size 4 is playable though the app has no size 4', () => {
    const p = wrapGame(4, 3), rec = record(p);
    const ctx = { sizes: PLAY_SIZES, algo: 0, sizesOf: id => sizesFor(id, PLAY_SIZES) };
    eq(shareStatus(rec, ctx).status, 'ok', 'size 4 with the variant sizes');
    const without = shareStatus(rec, { sizes: PLAY_SIZES, algo: 0 });
    eq(without.status, 'invalid', 'without them it is not');
    const back = decodeShare(encodeShare(rec));
    ok(back && back.n === 4 && back.puzzle.wrap === true, 'the size 4 code round-trips');
    const three = { ...rec, n: 3, puzzle: { ...rec.puzzle, n: 3 } };
    eq(shareStatus(three, ctx).status, 'invalid', 'size 3 is offered by nobody');
    const standard = shareStatus({ ...rec, variant: undefined, algo: 0, n: 4 }, ctx);
    eq(standard.status, 'invalid', 'a standard record of size 4 stays invalid');
  });

  t('wrap-play: wrap puzzles of every offered size are unique (4 to 8)', () => {
    for (const n of WRAP_SIZES) {
      const p = wrapGame(n, 21);
      eq(p.n, n, `n=${n}`);
      eq(solve(p, { limit: 2, nodeCap: 5e6, prop: true }).count, 1, `n=${n}: one solution`);
    }
  });

  ta('wrap-play: lucky game: 4 to 6 while wrap is locked, 4 to 8 once it is unlocked', async () => {
    const memory = () => {
      const map = new Map();
      return {
        map,
        async get(k) { return map.has(k) ? { value: map.get(k) } : null; },
        async set(k, v) { map.set(k, v); },
      };
    };
    const defs = luckyDefs(PLAY_SIZES), index = defs.findIndex(d => d.id === 'wrap');
    const MON = 20731, at = day => () => new Date(day * 86400000);
    const pick = (...values) => { const q = [...values]; return () => q.shift(); };
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
      await u.refund(); // the chance and the offer come back
    }
    eq(seen, [4, 5, 6], 'locked: only 4 to 6');
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
    eq(sizes, [4, 5, 6, 7, 8], 'unlocked: the sizes of free play');
  });
}
