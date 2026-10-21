// Tests of the Pentagon variant in the play app: the registry entry and texts, the icon, the board
// (apps/play/pentagon-board.js), walking and hints on it, the share text, and the links of the
// time before the 96-cell board (they must read as they did). Registered by tests.js:
// playPentagonTests(t, ok, eq). The page itself (apps/play/main.js) is not run here.
import { runSync } from '../src/core/run.js';
import { COLORS } from '../src/apps/play/board.js';
import { generatePentagon } from '../src/core/gen/pentagon.js';
import { generate } from '../src/core/gen/generate.js';
import {
  PENTAGON_KIND, PENTAGON_SIZES, PENTAGON_CELLS,
} from '../src/core/pentagon.js';
import { SLOTS, surfaceTopology } from '../src/core/surface/topology.js';
import {
  step as surfaceStep, isSolved as surfaceSolved, makeSurfacePuzzle, wallCount, maxNumber,
} from '../src/core/surface/puzzle.js';
import { encodeShare, decodeShare, PENTAGON } from '../src/core/share-code.js';
import {
  makeShareRecord, shareText, shareStatus, isPlayable, sizeArg,
} from '../src/features/share.js';
import { sanitize, serialize as serializeShared } from '../src/features/shared-games.js';
import { maxHints, computeHint, solutionOf } from '../src/features/hints.js';
import {
  PLAY_VARIANTS, variantById, variantOf, sizesFor, luckyDefs,
} from '../src/apps/play/variants.js';
import { PLAY_SIZES } from '../src/core/gen/generate.js';
import { variantIcon } from '../src/apps/play/icons.js';
import {
  pentagonBoardSvg, pentagonCellAt, pentagonCentres, pentagonPoint, pentagonRouteD,
  pentagonView, pentagonAcross,
} from '../src/apps/play/pentagon-board.js';
import { EN, ZH, t as translate, setLang } from '../src/ui/i18n.js';

const game = (n, seed) => runSync(generatePentagon(n, seed));
const count = (text, part) => text.split(part).length - 1;
const state = (p, path = [], extra = {}) => ({
  puzzle: p, path, hintCell: null, hintWrongCell: null, ...extra,
});

// Links made before the 96-cell board existed (n = 4, 6, 8, 10; made-up puzzles: numbers on the
// cells in order, walls on the edges). Never edit these codes: they are what a player may still
// hold, and they have to decode to the same puzzle.
const OLD_LINKS = [
  { code: 'xgAY4HiSGI', n: 4, cells: [0, 7, 15], edges: [1, 5] },
  { code: 'yuBryndeBGJ', n: 6, cells: [0, 20, 35], edges: [2, 9] },
  { code: 'xWABJ_1pO1Z-OK', n: 8, cells: [0, 31, 63, 12], edges: [3, 40] },
  { code: 'wgBDQGCPTQFQBuL', n: 10, cells: [0, 37, 99, 12], edges: [3, 4, 100] },
];

