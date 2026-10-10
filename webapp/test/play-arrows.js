// Tests of the One way arrows variant in the play app: what is pure in it (variants.js, icons.js,
// board.js, the share link). Registered by tests.js: playArrowsTests(t, ok, eq).
import { makePuzzle, maxNumber } from '../src/core/model.js';
import { edgeId, setArrowId, setWallId } from '../src/core/edges.js';
import { solve } from '../src/core/solver/solve.js';
import { runSync } from '../src/core/run.js';
import { generateArrows, ARROW_SIZES } from '../src/core/gen/arrows.js';
import { variantOf, sizesFor, nearestSize } from '../src/apps/play/variants.js';
import { variantIcon, PUZZLE_TYPES, HIDDEN_TYPES } from '../src/apps/play/icons.js';
import { boardSvg } from '../src/apps/play/board.js';
import { EN, ZH } from '../src/ui/i18n.js';
import { encodeShare, decodeShare, VARIANTS } from '../src/core/share-code.js';
import {
  makeShareRecord, shareStatus, shareText, parseShareLink, shareUrl,
} from '../src/features/share.js';

// A 3x3 puzzle: 1 at the top left, 2 at the bottom right, an arrow 4 -> 5 (right) and an arrow
// 7 -> 4 (up), so the marks point two ways.
function hand() {
  const p = makePuzzle(3);
  p.cp[0] = 1;
  p.cp[8] = 2;
  p.arrows = new Uint8Array(9);
  setArrowId(p.arrows, edgeId(3, 4, 5), 1);
  setArrowId(p.arrows, edgeId(3, 4, 7), -1);
  return p;
}

const record = (p, extra = {}) => makeShareRecord({
  n: p.n, timeS: 83.4, legs: [0, 2, 3], K: maxNumber(p), variant: 'arrows', puzzle: p, ...extra,
});

