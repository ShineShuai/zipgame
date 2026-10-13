// Tests of the Exact variant in the play app: what is pure in it (variants.js, icons.js, board.js,
// the share link, the legs of the colour strip, the grade model). Registered by tests.js:
// playExactTests(t, ok, eq).
import { makePuzzle, labelCount, labelRanks, validate } from '../src/core/model.js';
import { isSolved } from '../src/core/rules.js';
import { solve } from '../src/core/solver/solve.js';
import { runSync } from '../src/core/run.js';
import { generateExact, EXACT_SIZES } from '../src/core/gen/exact.js';
import {
  variantOf, variantById, sizesFor, nearestSize, PLAY_VARIANTS,
} from '../src/apps/play/variants.js';
import { variantIcon } from '../src/apps/play/icons.js';
import { boardSvg, badgeColors, COLORS } from '../src/apps/play/board.js';
import { EN, ZH } from '../src/ui/i18n.js';
import { encodeShare, decodeShare, VARIANTS } from '../src/core/share-code.js';
import {
  makeShareRecord, legsUndo, legLevels, shareText, parseShareLink, shareUrl,
} from '../src/features/share.js';
import { solutionOf, maxHints } from '../src/features/hints.js';
import { playGradesFor } from '../src/core/grades.js';
import { modelFor, EXACT_MODEL, ARROWS_MODEL, TRAP_MODEL } from '../src/core/trap.js';
import { generateArrows } from '../src/core/gen/arrows.js';
import { generateCutout } from '../src/core/gen/cutout.js';

// An Exact puzzle with `numbers` = { cell: step }.
function exactPuzzle(n, numbers) {
  const p = makePuzzle(n);
  p.exact = true;
  for (const [cell, number] of Object.entries(numbers)) {
    p.cp[+cell] = number;
  }
  return p;
}

const fast = (n, seed) => runSync(generateExact(n, seed, { candidates: 1, refineNodes: 0 }));
const record = (p, extra = {}) => makeShareRecord({
  n: p.n, timeS: 83.4, legs: [0, 2, 3], K: labelCount(p), variant: 'exact', puzzle: p, ...extra,
});