export function playPentagonTests(t, ok, eq) {
  t('play-pentagon: the registry entry — detect, sizes, lucky game, texts in both '
    + 'languages', () => {
    const v = variantById(PENTAGON);
    ok(v && PLAY_VARIANTS.includes(v), 'registered');
    ok(v.detect(game(4, 1)), 'detects its puzzles');
    ok(!v.detect(runSync(generate(5, 1))), 'and not a square one');
    eq(variantOf(game(4, 1)), PENTAGON);
    for (const other of PLAY_VARIANTS.filter(x => x.id !== PENTAGON)) {
      ok(!other.detect(game(4, 1)), `${other.id} does not claim it`);
    }
    eq(sizesFor(PENTAGON, [5, 6, 7]), PENTAGON_SIZES, 'its boards, whatever the grid sizes are');
    eq(sizesFor(PENTAGON, PLAY_SIZES), PENTAGON_SIZES);
    const lucky = luckyDefs(PLAY_SIZES).find(d => d.id === PENTAGON);
    eq([lucky.locked, lucky.pool], [[6, 8], PENTAGON_SIZES], 'a locked one draws 36 or 64 cells');
    for (const dict of [EN, ZH]) {
      for (const key of Object.values(v.keys)) ok(dict[key], `${key}`);
      ok(dict['size.cells'], 'size.cells');
    }
    ok(EN['mode.pentagonRules'].includes('pentagon') && EN['mode.pentagonRules'].includes('five'));
  });

  t('play-pentagon: the menu icon shows the pentagon board and its path', () => {
    const icon = variantIcon('pentagon');
    ok(icon.startsWith('<svg') && icon.endsWith('</svg>') && icon.includes('vi-pentagon'));
    eq(count(icon, '<polygon'), 16, 'the 16 cells of the smallest board');
    ok(icon.includes('<polyline class="vi-path"') && count(icon, 'vi-dot') === 2, 'path, two ends');
    ok(icon !== variantIcon('standard') && icon !== variantIcon('wrap'));
  });

  t('play-pentagon: sizes are shown as cells; the share text says so in both languages', () => {
    eq(PENTAGON_SIZES.map(n => sizeArg({ variant: PENTAGON, n })), [16, 36, 64, 96, 100]);
    const squares = [{ variant: null, n: 7 }, { variant: 'wrap', n: 6 }].map(sizeArg);
    eq(squares, [7, 6], 'squares: n');
    const p = game(6, 3);
    const rec = makeShareRecord({
      n: 6, timeS: 41.2, legs: [], K: maxNumber(p), variant: PENTAGON, puzzle: p,
    });
    try {
      setLang('en');
      const text = shareText(rec, 'http://x/?s=abc', translate);
      ok(text.startsWith('Zip Pentagon · 36 cells\n⏱ 41.2s'), text);
      setLang('zh');
      ok(shareText(rec, 'http://x/?s=abc', translate).startsWith('Zip 五边形 · 36 格'), 'zh');
      eq(translate('game.pentagonTitle', 36), '五边形 · 36 格');
      eq(translate('size.cells', 36), '36 格');
    } finally {
      setLang('en');
    }
    const sizesOf = id => sizesFor(id, PLAY_SIZES);
    const status = shareStatus(rec, { sizes: PLAY_SIZES, sizesOf });
    ok(isPlayable(status), 'a shared Pentagon game plays');
  });

  t('play-pentagon: the board markup — a polygon per cell, walls, border, badges, path, '
    + 'hints', () => {
    for (const n of [4, 6, 9]) {
      const p = game(n, 2);
      const top = surfaceTopology(PENTAGON_KIND, n);
      const markup = pentagonBoardSvg(state(p, p.path.slice(0, 6)));
      eq(count(markup, '<polygon'), top.T, `n=${n}: cells`);
      eq(count(markup, 'data-num-cell='), maxNumber(p), 'badges');
      let border = 0;
      for (let i = 0; i < top.T * SLOTS; i++) if (i % SLOTS < 5 && top.nb[i] < 0) border++;
      const walls = markup.match(/data-role="walls"[^>]*>([^]*?)<\/g>/)[1];
      eq(count(walls, '<line'), wallCount(p), 'one line per wall');
      const outline = markup.match(/data-role="outline"[^>]*>([^]*?)<\/g>/)[1];
      eq(count(outline, '<line'), border, 'border');
      eq(count(markup.match(/data-role="path" d="([^"]*)"/)[1], 'L'), 5, 'the path of 6 cells');
      ok(markup.includes('class="zip-svg pentagon"') && markup.startsWith('<svg viewBox="'), 'svg');
      ok(!markup.includes('data-role="hint"') && !markup.includes('data-role="hint-wrong"'));
      const hinted = pentagonBoardSvg(
        state(p, [], { hintCell: p.path[0], hintWrongCell: p.path[3] }),
      );
      ok(hinted.includes('data-role="hint"'), 'the ring');
      ok(hinted.includes('data-role="hint-wrong"'), 'the cross');
      const filled = pentagonBoardSvg(state(p, [p.path[0]]));
      ok(filled.includes(`fill="${COLORS.number}"`), 'a visited number is filled');
    }
  });

  t('play-pentagon: a point finds its cell — the centre, near each side, nothing outside; a '
    + 'pointer position maps into the view', () => {
    for (const n of PENTAGON_SIZES) {
      const p = makeSurfacePuzzle(PENTAGON_KIND, n);
      const centres = pentagonCentres(p);
      eq(centres.length, PENTAGON_CELLS[n]);
      const view = pentagonView(p);
      ok(view.w > 100 && view.h > 100, 'a view');
      centres.forEach(([x, y], cell) => {
        eq(pentagonCellAt(p, x, y), cell, `n=${n} centre of ${cell}`);
      });
      eq(pentagonCellAt(p, view.x - 50, view.y - 50), -1, 'outside');
      eq(pentagonCellAt(p, view.x + view.w + 50, view.y + view.h + 50), -1);
      ok(Math.abs(pentagonAcross(p) ** 2 - PENTAGON_CELLS[n]) < 1e-9);
      const rect = { left: 10, top: 20, width: 200, height: 200 * view.h / view.w };
      const [x, y] = pentagonPoint(p, rect, 10 + 100, 20 + rect.height / 2);
      ok(Math.abs(x - (view.x + view.w / 2)) < 1e-9 && Math.abs(y - (view.y + view.h / 2)) < 1e-9);
    }
    const p = makeSurfacePuzzle(PENTAGON_KIND, 4);
    eq(pentagonRouteD(p, [0, 1, 2]).match(/[ML]/g), ['M', 'L', 'L']);
    eq(pentagonRouteD(p, []), '');
  });

  t('play-pentagon: walking — the solution is a run of pushes, one step back pops, a far '
    + 'cell is refused, the last push solves it', () => {
    const p = game(6, 4);
    const path = [];
    p.path.forEach((cell, i) => {
      eq(surfaceStep(p, path, cell), 'push', `step ${i}`);
      eq(surfaceSolved(p, path), i === p.path.length - 1, `solved after ${i + 1} cells`);
    });
    eq(surfaceStep(p, path, p.path[34]), 'pop', 'one step back');
    eq(surfaceStep(p, path, p.path[35]), 'push');
    const walking = [];
    surfaceStep(p, walking, p.path[0]);
    eq(surfaceStep(p, walking, p.path[20]), null, 'a cell that is not next to the head');
    eq(surfaceStep(p, walking, p.path[0]), null, 'the head again');
    eq(surfaceStep(p, [], p.path[1]), null, 'the first press has to be the 1');
  });

  t('play-pentagon: hints — the solution of a received puzzle is found, the hint says what is '
    + 'next and where the player went wrong', () => {
    const made = game(6, 5);
    const received = decodeShare(encodeShare(makeShareRecord({
      n: 6, timeS: 10, legs: [], K: maxNumber(made), variant: PENTAGON, puzzle: made,
    }))).puzzle;
    ok(!received.path, 'a link carries no solution');
    eq(solutionOf(received), made.path, 'it is solved for the hint');
    eq(computeHint(made.path, []), { correctCell: made.path[0], wrongCell: null });
    const three = made.path.slice(0, 3);
    eq(computeHint(made.path, three), { correctCell: made.path[3], wrongCell: null });
    const wrong = [...made.path.slice(0, 3), made.path[10]];
    eq(computeHint(made.path, wrong), { correctCell: made.path[3], wrongCell: made.path[10] });
    ok(maxHints(made) >= 3 && maxHints(made) <= 6);
  });

  t('play-pentagon: links from before the 96-cell board decode as they did, a stored shared game '
    + 'is read and written again in the current format, a damaged one is dropped', () => {
    for (const { code, n, cells, edges } of OLD_LINKS) {
      const rec = decodeShare(code);
      ok(rec && rec.variant === PENTAGON && rec.n === n, `${code} reads`);
      eq(Array.from(rec.puzzle.cp).flatMap((v, cell) => (v ? [[v, cell]] : []))
        .sort((a, b) => a[0] - b[0]).map(x => x[1]), cells, `${n}: numbers`);
      const walls = Array.from(rec.puzzle.walls).flatMap((v, edge) => (v ? [edge] : []));
      eq(walls, edges, `${n}: walls`);
      eq(rec.timeS, 12.3);
      eq(encodeShare(rec), code, `${n}: the same code again`);
    }
    // 96-cell links are new: size index 4, and they are told apart from the others
    const made = makeSurfacePuzzle(PENTAGON_KIND, 9);
    [0, 95, 12].forEach((cell, i) => { made.cp[cell] = i + 1; });
    const code96 = encodeShare(makeShareRecord({
      n: 9, timeS: 12.3, legs: [], K: 3, variant: PENTAGON, puzzle: made,
    }));
    eq(decodeShare(code96).n, 9);
    ok(!OLD_LINKS.some(link => link.code === code96));
    // the shared games of a device: codes, decoded on load, encoded on save
    const stored = { v: 1, items: [...OLD_LINKS.map((link, i) => ({ c: link.code, a: 100 + i })),
      { c: code96, a: 200 }, { c: `${code96}x`, a: 300 }, { c: 'not a code', a: 400 }] };
    const entries = sanitize(stored);
    eq(entries.map(e => e.rec.n), [4, 6, 8, 10, 9], 'every good game, no damaged one');
    eq(JSON.parse(serializeShared(entries)).items.map(item => item.c),
      [...OLD_LINKS.map(link => link.code), code96], 'written again, the same codes');
    eq(sanitize(JSON.parse(serializeShared(entries))).map(e => e.key), entries.map(e => e.key));
  });
}