export function playArrowsTests(t, ok, eq) {
  t('play variants: variantOf, the sizes on offer, the nearest size', () => {
    const arrows = hand();
    eq([variantOf(arrows), variantOf(makePuzzle(5))], ['arrows', null]);
    eq(variantOf({ ...makePuzzle(5), holes: new Uint8Array(25) }), 'cutout');
    const all = [5, 6, 7, 8, 9, 10, 11, 12, 16];
    eq(sizesFor('standard', all), all);
    eq(sizesFor('cutout', all), all);
    eq(sizesFor('arrows', all), ARROW_SIZES);
    ok(ARROW_SIZES.every(n => all.includes(n)), 'every arrows size is a play size');
    const near = size => nearestSize(size, ARROW_SIZES);
    eq([near(12), near(7), near(4)], [9, 7, 5]);
    eq(nearestSize(6.5, [5, 6, 7]), 6, 'the smaller one on a tie');
  });

  t('play icons: the arrows type is hidden; its icon has 16 tiles and three arrowheads', () => {
    eq([PUZZLE_TYPES, HIDDEN_TYPES], [['standard', 'cutout'], ['arrows']]);
    const icon = variantIcon('arrows');
    eq((icon.match(/rx="1\.6"/g) || []).length, 16);
    eq((icon.match(/<polygon class="vi-arrow"/g) || []).length, 3);
    ok(icon.includes('vi-arrows') && icon !== variantIcon('standard'));
    ok(!variantIcon('standard').includes('vi-arrow"'));
    for (const dict of [EN, ZH]) {
      for (const key of ['mode.arrows', 'mode.arrowsTag', 'gen.subArrows', 'game.arrowsTitle',
        'game.sharedArrowsTitle', 'share.arrows', 'share.headArrows']) ok(dict[key], key);
      eq(typeof dict['gen.arrows'], 'function');
      ok(dict['gen.arrows'](3).includes('3'));
    }
  });

  t('play board: one mark per arrow, rotated to its direction; none without arrows', () => {
    const p = hand();
    const svg = boardSvg({ puzzle: p, path: [], hintCell: null, hintWrongCell: null });
    ok(svg.includes('zip-svg arrows'));
    const at = 'translate\\(([\\d.]+) ([\\d.]+)\\) rotate\\((-?\\d+)\\)';
    const mark = new RegExp(`data-arrow="(\\d+)" transform="${at}"`, 'g');
    const marks = [...svg.matchAll(mark)];
    eq(marks.length, 2);
    const byEdge = Object.fromEntries(marks.map(m => [m[1], m.slice(2).map(Number)]));
    // the cells are 60 wide: cell 4 is centred at (90, 90), 5 at (150, 90), 7 at (90, 150)
    eq(byEdge[edgeId(3, 4, 5)], [120, 90, 0], '4 -> 5 points right');
    eq(byEdge[edgeId(3, 4, 7)], [90, 120, -90], '7 -> 4 points up');
    const bare = { puzzle: makePuzzle(3), path: [], hintCell: null, hintWrongCell: null };
    const plain = boardSvg(bare);
    ok(!plain.includes('arrow-mark') && !plain.includes('zip-svg arrows'));
  });

  t('share-code: an arrows game round-trips with its puzzle; codes are short and checked', () => {
    eq(VARIANTS, [null, 'cutout', 'arrows']);
    const puzzles = [hand()];
    for (const n of [5, 7, 8]) {
      puzzles.push(runSync(generateArrows(n, 40 + n, { candidates: 1, refineNodes: 0 })));
    }
    for (const p of puzzles) {
      const rec = record(p);
      const code = encodeShare(rec);
      ok(/^[A-Za-z0-9_-]+$/.test(code), code);
      const back = decodeShare(code);
      const head = [back.kind, back.variant, back.n, back.timeS, back.levels, back.grade];
      eq(head, ['local', 'arrows', p.n, 83.4, rec.levels, null]);
      const body = q => [[...q.cp], [...q.arrows], [...q.walls]];
      eq(body(back.puzzle), body(p));
      eq(encodeShare(back), code);
      ok(decodeShare(code.slice(0, -1)) === null && decodeShare(code + 'A') === null);
      ok(parseShareLink('?s=' + code).rec.puzzle.n === p.n);
      ok(code.length <= 60, `${p.n}x${p.n}: ${code.length} characters`);
      const r = solve(back.puzzle, { limit: 2, nodeCap: 5e6 });
      ok(r.count >= 1, 'the shared puzzle is playable');
    }
    const code = encodeShare(record(puzzles[1]));
    for (let at = 3; at < code.length - 2; at += 3) {
      const other = code[at] === 'A' ? 'B' : 'A';
      const changed = code.slice(0, at) + other + code.slice(at + 1);
      ok(decodeShare(changed) === null, `a changed character at ${at}`);
    }
  });

  t('share-code: an arrows record is refused when its puzzle is unsound', () => {
    const refused = fn => {
      const p = hand();
      fn(p);
      return encodeShare(record(p, { puzzle: p }));
    };
    ok(refused(() => {}) !== null, 'the sound one is encoded');
    eq(refused(p => { p.arrows[2] = 1; }), null, 'an arrow leaving the board');
    eq(refused(p => { p.arrows[0] = 4; }), null, 'a direction bit without an arrow');
    eq(refused(p => { setWallId(p.walls, edgeId(3, 0, 1), true); }), null, 'a wall');
    eq(refused(p => { p.cp[4] = 3; p.cp[5] = 5; }), null, 'a gap in the numbers');
    eq(refused(p => { p.cp[8] = 0; }), null, 'a single checkpoint');
    eq(refused(p => { p.arrows = p.arrows.slice(0, 8); }), null, 'arrows of the wrong size');
    eq(encodeShare({ ...record(hand()), variant: 'unknown' }), null);
  });

  t('share: an arrows game has its own head text and is playable without an app version', () => {
    const rec = record(hand());
    const text = shareText(rec, 'https://x/?s=abc', (key, ...args) => key + args.join(','));
    ok(text.startsWith('share.headArrows3'), text);
    eq(shareStatus(rec, { sizes: [5, 6, 7] }), { status: 'invalid' }, 'a size not played');
    eq(shareStatus({ ...rec, n: 7 }, { sizes: [5, 6, 7] }), { status: 'ok' });
    const url = shareUrl('https://x/', rec);
    ok(url.startsWith('https://x/?s=') && decodeShare(url.split('?s=')[1]).variant === 'arrows');
  });
}