export function playExactTests(t, ok, eq) {
  t('play exact: registry, detect, offered sizes, generator', () => {
    const variant = variantById('exact');
    eq(PLAY_VARIANTS.map(v => v.id).includes('exact'), true);
    const keys = [variant.countKey, variant.keys.name, variant.keys.shareHead];
    eq(keys, ['gen.labels', 'mode.exact', 'share.headExact']);
    const puzzle = runSync(variant.generate(5, 11));
    const kinds = [variant.detect(puzzle), variantOf(puzzle), variantOf(makePuzzle(5))];
    eq(kinds, [true, 'exact', null]);
    ok(!variantOf({ ...makePuzzle(5), holes: new Uint8Array(25) }) !== 'exact');
    const all = [5, 6, 7, 8, 9, 10, 11, 12, 16];
    eq(sizesFor('exact', all), EXACT_SIZES);
    eq([nearestSize(16, EXACT_SIZES), nearestSize(4, EXACT_SIZES)], [12, 5]);
  });

  t('play exact: the icon has 16 tiles and 4 step badges; both languages have the texts', () => {
    const icon = variantIcon('exact');
    eq((icon.match(/rx="1\.6"/g) || []).length, 16);
    eq([...icon.matchAll(/class="vi-num"[^>]*>(\d+)</g)].map(m => +m[1]), [1, 7, 12, 16]);
    ok(icon.includes('vi-exact'));
    ok(icon !== variantIcon('standard') && icon !== variantIcon('arrows'));
    ok(!variantIcon('standard').includes('vi-badge'));
    for (const dict of [EN, ZH]) {
      const keys = ['mode.exact', 'mode.exactTag', 'gen.subExact', 'game.exactTitle',
        'game.sharedExactTitle', 'share.exact', 'share.headExact', 'game.step'];
      for (const key of keys) ok(dict[key], key);
      ok(dict['gen.labels'](3).includes('3') && dict['gen.labels'](1).includes('1'));
    }
    ok(EN['game.step'].includes('{0}') && EN['game.step'].includes('{1}'));
    ok(ZH['game.step'].includes('{0}') && ZH['game.step'].includes('{1}'));
  });

  t('play exact: a game round-trips through the share link; codes are short and checked', () => {
    eq(VARIANTS.indexOf('exact'), 3);
    for (const n of [5, 7, 9, 12]) {
      const p = fast(n, 40 + n);
      const rec = record(p);
      const code = encodeShare(rec);
      ok(/^[A-Za-z0-9_-]+$/.test(code), code);
      const back = decodeShare(code);
      const head = [back.kind, back.variant, back.n, back.timeS, back.levels, back.grade];
      eq(head, ['local', 'exact', n, 83.4, rec.levels, null]);
      const body = q => [[...q.cp], [...q.walls], q.exact];
      eq(body(back.puzzle), body(p));
      eq(encodeShare(back), code);
      ok(decodeShare(code.slice(0, -1)) === null && decodeShare(code + 'A') === null);
      const flipped = code.slice(0, 7) + (code[7] === 'A' ? 'B' : 'A') + code.slice(8);
      ok(decodeShare(flipped) === null, 'a changed character is caught');
      ok(parseShareLink('?s=' + code).rec.puzzle.n === n);
      ok(shareUrl('https://x/y', rec).endsWith('?s=' + code));
      const r = solve(back.puzzle, { limit: 2, nodeCap: 5e6, prop: true, parity: true });
      eq([r.count, r.exceeded], [1, false], 'the shared puzzle is playable and unique');
      const numbers = labelCount(p);
      ok(code.length <= 28 + 3 * numbers, `${n}x${n}: ${code.length} chars, ${numbers} numbers`);
    }
    const big = exactPuzzle(16, { 0: 1, 240: 256 });
    eq(validate(big).ok, true);
    const bigBack = decodeShare(encodeShare(record(big, { legs: [] })));
    eq([bigBack.puzzle.cp[0], bigBack.puzzle.cp[240]], [1, 256], 'step 256 fits the 8 bits');
  });

  t('play exact: an unsound record is refused (flag, walls, holes, arrows, ends, legs)', () => {
    const good = fast(6, 7);
    ok(encodeShare(record(good)) !== null);
    const refused = changes => {
      const q = { ...good, cp: good.cp.slice(), walls: good.walls.slice(), ...changes };
      const rec = {
        kind: 'local', variant: 'exact', n: 6, grade: null, timeS: 5, levels: [], puzzle: q,
      };
      return encodeShare(rec) === null;
    };
    const cells = [...good.cp.keys()].filter(c => good.cp[c]);
    eq(refused({ exact: undefined }), true, 'no exact flag');
    eq(refused({ holes: new Uint8Array(36) }), true, 'holes');
    eq(refused({ arrows: new Uint8Array(36) }), true, 'arrows');
    const walled = good.walls.slice();
    walled[0] = 1;
    eq(refused({ walls: walled }), true, 'a wall');
    const last = good.cp.slice();
    last[cells[cells.length - 1]] = 35;
    eq(refused({ cp: last }), true, 'the last number is not the cell count');
    const lonely = new Uint16Array(36);
    lonely[cells[0]] = 1;
    eq(refused({ cp: lonely }), true, 'a single number');
    const far = good.cp.slice();
    far[cells[1]] += 1;
    eq(refused({ cp: far }), true, 'a leg of the wrong parity');
  });

  t('play exact: forged codes with an unsound puzzle are refused (they come from outside)', () => {
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    // the layout of core/share-code.js, written by hand: n, [cell, step - 1] per number
    const forge = (n, numbers, tenths = 834) => {
      const bits = [];
      const push = (value, width) => {
        for (let i = width - 1; i >= 0; i--) bits.push((value >>> i) & 1);
      };
      push(2, 3);
      push(3, 4);
      push(n, 5);
      push(tenths, 17);
      push(numbers.length, 7);
      for (const [cell, step] of numbers) {
        push(cell, 8);
        push(step, 8);
      }
      push(0, 6);
      let h = 0x811c9dc5;
      for (const b of bits) h = Math.imul(h ^ b, 0x01000193);
      h >>>= 0;
      push((h ^ (h >>> 8) ^ (h >>> 16) ^ (h >>> 24)) & 0xff, 8);
      let code = '';
      for (let i = 0; i < bits.length; i += 6) {
        let v = 0;
        for (let j = 0; j < 6; j++) v = (v << 1) | (bits[i + j] || 0);
        code += ALPHABET[v];
      }
      return code;
    };
    // 1 at the corner, 25 at the opposite one: 8 apart, 24 steps
    const ok5 = forge(5, [[0, 0], [24, 24]]);
    const rec = decodeShare(ok5);
    const body = [rec.variant, rec.puzzle.cp[0], rec.puzzle.cp[24], rec.puzzle.exact];
    eq(body, ['exact', 1, 25, true]);
    eq(encodeShare(rec), ok5, 'the forged frame is the real one');
    eq(decodeShare(forge(5, [[0, 0], [0, 24]])), null, 'two numbers on one cell');
    eq(decodeShare(forge(5, [[0, 0], [25, 24]])), null, 'a cell outside the board');
    eq(decodeShare(forge(5, [[0, 0], [24, 25]])), null, 'the last number is 26, board of 25');
    eq(decodeShare(forge(5, [[0, 0], [24, 23]])), null, 'the last number is 24, not 25');
    eq(decodeShare(forge(5, [[0, 0], [1, 2], [24, 24]])), null, '1 apart, 2 steps: wrong parity');
    eq(decodeShare(forge(5, [[0, 0], [5, 0], [24, 24]])), null, 'two numbers on step 1');
    eq(decodeShare(forge(5, [[0, 0]])), null, 'one number');
    eq(decodeShare(forge(5, [])), null, 'no numbers');
    eq(decodeShare(forge(1, [[0, 0], [0, 0]])), null, 'a 1x1 board');
    eq(decodeShare(forge(5, [[0, 0], [24, 24]], 0)), null, 'a time of 0');
  });

  t('play exact: a variant record never carries a grade, so a graded game still shares', () => {
    const exact = fast(6, 3);
    const arrows = runSync(generateArrows(5, 3, { candidates: 1, refineNodes: 0 }));
    const cutout = runSync(generateCutout(6, 8, { boards: 1, effort: 0.1 }));
    for (const [variant, puzzle] of [['exact', exact], ['arrows', arrows], ['cutout', cutout]]) {
      const rec = makeShareRecord({
        n: puzzle.n, grade: 3, timeS: 12.3, legs: [], K: labelCount(puzzle), variant, puzzle,
      });
      eq(rec.grade, null, variant);
      ok(encodeShare(rec) !== null, `${variant}: encodes with a grade given`);
    }
    const game = { n: 5, grade: 3, timeS: 1, legs: [], K: 3, day: 5, index: 1, algo: 2 };
    const local = makeShareRecord(game);
    eq(local.grade, 3, 'a standard game keeps its grade');
  });

  t('play exact: shareText names the variant; legs are counted by rank, not by number', () => {
    const p = fast(6, 5);
    const rec = record(p);
    const text = shareText(rec, 'https://x/?s=abc', key => EN[key]);
    ok(text.startsWith('Zip Exact'), text.split('\n')[0]);
    // 3x3, numbers 1, 5, 9 = ranks 1, 2, 3; going back from the end of the snake to length 6
    // undoes cells 7, 8, 9
    const q = exactPuzzle(3, { 0: 1, 4: 5, 8: 9 });
    const snake = [0, 1, 2, 5, 4, 3, 6, 7, 8];
    const legs = [];
    legsUndo(legs, q, snake, 6);
    eq([legs[1], legs[4], legs.length], [3, undefined, 2], 'leg 2 (rank 2 -> 3), not leg 5');
    eq(legLevels(legs, labelCount(q)), [0, 2], '3 numbers, 2 legs; 3 cells taken back = level 2');
    const ranks = labelRanks(q);
    eq([ranks[0], ranks[4], ranks[8], ranks[1]], [1, 2, 3, 0]);
    const standard = makePuzzle(3);
    standard.cp[0] = 1;
    standard.cp[8] = 2;
    eq(labelRanks(standard), standard.cp, 'a standard puzzle: the numbers are the ranks');
  });

  t('play exact: the grade model drops altFrac and the ladder; legacy grades are off', () => {
    const p = fast(6, 9);
    eq(modelFor(p), EXACT_MODEL);
    eq([EXACT_MODEL.w.altFrac, EXACT_MODEL.w.lTr], [0, 0]);
    eq(EXACT_MODEL.w.trapMax, ARROWS_MODEL.w.trapMax);
    ok(modelFor(makePuzzle(5)) === TRAP_MODEL);
    const g = playGradesFor(p);
    ok(g.trap.ok, 'a trap grade');
    eq([g.legacy, g.trap.ladTrials], [null, 0]);
    ok(g.trap.grade >= 0 && g.trap.grade <= 5 && Number.isFinite(g.trap.predicted));
  });

  t('play exact: hints work on a shared puzzle (no stored solution): it is solved lazily', () => {
    const p = fast(7, 13);
    const shared = { ...decodeShare(encodeShare(record(p))).puzzle };
    ok(!shared.path);
    const path = solutionOf(shared);
    ok(path && isSolved(shared, path), 'the solver finds the one solution');
    eq(maxHints(shared), Math.min(7, labelCount(p)));
  });

  t('play exact: a number on its step is blue, on another red; 3 digits: smaller font', () => {
    const p = exactPuzzle(3, { 0: 1, 2: 3, 8: 9 });
    const board = (puzzle, path = []) => {
      return boardSvg({ puzzle, path, hintCell: null, hintWrongCell: null });
    };
    const badge = (svg, cell) => {
      return svg.match(new RegExp(`data-num-cell="${cell}"><circle[^>]*fill="([^"]+)"`))[1];
    };
    const right = board(p, [0, 1, 2]);
    const blue = [COLORS.number, COLORS.number, COLORS.numberFill];
    eq([badge(right, 0), badge(right, 2), badge(right, 8)], blue);
    const wrong = board(p, [0, 3, 4, 1, 2]); // number 3 reached on step 5
    eq([badge(wrong, 0), badge(wrong, 2)], [COLORS.number, COLORS.numberWrong]);
    const idle = { fill: COLORS.numberFill, stroke: COLORS.number, text: COLORS.number };
    eq(badgeColors(false), idle);
    eq(badgeColors(true).fill, COLORS.number);
    const ink = COLORS.numberWrong;
    const red = { fill: ink, stroke: ink, text: COLORS.numberVisitedText };
    eq(badgeColors(true, true), red);
    const font = svg => svg.match(/font-size="([\d.]+)"/g);
    const big = exactPuzzle(11, { 0: 1, 110: 121 });
    eq(font(board(big)), ['font-size="19.2"', 'font-size="14.4"']);
    const standard = makePuzzle(3);
    standard.cp[0] = 1;
    standard.cp[8] = 12;
    eq(font(board(standard)), ['font-size="19.2"', 'font-size="19.2"']);
  });
}
